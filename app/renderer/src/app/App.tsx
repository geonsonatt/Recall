import { useEffect, useMemo, useRef, useState } from 'react';
import Fuse from 'fuse.js';
import {
  askLibrary,
  backupData,
  buildReadingDigest,
  createCollection,
  deleteHighlight as deleteHighlightById,
  deleteDocument,
  exportAnnotatedPdf,
  exportMarkdown,
  exportNotionBundle,
  exportObsidianBundle,
  generateSrsDeck,
  getReadingOverview,
  getSettings,
  getStoragePaths,
  importPdf,
  importPdfPaths,
  listAllHighlights,
  listCollections,
  listDocuments,
  reviewHighlightSrs,
  revealUserData,
  resetDocumentReadingState,
  restoreData,
  summarizeHighlights,
  updateHighlight,
  updateDocumentMeta,
  updateSettings,
} from './api';
import { DebugOverlay, DebugToggleButton } from './components/DebugOverlay';
import { StatusCenter } from './components/StatusCenter';
import { CommandPalette, type CommandPaletteAction } from './components/CommandPalette';
import { TopTabs } from './components/TopTabs';
import { Toast } from './components/Toast';
import { LiquidSurface } from './components/LiquidSurface';
import { HighlightsView } from './features/highlights/HighlightsView';
import { InsightsView } from './features/insights/InsightsView';
import { LibraryView } from './features/library/LibraryView';
import { ReaderView } from './features/reader/ReaderView';
import { truncate } from './lib/format';
import {
  buildAbsoluteDeepLink,
  buildDeepLink,
  parseDeepLink,
  type DeepLinkPayload,
} from './lib/deepLinks';
import { useRenderProfiler } from './lib/perfProfiler';
import {
  createSavedHighlightView,
  normalizeSmartHighlightFilter,
  parseSmartHighlightFilter,
} from './lib/smartHighlightView';
import {
  addDebugEvent,
  incrementDebugCounter,
  startDebugAction,
  summarizeForDebug,
} from './lib/debugTrace';
import {
  ensureDiagnosticsRuntime,
  getDiagnosticsOverlayVisible,
  setDiagnosticsOverlayVisible,
} from './lib/diagnosticsCenter';
import { formatErrorToast } from './lib/errors';
import { useAppStore } from './store/useAppStore';
import type {
  AppView,
  DocumentRecord,
  HighlightRecord,
  SavedHighlightView,
  SmartHighlightFilter,
  WorkspacePreset,
} from './types';

const WORKSPACE_PRESET_KEY = 'recall.ui.workspacePreset';
const UI_DENSITY_KEY = 'recall.ui.density';

function useBootstrap() {
  const setLoading = useAppStore((state) => state.setLoading);
  const setDocuments = useAppStore((state) => state.setDocuments);
  const setCollections = useAppStore((state) => state.setCollections);
  const setSettings = useAppStore((state) => state.setSettings);
  const setReadingLog = useAppStore((state) => state.setReadingLog);
  const setStoragePaths = useAppStore((state) => state.setStoragePaths);
  const setAllHighlights = useAppStore((state) => state.setAllHighlights);
  const showToast = useAppStore((state) => state.showToast);

  useEffect(() => {
    let mounted = true;

    async function loadInitialData() {
      const bootAction = startDebugAction({
        scope: 'app',
        name: 'bootstrap',
      });
      setLoading(true);
      try {
        const [
          documents,
          collections,
          settings,
          readingOverview,
          storagePaths,
          highlights,
        ] = await Promise.all([
          listDocuments(),
          listCollections(),
          getSettings(),
          getReadingOverview(),
          getStoragePaths(),
          listAllHighlights(),
        ]);

        if (!mounted) {
          return;
        }

        setDocuments(documents);
        setCollections(collections);
        setSettings(settings);
        setReadingLog(readingOverview?.readingLog ?? {});
        setStoragePaths(storagePaths);
        setAllHighlights(highlights);
        bootAction.finish(true, {
          details: `docs=${documents.length} collections=${collections.length} highlights=${highlights.length}`,
        });
      } catch (error: any) {
        bootAction.finish(false, {
          details: formatErrorToast('Ошибка загрузки данных', error, 'E_BOOTSTRAP'),
          data: summarizeForDebug(error),
        });
        if (mounted) {
          showToast(formatErrorToast('Ошибка загрузки данных', error, 'E_BOOTSTRAP'), 'error');
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    void loadInitialData();

    return () => {
      mounted = false;
    };
  }, [
    setAllHighlights,
    setCollections,
    setDocuments,
    setLoading,
    setReadingLog,
    setSettings,
    setStoragePaths,
    showToast,
  ]);
}

type GlobalSearchItem = {
  id: string;
  kind: 'document' | 'highlight' | 'tag';
  title: string;
  subtitle: string;
  keywords: string[];
  documentId: string;
  pageIndex?: number;
  highlightId?: string;
};

function defaultDensityForPreset(preset: WorkspacePreset): 'comfortable' | 'compact' {
  if (preset === 'focus' || preset === 'review') {
    return 'compact';
  }
  return 'comfortable';
}

function workspacePresetLabel(preset: WorkspacePreset) {
  if (preset === 'focus') {
    return 'Focus';
  }
  if (preset === 'review') {
    return 'Review';
  }
  return 'Research';
}

function sortSavedHighlightViews(views: SavedHighlightView[]): SavedHighlightView[] {
  return [...views].sort((a, b) => {
    if (Boolean(a.isPinned) !== Boolean(b.isPinned)) {
      return a.isPinned ? -1 : 1;
    }
    const aTs = new Date(a.lastUsedAt || a.updatedAt || a.createdAt).valueOf();
    const bTs = new Date(b.lastUsedAt || b.updatedAt || b.createdAt).valueOf();
    return bTs - aTs;
  });
}

export default function App() {
  useBootstrap();
  const [uiDensity, setUiDensity] = useState<'comfortable' | 'compact'>('comfortable');
  const [workspacePreset, setWorkspacePreset] = useState<WorkspacePreset>('research');
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState(false);
  const [globalSearchIndex, setGlobalSearchIndex] = useState(0);
  const globalSearchInputRef = useRef<HTMLInputElement | null>(null);
  const pendingDeepLinkRef = useRef<DeepLinkPayload | null>(null);
  const didApplyInitialDeepLinkRef = useRef(false);

  useRenderProfiler('App');

  const view = useAppStore((state) => state.view);
  const documents = useAppStore((state) => state.documents);
  const collections = useAppStore((state) => state.collections);
  const settings = useAppStore((state) => state.settings);
  const loading = useAppStore((state) => state.loading);
  const toast = useAppStore((state) => state.toast);
  const activeDocumentId = useAppStore((state) => state.activeDocumentId);
  const highlightsByDocument = useAppStore((state) => state.highlightsByDocument);
  const allHighlights = useAppStore((state) => state.allHighlights);
  const highlightsSearch = useAppStore((state) => state.highlightsSearch);
  const highlightsContextOnly = useAppStore((state) => state.highlightsContextOnly);
  const highlightsDocumentFilter = useAppStore((state) => state.highlightsDocumentFilter);
  const currentPageIndex = useAppStore((state) => state.currentPageIndex);
  const pendingNavigation = useAppStore((state) => state.pendingNavigation);

  const setView = useAppStore((state) => state.setView);
  const setDocuments = useAppStore((state) => state.setDocuments);
  const upsertDocument = useAppStore((state) => state.upsertDocument);
  const removeDocument = useAppStore((state) => state.removeDocument);
  const setCollections = useAppStore((state) => state.setCollections);
  const patchSettings = useAppStore((state) => state.patchSettings);
  const setActiveDocumentId = useAppStore((state) => state.setActiveDocumentId);
  const setCurrentPageState = useAppStore((state) => state.setCurrentPageState);
  const setDocumentHighlights = useAppStore((state) => state.setDocumentHighlights);
  const upsertDocumentHighlight = useAppStore((state) => state.upsertDocumentHighlight);
  const removeDocumentHighlight = useAppStore((state) => state.removeDocumentHighlight);
  const setAllHighlights = useAppStore((state) => state.setAllHighlights);
  const setHighlightsSearch = useAppStore((state) => state.setHighlightsSearch);
  const setHighlightsContextOnly = useAppStore((state) => state.setHighlightsContextOnly);
  const setHighlightsDocumentFilter = useAppStore((state) => state.setHighlightsDocumentFilter);
  const setPendingNavigation = useAppStore((state) => state.setPendingNavigation);
  const showToast = useAppStore((state) => state.showToast);

  useEffect(() => {
    ensureDiagnosticsRuntime();
  }, []);

  const activeDocument = useMemo(
    () => documents.find((documentInfo) => documentInfo.id === activeDocumentId) ?? null,
    [activeDocumentId, documents],
  );

  const activeDocumentHighlights = useMemo(
    () => (activeDocument ? highlightsByDocument[activeDocument.id] ?? [] : []),
    [activeDocument, highlightsByDocument],
  );

  const canOpenReader = Boolean(activeDocument);
  const canOpenHighlights = documents.length > 0;
  const canOpenInsights = documents.length > 0;
  const totalHighlights = useMemo(
    () =>
      documents.reduce(
        (sum, documentInfo) => sum + Math.max(0, Number(documentInfo.highlightsCount || 0)),
        0,
      ),
    [documents],
  );

  const savedHighlightViews = useMemo(() => {
    const explicitViews = Array.isArray(settings.savedHighlightViews)
      ? settings.savedHighlightViews
      : [];
    if (explicitViews.length > 0) {
      return sortSavedHighlightViews(explicitViews);
    }

    const fallbackQueries = Array.isArray(settings.savedHighlightQueries)
      ? settings.savedHighlightQueries
      : [];
    return sortSavedHighlightViews(
      fallbackQueries
      .map((item) => {
        const filter = parseSmartHighlightFilter(item.query);
        if (!filter) {
          return createSavedHighlightView(item.name, normalizeSmartHighlightFilter({ search: item.query }), {
            id: item.id,
            createdAt: item.createdAt,
            updatedAt: item.createdAt,
          });
        }
        return createSavedHighlightView(item.name, filter, {
          id: item.id,
          createdAt: item.createdAt,
          updatedAt: item.createdAt,
        });
      })
      .slice(0, 40),
    );
  }, [settings.savedHighlightQueries, settings.savedHighlightViews]);

  const globalSearchItems = useMemo(() => {
    const items: GlobalSearchItem[] = [];
    const documentMap = new Map(documents.map((documentInfo) => [documentInfo.id, documentInfo]));

    for (const documentInfo of documents) {
      items.push({
        id: `doc:${documentInfo.id}`,
        kind: 'document',
        title: documentInfo.title,
        subtitle: `Книга · хайлайтов: ${Math.max(0, Number(documentInfo.highlightsCount || 0))}`,
        keywords: [documentInfo.id, documentInfo.title, 'книга', 'библиотека'],
        documentId: documentInfo.id,
      });
    }

    const tagSeen = new Set<string>();
    for (const highlight of allHighlights) {
      const documentTitle = documentMap.get(highlight.documentId)?.title || highlight.documentId;
      items.push({
        id: `highlight:${highlight.id}`,
        kind: 'highlight',
        title: truncate(highlight.selectedText || 'Выделение', 120),
        subtitle: `${documentTitle} · стр. ${highlight.pageIndex + 1}`,
        keywords: [
          highlight.selectedText,
          highlight.note || '',
          ...(highlight.tags ?? []),
          documentTitle,
          'хайлайт',
          'выделение',
        ],
        documentId: highlight.documentId,
        pageIndex: highlight.pageIndex,
        highlightId: highlight.id,
      });

      for (const tag of highlight.tags ?? []) {
        const normalizedTag = String(tag || '').trim().toLowerCase();
        if (!normalizedTag || tagSeen.has(normalizedTag)) {
          continue;
        }
        tagSeen.add(normalizedTag);
        items.push({
          id: `tag:${normalizedTag}`,
          kind: 'tag',
          title: `#${normalizedTag}`,
          subtitle: 'Тег · перейти во вкладку хайлайтов',
          keywords: [normalizedTag, 'tag', 'тег', '#'],
          documentId: activeDocumentId || 'all',
        });
      }
    }

    return items;
  }, [activeDocumentId, allHighlights, documents]);

  const globalSearchResults = useMemo(() => {
    const query = globalSearchQuery.trim();
    if (!query) {
      return [] as GlobalSearchItem[];
    }

    const fuse = new Fuse(globalSearchItems, {
      threshold: 0.31,
      ignoreLocation: true,
      minMatchCharLength: 2,
      keys: ['title', 'subtitle', 'keywords'],
    });

    return fuse.search(query).map((result) => result.item).slice(0, 12);
  }, [globalSearchItems, globalSearchQuery]);

  useEffect(() => {
    try {
      const savedDensity = window.localStorage.getItem(UI_DENSITY_KEY);
      if (savedDensity === 'compact' || savedDensity === 'comfortable') {
        setUiDensity(savedDensity);
      }
      const savedPreset = window.localStorage.getItem(WORKSPACE_PRESET_KEY);
      if (savedPreset === 'focus' || savedPreset === 'research' || savedPreset === 'review') {
        setWorkspacePreset(savedPreset);
      }
    } catch {
      // ignore storage access failures
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(UI_DENSITY_KEY, uiDensity);
    } catch {
      // ignore storage access failures
    }
  }, [uiDensity]);

  useEffect(() => {
    try {
      window.localStorage.setItem(WORKSPACE_PRESET_KEY, workspacePreset);
    } catch {
      // ignore storage access failures
    }
  }, [workspacePreset]);

  useEffect(() => {
    setGlobalSearchIndex((index) => {
      if (globalSearchResults.length === 0) {
        return 0;
      }
      return Math.min(index, globalSearchResults.length - 1);
    });
  }, [globalSearchResults.length]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const applyHash = () => {
      pendingDeepLinkRef.current = parseDeepLink(window.location.hash);
      if (!pendingDeepLinkRef.current) {
        return;
      }
      if (documents.length === 0 && pendingDeepLinkRef.current.view !== 'library') {
        return;
      }
      if (applyDeepLinkPayload(pendingDeepLinkRef.current)) {
        didApplyInitialDeepLinkRef.current = true;
        pendingDeepLinkRef.current = null;
      }
    };

    applyHash();
    const handleHashChange = () => {
      applyHash();
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => {
      window.removeEventListener('hashchange', handleHashChange);
    };
  }, [documents.length, savedHighlightViews.length]);

  useEffect(() => {
    const subscribe = window?.recallApi?.onDeepLink;
    if (typeof subscribe !== 'function') {
      return;
    }

    const unsubscribe = subscribe((rawLink) => {
      const payload = parseDeepLink(rawLink);
      if (!payload) {
        return;
      }
      pendingDeepLinkRef.current = payload;

      const canApply = documents.length > 0 || payload.view === 'library';
      if (canApply && applyDeepLinkPayload(payload)) {
        didApplyInitialDeepLinkRef.current = true;
        pendingDeepLinkRef.current = null;
      }

      if (typeof window !== 'undefined') {
        const nextHash = buildDeepLink(payload);
        if (window.location.hash !== nextHash) {
          window.history.replaceState(null, '', nextHash);
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, [documents.length, savedHighlightViews]);

  useEffect(() => {
    if (!pendingDeepLinkRef.current) {
      return;
    }
    if (documents.length === 0 && pendingDeepLinkRef.current.view !== 'library') {
      return;
    }
    if (applyDeepLinkPayload(pendingDeepLinkRef.current)) {
      didApplyInitialDeepLinkRef.current = true;
      pendingDeepLinkRef.current = null;
    }
  }, [documents.length, savedHighlightViews]);

  useEffect(() => {
    if (!didApplyInitialDeepLinkRef.current && typeof window !== 'undefined' && window.location.hash) {
      return;
    }

    const payload: DeepLinkPayload = {
      view,
    };
    if (view === 'reader' && activeDocumentId) {
      payload.documentId = activeDocumentId;
      payload.pageIndex = pendingNavigation?.pageIndex ?? currentPageIndex;
      if (pendingNavigation?.highlightId) {
        payload.highlightId = pendingNavigation.highlightId;
      }
    }
    if (view === 'highlights') {
      if (highlightsDocumentFilter !== 'all') {
        payload.documentId = highlightsDocumentFilter;
      }
      if (highlightsSearch.trim()) {
        payload.search = highlightsSearch.trim();
      }
    }
    if (view === 'insights' && activeDocumentId) {
      payload.documentId = activeDocumentId;
    }
    syncLocationDeepLink(payload);
  }, [
    activeDocumentId,
    currentPageIndex,
    highlightsDocumentFilter,
    highlightsSearch,
    activeDocumentId,
    pendingNavigation,
    view,
  ]);

  async function refreshLibraryData() {
    const refreshAction = startDebugAction({
      scope: 'app',
      name: 'refresh-library-data',
      documentId: activeDocumentId || undefined,
    });
    try {
      const [nextDocuments, nextCollections, nextHighlights] = await Promise.all([
        listDocuments(),
        listCollections(),
        listAllHighlights(),
      ]);

      setDocuments(nextDocuments);
      setCollections(nextCollections);
      setAllHighlights(nextHighlights);
      refreshAction.finish(true, {
        details: `docs=${nextDocuments.length} collections=${nextCollections.length} highlights=${nextHighlights.length}`,
      });
    } catch (refreshError) {
      refreshAction.finish(false, {
        details: 'Не удалось обновить библиотеку',
        data: summarizeForDebug(refreshError),
      });
      throw refreshError;
    }
  }

  async function handleImport() {
    addDebugEvent('app', 'ui.import.click');
    try {
      const result = await importPdf();
      if (result?.canceled) {
        incrementDebugCounter('app.import.canceled', 1, 'app');
        return;
      }

      if (result?.document) {
        upsertDocument(result.document);
      }

      await refreshLibraryData();
      showToast(
        result?.alreadyExists
          ? `Книга уже была в библиотеке: ${result?.document?.title || 'документ'}`
          : `Импортировано: ${result?.document?.title || 'документ'}`,
        result?.alreadyExists ? 'info' : 'success',
      );
      incrementDebugCounter(
        result?.alreadyExists ? 'app.import.duplicate' : 'app.import.created',
        1,
        'app',
        {
          documentId: result?.document?.id,
        },
      );
    } catch (error: any) {
      showToast(formatErrorToast('Ошибка импорта', error, 'E_IMPORT'), 'error');
    }
  }

  async function handleImportPaths(paths: string[]) {
    addDebugEvent('app', 'ui.import-paths.click', {
      details: `paths=${paths.length}`,
    });
    try {
      const result = await importPdfPaths(paths);
      await refreshLibraryData();
      showToast(
        `Импорт: ${result.imported.length} новых, ${result.duplicates.length} дубликатов, ${result.errors.length} ошибок.`,
        result.errors.length > 0 ? 'info' : 'success',
      );
      incrementDebugCounter('app.import-paths.created', result.imported.length, 'app');
      incrementDebugCounter('app.import-paths.duplicates', result.duplicates.length, 'app');
      incrementDebugCounter('app.import-paths.errors', result.errors.length, 'app');
    } catch (error: any) {
      showToast(formatErrorToast('Ошибка drag-and-drop импорта', error, 'E_IMPORT_DND'), 'error');
    }
  }

  function openReader(documentId: string, pageIndex?: number, highlightId?: string) {
    addDebugEvent('app', 'ui.open-reader', {
      documentId,
      highlightId,
      details: Number.isFinite(Number(pageIndex)) ? `page=${Number(pageIndex) + 1}` : undefined,
    });
    setActiveDocumentId(documentId);
    if (Number.isFinite(Number(pageIndex))) {
      setPendingNavigation({
        documentId,
        pageIndex: Math.max(0, Math.trunc(Number(pageIndex))),
        highlightId,
      });
    } else {
      setPendingNavigation(null);
    }
    setView('reader');
  }

  function openHighlights(documentId?: string) {
    addDebugEvent('app', 'ui.open-highlights', {
      documentId,
    });
    setView('highlights');
    if (documentId) {
      setHighlightsDocumentFilter(documentId);
    }
  }

  function openGlobalSearchResult(item: GlobalSearchItem) {
    if (item.kind === 'document') {
      openReader(item.documentId);
      setGlobalSearchQuery('');
      setIsGlobalSearchOpen(false);
      return;
    }

    if (item.kind === 'highlight') {
      openReader(item.documentId, item.pageIndex ?? 0, item.highlightId);
      setGlobalSearchQuery('');
      setIsGlobalSearchOpen(false);
      return;
    }

    setView('highlights');
    const normalizedTag = item.title.startsWith('#') ? item.title.slice(1) : item.title;
    setHighlightsSearch(normalizedTag);
    setIsGlobalSearchOpen(false);
  }

  function syncLocationDeepLink(payload: DeepLinkPayload) {
    if (typeof window === 'undefined') {
      return;
    }

    const nextHash = buildDeepLink(payload);
    if (window.location.hash === nextHash) {
      return;
    }
    window.history.replaceState(null, '', nextHash);
  }

  function applyDeepLinkPayload(payload: DeepLinkPayload | null): boolean {
    if (!payload) {
      return false;
    }

    const requestedView = payload.view || 'library';
    if (requestedView === 'library') {
      setView('library');
      return true;
    }

    if (requestedView === 'reader') {
      if (!payload.documentId) {
        return false;
      }
      openReader(payload.documentId, payload.pageIndex, payload.highlightId);
      return true;
    }

    if (requestedView === 'insights') {
      if (payload.documentId) {
        setActiveDocumentId(payload.documentId);
      }
      setView('insights');
      return true;
    }

    setView('highlights');
    if (payload.documentId) {
      setHighlightsDocumentFilter(payload.documentId);
    }
    if (payload.search) {
      setHighlightsSearch(payload.search);
    }
    if (payload.smartViewId) {
      const smartView = savedHighlightViews.find((item) => item.id === payload.smartViewId);
      if (smartView) {
        const filter = normalizeSmartHighlightFilter(smartView.filter);
        setHighlightsSearch(filter.search);
        setHighlightsDocumentFilter(filter.documentFilter || 'all');
        setHighlightsContextOnly(Boolean(filter.contextOnly));
        void handleTouchSmartHighlightView(smartView.id);
      }
    }
    return true;
  }

  async function copyDeepLink(payload: DeepLinkPayload) {
    const link = buildAbsoluteDeepLink(payload);
    try {
      await navigator.clipboard.writeText(link);
      showToast('Ссылка скопирована в буфер обмена.', 'success');
    } catch {
      showToast('Не удалось скопировать ссылку.', 'error');
    }
  }

  async function copyTextOutput(label: string, content: string) {
    const text = String(content || '').trim();
    if (!text) {
      showToast(`${label}: пустой результат.`, 'info');
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      showToast(`${label} скопирован в буфер обмена.`, 'success');
    } catch {
      showToast(`${label} готов, но буфер обмена недоступен.`, 'info');
    }
  }

  function resolveContextDocumentIds() {
    if (view === 'reader' && activeDocumentId) {
      return [activeDocumentId];
    }
    if (view === 'highlights' && highlightsDocumentFilter !== 'all') {
      return [highlightsDocumentFilter];
    }
    if (view === 'insights' && activeDocumentId) {
      return [activeDocumentId];
    }
    return undefined;
  }

  async function handleGenerateSrsDeck() {
    const documentIds = resolveContextDocumentIds();
    try {
      const result = await generateSrsDeck({
        documentIds,
        dueOnly: true,
        limit: 320,
      });
      if (result.cards.length === 0) {
        showToast('Нет карточек для генерации SRS.', 'info');
        return;
      }
      await copyTextOutput('SRS-карточки', result.markdown);
      showToast(
        `SRS: ${result.cards.length} карточек · due ${result.dueCount} · new ${result.newCount}`,
        'success',
      );
    } catch (error: any) {
      showToast(formatErrorToast('Ошибка генерации SRS', error, 'E_SRS_GENERATE'), 'error');
    }
  }

  async function handleBuildDigest(period: 'daily' | 'weekly') {
    const documentIds = resolveContextDocumentIds();
    try {
      const result = await buildReadingDigest({
        period,
        documentIds,
      });
      await copyTextOutput(
        period === 'daily' ? 'Daily digest' : 'Weekly digest',
        result.markdown,
      );
    } catch (error: any) {
      showToast(formatErrorToast('Ошибка генерации digest', error, 'E_DIGEST_BUILD'), 'error');
    }
  }

  async function handleAskLibrary() {
    const query = window.prompt('Спросите библиотеку:');
    if (!query || !query.trim()) {
      return;
    }

    const documentIds = resolveContextDocumentIds();
    try {
      const result = await askLibrary({
        query: query.trim(),
        documentIds,
        limit: 8,
      });
      const citations = result.citations
        .map(
          (item) =>
            `[${item.index}] ${item.documentTitle} · стр. ${item.page} · score=${item.score}\\n${item.snippet}`,
        )
        .join('\\n\\n');
      const report = [
        `# Ответ на запрос: ${result.query}`,
        '',
        result.answer,
        '',
        '## Цитаты',
        citations || 'Нет цитат.',
      ].join('\\n');
      await copyTextOutput('Ответ библиотеки', report);
    } catch (error: any) {
      showToast(formatErrorToast('Ошибка локального RAG', error, 'E_ASK_LIBRARY'), 'error');
    }
  }

  async function handleSummarizeHighlights() {
    const documentIds = resolveContextDocumentIds();
    const summaryDocumentId = documentIds?.[0];
    try {
      const result = await summarizeHighlights({
        documentId: summaryDocumentId,
        maxSentences: 8,
      });
      await copyTextOutput(
        'Саммари главы',
        [
          `# Саммари${result.documentTitle ? ` · ${result.documentTitle}` : ''}`,
          '',
          result.summary,
          '',
          `Использовано хайлайтов: ${result.usedHighlightsCount}`,
        ].join('\\n'),
      );
    } catch (error: any) {
      showToast(formatErrorToast('Ошибка саммари', error, 'E_SUMMARY'), 'error');
    }
  }

  async function handleExportObsidianBundle(documentId?: string) {
    const ids = documentId ? [documentId] : resolveContextDocumentIds();
    try {
      const result = await exportObsidianBundle({
        documentIds: ids,
      });
      if (result?.canceled) {
        showToast('Экспорт Obsidian bundle отменён.', 'info');
        return;
      }
      showToast(`Obsidian bundle: ${result.bundlePath || ''}`, 'success');
    } catch (error: any) {
      showToast(formatErrorToast('Ошибка экспорта Obsidian bundle', error, 'E_EXPORT_OBSIDIAN'), 'error');
    }
  }

  async function handleExportNotionBundle(documentId?: string) {
    const ids = documentId ? [documentId] : resolveContextDocumentIds();
    try {
      const result = await exportNotionBundle({
        documentIds: ids,
      });
      if (result?.canceled) {
        showToast('Экспорт Notion bundle отменён.', 'info');
        return;
      }
      showToast(`Notion bundle: ${result.bundlePath || ''}`, 'success');
    } catch (error: any) {
      showToast(formatErrorToast('Ошибка экспорта Notion bundle', error, 'E_EXPORT_NOTION'), 'error');
    }
  }

  async function handleDeleteDocument(documentId: string, title: string) {
    addDebugEvent('app', 'ui.delete-document.confirm', {
      documentId,
      details: title,
    });
    const confirmed = window.confirm(`Удалить книгу "${title}" и все её хайлайты?`);
    if (!confirmed) {
      incrementDebugCounter('app.delete-document.canceled', 1, 'app', {
        documentId,
      });
      return;
    }

    try {
      const result = await deleteDocument(documentId);
      if (!result?.deleted) {
        showToast('Документ уже удалён или не найден.', 'info');
        incrementDebugCounter('app.delete-document.not-found', 1, 'app', {
          documentId,
        });
        return;
      }

      removeDocument(documentId);
      await refreshLibraryData();
      showToast(`Книга удалена: ${title}`, 'success');

      if (activeDocumentId === documentId) {
        setView('library');
      }
      incrementDebugCounter('app.delete-document.ok', 1, 'app', {
        documentId,
      });
    } catch (error: any) {
      showToast(formatErrorToast('Ошибка удаления книги', error, 'E_DELETE_DOCUMENT'), 'error');
    }
  }

  async function handleExportPdf(documentId: string) {
    addDebugEvent('app', 'ui.export-pdf.click', {
      documentId,
    });
    try {
      const result = await exportAnnotatedPdf(documentId);
      if (result?.canceled) {
        showToast('Экспорт PDF отменён.', 'info');
        incrementDebugCounter('app.export-pdf.canceled', 1, 'app', {
          documentId,
        });
        return;
      }
      showToast(`PDF сохранён: ${result?.filePath || ''}`, 'success');
      incrementDebugCounter('app.export-pdf.ok', 1, 'app', {
        documentId,
      });
    } catch (error: any) {
      showToast(formatErrorToast('Ошибка экспорта PDF', error, 'E_EXPORT_PDF'), 'error');
    }
  }

  async function handleExportMarkdown(documentId: string) {
    addDebugEvent('app', 'ui.export-markdown.click', {
      documentId,
    });
    try {
      const result = await exportMarkdown(documentId);
      if (result?.canceled) {
        showToast('Экспорт Markdown отменён.', 'info');
        incrementDebugCounter('app.export-markdown.canceled', 1, 'app', {
          documentId,
        });
        return;
      }
      showToast(`Markdown сохранён: ${result?.filePath || ''}`, 'success');
      incrementDebugCounter('app.export-markdown.ok', 1, 'app', {
        documentId,
      });
    } catch (error: any) {
      showToast(formatErrorToast('Ошибка экспорта Markdown', error, 'E_EXPORT_MD'), 'error');
    }
  }

  async function handleTogglePin(documentInfo: DocumentRecord) {
    try {
      const updated = await updateDocumentMeta({
        documentId: documentInfo.id,
        isPinned: !Boolean(documentInfo.isPinned),
      });
      upsertDocument(updated);
      showToast(Boolean(updated.isPinned) ? 'Книга закреплена.' : 'Книга откреплена.', 'success');
    } catch (error: any) {
      showToast(formatErrorToast('Не удалось изменить закрепление', error, 'E_PIN'), 'error');
    }
  }

  async function handleAssignCollection(documentId: string, collectionId?: string) {
    try {
      const updated = await updateDocumentMeta({ documentId, collectionId });
      upsertDocument(updated);
      showToast('Коллекция обновлена.', 'success');
    } catch (error: any) {
      showToast(formatErrorToast('Не удалось сохранить коллекцию', error, 'E_COLLECTION_ASSIGN'), 'error');
    }
  }

  async function handleCreateCollection(name: string) {
    try {
      await createCollection(name);
      const nextCollections = await listCollections();
      setCollections(nextCollections);
      showToast('Коллекция создана.', 'success');
    } catch (error: any) {
      showToast(formatErrorToast('Не удалось создать коллекцию', error, 'E_COLLECTION_CREATE'), 'error');
    }
  }

  async function persistSavedHighlightViews(nextViews: SavedHighlightView[]) {
    const normalized = sortSavedHighlightViews(
      nextViews.map((viewItem) =>
      createSavedHighlightView(viewItem.name, normalizeSmartHighlightFilter(viewItem.filter), viewItem),
      ),
    );
    const updated = await updateSettings({
      savedHighlightViews: normalized,
      savedHighlightQueries: normalized.map((viewItem) => ({
        id: viewItem.id,
        name: viewItem.name,
        query: `smart:${JSON.stringify(viewItem.filter)}`,
        createdAt: viewItem.createdAt,
      })),
    });
    patchSettings(updated);
    return normalized;
  }

  async function handleSaveSmartHighlightView(name: string, filter: SmartHighlightFilter) {
    const trimmedName = name.trim();
    const normalizedFilter = normalizeSmartHighlightFilter(filter);
    if (!trimmedName) {
      showToast('Нельзя сохранить представление без названия.', 'info');
      return;
    }

    const current = [...savedHighlightViews];
    const existingIndex = current.findIndex(
      (item) => item.name.toLowerCase() === trimmedName.toLowerCase(),
    );
    const now = new Date().toISOString();
    if (existingIndex >= 0) {
      current[existingIndex] = createSavedHighlightView(trimmedName, normalizedFilter, {
        ...current[existingIndex],
        updatedAt: now,
      });
    } else {
      current.unshift(
        createSavedHighlightView(trimmedName, normalizedFilter, {
          createdAt: now,
          updatedAt: now,
        }),
      );
    }

    try {
      await persistSavedHighlightViews(current.slice(0, 40));
      showToast(`Представление сохранено: ${trimmedName}`, 'success');
    } catch (error: any) {
      showToast(
        formatErrorToast('Не удалось сохранить представление', error, 'E_SAVE_HIGHLIGHT_VIEW'),
        'error',
      );
    }
  }

  async function handleDeleteSmartHighlightView(viewId: string) {
    const current = [...savedHighlightViews];
    const next = current.filter((item) => item.id !== viewId);
    if (next.length === current.length) {
      return;
    }

    try {
      await persistSavedHighlightViews(next);
      showToast('Представление удалено.', 'info');
    } catch (error: any) {
      showToast(
        formatErrorToast('Не удалось удалить представление', error, 'E_DELETE_HIGHLIGHT_VIEW'),
        'error',
      );
    }
  }

  async function handleTouchSmartHighlightView(viewId: string) {
    const current = [...savedHighlightViews];
    const index = current.findIndex((item) => item.id === viewId);
    if (index < 0) {
      return;
    }
    current[index] = {
      ...current[index],
      lastUsedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    try {
      await persistSavedHighlightViews(current);
    } catch {
      // non-blocking metadata update
    }
  }

  async function handleTogglePinSmartHighlightView(viewId: string) {
    const current = [...savedHighlightViews];
    const index = current.findIndex((item) => item.id === viewId);
    if (index < 0) {
      return;
    }
    current[index] = {
      ...current[index],
      isPinned: !current[index].isPinned,
      updatedAt: new Date().toISOString(),
    };
    try {
      await persistSavedHighlightViews(current);
      showToast(current[index].isPinned ? 'Представление закреплено.' : 'Представление откреплено.', 'success');
    } catch (error: any) {
      showToast(
        formatErrorToast('Не удалось изменить закрепление представления', error, 'E_PIN_HIGHLIGHT_VIEW'),
        'error',
      );
    }
  }

  async function handleUpdateHighlightPatch(
    patch: Partial<HighlightRecord> & { id: string; documentId?: string },
  ) {
    const updatedHighlight = await updateHighlight(patch);
    upsertDocumentHighlight(updatedHighlight);
    return updatedHighlight;
  }

  async function handleReviewSrsCard(
    highlightId: string,
    grade: 'hard' | 'good' | 'easy',
  ) {
    const updatedHighlight = await reviewHighlightSrs({
      highlightId,
      grade,
    });
    upsertDocumentHighlight(updatedHighlight);
    return updatedHighlight;
  }

  async function handleSaveFocusMode(focusMode: boolean) {
    addDebugEvent('app', 'ui.focus-mode.change', {
      details: focusMode ? 'on' : 'off',
    });
    try {
      const updated = await updateSettings({ focusMode });
      patchSettings(updated);
      showToast('Настройка фокус-режима сохранена.', 'success');
    } catch (error: any) {
      showToast(formatErrorToast('Ошибка сохранения фокус-режима', error, 'E_SETTINGS_FOCUS'), 'error');
    }
  }

  async function handleRevealDataFolder() {
    try {
      await revealUserData();
    } catch (error: any) {
      showToast(formatErrorToast('Не удалось открыть папку данных', error, 'E_REVEAL_DATA'), 'error');
    }
  }

  async function handleBackup() {
    try {
      const result = await backupData();
      if (!result?.canceled) {
        showToast(`Бэкап создан: ${result.backupPath || ''}`, 'success');
      }
    } catch (error: any) {
      showToast(formatErrorToast('Ошибка бэкапа', error, 'E_BACKUP'), 'error');
    }
  }

  async function handleRestore() {
    addDebugEvent('app', 'ui.restore.click');
    const confirmed = window.confirm('Восстановить данные из бэкапа? Текущая база будет заменена.');
    if (!confirmed) {
      incrementDebugCounter('app.restore.canceled', 1, 'app');
      return;
    }

    try {
      const result = await restoreData();
      if (!result?.canceled) {
        await refreshLibraryData();
        showToast(`Данные восстановлены из: ${result?.backupPath || ''}`, 'success');
      }
    } catch (error: any) {
      showToast(formatErrorToast('Ошибка восстановления', error, 'E_RESTORE'), 'error');
    }
  }

  async function handleResetProgress(documentId: string, title: string) {
    addDebugEvent('app', 'ui.reset-progress.click', {
      documentId,
      details: title,
    });
    const confirmed = window.confirm(`Сбросить прогресс книги "${title}"?`);
    if (!confirmed) {
      incrementDebugCounter('app.reset-progress.canceled', 1, 'app', {
        documentId,
      });
      return;
    }

    try {
      const reset = await resetDocumentReadingState(documentId);
      upsertDocument(reset);
      showToast('Прогресс сброшен.', 'success');
    } catch (error: any) {
      showToast(formatErrorToast('Ошибка сброса прогресса', error, 'E_RESET_PROGRESS'), 'error');
    }
  }

  async function handleDeleteHighlight(highlight: HighlightRecord) {
    addDebugEvent('app', 'ui.delete-highlight.click', {
      documentId: highlight.documentId,
      highlightId: highlight.id,
    });
    const confirmed = window.confirm('Удалить выбранный хайлайт?');
    if (!confirmed) {
      incrementDebugCounter('app.delete-highlight.canceled', 1, 'app', {
        documentId: highlight.documentId,
        highlightId: highlight.id,
      });
      return;
    }

    try {
      await deleteHighlightById(highlight.id);
      removeDocumentHighlight(highlight.documentId, highlight.id);
      showToast('Хайлайт удалён.', 'success');
    } catch (error: any) {
      showToast(formatErrorToast('Ошибка удаления хайлайта', error, 'E_DELETE_HIGHLIGHT'), 'error');
    }
  }

  async function handleDeleteHighlightsBatch(highlightsBatch: HighlightRecord[]) {
    const uniqueHighlights = Array.from(
      new Map(highlightsBatch.map((highlight) => [highlight.id, highlight])).values(),
    );

    if (uniqueHighlights.length === 0) {
      showToast('Нет выбранных хайлайтов для удаления.', 'info');
      return;
    }

    addDebugEvent('app', 'ui.delete-highlights-batch.click', {
      details: `count=${uniqueHighlights.length}`,
    });

    const confirmed = window.confirm(`Удалить выбранные хайлайты (${uniqueHighlights.length})?`);
    if (!confirmed) {
      incrementDebugCounter('app.delete-highlights-batch.canceled', 1, 'app');
      return;
    }

    const results = await Promise.allSettled(
      uniqueHighlights.map(async (highlight) => {
        await deleteHighlightById(highlight.id);
        removeDocumentHighlight(highlight.documentId, highlight.id);
      }),
    );

    const deleted = results.filter((result) => result.status === 'fulfilled').length;
    const failed = results.length - deleted;

    if (deleted > 0 && failed === 0) {
      showToast(`Удалено ${deleted} хайлайтов.`, 'success');
      return;
    }

    if (deleted > 0) {
      showToast(`Удалено ${deleted} хайлайтов, ошибок: ${failed}.`, 'info');
      return;
    }

    showToast('Не удалось удалить выбранные хайлайты.', 'error');
  }

  function handleBackToLibrary() {
    addDebugEvent('app', 'ui.back-to-library');
    setView('library');
    void refreshLibraryData();
  }

  function handleTopTabChange(nextView: AppView) {
    addDebugEvent('app', 'ui.tab-change', {
      details: nextView,
    });
    if (nextView === 'reader' && !activeDocumentId) {
      showToast('Сначала откройте книгу из библиотеки.', 'info');
      return;
    }

    if (nextView === 'highlights' || nextView === 'insights') {
      if (documents.length === 0) {
        showToast('Сначала импортируйте книгу.', 'info');
        return;
      }
    }

    setView(nextView);
  }

  function applyWorkspacePreset(nextPreset: WorkspacePreset) {
    setWorkspacePreset(nextPreset);
    const nextDensity = defaultDensityForPreset(nextPreset);
    setUiDensity(nextDensity);
    addDebugEvent('ui', 'workspace-preset.apply', {
      details: nextPreset,
      data: { density: nextDensity },
    });
    showToast(
      `Workspace: ${workspacePresetLabel(nextPreset)} · ${
        nextDensity === 'compact' ? 'плотный' : 'комфортный'
      } режим.`,
      'info',
    );
  }

  function toggleUiDensity() {
    setUiDensity((value) => {
      const next = value === 'comfortable' ? 'compact' : 'comfortable';
      addDebugEvent('ui', 'ui-density.toggle', {
        details: next,
      });
      showToast(
        next === 'compact'
          ? 'Интерфейс: компактный режим.'
          : 'Интерфейс: комфортный режим.',
        'info',
      );
      return next;
    });
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = String(target?.tagName || '').toLowerCase();
      const isEditableTarget =
        Boolean(target?.isContentEditable) ||
        tagName === 'input' ||
        tagName === 'textarea' ||
        tagName === 'select';

      const isPaletteShortcut =
        (event.metaKey || event.ctrlKey) &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === 'k';
      if (isPaletteShortcut) {
        event.preventDefault();
        setIsCommandPaletteOpen(true);
        return;
      }

      const isDensityShortcut =
        event.altKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 'd';
      if (isDensityShortcut) {
        event.preventDefault();
        toggleUiDensity();
        return;
      }

      const isPresetShortcut =
        event.altKey &&
        event.shiftKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        ['1', '2', '3'].includes(event.key);
      if (isPresetShortcut) {
        event.preventDefault();
        if (event.key === '1') {
          applyWorkspacePreset('focus');
          return;
        }
        if (event.key === '2') {
          applyWorkspacePreset('research');
          return;
        }
        applyWorkspacePreset('review');
        return;
      }

      const isGlobalSearchShortcut =
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        event.key === '/';
      if (isGlobalSearchShortcut && !isEditableTarget) {
        event.preventDefault();
        setIsGlobalSearchOpen(true);
        globalSearchInputRef.current?.focus();
        globalSearchInputRef.current?.select();
        return;
      }

      if (isEditableTarget) {
        return;
      }

      const isTabShortcut =
        event.altKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        ['1', '2', '3', '4'].includes(event.key);
      if (!isTabShortcut) {
        return;
      }

      event.preventDefault();
      if (event.key === '1') {
        handleTopTabChange('library');
        return;
      }

      if (event.key === '2') {
        handleTopTabChange('reader');
        return;
      }
      if (event.key === '3') {
        handleTopTabChange('highlights');
        return;
      }
      handleTopTabChange('insights');
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    canOpenHighlights,
    canOpenInsights,
    canOpenReader,
    documents.length,
    activeDocumentId,
    showToast,
    applyWorkspacePreset,
    toggleUiDensity,
    handleTopTabChange,
  ]);

  const commandActions: CommandPaletteAction[] = [
    {
      id: 'go-library',
      title: 'Перейти: Библиотека',
      subtitle: 'Открыть список книг и инспектор',
      shortcut: 'Alt+1',
      keywords: ['library', 'books', 'книги'],
      run: () => {
        handleTopTabChange('library');
      },
    },
    {
      id: 'workspace-focus',
      title: 'Пресет: Focus',
      subtitle: 'Максимальная концентрация и плотный интерфейс',
      shortcut: 'Alt+Shift+1',
      keywords: ['preset', 'focus', 'workspace', 'режим'],
      run: () => {
        applyWorkspacePreset('focus');
      },
    },
    {
      id: 'workspace-research',
      title: 'Пресет: Research',
      subtitle: 'Режим исследования, комфортный ритм',
      shortcut: 'Alt+Shift+2',
      keywords: ['preset', 'research', 'workspace', 'режим'],
      run: () => {
        applyWorkspacePreset('research');
      },
    },
    {
      id: 'workspace-review',
      title: 'Пресет: Review',
      subtitle: 'Режим ревью и обработки хайлайтов',
      shortcut: 'Alt+Shift+3',
      keywords: ['preset', 'review', 'workspace', 'режим'],
      run: () => {
        applyWorkspacePreset('review');
      },
    },
    {
      id: 'focus-global-search',
      title: 'Глобальный поиск',
      subtitle: 'Книги, теги и хайлайты в одном поиске',
      shortcut: '/',
      keywords: ['search', 'global', 'fuzzy', 'поиск'],
      run: () => {
        setIsGlobalSearchOpen(true);
        globalSearchInputRef.current?.focus();
        globalSearchInputRef.current?.select();
      },
    },
    {
      id: 'copy-current-deeplink',
      title: 'Скопировать deep link',
      subtitle: 'Ссылка на текущий контекст экрана',
      keywords: ['link', 'deeplink', 'copy', 'share', 'ссылка'],
      run: async () => {
        const payload: DeepLinkPayload = { view };
        if (view === 'reader' && activeDocumentId) {
          payload.documentId = activeDocumentId;
          payload.pageIndex = pendingNavigation?.pageIndex ?? currentPageIndex;
          payload.highlightId = pendingNavigation?.highlightId;
        }
        if (view === 'highlights') {
          if (highlightsDocumentFilter !== 'all') {
            payload.documentId = highlightsDocumentFilter;
          }
          if (highlightsSearch.trim()) {
            payload.search = highlightsSearch.trim();
          }
        }
        if (view === 'insights' && activeDocumentId) {
          payload.documentId = activeDocumentId;
        }
        await copyDeepLink(payload);
      },
    },
    {
      id: 'go-reader',
      title: 'Перейти: Читалка',
      subtitle: 'Открыть активную книгу',
      shortcut: 'Alt+2',
      keywords: ['reader', 'читать', 'pdf'],
      disabled: !canOpenReader,
      run: () => {
        handleTopTabChange('reader');
      },
    },
    {
      id: 'go-highlights',
      title: 'Перейти: Хайлайты',
      subtitle: 'Открыть список выделений',
      shortcut: 'Alt+3',
      keywords: ['highlights', 'заметки', 'выделения'],
      disabled: !canOpenHighlights,
      run: () => {
        handleTopTabChange('highlights');
      },
    },
    {
      id: 'go-insights',
      title: 'Перейти: Insights',
      subtitle: 'SRS, digest, chapter summary и AI-коуч',
      shortcut: 'Alt+4',
      keywords: ['insights', 'srs', 'digest', 'ai', 'summary'],
      disabled: !canOpenInsights,
      run: () => {
        handleTopTabChange('insights');
      },
    },
    {
      id: 'import-pdf',
      title: 'Импорт PDF',
      subtitle: 'Добавить новую книгу в библиотеку',
      keywords: ['import', 'добавить', 'файл'],
      run: async () => {
        await handleImport();
      },
    },
    {
      id: 'open-data-folder',
      title: 'Открыть папку данных',
      subtitle: 'Быстрый доступ к хранилищу приложения',
      keywords: ['folder', 'data', 'backup', 'папка'],
      run: async () => {
        await handleRevealDataFolder();
      },
    },
    {
      id: 'insights-generate-srs',
      title: 'Killer: Автогенерация SRS-карточек',
      subtitle: 'Собрать интервальные карточки из хайлайтов',
      keywords: ['srs', 'spaced repetition', 'anki', 'cards', 'интервальное'],
      disabled: documents.length === 0,
      run: async () => {
        await handleGenerateSrsDeck();
      },
    },
    {
      id: 'insights-digest-daily',
      title: 'Killer: Daily digest',
      subtitle: 'Сводка дня по чтению и inbox хайлайтам',
      keywords: ['digest', 'daily', 'summary', 'день'],
      disabled: documents.length === 0,
      run: async () => {
        await handleBuildDigest('daily');
      },
    },
    {
      id: 'insights-digest-weekly',
      title: 'Killer: Weekly digest',
      subtitle: 'Сводка недели по чтению и выделениям',
      keywords: ['digest', 'weekly', 'summary', 'неделя'],
      disabled: documents.length === 0,
      run: async () => {
        await handleBuildDigest('weekly');
      },
    },
    {
      id: 'insights-ask-library',
      title: 'Killer: Спроси библиотеку',
      subtitle: 'Локальный RAG по цитатам и заметкам',
      keywords: ['rag', 'ask', 'query', 'вопрос'],
      disabled: documents.length === 0,
      run: async () => {
        await handleAskLibrary();
      },
    },
    {
      id: 'insights-auto-summary',
      title: 'Killer: Авто-саммари главы',
      subtitle: 'Собрать summary из выбранного контекста',
      keywords: ['summary', 'chapter', 'саммари', 'глава'],
      disabled: documents.length === 0,
      run: async () => {
        await handleSummarizeHighlights();
      },
    },
    {
      id: 'export-obsidian-bundle',
      title: 'Экспорт: Obsidian bundle',
      subtitle: 'Полный пакет: книги, хайлайты, SRS, digest',
      keywords: ['export', 'obsidian', 'bundle', 'markdown'],
      disabled: documents.length === 0,
      run: async () => {
        await handleExportObsidianBundle();
      },
    },
    {
      id: 'export-notion-bundle',
      title: 'Экспорт: Notion bundle',
      subtitle: 'CSV + markdown пакет для импорта в Notion',
      keywords: ['export', 'notion', 'bundle', 'csv'],
      disabled: documents.length === 0,
      run: async () => {
        await handleExportNotionBundle();
      },
    },
    {
      id: 'toggle-density',
      title:
        uiDensity === 'comfortable'
          ? 'Интерфейс: включить компактный режим'
          : 'Интерфейс: включить комфортный режим',
      subtitle: 'Управление плотностью интерфейса',
      shortcut: 'Alt+D',
      keywords: ['density', 'compact', 'comfortable', 'плотность'],
      run: () => {
        toggleUiDensity();
      },
    },
    {
      id: 'toggle-focus-mode',
      title: settings.focusMode ? 'Выключить фокус-режим' : 'Включить фокус-режим',
      subtitle: 'Скрыть второстепенные элементы в читалке',
      keywords: ['focus', 'режим', 'reader'],
      run: async () => {
        await handleSaveFocusMode(!settings.focusMode);
      },
    },
    {
      id: 'toggle-debug-overlay',
      title: getDiagnosticsOverlayVisible() ? 'Скрыть debug-панель' : 'Открыть debug-панель',
      subtitle: 'Подробный трассировщик и профайлер',
      keywords: ['debug', 'trace', 'overlay', 'profiler', 'tray'],
      run: () => {
        setDiagnosticsOverlayVisible(!getDiagnosticsOverlayVisible());
      },
    },
    {
      id: 'open-active-reader',
      title: 'Открыть активную книгу',
      subtitle: activeDocument ? truncate(activeDocument.title, 72) : 'Активная книга не выбрана',
      keywords: ['open', 'active', 'reader'],
      disabled: !activeDocument,
      run: () => {
        if (!activeDocument) {
          return;
        }
        openReader(activeDocument.id);
      },
    },
    ...documents.slice(0, 8).map((documentInfo) => ({
      id: `open-doc-${documentInfo.id}`,
      title: `Открыть: ${truncate(documentInfo.title, 68)}`,
      subtitle: 'Быстрый переход в читалку',
      keywords: ['open', 'reader', 'book', documentInfo.title],
      run: () => {
        openReader(documentInfo.id);
      },
    })),
    ...savedHighlightViews.slice(0, 10).map((savedView) => ({
      id: `saved-highlight-view-${savedView.id}`,
      title: `Представление: ${savedView.name}`,
      subtitle: 'Применить сохранённый фильтр хайлайтов',
      keywords: ['saved', 'highlight', 'view', savedView.name],
      run: () => {
        setView('highlights');
        const smartPayload = normalizeSmartHighlightFilter(savedView.filter);
        setHighlightsSearch(smartPayload.search);
        setHighlightsDocumentFilter(smartPayload.documentFilter || 'all');
        setHighlightsContextOnly(Boolean(smartPayload.contextOnly));
        void handleTouchSmartHighlightView(savedView.id);
      },
    })),
  ];

  return (
    <div className={`app-root theme-white density-${uiDensity}`}>
      <header className="app-top">
        <LiquidSurface className="app-chrome glass-panel" tone="chrome" padding="10px 14px">
          <div className="app-chrome-center">
            <span className="app-product">Recall PDF</span>
            <div className="app-chrome-meta">
              <span className="chip">Книг: {documents.length}</span>
              <span className="chip">Хайлайтов: {totalHighlights}</span>
              {activeDocument ? (
                <span className="chip active">
                  Открыта: {truncate(activeDocument.title, 52)}
                </span>
              ) : (
                <span className="chip">Книга не выбрана</span>
              )}
            </div>
          </div>
          <div className="app-chrome-right">
            <div className="global-search-shell">
              <label className="global-search-field">
                <span className="sr-only">Глобальный поиск</span>
                <input
                  ref={globalSearchInputRef}
                  type="text"
                  value={globalSearchQuery}
                  placeholder="Поиск: книги, хайлайты, теги"
                  onFocus={() => {
                    setIsGlobalSearchOpen(true);
                  }}
                  onBlur={() => {
                    window.setTimeout(() => {
                      setIsGlobalSearchOpen(false);
                    }, 120);
                  }}
                  onChange={(event) => {
                    setGlobalSearchQuery(event.target.value);
                    setIsGlobalSearchOpen(true);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      setGlobalSearchIndex((index) =>
                        globalSearchResults.length === 0
                          ? 0
                          : (index + 1) % globalSearchResults.length,
                      );
                      return;
                    }
                    if (event.key === 'ArrowUp') {
                      event.preventDefault();
                      setGlobalSearchIndex((index) =>
                        globalSearchResults.length === 0
                          ? 0
                          : (index - 1 + globalSearchResults.length) % globalSearchResults.length,
                      );
                      return;
                    }
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      setIsGlobalSearchOpen(false);
                      return;
                    }
                    if (event.key === 'Enter') {
                      if (globalSearchResults.length === 0) {
                        return;
                      }
                      event.preventDefault();
                      openGlobalSearchResult(
                        globalSearchResults[Math.max(0, Math.min(globalSearchIndex, globalSearchResults.length - 1))],
                      );
                    }
                  }}
                />
              </label>
              {isGlobalSearchOpen && globalSearchQuery.trim() ? (
                <div className="global-search-results" role="listbox" aria-label="Результаты глобального поиска">
                  {globalSearchResults.length > 0 ? (
                    globalSearchResults.map((item, index) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`global-search-item ${index === globalSearchIndex ? 'active' : ''}`}
                        onMouseEnter={() => setGlobalSearchIndex(index)}
                        onClick={() => {
                          openGlobalSearchResult(item);
                        }}
                      >
                        <strong>{item.title}</strong>
                        <small className="muted">{item.subtitle}</small>
                      </button>
                    ))
                  ) : (
                    <p className="muted">Ничего не найдено.</p>
                  )}
                </div>
              ) : null}
            </div>
            <TopTabs
              activeView={view}
              onChange={handleTopTabChange}
              canOpenReader={canOpenReader}
              canOpenHighlights={canOpenHighlights}
              canOpenInsights={canOpenInsights}
              libraryCount={documents.length}
              highlightsCount={totalHighlights}
            />
            <div className="workspace-preset-group" role="group" aria-label="Пресет рабочего пространства">
              {(['focus', 'research', 'review'] as WorkspacePreset[]).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className={`btn ghost ${workspacePreset === preset ? 'active' : ''}`}
                  onClick={() => {
                    applyWorkspacePreset(preset);
                  }}
                >
                  {workspacePresetLabel(preset)}
                </button>
              ))}
            </div>
            <button type="button" className="btn ghost" onClick={toggleUiDensity}>
              {uiDensity === 'compact' ? 'UI: Плотно' : 'UI: Комфорт'}
            </button>
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setIsCommandPaletteOpen(true);
              }}
            >
              Команды
            </button>
            <StatusCenter />
            <DebugToggleButton />
          </div>
        </LiquidSurface>
      </header>

      {view === 'library' ? (
        <LibraryView
          workspacePreset={workspacePreset}
          documents={documents}
          collections={collections}
          settings={settings}
          loading={loading}
          onImport={handleImport}
          onImportPaths={handleImportPaths}
          onOpenReader={(documentId) => openReader(documentId)}
          onOpenHighlights={(documentId) => openHighlights(documentId)}
          onDeleteDocument={handleDeleteDocument}
          onExportPdf={handleExportPdf}
          onExportMarkdown={handleExportMarkdown}
          onExportObsidianBundle={handleExportObsidianBundle}
          onExportNotionBundle={handleExportNotionBundle}
          onTogglePin={handleTogglePin}
          onAssignCollection={handleAssignCollection}
          onCreateCollection={handleCreateCollection}
          onSaveFocusMode={handleSaveFocusMode}
          onRevealDataFolder={handleRevealDataFolder}
          onBackup={handleBackup}
          onRestore={handleRestore}
          onResetProgress={handleResetProgress}
          onCopyDeepLink={(documentId) => {
            void copyDeepLink({
              view: 'reader',
              documentId,
            });
          }}
        />
      ) : null}

      {view === 'reader' && activeDocument ? (
        <ReaderView
          workspacePreset={workspacePreset}
          document={activeDocument}
          settings={settings}
          highlights={activeDocumentHighlights}
          pendingNavigation={pendingNavigation}
          onNavigationConsumed={() => setPendingNavigation(null)}
          onBackToLibrary={handleBackToLibrary}
          onOpenHighlightsTab={() => {
            setHighlightsDocumentFilter(activeDocument.id);
            setView('highlights');
          }}
          onSetHighlights={(documentId, nextHighlights) => {
            setDocumentHighlights(documentId, nextHighlights);
          }}
          onUpsertHighlight={(highlight) => {
            upsertDocumentHighlight(highlight);
          }}
          onDeleteHighlightFromStore={(documentId, highlightId) => {
            removeDocumentHighlight(documentId, highlightId);
          }}
          onSetCurrentPage={(pageIndex, totalPages) => setCurrentPageState(pageIndex, totalPages)}
          onNotify={showToast}
          onCopyDeepLink={(documentId, pageIndex, highlightId) => {
            void copyDeepLink({
              view: 'reader',
              documentId,
              pageIndex,
              highlightId,
            });
          }}
        />
      ) : null}

      {view === 'highlights' ? (
        <HighlightsView
          workspacePreset={workspacePreset}
          documents={documents}
          highlights={allHighlights}
          activeDocumentId={activeDocumentId}
          currentPageIndex={currentPageIndex}
          search={highlightsSearch}
          contextOnly={highlightsContextOnly}
          documentFilter={highlightsDocumentFilter}
          onChangeSearch={setHighlightsSearch}
          onChangeContextOnly={setHighlightsContextOnly}
          onChangeDocumentFilter={setHighlightsDocumentFilter}
          onOpenReaderHighlight={(documentId, pageIndex, highlightId) => {
            openReader(documentId, pageIndex, highlightId);
          }}
          onCopyHighlightLink={(documentId, pageIndex, highlightId) => {
            void copyDeepLink({
              view: 'reader',
              documentId,
              pageIndex,
              highlightId,
            });
          }}
          onNotify={showToast}
          onDeleteHighlight={handleDeleteHighlight}
          onDeleteHighlightsBatch={handleDeleteHighlightsBatch}
          onUpdateHighlight={handleUpdateHighlightPatch}
          savedSmartViews={savedHighlightViews}
          onSaveSmartFilter={handleSaveSmartHighlightView}
          onDeleteSmartFilter={handleDeleteSmartHighlightView}
          onTouchSmartFilter={handleTouchSmartHighlightView}
          onTogglePinSmartFilter={handleTogglePinSmartHighlightView}
        />
      ) : null}

      {view === 'insights' ? (
        <InsightsView
          workspacePreset={workspacePreset}
          documents={documents}
          activeDocumentId={activeDocumentId}
          onNotify={showToast}
          onOpenReaderHighlight={(documentId, pageIndex, highlightId) => {
            openReader(documentId, pageIndex, highlightId);
          }}
          onReviewSrsCard={handleReviewSrsCard}
        />
      ) : null}

      {toast ? <Toast message={toast.message} type={toast.type} /> : null}
      <CommandPalette
        open={isCommandPaletteOpen}
        actions={commandActions}
        onClose={() => {
          setIsCommandPaletteOpen(false);
        }}
      />
      <DebugOverlay activeDocumentId={activeDocumentId} />
    </div>
  );
}
