import { useEffect, useMemo, useState } from 'react';
import {
  formatDateTime,
  normalizeSelectionText,
  truncate,
  truncateSelectionText,
} from '../../lib/format';
import { HIGHLIGHT_COLORS, highlightColorLabel } from '../../lib/highlightColors';
import {
  normalizeSmartHighlightFilter,
} from '../../lib/smartHighlightView';
import { useRenderProfiler } from '../../lib/perfProfiler';
import type {
  DocumentRecord,
  HighlightRecord,
  SavedHighlightView,
  SmartHighlightFilter,
  WorkspacePreset,
} from '../../types';
import { LiquidSurface } from '../../components/LiquidSurface';

interface HighlightsViewProps {
  workspacePreset: WorkspacePreset;
  documents: DocumentRecord[];
  highlights: HighlightRecord[];
  activeDocumentId: string | null;
  currentPageIndex: number;
  search: string;
  contextOnly: boolean;
  documentFilter: string;
  onChangeSearch: (value: string) => void;
  onChangeContextOnly: (value: boolean) => void;
  onChangeDocumentFilter: (value: string) => void;
  onOpenReaderHighlight: (documentId: string, pageIndex: number, highlightId?: string) => void;
  onCopyHighlightLink: (documentId: string, pageIndex: number, highlightId?: string) => void;
  onNotify: (message: string, type?: 'info' | 'error' | 'success') => void;
  onDeleteHighlight: (highlight: HighlightRecord) => Promise<void>;
  onDeleteHighlightsBatch: (highlights: HighlightRecord[]) => Promise<void>;
  onUpdateHighlight: (
    patch: Partial<HighlightRecord> & { id: string; documentId?: string },
  ) => Promise<HighlightRecord>;
  savedSmartViews: SavedHighlightView[];
  onSaveSmartFilter: (name: string, filter: SmartHighlightFilter) => Promise<void>;
  onDeleteSmartFilter: (id: string) => Promise<void>;
  onTouchSmartFilter: (id: string) => Promise<void>;
  onTogglePinSmartFilter: (id: string) => Promise<void>;
}

const HIGHLIGHTS_INSPECTOR_WIDTH_KEY = 'recall.ui.highlightsInspectorWidth';
const MIN_HIGHLIGHTS_INSPECTOR_WIDTH = 320;
const MAX_HIGHLIGHTS_INSPECTOR_WIDTH = 680;

function parseTagsInput(value: string) {
  const unique = new Set<string>();
  String(value || '')
    .split(/[,\n]/g)
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((item) => unique.add(item));
  return [...unique].slice(0, 12);
}

function toSearchable(value: unknown) {
  return normalizeSelectionText(
    String(value ?? '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' '),
  ).toLowerCase();
}

function matchesSearch(highlight: HighlightRecord, rawQuery: string): boolean {
  const query = toSearchable(rawQuery);
  if (!query) {
    return true;
  }

  const text = toSearchable(highlight.selectedText);
  const rich = toSearchable(highlight.selectedRichText);
  const note = toSearchable(highlight.note);
  const tags = (highlight.tags ?? []).join(' ').toLowerCase();
  return text.includes(query) || rich.includes(query) || note.includes(query) || tags.includes(query);
}

function highlightAnchor(highlight: HighlightRecord): { y: number; x: number } {
  const rect = (highlight.rects ?? [])
    .filter((item) => item && Number(item.w) > 0 && Number(item.h) > 0)
    .sort((left, right) => (Math.abs(left.y - right.y) > 0.0001 ? left.y - right.y : left.x - right.x))[0];
  return {
    y: Number(rect?.y ?? 1),
    x: Number(rect?.x ?? 1),
  };
}

function compareHighlightPosition(left: HighlightRecord, right: HighlightRecord): number {
  if (left.pageIndex !== right.pageIndex) {
    return left.pageIndex - right.pageIndex;
  }
  const leftAnchor = highlightAnchor(left);
  const rightAnchor = highlightAnchor(right);
  if (Math.abs(leftAnchor.y - rightAnchor.y) > 0.0001) {
    return leftAnchor.y - rightAnchor.y;
  }
  if (Math.abs(leftAnchor.x - rightAnchor.x) > 0.0001) {
    return leftAnchor.x - rightAnchor.x;
  }
  return new Date(left.createdAt).valueOf() - new Date(right.createdAt).valueOf();
}

export function HighlightsView({
  workspacePreset,
  documents,
  highlights,
  activeDocumentId,
  currentPageIndex,
  search,
  contextOnly,
  documentFilter,
  onChangeSearch,
  onChangeContextOnly,
  onChangeDocumentFilter,
  onOpenReaderHighlight,
  onCopyHighlightLink,
  onNotify,
  onDeleteHighlight,
  onDeleteHighlightsBatch,
  onUpdateHighlight,
  savedSmartViews,
  onSaveSmartFilter,
  onDeleteSmartFilter,
  onTouchSmartFilter,
  onTogglePinSmartFilter,
}: HighlightsViewProps) {
  useRenderProfiler('HighlightsView');
  const [colorFilter, setColorFilter] = useState<'all' | HighlightRecord['color']>('all');
  const [notesOnly, setNotesOnly] = useState(false);
  const [inboxOnly, setInboxOnly] = useState(false);
  const [groupMode, setGroupMode] = useState<'document' | 'timeline'>('document');
  const [selectedHighlightId, setSelectedHighlightId] = useState<string | null>(null);
  const [selectedHighlightIds, setSelectedHighlightIds] = useState<string[]>([]);
  const [inspectorWidth, setInspectorWidth] = useState(380);
  const [isInspectorHidden, setIsInspectorHidden] = useState(false);
  const [bulkColor, setBulkColor] = useState<HighlightRecord['color']>('yellow');
  const [bulkTagsInput, setBulkTagsInput] = useState('');

  const documentMap = useMemo(() => {
    const map = new Map<string, DocumentRecord>();
    for (const documentInfo of documents) {
      map.set(documentInfo.id, documentInfo);
    }
    return map;
  }, [documents]);

  const filteredHighlights = useMemo(() => {
    return highlights
      .filter((highlight) => {
        if (documentFilter !== 'all' && highlight.documentId !== documentFilter) {
          return false;
        }

        if (colorFilter !== 'all' && highlight.color !== colorFilter) {
          return false;
        }

        if (notesOnly && !String(highlight.note || '').trim()) {
          return false;
        }

        if (inboxOnly) {
          const hasNote = Boolean(String(highlight.note || '').trim());
          const hasTags = Array.isArray(highlight.tags) && highlight.tags.length > 0;
          if (hasNote || hasTags) {
            return false;
          }
        }

        if (!matchesSearch(highlight, search)) {
          return false;
        }

        if (contextOnly) {
          if (!activeDocumentId || highlight.documentId !== activeDocumentId) {
            return false;
          }

          if (Math.abs(highlight.pageIndex - currentPageIndex) > 3) {
            return false;
          }
        }

        return true;
      })
      .sort((left, right) => {
        if (left.documentId === right.documentId) {
          if (left.pageIndex === right.pageIndex) {
            return new Date(right.createdAt).valueOf() - new Date(left.createdAt).valueOf();
          }
          return left.pageIndex - right.pageIndex;
        }

        const leftTitle = documentMap.get(left.documentId)?.title || left.documentId;
        const rightTitle = documentMap.get(right.documentId)?.title || right.documentId;
        return leftTitle.localeCompare(rightTitle, 'ru');
      });
  }, [
    activeDocumentId,
    colorFilter,
    contextOnly,
    currentPageIndex,
    documentFilter,
    documentMap,
    highlights,
    inboxOnly,
    notesOnly,
    search,
  ]);

  const highlightContextMap = useMemo(() => {
    const map = new Map<string, { before: string; after: string }>();
    const sorted = [...filteredHighlights].sort(compareHighlightPosition);
    for (let index = 0; index < sorted.length; index += 1) {
      const current = sorted[index];
      const previous = sorted[index - 1];
      const next = sorted[index + 1];
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
  }, [filteredHighlights]);

  const groupedSections = useMemo(() => {
    if (groupMode === 'timeline') {
      const map = new Map<string, HighlightRecord[]>();
      for (const highlight of filteredHighlights) {
        const dayKey = String(highlight.createdAt || '').slice(0, 10) || 'unknown';
        if (!map.has(dayKey)) {
          map.set(dayKey, []);
        }
        map.get(dayKey)?.push(highlight);
      }

      return [...map.entries()]
        .sort((left, right) => right[0].localeCompare(left[0]))
        .map(([groupId, sectionHighlights]) => ({
          groupId,
          title: formatDateTime(`${groupId}T00:00:00.000Z`),
          highlights: sectionHighlights,
        }));
    }

    const map = new Map<string, HighlightRecord[]>();
    for (const highlight of filteredHighlights) {
      if (!map.has(highlight.documentId)) {
        map.set(highlight.documentId, []);
      }
      map.get(highlight.documentId)?.push(highlight);
    }
    return [...map.entries()].map(([groupId, sectionHighlights]) => ({
      groupId,
      title: documentMap.get(groupId)?.title || groupId,
      highlights: sectionHighlights,
    }));
  }, [documentMap, filteredHighlights, groupMode]);

  const highlightsStats = useMemo(() => {
    const withNotes = filteredHighlights.filter((highlight) =>
      Boolean(String(highlight.note || '').trim()),
    ).length;
    const tagged = filteredHighlights.filter((highlight) =>
      Array.isArray(highlight.tags) && highlight.tags.length > 0,
    ).length;
    const inbox = filteredHighlights.filter((highlight) => {
      const hasNote = Boolean(String(highlight.note || '').trim());
      const hasTags = Array.isArray(highlight.tags) && highlight.tags.length > 0;
      return !hasNote && !hasTags;
    }).length;
    return {
      documents: groupedSections.length,
      withNotes,
      tagged,
      inbox,
    };
  }, [filteredHighlights, groupedSections.length]);

  useEffect(() => {
    try {
      const rawWidth = Number(window.localStorage.getItem(HIGHLIGHTS_INSPECTOR_WIDTH_KEY) || 0);
      if (Number.isFinite(rawWidth) && rawWidth >= MIN_HIGHLIGHTS_INSPECTOR_WIDTH) {
        setInspectorWidth(
          Math.min(
            MAX_HIGHLIGHTS_INSPECTOR_WIDTH,
            Math.max(MIN_HIGHLIGHTS_INSPECTOR_WIDTH, Math.trunc(rawWidth)),
          ),
        );
      }
    } catch {
      // ignore storage access failures
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(HIGHLIGHTS_INSPECTOR_WIDTH_KEY, String(inspectorWidth));
    } catch {
      // ignore storage access failures
    }
  }, [inspectorWidth]);

  useEffect(() => {
    if (filteredHighlights.length === 0) {
      if (selectedHighlightId !== null) {
        setSelectedHighlightId(null);
      }
      return;
    }

    if (!selectedHighlightId || !filteredHighlights.some((highlight) => highlight.id === selectedHighlightId)) {
      setSelectedHighlightId(filteredHighlights[0].id);
    }
  }, [filteredHighlights, selectedHighlightId]);

  useEffect(() => {
    const allowed = new Set(filteredHighlights.map((highlight) => highlight.id));
    setSelectedHighlightIds((current) => current.filter((id) => allowed.has(id)));
  }, [filteredHighlights]);

  useEffect(() => {
    if (workspacePreset === 'focus') {
      setIsInspectorHidden(true);
      setGroupMode('document');
      setInboxOnly(false);
      return;
    }

    setIsInspectorHidden(false);
    if (workspacePreset === 'review') {
      setGroupMode('timeline');
      setInboxOnly(true);
    }
  }, [workspacePreset]);

  useEffect(() => {
    const handleKeyboardNavigation = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = String(target?.tagName || '').toLowerCase();
      const isEditableTarget =
        Boolean(target?.isContentEditable) ||
        tagName === 'input' ||
        tagName === 'textarea' ||
        tagName === 'select';
      if (isEditableTarget || filteredHighlights.length === 0) {
        return;
      }

      const selectedIndex = Math.max(
        0,
        filteredHighlights.findIndex((highlight) => highlight.id === selectedHighlightId),
      );

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        const next = filteredHighlights[(selectedIndex + 1) % filteredHighlights.length];
        setSelectedHighlightId(next.id);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        const next =
          filteredHighlights[(selectedIndex - 1 + filteredHighlights.length) % filteredHighlights.length];
        setSelectedHighlightId(next.id);
        return;
      }

      if (event.key.toLowerCase() === 'j' || event.key === 'Enter') {
        const selected = filteredHighlights[selectedIndex];
        if (!selected) {
          return;
        }
        event.preventDefault();
        onOpenReaderHighlight(selected.documentId, selected.pageIndex, selected.id);
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        setSelectedHighlightIds(filteredHighlights.map((highlight) => highlight.id));
      }
    };

    window.addEventListener('keydown', handleKeyboardNavigation);
    return () => {
      window.removeEventListener('keydown', handleKeyboardNavigation);
    };
  }, [filteredHighlights, onOpenReaderHighlight, selectedHighlightId]);

  const selectedHighlight = useMemo(() => {
    if (!selectedHighlightId) {
      return filteredHighlights[0] ?? null;
    }
    return (
      filteredHighlights.find((highlight) => highlight.id === selectedHighlightId) ??
      highlights.find((highlight) => highlight.id === selectedHighlightId) ??
      null
    );
  }, [filteredHighlights, highlights, selectedHighlightId]);

  const selectedHighlightTitle = selectedHighlight
    ? documentMap.get(selectedHighlight.documentId)?.title || selectedHighlight.documentId
    : '';

  const selectedHighlightsForBulk = useMemo(() => {
    if (selectedHighlightIds.length === 0) {
      return [] as HighlightRecord[];
    }
    const selectedSet = new Set(selectedHighlightIds);
    return filteredHighlights.filter((highlight) => selectedSet.has(highlight.id));
  }, [filteredHighlights, selectedHighlightIds]);

  const highlightsWorkspaceStyle = useMemo(() => {
    if (isInspectorHidden) {
      return {
        gridTemplateColumns: 'minmax(0, 1fr)',
      } as const;
    }
    return {
      gridTemplateColumns: `minmax(0, 1fr) ${inspectorWidth}px`,
    } as const;
  }, [inspectorWidth, isInspectorHidden]);

  function toggleHighlightSelection(highlightId: string, additive: boolean) {
    setSelectedHighlightIds((current) => {
      if (!additive) {
        return [highlightId];
      }
      if (current.includes(highlightId)) {
        return current.filter((id) => id !== highlightId);
      }
      return [...current, highlightId];
    });
  }

  function copyHighlightsToClipboard(highlightsToCopy: HighlightRecord[]) {
    if (highlightsToCopy.length === 0) {
      onNotify('Сначала выберите выделения для копирования.', 'info');
      return;
    }

    const text = highlightsToCopy
      .map((highlight) => {
        const title = documentMap.get(highlight.documentId)?.title || highlight.documentId;
        const note = String(highlight.note || '').trim();
        const noteLine = note ? `\nЗаметка: ${note}` : '';
        return `[${title}] стр. ${highlight.pageIndex + 1}\n${highlight.selectedText}${noteLine}`;
      })
      .join('\n\n---\n\n');

    void navigator.clipboard
      .writeText(text)
      .then(() => {
        onNotify(`Скопировано ${highlightsToCopy.length} выделений.`, 'success');
      })
      .catch(() => {
        onNotify('Не удалось скопировать в буфер обмена.', 'error');
      });
  }

  async function handleDeleteSelectedHighlights() {
    if (selectedHighlightsForBulk.length === 0) {
      onNotify('Сначала выберите выделения для удаления.', 'info');
      return;
    }
    await onDeleteHighlightsBatch(selectedHighlightsForBulk);
    setSelectedHighlightIds([]);
  }

  async function handleApplyBulkColor() {
    if (selectedHighlightsForBulk.length === 0) {
      onNotify('Сначала выберите выделения для изменения цвета.', 'info');
      return;
    }

    const results = await Promise.allSettled(
      selectedHighlightsForBulk.map((highlight) =>
        onUpdateHighlight({
          id: highlight.id,
          documentId: highlight.documentId,
          color: bulkColor,
        }),
      ),
    );
    const updated = results.filter((result) => result.status === 'fulfilled').length;
    const failed = results.length - updated;
    if (failed > 0) {
      onNotify(`Цвет обновлён: ${updated}, ошибок: ${failed}.`, updated > 0 ? 'info' : 'error');
      return;
    }
    onNotify(`Цвет обновлён для ${updated} выделений.`, 'success');
  }

  async function handleAddBulkTags() {
    const parsedTags = parseTagsInput(bulkTagsInput);
    if (selectedHighlightsForBulk.length === 0) {
      onNotify('Сначала выберите выделения.', 'info');
      return;
    }
    if (parsedTags.length === 0) {
      onNotify('Введите хотя бы один тег.', 'info');
      return;
    }

    const results = await Promise.allSettled(
      selectedHighlightsForBulk.map((highlight) => {
        const nextTags = Array.from(new Set([...(highlight.tags ?? []), ...parsedTags]));
        return onUpdateHighlight({
          id: highlight.id,
          documentId: highlight.documentId,
          tags: nextTags,
        });
      }),
    );
    const updated = results.filter((result) => result.status === 'fulfilled').length;
    const failed = results.length - updated;
    if (failed > 0) {
      onNotify(`Теги обновлены: ${updated}, ошибок: ${failed}.`, updated > 0 ? 'info' : 'error');
      return;
    }
    onNotify(`Теги добавлены в ${updated} выделений.`, 'success');
  }

  async function handleClearBulkTags() {
    if (selectedHighlightsForBulk.length === 0) {
      onNotify('Сначала выберите выделения.', 'info');
      return;
    }

    const results = await Promise.allSettled(
      selectedHighlightsForBulk.map((highlight) =>
        onUpdateHighlight({
          id: highlight.id,
          documentId: highlight.documentId,
          tags: [],
        }),
      ),
    );
    const updated = results.filter((result) => result.status === 'fulfilled').length;
    const failed = results.length - updated;
    if (failed > 0) {
      onNotify(`Теги очищены: ${updated}, ошибок: ${failed}.`, updated > 0 ? 'info' : 'error');
      return;
    }
    onNotify(`Теги очищены у ${updated} выделений.`, 'success');
  }

  function applySavedSmartFilter(savedView: SavedHighlightView) {
    const smartFilter = normalizeSmartHighlightFilter(savedView.filter);
    onChangeSearch(smartFilter.search);
    onChangeDocumentFilter(smartFilter.documentFilter || 'all');
    onChangeContextOnly(Boolean(smartFilter.contextOnly));
    setColorFilter(smartFilter.colorFilter);
    setNotesOnly(Boolean(smartFilter.notesOnly));
    setInboxOnly(Boolean(smartFilter.inboxOnly));
    setGroupMode(smartFilter.groupMode);
    void onTouchSmartFilter(savedView.id);
  }

  async function handleSaveCurrentSmartFilter() {
    const suggestedName =
      window.prompt('Название представления', `Фильтр ${new Date().toLocaleDateString()}`) || '';
    const trimmedName = suggestedName.trim();
    if (!trimmedName) {
      return;
    }

    const payload = normalizeSmartHighlightFilter({
      search,
      documentFilter,
      contextOnly,
      colorFilter,
      notesOnly,
      inboxOnly,
      groupMode,
    });
    await onSaveSmartFilter(trimmedName, payload);
  }

  function handleHighlightsInspectorResizeStart(event: React.PointerEvent<HTMLDivElement>) {
    if (isInspectorHidden) {
      return;
    }
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = inspectorWidth;
    const maxByViewport = Math.max(
      MIN_HIGHLIGHTS_INSPECTOR_WIDTH,
      Math.min(MAX_HIGHLIGHTS_INSPECTOR_WIDTH, Math.round(window.innerWidth * 0.62)),
    );

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const nextWidth = Math.max(
        MIN_HIGHLIGHTS_INSPECTOR_WIDTH,
        Math.min(maxByViewport, Math.round(startWidth - deltaX)),
      );
      setInspectorWidth(nextWidth);
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
    <section className="view-shell">
      <LiquidSurface className="glass-panel view-header highlights-header">
        <div className="highlights-header-main">
          <h1>Хайлайты</h1>
          <p className="muted">Список выделений по книгам, контекстный поиск и быстрый переход</p>
          <div className="highlights-header-meta">
            <span className="chip">Документов: {highlightsStats.documents}</span>
            <span className="chip">С заметками: {highlightsStats.withNotes}</span>
            <span className="chip">С тегами: {highlightsStats.tagged}</span>
            <span className="chip">Inbox: {highlightsStats.inbox}</span>
            <span className="chip active">Режим: {workspacePreset === 'review' ? 'Review' : workspacePreset === 'focus' ? 'Focus' : 'Research'}</span>
          </div>
        </div>
      </LiquidSurface>

      <LiquidSurface className="glass-panel highlights-filters highlights-smart-filters">
        <div className="action-row compact">
          <button
            type="button"
            className="btn secondary"
            onClick={() => {
              void handleSaveCurrentSmartFilter();
            }}
          >
            Сохранить представление
          </button>
          <button
            type="button"
            className={`btn ghost ${groupMode === 'document' ? 'active' : ''}`}
            onClick={() => setGroupMode('document')}
          >
            Группировка: по книгам
          </button>
          <button
            type="button"
            className={`btn ghost ${groupMode === 'timeline' ? 'active' : ''}`}
            onClick={() => setGroupMode('timeline')}
          >
            Группировка: таймлайн
          </button>
          <button
            type="button"
            className={`btn ghost ${isInspectorHidden ? 'active' : ''}`}
            onClick={() => {
              setIsInspectorHidden((value) => !value);
            }}
          >
            {isInspectorHidden ? 'Показать инспектор' : 'Скрыть инспектор'}
          </button>
        </div>
        {savedSmartViews.length > 0 ? (
          <div className="saved-filters-row">
            {savedSmartViews.map((savedFilter) => (
              <span className="saved-filter-chip" key={savedFilter.id}>
                <button
                  type="button"
                  className={`chip ${savedFilter.isPinned ? 'active' : ''}`}
                  onClick={() => {
                    applySavedSmartFilter(savedFilter);
                  }}
                  title={
                    savedFilter.lastUsedAt
                      ? `Последнее использование: ${formatDateTime(savedFilter.lastUsedAt)}`
                      : `Обновлено: ${formatDateTime(savedFilter.updatedAt)}`
                  }
                >
                  {savedFilter.name}
                </button>
                <button
                  type="button"
                  className={`chip ${savedFilter.isPinned ? 'active' : ''}`}
                  onClick={() => {
                    void onTogglePinSmartFilter(savedFilter.id);
                  }}
                  aria-label={
                    savedFilter.isPinned
                      ? `Открепить представление ${savedFilter.name}`
                      : `Закрепить представление ${savedFilter.name}`
                  }
                  title={savedFilter.isPinned ? 'Открепить' : 'Закрепить'}
                >
                  {savedFilter.isPinned ? '★' : '☆'}
                </button>
                <button
                  type="button"
                  className="chip danger"
                  onClick={() => {
                    void onDeleteSmartFilter(savedFilter.id);
                  }}
                  aria-label={`Удалить представление ${savedFilter.name}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="muted">Сохранённые представления появятся здесь.</p>
        )}
      </LiquidSurface>

      <LiquidSurface className="glass-panel highlights-filters">
        <label className="filter-book">
          Книга
          <select
            value={documentFilter}
            onChange={(event) => onChangeDocumentFilter(event.target.value)}
          >
            <option value="all">Все книги</option>
            {documents.map((documentInfo) => (
              <option value={documentInfo.id} key={documentInfo.id}>
                {documentInfo.title}
              </option>
            ))}
          </select>
        </label>

        <label className="filter-search">
          Контекстный поиск
          <input
            type="text"
            placeholder="Текст, заметка или тег"
            value={search}
            onChange={(event) => onChangeSearch(event.target.value)}
          />
        </label>

        <label className="filter-color">
          Цвет
          <select value={colorFilter} onChange={(event) => setColorFilter(event.target.value as 'all' | HighlightRecord['color'])}>
            <option value="all">Все цвета</option>
            {HIGHLIGHT_COLORS.map((color) => (
              <option key={color} value={color}>
                {highlightColorLabel(color)}
              </option>
            ))}
          </select>
        </label>

        <div className="filter-context">
          <label className="filter-context-check">
            <input
              type="checkbox"
              checked={contextOnly}
              onChange={(event) => onChangeContextOnly(event.target.checked)}
            />
            <span>Только рядом с текущей страницей (±3)</span>
          </label>
        </div>

        <div className="filter-notes">
          <label className="filter-context-check filter-notes-check">
            <input
              type="checkbox"
              checked={notesOnly}
              onChange={(event) => setNotesOnly(event.target.checked)}
            />
            <span>Только с заметками</span>
          </label>
          <label className="filter-context-check filter-notes-check">
            <input
              type="checkbox"
              checked={inboxOnly}
              onChange={(event) => setInboxOnly(event.target.checked)}
            />
            <span>Inbox: без заметки и тегов</span>
          </label>
        </div>

        <div className="filter-count">
          <p className="muted">{filteredHighlights.length} результатов</p>
        </div>
      </LiquidSurface>

      <section className="highlights-workspace" style={highlightsWorkspaceStyle}>
        <section className="highlights-groups">
          {filteredHighlights.length > 0 ? (
            <article className="glass-panel highlights-bulk-toolbar">
              <div className="action-row">
                <span className="chip">Выбрано: {selectedHighlightsForBulk.length}</span>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => {
                    setSelectedHighlightIds(filteredHighlights.map((highlight) => highlight.id));
                  }}
                >
                  Выбрать всё
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => {
                    setSelectedHighlightIds([]);
                  }}
                >
                  Снять выбор
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => {
                    copyHighlightsToClipboard(selectedHighlightsForBulk);
                  }}
                >
                  Скопировать выбранные
                </button>
                <label className="bulk-color-control">
                  Цвет
                  <select
                    value={bulkColor}
                    onChange={(event) => setBulkColor(event.target.value as HighlightRecord['color'])}
                  >
                    {HIGHLIGHT_COLORS.map((color) => (
                      <option key={color} value={color}>
                        {highlightColorLabel(color)}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => {
                    void handleApplyBulkColor();
                  }}
                >
                  Применить цвет
                </button>
                <input
                  type="text"
                  value={bulkTagsInput}
                  onChange={(event) => setBulkTagsInput(event.target.value)}
                  placeholder="Теги через запятую"
                  className="bulk-tags-input"
                />
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => {
                    void handleAddBulkTags();
                  }}
                >
                  Добавить теги
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => {
                    void handleClearBulkTags();
                  }}
                >
                  Очистить теги
                </button>
                <button
                  type="button"
                  className="btn ghost danger"
                  onClick={() => {
                    void handleDeleteSelectedHighlights();
                  }}
                >
                  Удалить выбранные
                </button>
              </div>
            </article>
          ) : null}

          {groupedSections.length === 0 ? (
            <article className="glass-panel empty-state">
              <p>Ничего не найдено по текущему фильтру.</p>
            </article>
          ) : (
            groupedSections.map((section) => {
              const { groupId, title, highlights: groupHighlights } = section;
              const listClassName =
                groupHighlights.length > 2 ? 'highlights-list grid' : 'highlights-list';
              return (
                <article className="glass-panel highlights-group" key={groupId}>
                  <header>
                    <h2>{title}</h2>
                    <small className="muted">{groupHighlights.length} выделений</small>
                  </header>

                  <div className={listClassName}>
                    {groupHighlights.map((highlight) => {
                      const isSelected = selectedHighlight?.id === highlight.id;
                      const isChecked = selectedHighlightIds.includes(highlight.id);
                      return (
                        <article
                          className={`highlight-item highlight-selectable ${isSelected ? 'selected' : ''}`}
                          key={highlight.id}
                          role="button"
                          tabIndex={0}
                          aria-selected={isSelected}
                          onClick={(event) => {
                            const additive = event.metaKey || event.ctrlKey;
                            toggleHighlightSelection(highlight.id, additive);
                            setSelectedHighlightId(highlight.id);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              const additive = event.metaKey || event.ctrlKey;
                              toggleHighlightSelection(highlight.id, additive);
                              setSelectedHighlightId(highlight.id);
                            }
                          }}
                        >
                          <div className="highlight-select-check">
                            <input
                              type="checkbox"
                              aria-label="Выбрать выделение"
                              checked={isChecked}
                              onChange={(event) => {
                                event.stopPropagation();
                                toggleHighlightSelection(highlight.id, true);
                              }}
                              onClick={(event) => {
                                event.stopPropagation();
                              }}
                            />
                          </div>
                          <div className="highlight-meta-row">
                            <span className={`chip color-${highlight.color}`}>
                              {highlightColorLabel(highlight.color)}
                            </span>
                            <span className="muted">стр. {highlight.pageIndex + 1}</span>
                            <span className="muted">{formatDateTime(highlight.createdAt)}</span>
                          </div>

                          <p className="highlight-quote">{truncateSelectionText(highlight.selectedText, 460)}</p>
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

                          {highlight.note ? (
                            <p className="highlight-note">Заметка: {truncate(highlight.note, 240)}</p>
                          ) : null}

                          {highlight.tags && highlight.tags.length > 0 ? (
                            <div className="tag-row">
                              {highlight.tags.map((tag) => (
                                <span className="chip" key={`${highlight.id}-${tag}`}>
                                  #{tag}
                                </span>
                              ))}
                            </div>
                          ) : null}

                          <div className="action-row compact">
                            <button
                              type="button"
                              className="btn secondary"
                              onClick={(event) => {
                                event.stopPropagation();
                                onOpenReaderHighlight(highlight.documentId, highlight.pageIndex, highlight.id);
                              }}
                            >
                              Перейти
                            </button>
                            <button
                              type="button"
                              className="btn ghost"
                              onClick={(event) => {
                                event.stopPropagation();
                                onCopyHighlightLink(
                                  highlight.documentId,
                                  highlight.pageIndex,
                                  highlight.id,
                                );
                              }}
                            >
                              Ссылка
                            </button>
                            <button
                              type="button"
                              className="btn ghost danger"
                              onClick={(event) => {
                                event.stopPropagation();
                                void onDeleteHighlight(highlight);
                              }}
                            >
                              Удалить
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </article>
              );
            })
          )}
        </section>

        {!isInspectorHidden ? (
          <>
            <div
              className="split-handle highlights-split-handle"
              role="separator"
              aria-orientation="vertical"
              aria-label="Изменить ширину инспектора выделений"
              style={{ right: `${Math.max(0, inspectorWidth - 5)}px` }}
              onPointerDown={handleHighlightsInspectorResizeStart}
            />

            <aside className="glass-panel highlights-inspector">
              <h2>Инспектор выделения</h2>
              {selectedHighlight ? (
                <>
                  <p className="muted">{selectedHighlightTitle}</p>
                  <div className="highlight-meta-row">
                    <span className={`chip color-${selectedHighlight.color}`}>
                      {highlightColorLabel(selectedHighlight.color)}
                    </span>
                    <span className="muted">стр. {selectedHighlight.pageIndex + 1}</span>
                    <span className="muted">{formatDateTime(selectedHighlight.createdAt)}</span>
                  </div>
                  <p className="highlight-quote highlights-inspector-quote">
                    {truncateSelectionText(selectedHighlight.selectedText, 1800)}
                  </p>
                  {highlightContextMap.get(selectedHighlight.id)?.before ? (
                    <p className="highlight-context before">
                      До: {highlightContextMap.get(selectedHighlight.id)?.before}
                    </p>
                  ) : null}
                  {highlightContextMap.get(selectedHighlight.id)?.after ? (
                    <p className="highlight-context after">
                      После: {highlightContextMap.get(selectedHighlight.id)?.after}
                    </p>
                  ) : null}
                  {selectedHighlight.note ? (
                    <p className="highlight-note">Заметка: {truncate(selectedHighlight.note, 720)}</p>
                  ) : (
                    <p className="muted">Заметка не добавлена.</p>
                  )}
                  {selectedHighlight.tags && selectedHighlight.tags.length > 0 ? (
                    <div className="tag-row">
                      {selectedHighlight.tags.map((tag) => (
                        <span className="chip" key={`inspector-${selectedHighlight.id}-${tag}`}>
                          #{tag}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="action-row highlights-inspector-actions">
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => {
                        onOpenReaderHighlight(
                          selectedHighlight.documentId,
                          selectedHighlight.pageIndex,
                          selectedHighlight.id,
                        );
                      }}
                    >
                      Открыть в читалке
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => {
                        onCopyHighlightLink(
                          selectedHighlight.documentId,
                          selectedHighlight.pageIndex,
                          selectedHighlight.id,
                        );
                      }}
                    >
                      Скопировать ссылку
                    </button>
                    <button
                      type="button"
                      className="btn ghost danger"
                      onClick={() => {
                        void onDeleteHighlight(selectedHighlight);
                      }}
                    >
                      Удалить выделение
                    </button>
                  </div>
                </>
              ) : (
                <p className="muted">Выберите выделение, чтобы увидеть детали.</p>
              )}
            </aside>
          </>
        ) : null}
      </section>
    </section>
  );
}
