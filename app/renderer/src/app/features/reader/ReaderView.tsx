import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addHighlight,
  deleteHighlight,
  exportAnnotatedPdf,
  exportMarkdown,
  listHighlights,
  readDocumentPdfBytes,
  updateHighlight,
  updateReadingState,
} from '../../api';
import {
  WEBVIEWER_CUSTOM_COLOR_KEY,
  WEBVIEWER_CUSTOM_ID_KEY,
  WEBVIEWER_CUSTOM_RICH_TEXT_KEY,
  WEBVIEWER_CUSTOM_TEXT_KEY,
  buildQuadSignature,
  highlightToWebViewerColor,
  isWebViewerHighlightAnnotation,
  mergeNormalizedRects,
  selectionObjectToPlainText,
  webViewerColorToHighlight,
  webViewerQuadToNormalizedRect,
} from '../../lib/highlight';
import { clamp, normalizeSelectionText, normalizeText, truncate, truncateSelectionText } from '../../lib/format';
import { HIGHLIGHT_COLORS, highlightColorLabel } from '../../lib/highlightColors';
import { formatErrorToast } from '../../lib/errors';
import {
  addDebugEvent,
  incrementDebugCounter,
  setDebugGauge,
} from '../../lib/debugTrace';
import { LiquidSurface } from '../../components/LiquidSurface';
import { useRenderProfiler } from '../../lib/perfProfiler';
import type {
  AppSettings,
  DocumentRecord,
  HighlightColor,
  HighlightRecord,
  NavigateToHighlight,
  WorkspacePreset,
} from '../../types';
import { useViewerLifecycle } from './hooks/useViewerLifecycle';
import { useSelectionDraft } from './hooks/useSelectionDraft';
import { useReadingProgress } from './hooks/useReadingProgress';
import { useHighlightSync } from './hooks/useHighlightSync';
import { ReaderMiniMap } from './components/ReaderMiniMap';

interface ReaderViewProps {
  workspacePreset: WorkspacePreset;
  document: DocumentRecord;
  settings: AppSettings;
  highlights: HighlightRecord[];
  pendingNavigation: NavigateToHighlight | null;
  onNavigationConsumed: () => void;
  onBackToLibrary: () => void;
  onOpenHighlightsTab: () => void;
  onSetHighlights: (documentId: string, highlights: HighlightRecord[]) => void;
  onUpsertHighlight: (highlight: HighlightRecord) => void;
  onDeleteHighlightFromStore: (documentId: string, highlightId: string) => void;
  onSetCurrentPage: (pageIndex: number, totalPages: number) => void;
  onNotify: (message: string, type?: 'info' | 'error' | 'success') => void;
  onCopyDeepLink: (documentId: string, pageIndex: number, highlightId?: string) => Promise<void> | void;
}

const TOOLBAR_GROUP = 'toolbarGroup-View';
const TOOL_NAME_HIGHLIGHT = 'AnnotationCreateTextHighlight';
const READING_PERSIST_MIN_SECONDS = 12;
const HIGHLIGHT_OPACITY = 0.24;
const READER_SIDE_COLLAPSED_KEY = 'recall.ui.readerSideCollapsed';
const READER_SIDE_WIDTH_KEY = 'recall.ui.readerSideWidth';
const MIN_READER_SIDE_WIDTH = 300;
const MAX_READER_SIDE_WIDTH = 640;

const NOTE_TEMPLATES: Array<{
  id: 'insight' | 'question' | 'action';
  label: string;
  prefix: string;
}> = [
  { id: 'insight', label: 'Вывод', prefix: 'Вывод:' },
  { id: 'question', label: 'Вопрос', prefix: 'Вопрос:' },
  { id: 'action', label: 'Действие', prefix: 'Действие:' },
];

const TAG_STOPWORDS = new Set([
  'и',
  'в',
  'во',
  'не',
  'на',
  'но',
  'что',
  'как',
  'это',
  'для',
  'или',
  'при',
  'где',
  'когда',
  'чтобы',
  'the',
  'and',
  'with',
  'from',
  'that',
  'this',
  'into',
  'over',
  'under',
  'about',
]);

type BufferLike = {
  type?: string;
  data?: number[];
};

function toArrayBuffer(bytes: ArrayBuffer | Uint8Array | BufferLike) {
  if (bytes instanceof ArrayBuffer) {
    return bytes;
  }

  if (ArrayBuffer.isView(bytes)) {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  }

  const nodeBufferLike = bytes as BufferLike;
  if (nodeBufferLike?.type === 'Buffer' && Array.isArray(nodeBufferLike.data)) {
    return new Uint8Array(nodeBufferLike.data).buffer;
  }

  throw new Error('Неподдерживаемый формат PDF-данных.');
}

function normalizeTemplateNote(current: string, templatePrefix: string): string {
  const cleanTemplate = String(templatePrefix || '').trim();
  if (!cleanTemplate) {
    return String(current || '');
  }
  const normalizedCurrent = String(current || '').trim();
  if (!normalizedCurrent) {
    return `${cleanTemplate} `;
  }
  if (normalizedCurrent.toLowerCase().startsWith(cleanTemplate.toLowerCase())) {
    return normalizedCurrent;
  }
  return `${cleanTemplate} ${normalizedCurrent}`.trim();
}

function tokenizeForTags(value: string): string[] {
  return normalizeSelectionText(value)
    .toLowerCase()
    .replace(/[_/\\]+/g, ' ')
    .replace(/[^\p{L}\p{N}\- ]+/gu, ' ')
    .split(/\s+/)
    .map((token) => token.replace(/^-+|-+$/g, ''))
    .filter(Boolean);
}

function extractSuggestedTags(sourceText: string, existingTags: string[] = [], limit = 6): string[] {
  const existing = new Set(
    existingTags
      .map((tag) => normalizeText(tag).toLowerCase())
      .filter(Boolean),
  );
  const frequencies = new Map<string, number>();
  for (const token of tokenizeForTags(sourceText)) {
    if (token.length < 3 || token.length > 28) {
      continue;
    }
    if (/^\d+$/.test(token)) {
      continue;
    }
    if (TAG_STOPWORDS.has(token) || existing.has(token)) {
      continue;
    }
    frequencies.set(token, (frequencies.get(token) || 0) + 1);
  }

  return [...frequencies.entries()]
    .sort((left, right) => right[1] - left[1] || right[0].length - left[0].length)
    .slice(0, Math.max(1, Math.trunc(Number(limit || 6))))
    .map(([tag]) => tag);
}

function splitTextIntoBalancedSegments(textRaw: string, partsRaw: number): string[] {
  const text = normalizeSelectionText(textRaw);
  const parts = Math.max(1, Math.trunc(Number(partsRaw || 1)));
  if (!text) {
    return Array.from({ length: parts }, () => '');
  }
  if (parts <= 1) {
    return [text];
  }

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= parts) {
    const result = words.map((word) => normalizeSelectionText(word));
    while (result.length < parts) {
      result.push(text);
    }
    return result;
  }

  const segments: string[] = [];
  let start = 0;
  for (let index = 0; index < parts; index += 1) {
    const isLast = index === parts - 1;
    const end = isLast
      ? words.length
      : clamp(Math.round(((index + 1) * words.length) / parts), start + 1, words.length - 1);
    segments.push(normalizeSelectionText(words.slice(start, end).join(' ')));
    start = end;
  }
  return segments.map((segment) => segment || text);
}

function getHighlightAnchor(highlight: HighlightRecord): { y: number; x: number } {
  const prepared = (highlight.rects ?? [])
    .filter((rect) => rect && Number(rect.w) > 0 && Number(rect.h) > 0)
    .sort((left, right) => {
      if (Math.abs(left.y - right.y) > 0.0001) {
        return left.y - right.y;
      }
      return left.x - right.x;
    });
  const first = prepared[0];
  return {
    y: Number(first?.y ?? 1),
    x: Number(first?.x ?? 1),
  };
}

function compareHighlightsByPosition(left: HighlightRecord, right: HighlightRecord): number {
  if (left.pageIndex !== right.pageIndex) {
    return left.pageIndex - right.pageIndex;
  }
  const leftAnchor = getHighlightAnchor(left);
  const rightAnchor = getHighlightAnchor(right);
  if (Math.abs(leftAnchor.y - rightAnchor.y) > 0.0001) {
    return leftAnchor.y - rightAnchor.y;
  }
  if (Math.abs(leftAnchor.x - rightAnchor.x) > 0.0001) {
    return leftAnchor.x - rightAnchor.x;
  }
  return new Date(left.createdAt).valueOf() - new Date(right.createdAt).valueOf();
}

function selectionToRichText(selection: Selection | null | undefined, fallbackText: string) {
  if (!selection || selection.rangeCount === 0) {
    return fallbackText;
  }

  try {
    const fragment = selection.getRangeAt(0).cloneContents();
    const container = document.createElement('div');
    container.appendChild(fragment);
    const html = container.innerHTML.trim();
    if (!html) {
      return fallbackText;
    }
    return html.slice(0, 24000);
  } catch {
    return fallbackText;
  }
}

function normalizeHighlightPayload(
  annotation: any,
  documentViewer: any,
  selectedText: string,
  selectedRichText: string,
) {
  const pageNumber = Math.max(1, Number(annotation?.PageNumber ?? 1));
  const pageInfo = documentViewer.getDocument().getPageInfo(pageNumber);
  const quads = annotation.getQuads?.() ?? annotation.Quads ?? [];
  const rects = mergeNormalizedRects(
    quads
      .map((quad: any) => webViewerQuadToNormalizedRect(quad, pageInfo))
      .filter(Boolean),
  );

  if (rects.length === 0) {
    return null;
  }

  const note = normalizeText(annotation?.getContents?.() ?? '');
  const customColor = String(annotation?.getCustomData?.(WEBVIEWER_CUSTOM_COLOR_KEY) || '').trim();
  const hasCustomColor = HIGHLIGHT_COLORS.includes(customColor as HighlightColor);
  const annotationColor =
    annotation?.Color ??
    annotation?.StrokeColor ??
    annotation?.FillColor ??
    (typeof annotation?.getColor === 'function' ? annotation.getColor() : undefined);

  return {
    pageIndex: pageNumber - 1,
    rects,
    selectedText,
    selectedRichText,
    color: hasCustomColor
      ? (customColor as HighlightColor)
      : webViewerColorToHighlight(annotationColor),
    note: note || undefined,
    tags: [],
  };
}

function colorLabel(color: HighlightColor) {
  return highlightColorLabel(color);
}

function shouldIgnoreAnnotationSyncEvent(syncSuppressed: boolean, info: any): boolean {
  const source = String(info?.source || '');
  return Boolean(syncSuppressed || info?.imported || source === 'recall-sync');
}

function toSearchable(value: unknown) {
  return normalizeSelectionText(
    String(value ?? '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' '),
  ).toLowerCase();
}

function trySelectHighlightAnnotation(instance: any, highlightId?: string) {
  if (!instance || !highlightId) {
    return false;
  }

  const { annotationManager } = instance.Core;
  const target = annotationManager
    .getAnnotationsList()
    .find(
      (annotation: any) =>
        String(annotation.getCustomData(WEBVIEWER_CUSTOM_ID_KEY) || '') === String(highlightId),
    );

  if (!target) {
    return false;
  }

  annotationManager.deselectAllAnnotations();
  annotationManager.selectAnnotation(target);
  if (typeof annotationManager.jumpToAnnotation === 'function') {
    try {
      annotationManager.jumpToAnnotation(target, { fitToView: true });
    } catch {
      try {
        annotationManager.jumpToAnnotation(target);
      } catch {
        // ignore jump errors, selection already succeeded
      }
    }
  }
  return true;
}

function selectHighlightAnnotationWithRetry(instance: any, highlightId?: string, attempts = 5) {
  if (!instance || !highlightId) {
    return;
  }

  let remaining = Math.max(1, Math.trunc(attempts));
  const run = () => {
    const selected = trySelectHighlightAnnotation(instance, highlightId);
    if (selected || remaining <= 1) {
      return;
    }
    remaining -= 1;
    window.setTimeout(run, 140);
  };
  run();
}

function getTextSelectToolName(Tools: any): string | null {
  const candidates = [
    Tools?.ToolNames?.TEXT_SELECT,
    Tools?.ToolNames?.TEXT_SELECT_TOOL,
    Tools?.ToolNames?.TextSelect,
    Tools?.ToolNames?.TextSelection,
    'TextSelect',
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate;
    }
  }

  return null;
}

function extractSelectionQuadGroups(allQuads: any, fallbackPageNumber?: number): Array<{
  pageNumber: number;
  quads: any[];
}> {
  const groups: Array<{ pageNumber: number; quads: any[] }> = [];
  const visited = new Set<number>();

  const pushGroup = (pageNumberRaw: any, quadsRaw: any) => {
    const pageNumber = Math.max(1, Number(pageNumberRaw || fallbackPageNumber || 1));
    const quads = Array.isArray(quadsRaw) ? quadsRaw.filter(Boolean) : [];
    if (quads.length === 0 || visited.has(pageNumber)) {
      return;
    }
    visited.add(pageNumber);
    groups.push({ pageNumber, quads });
  };

  if (Array.isArray(allQuads)) {
    pushGroup(fallbackPageNumber, allQuads);
    return groups;
  }

  if (allQuads && typeof allQuads === 'object') {
    for (const [pageNumber, quads] of Object.entries(allQuads)) {
      pushGroup(pageNumber, quads);
    }
  }

  if (groups.length === 0 && Number.isFinite(Number(fallbackPageNumber))) {
    pushGroup(fallbackPageNumber, allQuads);
  }

  return groups;
}

function normalizeSelectionQuadGroups(allQuads: any, fallbackPageNumber?: number): Array<{
  pageNumber: number;
  quads: any[];
  signature: string;
}> {
  return extractSelectionQuadGroups(allQuads, fallbackPageNumber)
    .map((group) => {
      const pageNumber = Math.max(1, Number(group.pageNumber || fallbackPageNumber || 1));
      const quads = Array.isArray(group.quads) ? group.quads.filter(Boolean) : [];
      return {
        pageNumber,
        quads,
        signature: buildQuadSignature(quads),
      };
    })
    .filter((group) => Boolean(group.signature) && group.quads.length > 0)
    .sort((left, right) => left.pageNumber - right.pageNumber);
}

function splitSelectionTextByGroups(
  selectedTextRaw: string,
  groups: Array<{ quads: any[] }>,
): string[] {
  const selectedText = normalizeSelectionText(selectedTextRaw);
  if (!selectedText || groups.length === 0) {
    return [];
  }

  if (groups.length === 1) {
    return [selectedText];
  }

  const words = selectedText.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [];
  }

  const segments: string[] = [];
  const weights = groups.map((group) => Math.max(1, Number(group.quads?.length || 0)));
  const totalWeight = Math.max(1, weights.reduce((sum, weight) => sum + weight, 0));
  let consumedWords = 0;
  let consumedWeight = 0;

  for (let index = 0; index < groups.length; index += 1) {
    if (index === groups.length - 1) {
      const tail = normalizeSelectionText(words.slice(consumedWords).join(' '));
      segments.push(tail || selectedText);
      break;
    }

    consumedWeight += weights[index];
    const expectedEnd = Math.round((words.length * consumedWeight) / totalWeight);
    const minEnd = consumedWords + 1;
    const maxEnd = words.length - (groups.length - index - 1);
    const sliceEnd = clamp(expectedEnd, minEnd, maxEnd);
    const segment = normalizeSelectionText(words.slice(consumedWords, sliceEnd).join(' '));
    segments.push(segment || selectedText);
    consumedWords = sliceEnd;
  }

  if (segments.length !== groups.length) {
    return groups.map(() => selectedText);
  }

  return segments;
}

async function navigateToPageWithRetry(instance: any, targetPageIndexRaw: number, attempts = 8) {
  const documentViewer = instance?.Core?.documentViewer;
  if (!documentViewer?.getPageCount || !documentViewer?.setCurrentPage || !documentViewer?.getCurrentPage) {
    return false;
  }

  const totalPages = Math.max(1, Number(documentViewer.getPageCount() || 1));
  const targetPageIndex = clamp(Number(targetPageIndexRaw || 0), 0, totalPages - 1);
  const tries = Math.max(1, Math.trunc(Number(attempts || 1)));

  for (let index = 0; index < tries; index += 1) {
    documentViewer.setCurrentPage(targetPageIndex + 1, false);
    // WebViewer can reflow after setCurrentPage, so verify target in a short retry loop.
    await new Promise((resolve) => {
      window.setTimeout(resolve, 72 + index * 14);
    });

    const currentPageIndex = clamp(Number(documentViewer.getCurrentPage() || 1) - 1, 0, totalPages - 1);
    if (currentPageIndex === targetPageIndex) {
      return true;
    }
  }

  return false;
}

export const __readerTestUtils = {
  toArrayBuffer,
  selectionToRichText,
  normalizeHighlightPayload,
  colorLabel,
  trySelectHighlightAnnotation,
  selectHighlightAnnotationWithRetry,
  getTextSelectToolName,
  extractSelectionQuadGroups,
  normalizeSelectionQuadGroups,
  splitSelectionTextByGroups,
  navigateToPageWithRetry,
  shouldIgnoreAnnotationSyncEvent,
};

export function ReaderView({
  workspacePreset,
  document,
  settings,
  highlights,
  pendingNavigation,
  onNavigationConsumed,
  onBackToLibrary,
  onOpenHighlightsTab,
  onSetHighlights,
  onUpsertHighlight,
  onDeleteHighlightFromStore,
  onSetCurrentPage,
  onNotify,
  onCopyDeepLink,
}: ReaderViewProps) {
  useRenderProfiler('ReaderView');
  const { hostRef, instanceRef, viewerReady, viewerInitError, retryViewerInit } =
    useViewerLifecycle({
      toolbarGroup: TOOLBAR_GROUP,
    });

  const commitSelectionRef = useRef<(() => boolean) | null>(null);
  const clearSelectionRef = useRef<(() => void) | null>(null);
  const eventsBoundRef = useRef(false);
  const suppressSyncRef = useRef(false);

  const {
    pageInput,
    setPageInput,
    currentPageLocal,
    setCurrentPageLocal,
    totalPagesLocal,
    setTotalPagesLocal,
    loadingDocumentRef,
    restoreTargetPageRef,
    restoreGuardUntilRef,
    restoreInProgressRef,
    lastPersistTsRef,
    lastPersistPageRef,
    maxPageSeenRef,
    beginRestoreNavigation,
    completeRestoreNavigationIfNeeded,
    enforceRestoreTarget,
  } = useReadingProgress(document);

  const {
    searchText,
    setSearchText,
    visibleHighlightsCount,
    setVisibleHighlightsCount,
    pendingSelectionText,
    setPendingSelectionText,
    pendingSelectionPage,
    setPendingSelectionPage,
    pendingSelectionPageEnd,
    setPendingSelectionPageEnd,
    pendingNote,
    setPendingNote,
    pendingNoteRef,
    lastSelectionRef,
    clearPendingSelection,
    getHighlightNoteDraft,
    setHighlightNoteDraft,
    clearHighlightNoteDraft,
  } = useSelectionDraft(document.id);

  const [activeColor, setActiveColor] = useState<HighlightColor>('yellow');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reloadNonce, setReloadNonce] = useState(0);
  const [isSidePanelCollapsed, setIsSidePanelCollapsed] = useState(false);
  const [readerSideWidth, setReaderSideWidth] = useState(360);
  const [selectedHighlightIds, setSelectedHighlightIds] = useState<string[]>([]);

  const currentDocumentIdRef = useRef(document.id);

  const activeColorRef = useRef<HighlightColor>('yellow');
  const lastCreatedSelectionRef = useRef<{
    pageNumber: number;
    signature: string;
    timestamp: number;
  } | null>(null);

  const highlightsRef = useRef<HighlightRecord[]>(highlights);
  const pendingNavigationRef = useRef<NavigateToHighlight | null>(pendingNavigation);
  const onNavigationConsumedRef = useRef(onNavigationConsumed);
  const onSetHighlightsRef = useRef(onSetHighlights);
  const onUpsertHighlightRef = useRef(onUpsertHighlight);
  const onDeleteHighlightFromStoreRef = useRef(onDeleteHighlightFromStore);
  const onSetCurrentPageRef = useRef(onSetCurrentPage);
  const onNotifyRef = useRef(onNotify);

  const documentHighlights = useMemo(() => {
    const normalizedSearch = toSearchable(searchText);
    const sorted = [...highlights].sort((left, right) => {
      if (left.pageIndex === right.pageIndex) {
        return new Date(right.createdAt).valueOf() - new Date(left.createdAt).valueOf();
      }
      return left.pageIndex - right.pageIndex;
    });

    if (!normalizedSearch) {
      return sorted;
    }

    return sorted.filter((highlight) => {
      const haystack = [
        highlight.selectedText,
        highlight.selectedRichText,
        highlight.note,
        ...(highlight.tags ?? []),
      ]
        .map((part) => toSearchable(part))
        .join(' ');
      return haystack.includes(normalizedSearch);
    });
  }, [highlights, searchText]);

  const highlightCountByPage = useMemo(() => {
    const map = new Map<number, number>();
    for (const highlight of highlights) {
      const pageIndex = Math.max(0, Number(highlight.pageIndex || 0));
      map.set(pageIndex, (map.get(pageIndex) || 0) + 1);
    }
    return map;
  }, [highlights]);

  const positionSortedHighlights = useMemo(
    () => [...highlights].sort(compareHighlightsByPosition),
    [highlights],
  );

  const highlightContextMap = useMemo(() => {
    const map = new Map<string, { before: string; after: string }>();
    for (let index = 0; index < positionSortedHighlights.length; index += 1) {
      const current = positionSortedHighlights[index];
      const previous = positionSortedHighlights[index - 1];
      const next = positionSortedHighlights[index + 1];
      map.set(current.id, {
        before:
          previous && previous.pageIndex === current.pageIndex
            ? truncateSelectionText(previous.selectedText, 160)
            : '',
        after:
          next && next.pageIndex === current.pageIndex
            ? truncateSelectionText(next.selectedText, 160)
            : '',
      });
    }
    return map;
  }, [positionSortedHighlights]);

  const tagSuggestionsByHighlightId = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const highlight of documentHighlights) {
      const source = `${highlight.selectedText || ''} ${highlight.note || ''}`;
      map.set(highlight.id, extractSuggestedTags(source, highlight.tags ?? [], 6));
    }
    return map;
  }, [documentHighlights]);

  const selectedHighlights = useMemo(
    () => highlights.filter((highlight) => selectedHighlightIds.includes(highlight.id)),
    [highlights, selectedHighlightIds],
  );

  const selectedHighlightsCanMerge = useMemo(() => {
    if (selectedHighlights.length < 2) {
      return false;
    }
    return new Set(selectedHighlights.map((highlight) => highlight.pageIndex)).size === 1;
  }, [selectedHighlights]);

  const selectedHighlightsPageLabel = useMemo(() => {
    if (selectedHighlights.length === 0) {
      return '';
    }
    const pages = [...new Set(selectedHighlights.map((highlight) => highlight.pageIndex + 1))]
      .sort((left, right) => left - right);
    if (pages.length === 1) {
      return `стр. ${pages[0]}`;
    }
    return `стр. ${pages[0]}-${pages[pages.length - 1]}`;
  }, [selectedHighlights]);

  useEffect(() => {
    setDebugGauge('reader.highlights.total', highlights.length, 'reader', {
      documentId: document.id,
    });
  }, [document.id, highlights.length]);

  useEffect(() => {
    setDebugGauge('reader.highlights.filtered', documentHighlights.length, 'reader', {
      documentId: document.id,
    });
  }, [document.id, documentHighlights.length]);

  useEffect(() => {
    setDebugGauge('reader.search.length', searchText.length, 'reader', {
      documentId: document.id,
    });
  }, [document.id, searchText.length]);

  useEffect(() => {
    try {
      setIsSidePanelCollapsed(window.localStorage.getItem(READER_SIDE_COLLAPSED_KEY) === '1');
      const rawSideWidth = Number(window.localStorage.getItem(READER_SIDE_WIDTH_KEY) || 0);
      if (Number.isFinite(rawSideWidth) && rawSideWidth >= MIN_READER_SIDE_WIDTH) {
        setReaderSideWidth(
          Math.min(MAX_READER_SIDE_WIDTH, Math.max(MIN_READER_SIDE_WIDTH, Math.trunc(rawSideWidth))),
        );
      }
    } catch {
      // ignore storage access failures
    }
  }, []);

  useEffect(() => {
    if (workspacePreset === 'focus') {
      setIsSidePanelCollapsed(true);
      return;
    }

    if (!settings.focusMode) {
      setIsSidePanelCollapsed(false);
    }
  }, [settings.focusMode, workspacePreset]);

  useEffect(() => {
    try {
      window.localStorage.setItem(READER_SIDE_COLLAPSED_KEY, isSidePanelCollapsed ? '1' : '0');
    } catch {
      // ignore storage access failures
    }
  }, [isSidePanelCollapsed]);

  useEffect(() => {
    try {
      window.localStorage.setItem(READER_SIDE_WIDTH_KEY, String(readerSideWidth));
    } catch {
      // ignore storage access failures
    }
  }, [readerSideWidth]);

  useEffect(() => {
    currentDocumentIdRef.current = document.id;
  }, [document.id]);

  useEffect(() => {
    setSelectedHighlightIds([]);
  }, [document.id]);

  useEffect(() => {
    highlightsRef.current = highlights;
  }, [highlights]);

  useEffect(() => {
    setSelectedHighlightIds((current) => {
      const existing = new Set(highlights.map((highlight) => highlight.id));
      const next = current.filter((id) => existing.has(id));
      return next.length === current.length ? current : next;
    });
  }, [highlights]);

  useEffect(() => {
    pendingNavigationRef.current = pendingNavigation;
  }, [pendingNavigation]);

  useEffect(() => {
    activeColorRef.current = activeColor;
  }, [activeColor]);

  useEffect(() => {
    onNavigationConsumedRef.current = onNavigationConsumed;
    onSetHighlightsRef.current = onSetHighlights;
    onUpsertHighlightRef.current = onUpsertHighlight;
    onDeleteHighlightFromStoreRef.current = onDeleteHighlightFromStore;
    onSetCurrentPageRef.current = onSetCurrentPage;
    onNotifyRef.current = onNotify;
  }, [
    onDeleteHighlightFromStore,
    onNavigationConsumed,
    onNotify,
    onSetCurrentPage,
    onSetHighlights,
    onUpsertHighlight,
  ]);

  useEffect(() => {
    if (viewerInitError) {
      setLoading(false);
    }
  }, [viewerInitError]);

  const logAction = useCallback(
    (action: string, details?: string, highlightId?: string) => {
      const event = addDebugEvent('reader', action, {
        documentId: document.id,
        highlightId,
        details,
      }, details?.includes('[E_') ? 'error' : 'info');
      incrementDebugCounter(`reader.action.${action}`, 1, 'reader', {
        documentId: document.id,
        highlightId,
        actionId: event.id,
      });
      return event.id;
    },
    [document.id],
  );

  useEffect(() => {
    const instance = instanceRef.current;
    if (!viewerReady || !instance || eventsBoundRef.current) {
      return;
    }

    const { documentViewer, annotationManager, Annotations, Tools } = instance.Core;
    const highlightToolName = Tools?.ToolNames?.[TOOL_NAME_HIGHLIGHT] || TOOL_NAME_HIGHLIGHT;

    const handlePageNumberUpdated = () => {
      if (loadingDocumentRef.current) {
        return;
      }

      const totalPages = Math.max(1, Number(documentViewer.getPageCount() || 1));
      const pageIndex = clamp(Number(documentViewer.getCurrentPage() || 1) - 1, 0, totalPages - 1);

      if (restoreInProgressRef.current) {
        const now = Date.now();
        if (now > restoreGuardUntilRef.current) {
          restoreInProgressRef.current = false;
        } else if (pageIndex !== restoreTargetPageRef.current) {
          return;
        } else {
          restoreInProgressRef.current = false;
        }
      }

      completeRestoreNavigationIfNeeded(pageIndex);
      setPageInput(String(pageIndex + 1));
      setCurrentPageLocal(pageIndex);
      setTotalPagesLocal(totalPages);
      onSetCurrentPageRef.current(pageIndex, totalPages);
      setDebugGauge('reader.page.index', pageIndex + 1, 'reader', {
        documentId: currentDocumentIdRef.current,
      });
      setDebugGauge('reader.page.total', totalPages, 'reader', {
        documentId: currentDocumentIdRef.current,
      });
      logAction('page-changed', `page=${pageIndex + 1}/${totalPages}`);

      const now = Date.now();
      const elapsedSeconds = Math.max(0, Math.round((now - lastPersistTsRef.current) / 1000));
      const pageChanged = pageIndex !== lastPersistPageRef.current;
      const shouldPersist = pageChanged || elapsedSeconds >= READING_PERSIST_MIN_SECONDS;
      if (!shouldPersist) {
        return;
      }

      const pagesDelta = pageChanged && pageIndex > maxPageSeenRef.current
        ? pageIndex - maxPageSeenRef.current
        : 0;
      maxPageSeenRef.current = Math.max(maxPageSeenRef.current, pageIndex);
      lastPersistTsRef.current = now;
      lastPersistPageRef.current = pageIndex;

      void updateReadingState({
        documentId: currentDocumentIdRef.current,
        pageIndex,
        totalPages,
        scale: Number(documentViewer.getZoomLevel() || 1),
        lastOpenedAt: new Date().toISOString(),
        readingSeconds: elapsedSeconds,
        pagesDelta,
        allowFirstPage: true,
      })
        .then(() => undefined)
        .catch(() => {
          // Ignore transient persist errors during navigation.
        });
    };

    const createHighlightsFromSelection = (
      groupsRaw: Array<{ pageNumber: number; quads: any[]; signature?: string }>,
      selectedTextRaw: string,
      selectedRichTextRaw: string,
      noteRaw?: string,
    ) => {
      const groups = (groupsRaw ?? [])
        .map((group) => {
          const pageNumber = Math.max(1, Number(group?.pageNumber || 1));
          const quads = Array.isArray(group?.quads) ? group.quads.filter(Boolean) : [];
          return {
            pageNumber,
            quads,
            signature: String(group?.signature || buildQuadSignature(quads)),
          };
        })
        .filter((group) => Boolean(group.signature) && group.quads.length > 0)
        .sort((left, right) => left.pageNumber - right.pageNumber);
      const selectedText = normalizeSelectionText(selectedTextRaw);
      const selectedRichText = String(selectedRichTextRaw || '').trim();
      const note = normalizeSelectionText(noteRaw || '');

      if (groups.length === 0 || !selectedText) {
        return 0;
      }

      const existingByPageSignature = new Set<string>();
      for (const annotation of annotationManager.getAnnotationsList()) {
        if (!isWebViewerHighlightAnnotation(annotation, Annotations)) {
          continue;
        }

        const pageNumber = Math.max(1, Number(annotation?.PageNumber || 1));
        const signature = buildQuadSignature(annotation.getQuads?.() ?? []);
        if (!signature) {
          continue;
        }
        existingByPageSignature.add(`${pageNumber}:${signature}`);
      }

      const textSegments = splitSelectionTextByGroups(selectedText, groups);
      const annotationsToAdd: any[] = [];
      const now = Date.now();

      for (let index = 0; index < groups.length; index += 1) {
        const group = groups[index];
        const key = `${group.pageNumber}:${group.signature}`;
        const lastCreated = lastCreatedSelectionRef.current;

        if (
          lastCreated &&
          lastCreated.pageNumber === group.pageNumber &&
          lastCreated.signature === group.signature &&
          now - lastCreated.timestamp < 1300
        ) {
          continue;
        }

        if (existingByPageSignature.has(key)) {
          continue;
        }
        existingByPageSignature.add(key);

        const segmentText = normalizeSelectionText(textSegments[index] || selectedText) || selectedText;
        const segmentRichText =
          groups.length > 1 ? segmentText : normalizeSelectionText(selectedRichText) ? selectedRichText : segmentText;

        const annotation = new Annotations.TextHighlightAnnotation();
        annotation.PageNumber = group.pageNumber;
        annotation.Quads = group.quads;
        annotation.Color = highlightToWebViewerColor(activeColorRef.current, Annotations);
        annotation.Opacity = HIGHLIGHT_OPACITY;
        annotation.StrokeThickness = 0;
        annotation.setContents(note);
        annotation.setCustomData(WEBVIEWER_CUSTOM_COLOR_KEY, activeColorRef.current);
        annotation.setCustomData(WEBVIEWER_CUSTOM_TEXT_KEY, segmentText);
        annotation.setCustomData(WEBVIEWER_CUSTOM_RICH_TEXT_KEY, segmentRichText);
        annotationsToAdd.push(annotation);

        lastCreatedSelectionRef.current = {
          pageNumber: group.pageNumber,
          signature: group.signature,
          timestamp: now,
        };
      }

      if (annotationsToAdd.length === 0) {
        return 0;
      }

      if (typeof annotationManager.addAnnotations === 'function') {
        annotationManager.addAnnotations(annotationsToAdd, {
          imported: false,
          source: 'recall-selection',
        });
      } else if (typeof annotationManager.addAnnotation === 'function') {
        for (const annotation of annotationsToAdd) {
          annotationManager.addAnnotation(annotation);
        }
      } else {
        return 0;
      }

      for (const annotation of annotationsToAdd) {
        annotationManager.redrawAnnotation(annotation);
      }

      return annotationsToAdd.length;
    };

    const clearNativeSelection = () => {
      const iframeSelection = instance?.UI?.iframeWindow?.getSelection?.() as
        | Selection
        | null
        | undefined;
      try {
        iframeSelection?.removeAllRanges();
      } catch {
        // ignore selection cleanup errors
      }
    };

    clearSelectionRef.current = clearNativeSelection;

    const commitLatestSelection = () => {
      const currentSelection = lastSelectionRef.current;
      if (!currentSelection) {
        return false;
      }

      if (Date.now() - currentSelection.timestamp > 60000) {
        return false;
      }

      const selectionGroups =
        Array.isArray(currentSelection.groups) && currentSelection.groups.length > 0
          ? currentSelection.groups
          : normalizeSelectionQuadGroups(currentSelection.quads, currentSelection.pageNumber);
      if (selectionGroups.length === 0) {
        return false;
      }

      const iframeSelection = instance?.UI?.iframeWindow?.getSelection?.() as
        | Selection
        | null
        | undefined;
      let selectedText = '';
      selectedText = normalizeSelectionText(selectionObjectToPlainText(iframeSelection));

      if (!selectedText && typeof documentViewer.getSelectedText === 'function') {
        const pageTexts: string[] = [];
        for (const group of selectionGroups) {
          try {
            const chunk = normalizeSelectionText(documentViewer.getSelectedText(group.pageNumber) || '');
            if (chunk) {
              pageTexts.push(chunk);
            }
          } catch {
            // ignore page text read errors
          }
        }
        if (pageTexts.length > 0) {
          selectedText = normalizeSelectionText(pageTexts.join('\n'));
        }
      }

      if (!selectedText) {
        selectedText = currentSelection.text;
      }

      if (!selectedText) {
        return false;
      }

      const selectedRichText =
        selectionToRichText(iframeSelection, selectedText) || currentSelection.richText || selectedText;

      const createdCount = createHighlightsFromSelection(
        selectionGroups,
        selectedText,
        selectedRichText,
        pendingNoteRef.current,
      );
      if (createdCount > 0) {
        clearPendingSelection();
        clearNativeSelection();
      }
      return createdCount > 0;
    };

    commitSelectionRef.current = commitLatestSelection;

    const handleTextSelected = (quads: any, text: string, pageNumber: number) => {
      const iframeSelection = instance?.UI?.iframeWindow?.getSelection?.() as
        | Selection
        | null
        | undefined;
      const normalizedGroups = normalizeSelectionQuadGroups(quads, pageNumber);
      const normalizedText = normalizeSelectionText(
        selectionObjectToPlainText(iframeSelection) || normalizeSelectionText(text),
      );
      const richText = selectionToRichText(iframeSelection, normalizedText);
      const signature = normalizedGroups
        .map((group) => `${group.pageNumber}:${group.signature}`)
        .join('||');
      const firstPageNumber = normalizedGroups[0]?.pageNumber ?? Math.max(1, Number(pageNumber || 1));
      const lastPageNumber = normalizedGroups[normalizedGroups.length - 1]?.pageNumber ?? firstPageNumber;

      if (!signature || !normalizedText || normalizedGroups.length === 0) {
        lastSelectionRef.current = null;
        setPendingSelectionText('');
        setPendingSelectionPage(null);
        setPendingSelectionPageEnd(null);
        logAction('selection-empty');
        return;
      }

      lastSelectionRef.current = {
        pageNumber: firstPageNumber,
        pageNumberTo: lastPageNumber,
        text: normalizedText,
        richText,
        signature,
        quads: normalizedGroups[0].quads,
        groups: normalizedGroups,
        timestamp: Date.now(),
      };
      setPendingSelectionText(normalizedText);
      setPendingSelectionPage(firstPageNumber - 1);
      setPendingSelectionPageEnd(lastPageNumber - 1);
      logAction(
        'selection-captured',
        `pages=${firstPageNumber}${lastPageNumber > firstPageNumber ? `-${lastPageNumber}` : ''} chars=${normalizedText.length}`,
      );
    };

    const handleAnnotationChanged = async (annotations: any[], action: string, info: any) => {
      if (shouldIgnoreAnnotationSyncEvent(suppressSyncRef.current, info)) {
        return;
      }

      const relevant = annotations.filter((annotation) =>
        isWebViewerHighlightAnnotation(annotation, Annotations),
      );
      if (relevant.length === 0) {
        return;
      }

      try {
        for (const annotation of relevant) {
          if (action === 'add') {
            const existingId = String(annotation.getCustomData(WEBVIEWER_CUSTOM_ID_KEY) || '');
            if (existingId) {
              continue;
            }

            const pageNumber = Number(annotation?.PageNumber ?? 0);
            const lastSelection = lastSelectionRef.current;
            const annotationSignature = buildQuadSignature(annotation.getQuads?.() ?? []);
            const matchedGroup = lastSelection?.groups?.find(
              (group) =>
                group.pageNumber === pageNumber &&
                group.signature === annotationSignature,
            );
            const sameSelection =
              lastSelection &&
              Date.now() - lastSelection.timestamp <= 8000 &&
              Boolean(matchedGroup);

            const fallbackText = normalizeSelectionText(
              annotation.getCustomData('trn-annot-preview') ||
                annotation.getContents?.() ||
                '',
            );
            const customSelectedText = normalizeSelectionText(
              annotation.getCustomData(WEBVIEWER_CUSTOM_TEXT_KEY) || '',
            );

            const selectedText =
              customSelectedText ||
              (sameSelection
                ? normalizeSelectionText(lastSelection?.text || '')
                : fallbackText || `Выделение на стр. ${Math.max(1, pageNumber)}`);

            const customRichText = String(
              annotation.getCustomData(WEBVIEWER_CUSTOM_RICH_TEXT_KEY) || '',
            ).trim();
            const selectedRichText =
              customRichText ||
              (sameSelection
                ? String(lastSelection?.richText || '').trim() || selectedText
                : String(annotation.getCustomData(WEBVIEWER_CUSTOM_RICH_TEXT_KEY) || '').trim() ||
                  selectedText);

            const payload = normalizeHighlightPayload(
              annotation,
              documentViewer,
              selectedText,
              selectedRichText,
            );

            if (!payload) {
              continue;
            }

            const saved = await addHighlight({
              documentId: currentDocumentIdRef.current,
              ...payload,
            });

            annotation.Id = String(saved.id);
            annotation.setCustomData(WEBVIEWER_CUSTOM_ID_KEY, saved.id);
            annotation.setCustomData(WEBVIEWER_CUSTOM_COLOR_KEY, saved.color);
            annotation.setCustomData(WEBVIEWER_CUSTOM_TEXT_KEY, saved.selectedText);
            annotation.setCustomData(WEBVIEWER_CUSTOM_RICH_TEXT_KEY, saved.selectedRichText || '');
            annotationManager.redrawAnnotation(annotation);
            onUpsertHighlightRef.current(saved);
            logAction('highlight-added', `page=${saved.pageIndex + 1}`, saved.id);
            continue;
          }

          if (action === 'modify') {
            const highlightId = String(annotation.getCustomData(WEBVIEWER_CUSTOM_ID_KEY) || '');
            if (!highlightId) {
              continue;
            }

            const existing =
              highlightsRef.current.find((highlight) => highlight.id === highlightId) || null;
            const selectedText =
              normalizeSelectionText(annotation.getCustomData(WEBVIEWER_CUSTOM_TEXT_KEY)) ||
              normalizeSelectionText(existing?.selectedText) ||
              `Выделение на стр. ${Math.max(1, Number(annotation?.PageNumber || 1))}`;

            const selectedRichText =
              String(annotation.getCustomData(WEBVIEWER_CUSTOM_RICH_TEXT_KEY) || '').trim() ||
              String(existing?.selectedRichText || '').trim() ||
              selectedText;

            const payload = normalizeHighlightPayload(
              annotation,
              documentViewer,
              selectedText,
              selectedRichText,
            );
            if (!payload) {
              continue;
            }

            const updated = await updateHighlight({
              id: highlightId,
              ...payload,
            });

            annotation.setCustomData(WEBVIEWER_CUSTOM_TEXT_KEY, updated.selectedText);
            annotation.setCustomData(WEBVIEWER_CUSTOM_COLOR_KEY, updated.color);
            annotation.setCustomData(
              WEBVIEWER_CUSTOM_RICH_TEXT_KEY,
              updated.selectedRichText || '',
            );
            onUpsertHighlightRef.current(updated);
            logAction('highlight-modified', undefined, updated.id);
            continue;
          }

          if (action === 'delete') {
            const highlightId = String(annotation.getCustomData(WEBVIEWER_CUSTOM_ID_KEY) || '');
            if (!highlightId) {
              continue;
            }

            await deleteHighlight(highlightId);
            onDeleteHighlightFromStoreRef.current(currentDocumentIdRef.current, highlightId);
            logAction('highlight-deleted', undefined, highlightId);
          }
        }
      } catch (syncError: any) {
        onNotifyRef.current(formatErrorToast('Ошибка синхронизации хайлайтов', syncError, 'E_SYNC'), 'error');
        logAction('highlight-sync-error', formatErrorToast('', syncError, 'E_SYNC'));
      }
    };

    documentViewer.addEventListener('pageNumberUpdated', handlePageNumberUpdated);
    documentViewer.addEventListener('textSelected', handleTextSelected);
    annotationManager.addEventListener('annotationChanged', handleAnnotationChanged);

    const tool = documentViewer.getTool(highlightToolName);
    if (tool?.setStyles) {
      const tint = highlightToWebViewerColor(activeColorRef.current, Annotations);
      tool.setStyles({
        StrokeColor: tint,
        FillColor: tint,
        StrokeThickness: 0,
        Opacity: HIGHLIGHT_OPACITY,
      });
    }

    eventsBoundRef.current = true;

    return () => {
      eventsBoundRef.current = false;
      commitSelectionRef.current = null;
      clearSelectionRef.current = null;
      documentViewer.removeEventListener('pageNumberUpdated', handlePageNumberUpdated);
      documentViewer.removeEventListener('textSelected', handleTextSelected);
      annotationManager.removeEventListener('annotationChanged', handleAnnotationChanged);
    };
  }, [logAction, viewerReady]);

  useEffect(() => {
    let cancelled = false;

    async function loadDocument() {
      if (!viewerReady) {
        return;
      }

      const instance = instanceRef.current;
      if (!instance) {
        return;
      }

      const { documentViewer } = instance.Core;
      loadingDocumentRef.current = true;
      setLoading(true);
      setError('');
      const loadActionId = logAction('document-load-start');

      try {
        const pdfBytes = await readDocumentPdfBytes(document.id);
        if (cancelled) {
          return;
        }

        const buffer = toArrayBuffer(pdfBytes as any);

        await documentViewer.loadDocument(buffer, {
          filename: `${document.title}.pdf`,
          extension: 'pdf',
          docId: document.id,
        });

        if (cancelled) {
          return;
        }

        const fetchedHighlights = await listHighlights(document.id);
        onSetHighlightsRef.current(document.id, fetchedHighlights);

        const totalPages = Math.max(1, Number(documentViewer.getPageCount() || 1));
        const currentPendingNavigation = pendingNavigationRef.current;
        const targetFromNavigation =
          currentPendingNavigation && currentPendingNavigation.documentId === document.id
            ? currentPendingNavigation.pageIndex
            : undefined;
        const targetPageIndex = clamp(
          Number(
            targetFromNavigation ??
              document.lastReadPageIndex ??
              document.maxReadPageIndex ??
              0,
          ),
          0,
          Math.max(0, totalPages - 1),
        );

        beginRestoreNavigation(targetPageIndex, 3200);
        await navigateToPageWithRetry(instance, targetPageIndex, 12);
        enforceRestoreTarget(instance, targetPageIndex, 18, 170);

        if (
          currentPendingNavigation &&
          currentPendingNavigation.documentId === document.id &&
          currentPendingNavigation.highlightId
        ) {
          window.setTimeout(() => {
            selectHighlightAnnotationWithRetry(instance, currentPendingNavigation.highlightId);
          }, 260);
        }

        if (currentPendingNavigation && currentPendingNavigation.documentId === document.id) {
          onNavigationConsumedRef.current();
        }

        lastPersistTsRef.current = Date.now();
        lastPersistPageRef.current = targetPageIndex;
        maxPageSeenRef.current = Math.max(
          Number(document.maxReadPageIndex ?? 0),
          targetPageIndex,
        );

        onSetCurrentPageRef.current(targetPageIndex, totalPages);
        setCurrentPageLocal(targetPageIndex);
        setTotalPagesLocal(totalPages);
        setPageInput(String(targetPageIndex + 1));
        setLoading(false);
        logAction('document-load-success', `action=${loadActionId} page=${targetPageIndex + 1}`);
      } catch (loadError: any) {
        setError(formatErrorToast('Не удалось загрузить документ', loadError, 'E_READER_LOAD'));
        logAction('document-load-error', formatErrorToast('', loadError, 'E_READER_LOAD'));
        setLoading(false);
      } finally {
        loadingDocumentRef.current = false;
      }
    }

    void loadDocument();

    return () => {
      cancelled = true;
    };
  }, [document.id, logAction, reloadNonce, viewerReady]);

  useEffect(() => {
    if (!viewerReady || !pendingNavigation || pendingNavigation.documentId !== document.id) {
      return;
    }

    const instance = instanceRef.current;
    if (!instance || loadingDocumentRef.current) {
      return;
    }

    const { documentViewer } = instance.Core;
    if (!documentViewer.getDocument()) {
      return;
    }

    const totalPages = Math.max(1, Number(documentViewer.getPageCount() || 1));
    const targetPageIndex = clamp(Number(pendingNavigation.pageIndex || 0), 0, totalPages - 1);

    beginRestoreNavigation(targetPageIndex, 2400);
    enforceRestoreTarget(instance, targetPageIndex, 14, 160);
    void navigateToPageWithRetry(instance, targetPageIndex, 10).finally(() => {
      setPageInput(String(targetPageIndex + 1));
      onSetCurrentPageRef.current(targetPageIndex, totalPages);
      setCurrentPageLocal(targetPageIndex);
      setTotalPagesLocal(totalPages);

      if (pendingNavigation.highlightId) {
        window.setTimeout(() => {
          selectHighlightAnnotationWithRetry(instance, pendingNavigation.highlightId);
        }, 180);
      }

      onNavigationConsumedRef.current();
    });
  }, [document.id, pendingNavigation, viewerReady]);

  useHighlightSync({
    viewerReady,
    instanceRef,
    loadingDocumentRef,
    suppressSyncRef,
    documentId: document.id,
    highlights,
    onSyncStats: ({ added, updated, removed }) => {
      setDebugGauge('reader.sync.last.added', added, 'reader', {
        documentId: document.id,
      });
      setDebugGauge('reader.sync.last.updated', updated, 'reader', {
        documentId: document.id,
      });
      setDebugGauge('reader.sync.last.removed', removed, 'reader', {
        documentId: document.id,
      });
      if (added > 0) {
        incrementDebugCounter('reader.sync.added.total', added, 'reader', {
          documentId: document.id,
        });
      }
      if (updated > 0) {
        incrementDebugCounter('reader.sync.updated.total', updated, 'reader', {
          documentId: document.id,
        });
      }
      if (removed > 0) {
        incrementDebugCounter('reader.sync.removed.total', removed, 'reader', {
          documentId: document.id,
        });
      }
      if (added || updated || removed) {
        logAction('highlight-sync', `+${added}/~${updated}/-${removed}`);
      }
    },
  });

  useEffect(() => {
    const instance = instanceRef.current;
    if (!viewerReady || !instance) {
      return;
    }

    const { documentViewer, Tools, Annotations } = instance.Core;
    const highlightToolName = Tools?.ToolNames?.[TOOL_NAME_HIGHLIGHT] || TOOL_NAME_HIGHLIGHT;
    const tool = documentViewer.getTool(highlightToolName);
    if (tool?.setStyles) {
      const tint = highlightToWebViewerColor(activeColor, Annotations);
      tool.setStyles({
        StrokeColor: tint,
        FillColor: tint,
        StrokeThickness: 0,
        Opacity: HIGHLIGHT_OPACITY,
      });
    }

    const textSelectToolName = getTextSelectToolName(Tools);
    if (textSelectToolName) {
      instance.UI.setToolMode(textSelectToolName);
    }
  }, [activeColor, viewerReady]);

  const activeProgress = useMemo(() => {
    const total = Math.max(0, totalPagesLocal);
    const page = Math.max(0, currentPageLocal);
    if (!total) {
      return 0;
    }
    return Math.round(((page + 1) / total) * 100);
  }, [currentPageLocal, totalPagesLocal]);

  const pendingSelectionPageLabel = useMemo(() => {
    if (pendingSelectionPage === null) {
      return '';
    }

    const start = pendingSelectionPage + 1;
    const end = pendingSelectionPageEnd === null ? start : pendingSelectionPageEnd + 1;
    if (end <= start) {
      return `стр. ${start}`;
    }

    return `стр. ${start}-${end}`;
  }, [pendingSelectionPage, pendingSelectionPageEnd]);

  const visibleHighlights = useMemo(
    () => documentHighlights.slice(0, Math.max(0, visibleHighlightsCount)),
    [documentHighlights, visibleHighlightsCount],
  );
  useEffect(() => {
    setDebugGauge('reader.highlights.visible', visibleHighlights.length, 'reader', {
      documentId: document.id,
    });
  }, [document.id, visibleHighlights.length]);
  const effectiveReaderError = error || viewerInitError;
  useEffect(() => {
    setDebugGauge('reader.loading', loading ? 1 : 0, 'reader', {
      documentId: document.id,
    });
  }, [document.id, loading]);

  useEffect(() => {
    setDebugGauge('reader.error.active', effectiveReaderError ? 1 : 0, 'reader', {
      documentId: document.id,
    });
  }, [document.id, effectiveReaderError]);

  const isReaderSideHidden = settings.focusMode || isSidePanelCollapsed;
  const readerLayoutStyle = useMemo(() => {
    if (isReaderSideHidden) {
      return undefined;
    }
    return {
      gridTemplateColumns: `minmax(0, 1fr) ${readerSideWidth}px`,
    } as const;
  }, [isReaderSideHidden, readerSideWidth]);

  const maxReadPageIndex = useMemo(
    () =>
      Math.max(
        Number(document.maxReadPageIndex ?? document.lastReadPageIndex ?? 0),
        Number(currentPageLocal || 0),
      ),
    [currentPageLocal, document.lastReadPageIndex, document.maxReadPageIndex],
  );

  const jumpToPage = useCallback(
    (targetPageRaw: number, source = 'jump', highlightId?: string) => {
      const instance = instanceRef.current;
      if (!instance) {
        return;
      }

      const { documentViewer } = instance.Core;
      const totalPages = Math.max(1, Number(documentViewer.getPageCount() || 1));
      const targetPage = clamp(Number(targetPageRaw || 0), 0, totalPages - 1);
      beginRestoreNavigation(targetPage, highlightId ? 2200 : 1700);
      enforceRestoreTarget(instance, targetPage, highlightId ? 13 : 10, 140);

      void navigateToPageWithRetry(instance, targetPage, highlightId ? 9 : 7).finally(() => {
        setPageInput(String(targetPage + 1));
        onSetCurrentPageRef.current(targetPage, totalPages);
        setCurrentPageLocal(targetPage);
        setTotalPagesLocal(totalPages);
        if (highlightId) {
          window.setTimeout(() => {
            selectHighlightAnnotationWithRetry(instance, highlightId);
          }, 140);
        }
      });
      logAction('page-jump', `source=${source} page=${targetPage + 1}`, highlightId);
    },
    [beginRestoreNavigation, enforceRestoreTarget, logAction, setCurrentPageLocal, setPageInput, setTotalPagesLocal],
  );

  const toggleHighlightCheckboxSelection = useCallback((highlightId: string, checked: boolean) => {
    setSelectedHighlightIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(highlightId);
      } else {
        next.delete(highlightId);
      }
      return [...next];
    });
  }, []);

  const applyPendingNoteTemplate = useCallback((templatePrefix: string) => {
    setPendingNote((current) => normalizeTemplateNote(current, templatePrefix));
  }, [setPendingNote]);

  const applyHighlightNoteTemplate = useCallback(
    (highlight: HighlightRecord, templatePrefix: string) => {
      const currentDraft = getHighlightNoteDraft(highlight);
      setHighlightNoteDraft(highlight.id, normalizeTemplateNote(currentDraft, templatePrefix));
    },
    [getHighlightNoteDraft, setHighlightNoteDraft],
  );

  const handleApplySuggestedTag = useCallback(
    (highlight: HighlightRecord, tagRaw: string) => {
      const tag = normalizeText(tagRaw).slice(0, 40);
      if (!tag) {
        return;
      }
      const existingTags = new Set((highlight.tags ?? []).map((item) => normalizeText(item).toLowerCase()));
      if (existingTags.has(tag.toLowerCase())) {
        return;
      }

      const nextTags = Array.from(
        new Set([...(highlight.tags ?? []).map((item) => normalizeText(item)).filter(Boolean), tag]),
      );
      void updateHighlight({ id: highlight.id, tags: nextTags })
        .then((updatedHighlight) => {
          onUpsertHighlight(updatedHighlight);
          onNotify(`Тег #${tag} добавлен.`, 'success');
          logAction('highlight-tag-added', `tag=${tag}`, highlight.id);
        })
        .catch((updateError) => {
          onNotify(formatErrorToast('Ошибка добавления тега', updateError, 'E_HIGHLIGHT_TAG'), 'error');
        });
    },
    [logAction, onNotify, onUpsertHighlight],
  );

  const handleSplitHighlight = useCallback(
    async (highlight: HighlightRecord) => {
      const rects = mergeNormalizedRects(highlight.rects ?? []);
      if (rects.length < 2) {
        onNotify('Для разделения нужно минимум 2 сегмента выделения.', 'info');
        return;
      }

      const textSegments = splitTextIntoBalancedSegments(highlight.selectedText, rects.length);
      const primaryText = normalizeSelectionText(textSegments[0] || highlight.selectedText) || highlight.selectedText;
      try {
        const updatedMain = await updateHighlight({
          id: highlight.id,
          pageIndex: highlight.pageIndex,
          rects: [rects[0]],
          selectedText: primaryText,
          selectedRichText: primaryText,
        });
        onUpsertHighlight(updatedMain);

        const addResults = await Promise.allSettled(
          rects.slice(1).map((rect, index) => {
            const segmentText =
              normalizeSelectionText(textSegments[index + 1] || primaryText) || primaryText;
            return addHighlight({
              documentId: document.id,
              pageIndex: highlight.pageIndex,
              rects: [rect],
              selectedText: segmentText,
              selectedRichText: segmentText,
              color: highlight.color,
              note: undefined,
              tags: highlight.tags ?? [],
            });
          }),
        );

        const created = addResults
          .filter((result): result is PromiseFulfilledResult<HighlightRecord> => result.status === 'fulfilled')
          .map((result) => result.value);
        for (const createdHighlight of created) {
          onUpsertHighlight(createdHighlight);
        }

        const failed = addResults.length - created.length;
        if (failed > 0) {
          onNotify(
            `Разделено на ${created.length + 1} частей, ошибок создания: ${failed}.`,
            created.length > 0 ? 'info' : 'error',
          );
        } else {
          onNotify(`Выделение разделено на ${created.length + 1} частей.`, 'success');
        }
        logAction('highlight-split', `parts=${created.length + 1}`, highlight.id);
      } catch (splitError) {
        onNotify(formatErrorToast('Ошибка разделения выделения', splitError, 'E_HIGHLIGHT_SPLIT'), 'error');
      }
    },
    [document.id, logAction, onNotify, onUpsertHighlight],
  );

  const handleMergeSelectedHighlights = useCallback(async () => {
    if (selectedHighlights.length < 2) {
      onNotify('Выберите минимум два выделения для объединения.', 'info');
      return;
    }

    if (!selectedHighlightsCanMerge) {
      onNotify('Объединять можно только выделения с одной страницы.', 'info');
      return;
    }

    const sorted = [...selectedHighlights].sort(compareHighlightsByPosition);
    const target = sorted[0];
    const toDelete = sorted.slice(1);
    const mergedRects = mergeNormalizedRects(sorted.flatMap((highlight) => highlight.rects ?? []));
    const mergedText =
      normalizeSelectionText(sorted.map((highlight) => highlight.selectedText).join('\n\n')) ||
      normalizeSelectionText(target.selectedText);
    const mergedRichText =
      normalizeSelectionText(
        sorted
          .map((highlight) => highlight.selectedRichText || highlight.selectedText)
          .join('\n\n'),
      ) || mergedText;
    const mergedNote = Array.from(
      new Set(
        sorted
          .map((highlight) => normalizeSelectionText(highlight.note || ''))
          .filter(Boolean),
      ),
    ).join('\n');
    const mergedTags = Array.from(
      new Set(
        sorted
          .flatMap((highlight) => highlight.tags ?? [])
          .map((tag) => normalizeText(tag))
          .filter(Boolean),
      ),
    );

    try {
      const updated = await updateHighlight({
        id: target.id,
        pageIndex: target.pageIndex,
        rects: mergedRects,
        selectedText: mergedText,
        selectedRichText: mergedRichText,
        note: mergedNote || undefined,
        tags: mergedTags,
      });
      onUpsertHighlight(updated);

      const deleteResults = await Promise.allSettled(
        toDelete.map((highlight) => deleteHighlight(highlight.id)),
      );
      let deleted = 0;
      for (let index = 0; index < deleteResults.length; index += 1) {
        if (deleteResults[index].status === 'fulfilled') {
          deleted += 1;
          onDeleteHighlightFromStore(document.id, toDelete[index].id);
        }
      }

      setSelectedHighlightIds([updated.id]);
      if (deleted === toDelete.length) {
        onNotify(`Объединено ${sorted.length} выделений.`, 'success');
      } else {
        onNotify(
          `Объединение выполнено, удалено ${deleted}/${toDelete.length} старых выделений.`,
          'info',
        );
      }
      logAction('highlights-merged', `count=${sorted.length}`, updated.id);
    } catch (mergeError) {
      onNotify(formatErrorToast('Ошибка объединения выделений', mergeError, 'E_HIGHLIGHT_MERGE'), 'error');
    }
  }, [
    document.id,
    onDeleteHighlightFromStore,
    onNotify,
    onUpsertHighlight,
    selectedHighlights,
    selectedHighlightsCanMerge,
    logAction,
  ]);

  const handleApplySelection = () => {
    const commitSelection = commitSelectionRef.current;
    if (!commitSelection) {
      onNotify('[E_READER_NOT_READY] Читалка ещё инициализируется, попробуйте через секунду.', 'info');
      return;
    }

    const created = commitSelection();
    if (!created) {
      onNotify('[E_SELECTION_EMPTY] Сначала выделите текст, затем нажмите «Выделить».', 'info');
      return;
    }

    logAction('highlight-create-confirmed');
    onNotify('Выделение добавлено.', 'success');
  };

  const handleClearSelection = () => {
    clearPendingSelection();
    clearSelectionRef.current?.();
    logAction('selection-cleared');
  };

  const handleChangeHighlightColor = (highlight: HighlightRecord, nextColor: HighlightColor) => {
    if (highlight.color === nextColor) {
      return;
    }

    void updateHighlight({ id: highlight.id, color: nextColor })
      .then((updatedHighlight) => {
        onUpsertHighlight(updatedHighlight);
        logAction('highlight-color-changed', `to=${updatedHighlight.color}`, updatedHighlight.id);
      })
      .catch((updateError) => {
        onNotify(formatErrorToast('Ошибка изменения цвета', updateError, 'E_HIGHLIGHT_COLOR'), 'error');
      });
  };

  const handleSaveHighlightNote = (highlight: HighlightRecord) => {
    const draft = normalizeSelectionText(getHighlightNoteDraft(highlight));
    const normalizedCurrent = normalizeSelectionText(highlight.note || '');
    const nextNote = draft || undefined;
    if (draft === normalizedCurrent) {
      clearHighlightNoteDraft(highlight.id);
      return;
    }

    void updateHighlight({ id: highlight.id, note: nextNote })
      .then((updatedHighlight) => {
        onUpsertHighlight(updatedHighlight);
        clearHighlightNoteDraft(highlight.id);
        logAction('highlight-note-saved', undefined, updatedHighlight.id);
      })
      .catch((updateError) => {
        onNotify(formatErrorToast('Ошибка сохранения заметки', updateError, 'E_HIGHLIGHT_NOTE'), 'error');
      });
  };

  const retryDocumentLoad = () => {
    setError('');
    setReloadNonce((value) => value + 1);
    logAction('document-retry');
  };

  function handleReaderSideResizeStart(event: React.PointerEvent<HTMLDivElement>) {
    if (isReaderSideHidden) {
      return;
    }

    event.preventDefault();
    const startX = event.clientX;
    const startWidth = readerSideWidth;
    const maxByViewport = Math.max(
      MIN_READER_SIDE_WIDTH,
      Math.min(MAX_READER_SIDE_WIDTH, Math.round(window.innerWidth * 0.6)),
    );

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const nextWidth = Math.max(
        MIN_READER_SIDE_WIDTH,
        Math.min(maxByViewport, Math.round(startWidth - deltaX)),
      );
      setReaderSideWidth(nextWidth);
    };

    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }

  return (
    <section className={`view-shell reader-view ${settings.focusMode ? 'focus-mode' : ''}`}>
      <LiquidSurface className="glass-panel view-header reader-header reader-header-grid">
        <div className="reader-header-main">
          <h1>{truncate(document.title, 120)}</h1>
          <p className="muted">
            Прогресс: {activeProgress}% · Выделений: {highlights.length}
          </p>
          <div className="reader-header-meta">
            <span className="chip">Страница: {currentPageLocal + 1}/{totalPagesLocal || '—'}</span>
            <span className="chip">Прогресс: {activeProgress}%</span>
            <span className="chip">Хайлайты: {highlights.length}</span>
          </div>
        </div>

        <div className="action-row reader-header-actions">
          <button type="button" className="btn ghost" onClick={onBackToLibrary}>
            В библиотеку
          </button>
          <button type="button" className="btn secondary" onClick={onOpenHighlightsTab}>
            Вкладка хайлайтов
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              setIsSidePanelCollapsed((value) => {
                const next = !value;
                logAction(next ? 'reader-side-collapsed' : 'reader-side-expanded');
                return next;
              });
            }}
            disabled={settings.focusMode}
            title={
              settings.focusMode ? 'В фокус-режиме боковая панель скрывается автоматически.' : undefined
            }
          >
            {settings.focusMode
              ? 'Панель скрыта (focus)'
              : isReaderSideHidden
                ? 'Показать панель'
                : 'Скрыть панель'}
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              void exportAnnotatedPdf(document.id).then((result) => {
                if (result?.canceled) {
                  onNotify('Экспорт PDF отменён.', 'info');
                  return;
                }
                onNotify(`PDF экспортирован: ${result?.filePath || ''}`, 'success');
              }).catch((exportError) => {
                onNotify(formatErrorToast('Ошибка экспорта PDF', exportError, 'E_EXPORT_PDF'), 'error');
              });
            }}
          >
            Экспорт PDF
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              void exportMarkdown(document.id).then((result) => {
                if (result?.canceled) {
                  onNotify('Экспорт Markdown отменён.', 'info');
                  return;
                }
                onNotify(`Markdown экспортирован: ${result?.filePath || ''}`, 'success');
              }).catch((exportError) => {
                onNotify(formatErrorToast('Ошибка экспорта Markdown', exportError, 'E_EXPORT_MD'), 'error');
              });
            }}
          >
            Экспорт Markdown
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              void onCopyDeepLink(document.id, currentPageLocal);
            }}
          >
            Скопировать ссылку
          </button>
        </div>
      </LiquidSurface>

      <LiquidSurface className="reader-toolbar glass-panel reader-toolbar-grid">
        <div className="reader-color-tools">
          <div className="action-row compact reader-color-row">
            <span className="muted">Цвет выделения:</span>
            {HIGHLIGHT_COLORS.map((color) => (
              <button
                type="button"
                key={color}
                className={`chip color-${color} ${activeColor === color ? 'active' : ''}`}
                onClick={() => setActiveColor(color)}
              >
                {colorLabel(color)}
              </button>
            ))}
          </div>
          <div className="action-row compact reader-selection-tools">
            <button
              type="button"
              className="btn primary"
              onClick={handleApplySelection}
              disabled={!pendingSelectionText}
            >
              Выделить
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={handleClearSelection}
              disabled={!pendingSelectionText}
            >
              Очистить
            </button>
            <div className="reader-note-stack">
              <input
                type="text"
                className="reader-note-input"
                placeholder="Заметка к выделению (опционально)"
                value={pendingNote}
                onChange={(event) => setPendingNote(event.target.value)}
              />
              <div className="reader-note-templates">
                {NOTE_TEMPLATES.map((template) => (
                  <button
                    type="button"
                    className="chip"
                    key={template.id}
                    onClick={() => applyPendingNoteTemplate(template.prefix)}
                  >
                    {template.label}
                  </button>
                ))}
              </div>
            </div>
            <p className="muted reader-selection-hint">
              {pendingSelectionText
                ? `Выбрано: ${pendingSelectionPageLabel} · ${truncateSelectionText(pendingSelectionText, 120)}`
                : 'Сначала выделите текст в PDF, затем нажмите «Выделить».'}
            </p>
          </div>
        </div>

        <div className="action-row compact reader-page-tools">
          <label className="reader-page-label">
            Страница
            <input
              type="number"
              min={1}
              value={pageInput}
              onChange={(event) => setPageInput(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="btn secondary"
            onClick={() => {
              const target = Math.max(0, Number(pageInput || 1) - 1);
              jumpToPage(target, 'page-input');
            }}
          >
            Перейти
          </button>
        </div>
      </LiquidSurface>

      <section
        className={`reader-layout ${isReaderSideHidden ? 'reader-side-hidden' : ''}`}
        style={readerLayoutStyle}
      >
        <article className="glass-panel reader-canvas-panel">
          <div ref={hostRef} id="reader-webviewer-host" className="reader-webviewer-host" />
          {loading ? (
            <div className="reader-overlay">
              <div className="reader-status-card">
                <p className="reader-status-title">Загрузка документа</p>
                <p className="muted">Подготавливаем PDF и синхронизируем хайлайты…</p>
                <div className="action-row compact">
                  <button type="button" className="btn ghost" onClick={retryDocumentLoad}>
                    Перезапустить загрузку
                  </button>
                </div>
              </div>
            </div>
          ) : null}
          {effectiveReaderError ? (
            <div className="reader-overlay error">
              <div className="reader-status-card">
                <p className="reader-status-title">Не удалось открыть PDF</p>
                <p className="muted">{effectiveReaderError}</p>
                <div className="action-row compact">
                  <button type="button" className="btn secondary" onClick={retryDocumentLoad}>
                    Повторить загрузку
                  </button>
                  {viewerInitError ? (
                    <button type="button" className="btn ghost" onClick={retryViewerInit}>
                      Перезапустить движок
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </article>

        {!isReaderSideHidden ? (
          <div
            className="split-handle reader-split-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label="Изменить ширину панели хайлайтов"
            style={{ right: `${Math.max(0, readerSideWidth - 5)}px` }}
            onPointerDown={handleReaderSideResizeStart}
          />
        ) : null}

        {!isReaderSideHidden ? (
          <LiquidSurface className="glass-panel reader-side">
            <div className="table-head">
              <h2>Хайлайты</h2>
              <span className="muted">{documentHighlights.length}</span>
            </div>
            <div className="reader-side-meta">
              <span className="chip">Показано: {visibleHighlights.length}</span>
              <span className="chip">Всего: {documentHighlights.length}</span>
            </div>

            <ReaderMiniMap
              totalPages={totalPagesLocal}
              currentPageIndex={currentPageLocal}
              maxReadPageIndex={maxReadPageIndex}
              totalHighlights={highlights.length}
              highlightCountByPage={highlightCountByPage}
              onJumpToPage={(pageIndex, source) => jumpToPage(pageIndex, source)}
            />

            <div className="reader-bulk-tools action-row compact">
              <span className="chip">
                Выбрано: {selectedHighlightIds.length}
                {selectedHighlightsPageLabel ? ` · ${selectedHighlightsPageLabel}` : ''}
              </span>
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setSelectedHighlightIds(visibleHighlights.map((highlight) => highlight.id));
                }}
                disabled={visibleHighlights.length === 0}
              >
                Выбрать всё
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setSelectedHighlightIds([]);
                }}
                disabled={selectedHighlightIds.length === 0}
              >
                Снять выбор
              </button>
              <button
                type="button"
                className="btn secondary"
                onClick={() => {
                  void handleMergeSelectedHighlights();
                }}
                disabled={!selectedHighlightsCanMerge}
                title={
                  selectedHighlights.length > 1 && !selectedHighlightsCanMerge
                    ? 'Можно объединять только выделения с одной страницы.'
                    : undefined
                }
              >
                Объединить
              </button>
            </div>

            <label>
              Поиск
              <input
                type="text"
                placeholder="Текст или заметка"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
              />
            </label>

            <div className="highlights-list">
              {documentHighlights.length === 0 ? (
                <div className="empty-state"><p>Для этой книги пока нет хайлайтов.</p></div>
              ) : (
                visibleHighlights.map((highlight) => (
                  <article
                    className={`highlight-item ${selectedHighlightIds.includes(highlight.id) ? 'selected' : ''}`}
                    key={highlight.id}
                  >
                    <div className="highlight-meta-row">
                      <div className="highlight-meta-left">
                        <label className="highlight-select-toggle">
                          <input
                            type="checkbox"
                            checked={selectedHighlightIds.includes(highlight.id)}
                            onChange={(event) => {
                              toggleHighlightCheckboxSelection(highlight.id, event.target.checked);
                            }}
                          />
                        </label>
                        <span className={`chip color-${highlight.color}`}>{colorLabel(highlight.color)}</span>
                        <span className="muted">стр. {highlight.pageIndex + 1}</span>
                      </div>
                      <select
                        aria-label="Цвет выделения"
                        className="highlight-color-select"
                        value={highlight.color}
                        onChange={(event) => {
                          handleChangeHighlightColor(highlight, event.target.value as HighlightColor);
                        }}
                      >
                        {HIGHLIGHT_COLORS.map((color) => (
                          <option key={`${highlight.id}-${color}`} value={color}>
                            Цвет: {colorLabel(color)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <p className="highlight-quote">{truncateSelectionText(highlight.selectedText, 220)}</p>
                    {highlightContextMap.get(highlight.id)?.before ? (
                      <p className="highlight-context before">
                        До: {highlightContextMap.get(highlight.id)?.before}
                      </p>
                    ) : null}
                    {highlightContextMap.get(highlight.id)?.after ? (
                      <p className="highlight-context after">
                        После: {highlightContextMap.get(highlight.id)?.after}
                      </p>
                    ) : null}
                    <div className="highlight-note-row">
                      <input
                        type="text"
                        className="highlight-note-input"
                        placeholder="Заметка к выделению"
                        value={getHighlightNoteDraft(highlight)}
                        onChange={(event) => {
                          setHighlightNoteDraft(highlight.id, event.target.value);
                        }}
                        onBlur={() => {
                          handleSaveHighlightNote(highlight);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            handleSaveHighlightNote(highlight);
                          }
                        }}
                      />
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() => {
                          handleSaveHighlightNote(highlight);
                        }}
                      >
                        Сохранить заметку
                      </button>
                    </div>
                    <div className="reader-note-templates">
                      {NOTE_TEMPLATES.map((template) => (
                        <button
                          type="button"
                          className="chip"
                          key={`${highlight.id}-${template.id}`}
                          onClick={() => applyHighlightNoteTemplate(highlight, template.prefix)}
                        >
                          {template.label}
                        </button>
                      ))}
                    </div>
                    {highlight.note ? <p className="highlight-note">{truncate(highlight.note, 170)}</p> : null}
                    {highlight.tags && highlight.tags.length > 0 ? (
                      <div className="tag-row">
                        {highlight.tags.map((tag) => (
                          <span className="chip" key={`${highlight.id}-tag-${tag}`}>
                            #{tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {tagSuggestionsByHighlightId.get(highlight.id)?.length ? (
                      <div className="reader-tag-suggestions">
                        <span className="muted">Подсказки тегов:</span>
                        {tagSuggestionsByHighlightId.get(highlight.id)?.map((tag) => (
                          <button
                            type="button"
                            className="chip"
                            key={`${highlight.id}-suggested-${tag}`}
                            onClick={() => {
                              handleApplySuggestedTag(highlight, tag);
                            }}
                          >
                            +#{tag}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <div className="action-row compact highlight-actions">
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => {
                          jumpToPage(highlight.pageIndex, 'highlight-jump', highlight.id);
                        }}
                      >
                        Перейти
                      </button>
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() => {
                          void handleSplitHighlight(highlight);
                        }}
                        disabled={(highlight.rects?.length || 0) < 2}
                        title={(highlight.rects?.length || 0) < 2 ? 'Нечего делить: одно геометрическое выделение.' : undefined}
                      >
                        Разделить
                      </button>
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() => {
                          void onCopyDeepLink(document.id, highlight.pageIndex, highlight.id);
                        }}
                      >
                        Ссылка
                      </button>
                      <button
                        type="button"
                        className="btn ghost danger"
                        onClick={() => {
                          void deleteHighlight(highlight.id)
                            .then(() => {
                              onDeleteHighlightFromStore(document.id, highlight.id);
                              logAction('highlight-deleted-manual', undefined, highlight.id);
                              onNotify('Хайлайт удалён.', 'success');
                            })
                            .catch((deleteError) => {
                              onNotify(
                                formatErrorToast(
                                  'Ошибка удаления хайлайта',
                                  deleteError,
                                  'E_HIGHLIGHT_DELETE',
                                ),
                                'error',
                              );
                            });
                        }}
                      >
                        Удалить
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>
            {visibleHighlights.length < documentHighlights.length ? (
              <button
                type="button"
                className="btn secondary reader-load-more"
                onClick={() => {
                  setVisibleHighlightsCount((count) => count + 80);
                }}
              >
                Показать ещё ({documentHighlights.length - visibleHighlights.length})
              </button>
            ) : null}
          </LiquidSurface>
        ) : null}

      </section>
    </section>
  );
}
