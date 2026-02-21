import { useEffect, useMemo, useState } from 'react';
import { formatDateTime, getDocumentProgress, truncate } from '../../lib/format';
import type { AppSettings, CollectionRecord, DocumentRecord, WorkspacePreset } from '../../types';
import { LiquidSurface } from '../../components/LiquidSurface';
import { useRenderProfiler } from '../../lib/perfProfiler';

const LIBRARY_SIDEBAR_WIDTH_KEY = 'recall.ui.librarySidebarWidth';
const MIN_LIBRARY_SIDEBAR_WIDTH = 280;
const MAX_LIBRARY_SIDEBAR_WIDTH = 560;

interface LibraryViewProps {
  workspacePreset: WorkspacePreset;
  documents: DocumentRecord[];
  collections: CollectionRecord[];
  settings: AppSettings;
  loading: boolean;
  onImport: () => Promise<void>;
  onImportPaths: (paths: string[]) => Promise<void>;
  onOpenReader: (documentId: string) => void;
  onOpenHighlights: (documentId: string) => void;
  onDeleteDocument: (documentId: string, title: string) => Promise<void>;
  onExportPdf: (documentId: string) => Promise<void>;
  onExportMarkdown: (documentId: string) => Promise<void>;
  onExportObsidianBundle: (documentId?: string) => Promise<void>;
  onExportNotionBundle: (documentId?: string) => Promise<void>;
  onTogglePin: (document: DocumentRecord) => Promise<void>;
  onAssignCollection: (documentId: string, collectionId?: string) => Promise<void>;
  onCreateCollection: (name: string) => Promise<void>;
  onSaveFocusMode: (focusMode: boolean) => Promise<void>;
  onRevealDataFolder: () => Promise<void>;
  onBackup: () => Promise<void>;
  onRestore: () => Promise<void>;
  onResetProgress: (documentId: string, title: string) => Promise<void>;
  onCopyDeepLink: (documentId: string) => Promise<void> | void;
}

export function LibraryView({
  workspacePreset,
  documents,
  collections,
  settings,
  loading,
  onImport,
  onImportPaths,
  onOpenReader,
  onOpenHighlights,
  onDeleteDocument,
  onExportPdf,
  onExportMarkdown,
  onExportObsidianBundle,
  onExportNotionBundle,
  onTogglePin,
  onAssignCollection,
  onCreateCollection,
  onSaveFocusMode,
  onRevealDataFolder,
  onBackup,
  onRestore,
  onResetProgress,
  onCopyDeepLink,
}: LibraryViewProps) {
  useRenderProfiler('LibraryView');
  const [collectionName, setCollectionName] = useState('');
  const [dropActive, setDropActive] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [progressFilter, setProgressFilter] = useState<
    'all' | 'not-started' | 'in-progress' | 'completed'
  >('all');
  const [sortMode, setSortMode] = useState<'recent' | 'title' | 'progress' | 'highlights'>(
    'recent',
  );
  const [showPinnedOnly, setShowPinnedOnly] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(340);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);

  useEffect(() => {
    try {
      setIsSidebarCollapsed(window.localStorage.getItem('recall.ui.librarySidebarCollapsed') === '1');
      const rawSidebarWidth = Number(window.localStorage.getItem(LIBRARY_SIDEBAR_WIDTH_KEY) || 0);
      if (Number.isFinite(rawSidebarWidth) && rawSidebarWidth >= MIN_LIBRARY_SIDEBAR_WIDTH) {
        setSidebarWidth(
          Math.min(MAX_LIBRARY_SIDEBAR_WIDTH, Math.max(MIN_LIBRARY_SIDEBAR_WIDTH, Math.trunc(rawSidebarWidth))),
        );
      }
    } catch {
      // ignore storage access failures
    }
  }, []);

  useEffect(() => {
    if (workspacePreset === 'focus') {
      setIsSidebarCollapsed(true);
      return;
    }

    setIsSidebarCollapsed(false);
    if (workspacePreset === 'review') {
      setSortMode('highlights');
    }
  }, [workspacePreset]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        'recall.ui.librarySidebarCollapsed',
        isSidebarCollapsed ? '1' : '0',
      );
    } catch {
      // ignore storage access failures
    }
  }, [isSidebarCollapsed]);

  useEffect(() => {
    try {
      window.localStorage.setItem(LIBRARY_SIDEBAR_WIDTH_KEY, String(sidebarWidth));
    } catch {
      // ignore storage access failures
    }
  }, [sidebarWidth]);

  function extractDroppedPaths(dataTransfer?: DataTransfer | null): string[] {
    if (!dataTransfer) {
      return [];
    }

    return Array.from(dataTransfer.files)
      .map((file) => ((file as File & { path?: string }).path || '').trim())
      .filter(Boolean);
  }

  const sortedDocuments = useMemo(() => {
    return [...documents].sort((left, right) => {
      if (Boolean(left.isPinned) !== Boolean(right.isPinned)) {
        return left.isPinned ? -1 : 1;
      }

      if (sortMode === 'title') {
        return left.title.localeCompare(right.title, 'ru');
      }

      if (sortMode === 'progress') {
        const leftProgress = getDocumentProgress(left).progress;
        const rightProgress = getDocumentProgress(right).progress;
        return rightProgress - leftProgress;
      }

      if (sortMode === 'highlights') {
        return Number(right.highlightsCount || 0) - Number(left.highlightsCount || 0);
      }

      const leftLastOpened = new Date(left.lastOpenedAt || left.createdAt).valueOf();
      const rightLastOpened = new Date(right.lastOpenedAt || right.createdAt).valueOf();
      return rightLastOpened - leftLastOpened;
    });
  }, [documents, sortMode]);

  const filteredDocuments = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return sortedDocuments.filter((documentInfo) => {
      const progress = getDocumentProgress(documentInfo);
      const isCompleted = progress.totalPages > 0 && progress.progress >= 0.98;
      const hasProgress =
        Number(documentInfo.maxReadPageIndex ?? documentInfo.lastReadPageIndex ?? 0) > 0;
      const status = isCompleted ? 'completed' : hasProgress ? 'in-progress' : 'not-started';

      if (showPinnedOnly && !documentInfo.isPinned) {
        return false;
      }

      if (progressFilter !== 'all' && status !== progressFilter) {
        return false;
      }

      if (!query) {
        return true;
      }

      return documentInfo.title.toLowerCase().includes(query);
    });
  }, [progressFilter, searchQuery, showPinnedOnly, sortedDocuments]);

  useEffect(() => {
    if (filteredDocuments.length === 0) {
      if (selectedDocumentId !== null) {
        setSelectedDocumentId(null);
      }
      return;
    }

    if (!selectedDocumentId || !filteredDocuments.some((documentInfo) => documentInfo.id === selectedDocumentId)) {
      setSelectedDocumentId(filteredDocuments[0].id);
    }
  }, [filteredDocuments, selectedDocumentId]);

  useEffect(() => {
    const handleKeyboardNavigation = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tagName = String(target?.tagName || '').toLowerCase();
      const isEditableTarget =
        Boolean(target?.isContentEditable) ||
        tagName === 'input' ||
        tagName === 'textarea' ||
        tagName === 'select';
      if (isEditableTarget || filteredDocuments.length === 0) {
        return;
      }

      const selectedIndex = Math.max(
        0,
        filteredDocuments.findIndex((documentInfo) => documentInfo.id === selectedDocumentId),
      );

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        const next = filteredDocuments[(selectedIndex + 1) % filteredDocuments.length];
        setSelectedDocumentId(next.id);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        const next =
          filteredDocuments[(selectedIndex - 1 + filteredDocuments.length) % filteredDocuments.length];
        setSelectedDocumentId(next.id);
        return;
      }

      if (event.key === 'Enter') {
        if (!selectedDocumentId) {
          return;
        }
        event.preventDefault();
        onOpenReader(selectedDocumentId);
        return;
      }

      if (event.key.toLowerCase() === 'h') {
        if (!selectedDocumentId) {
          return;
        }
        event.preventDefault();
        onOpenHighlights(selectedDocumentId);
      }
    };

    window.addEventListener('keydown', handleKeyboardNavigation);
    return () => {
      window.removeEventListener('keydown', handleKeyboardNavigation);
    };
  }, [filteredDocuments, onOpenHighlights, onOpenReader, selectedDocumentId]);

  const selectedDocument = useMemo(() => {
    if (!selectedDocumentId) {
      return filteredDocuments[0] ?? null;
    }
    return (
      filteredDocuments.find((documentInfo) => documentInfo.id === selectedDocumentId) ??
      sortedDocuments.find((documentInfo) => documentInfo.id === selectedDocumentId) ??
      null
    );
  }, [filteredDocuments, selectedDocumentId, sortedDocuments]);

  const selectedProgress = useMemo(
    () => (selectedDocument ? getDocumentProgress(selectedDocument) : null),
    [selectedDocument],
  );

  const collectionNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const collection of collections) {
      map.set(collection.id, collection.name);
    }
    return map;
  }, [collections]);

  const libraryStats = useMemo(() => {
    const totalBooks = documents.length;
    const totalHighlights = documents.reduce(
      (sum, documentInfo) => sum + Number(documentInfo.highlightsCount || 0),
      0,
    );
    const inProgress = documents.filter((documentInfo) => {
      const progress = getDocumentProgress(documentInfo);
      return progress.totalPages > 0 && progress.progress > 0 && progress.progress < 0.98;
    }).length;
    const pinned = documents.filter((documentInfo) => Boolean(documentInfo.isPinned)).length;
    const completed = documents.filter((documentInfo) => {
      const progress = getDocumentProgress(documentInfo);
      return progress.totalPages > 0 && progress.progress >= 0.98;
    }).length;

    return {
      totalBooks,
      totalHighlights,
      inProgress,
      pinned,
      completed,
    };
  }, [documents]);

  const libraryWorkspaceStyle = useMemo(() => {
    if (isSidebarCollapsed) {
      return undefined;
    }
    return {
      gridTemplateColumns: `minmax(0, 1fr) ${sidebarWidth}px`,
    } as const;
  }, [isSidebarCollapsed, sidebarWidth]);

  function handleSidebarResizeStart(event: React.PointerEvent<HTMLDivElement>) {
    if (isSidebarCollapsed) {
      return;
    }

    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    const maxByViewport = Math.max(
      MIN_LIBRARY_SIDEBAR_WIDTH,
      Math.min(MAX_LIBRARY_SIDEBAR_WIDTH, Math.round(window.innerWidth * 0.56)),
    );

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const nextWidth = Math.max(
        MIN_LIBRARY_SIDEBAR_WIDTH,
        Math.min(maxByViewport, Math.round(startWidth - deltaX)),
      );
      setSidebarWidth(nextWidth);
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
      <LiquidSurface className="glass-panel view-header library-header">
        <div className="library-header-main">
          <h1>Библиотека Recall PDF</h1>
          <p className="muted">Локальная PDF-читалка с выделениями, заметками и экспортом</p>
          <div className="library-stats-row">
            <span className="chip">Книг: {libraryStats.totalBooks}</span>
            <span className="chip">В процессе: {libraryStats.inProgress}</span>
            <span className="chip">Завершено: {libraryStats.completed}</span>
            <span className="chip">Закреплено: {libraryStats.pinned}</span>
            <span className="chip">Хайлайтов: {libraryStats.totalHighlights}</span>
          </div>
        </div>
        <div className="action-row header-actions library-header-actions">
          <button
            type="button"
            className="btn ghost"
            onClick={() => setIsSidebarCollapsed((value) => !value)}
          >
            {isSidebarCollapsed ? 'Показать панель' : 'Скрыть панель'}
          </button>
          <button type="button" className="btn ghost" onClick={onRevealDataFolder}>
            Папка данных
          </button>
          <button type="button" className="btn ghost" onClick={onBackup}>
            Бэкап
          </button>
          <button type="button" className="btn ghost" onClick={onRestore}>
            Восстановить
          </button>
          <button type="button" className="btn primary" onClick={onImport} disabled={loading}>
            {loading ? 'Импорт…' : 'Импорт PDF'}
          </button>
        </div>
      </LiquidSurface>

      <section
        className={`library-workspace ${isSidebarCollapsed ? 'sidebar-collapsed' : ''}`}
        style={libraryWorkspaceStyle}
      >
        <LiquidSurface
          className={`glass-panel library-table ${dropActive ? 'drop-active' : ''}`}
          padding="12px"
          onDragEnter={(event) => {
            event.preventDefault();
            setDropActive(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDropActive(true);
          }}
          onDragLeave={() => setDropActive(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDropActive(false);
            const paths = extractDroppedPaths(event.dataTransfer);
            if (paths.length === 0) {
              return;
            }
            void onImportPaths(paths);
          }}
        >
          <div className="table-head">
            <h2>Библиотека книг</h2>
            <span className="muted">{filteredDocuments.length} из {documents.length} книг</span>
          </div>

          <div className="library-controls">
            <label>
              Поиск по книгам
              <input
                type="text"
                value={searchQuery}
                placeholder="Название книги…"
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </label>
            <label>
              Статус чтения
              <select
                value={progressFilter}
                onChange={(event) =>
                  setProgressFilter(event.target.value as 'all' | 'not-started' | 'in-progress' | 'completed')
                }
              >
                <option value="all">Все</option>
                <option value="not-started">Не начато</option>
                <option value="in-progress">В процессе</option>
                <option value="completed">Завершено</option>
              </select>
            </label>
            <label>
              Сортировка
              <select
                value={sortMode}
                onChange={(event) =>
                  setSortMode(
                    event.target.value as 'recent' | 'title' | 'progress' | 'highlights',
                  )
                }
              >
                <option value="recent">Сначала недавние</option>
                <option value="title">По названию</option>
                <option value="progress">По прогрессу</option>
                <option value="highlights">По числу хайлайтов</option>
              </select>
            </label>
          </div>
          <div className="library-controls-quick">
            <button
              type="button"
              className={`chip ${showPinnedOnly ? 'active' : ''}`}
              onClick={() => setShowPinnedOnly((value) => !value)}
            >
              Только закреплённые
            </button>
            <button
              type="button"
              className="chip"
              onClick={() => {
                setSearchQuery('');
                setProgressFilter('all');
                setSortMode('recent');
                setShowPinnedOnly(false);
              }}
            >
              Сбросить фильтры
            </button>
          </div>

          <div className="docs-list">
            {filteredDocuments.length === 0 ? (
              <div className="empty-state">
                {documents.length === 0 ? (
                  <p>Пока нет книг. Нажмите «Импорт PDF» или перетащите PDF в эту область.</p>
                ) : (
                  <p>По текущим фильтрам книги не найдены.</p>
                )}
              </div>
            ) : (
              filteredDocuments.map((documentInfo) => {
                const progress = getDocumentProgress(documentInfo);
                const isCompleted = progress.totalPages > 0 && progress.progress >= 0.98;
                const hasProgress =
                  Number(documentInfo.maxReadPageIndex ?? documentInfo.lastReadPageIndex ?? 0) > 0;
                const statusLabel = isCompleted
                  ? 'Завершено'
                  : hasProgress
                    ? 'В процессе'
                    : 'Не начато';
                const statusClass = isCompleted
                  ? 'status-completed'
                  : hasProgress
                    ? 'status-progress'
                    : 'status-new';
                const collectionName = documentInfo.collectionId
                  ? collectionNameById.get(documentInfo.collectionId)
                  : '';
                const isSelected = selectedDocument?.id === documentInfo.id;
                return (
                  <article
                    className={`doc-card doc-row ${isSelected ? 'selected' : ''}`}
                    key={documentInfo.id}
                    role="button"
                    tabIndex={0}
                    aria-selected={isSelected}
                    onClick={() => {
                      setSelectedDocumentId(documentInfo.id);
                    }}
                    onDoubleClick={() => {
                      onOpenReader(documentInfo.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        setSelectedDocumentId(documentInfo.id);
                      }
                    }}
                  >
                    <div className="doc-head">
                      <button
                        type="button"
                        className={`pin-btn ${documentInfo.isPinned ? 'active' : ''}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          void onTogglePin(documentInfo);
                        }}
                        title={documentInfo.isPinned ? 'Открепить книгу' : 'Закрепить книгу'}
                      >
                        {documentInfo.isPinned ? '★' : '☆'}
                      </button>
                      <div className="doc-title-block">
                        <h3>{truncate(documentInfo.title, 96)}</h3>
                        <p className="muted">
                          Импорт: {formatDateTime(documentInfo.createdAt)} · Хайлайты: {documentInfo.highlightsCount ?? 0}
                        </p>
                        <div className="doc-badges">
                          <span className={`chip doc-status-chip ${statusClass}`}>{statusLabel}</span>
                          {collectionName ? <span className="chip">Коллекция: {collectionName}</span> : null}
                        </div>
                      </div>
                    </div>

                    <div className="progress-row doc-progress">
                      <div className="progress-bar">
                        <span style={{ width: `${Math.round(progress.progress * 100)}%` }} />
                      </div>
                      <small className="muted">
                        {Math.round(progress.progress * 100)}% · стр. {progress.pageNumber}/{progress.totalPages || '—'}
                      </small>
                    </div>

                    <div className="doc-row-meta">
                      <small className="muted">{formatDateTime(documentInfo.lastOpenedAt || documentInfo.createdAt)}</small>
                    </div>

                    <div className="action-row doc-actions doc-row-actions">
                      <button
                        type="button"
                        className="btn primary"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenReader(documentInfo.id);
                        }}
                      >
                        Открыть
                      </button>
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenHighlights(documentInfo.id);
                        }}
                      >
                        Хайлайты
                      </button>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </LiquidSurface>

        {!isSidebarCollapsed ? (
          <div
            className="split-handle library-split-handle"
            role="separator"
            aria-orientation="vertical"
            aria-label="Изменить ширину панели библиотеки"
            style={{ right: `${Math.max(0, sidebarWidth - 5)}px` }}
            onPointerDown={handleSidebarResizeStart}
          />
        ) : null}

        <aside className="library-sidebar">
          <section className="glass-grid library-config-grid">
            <LiquidSurface className="glass-panel library-config-card library-config-item">
              <h2>Инспектор</h2>
              {selectedDocument ? (
                <>
                  <p className="muted">{truncate(selectedDocument.title, 140)}</p>
                  <p className="muted">
                    Импорт: {formatDateTime(selectedDocument.createdAt)} · Хайлайты: {selectedDocument.highlightsCount ?? 0}
                  </p>
                  <div className="progress-row">
                    <div className="progress-bar">
                      <span style={{ width: `${Math.round((selectedProgress?.progress ?? 0) * 100)}%` }} />
                    </div>
                    <small className="muted">
                      {Math.round((selectedProgress?.progress ?? 0) * 100)}% · стр. {selectedProgress?.pageNumber ?? 0}/
                      {selectedProgress?.totalPages || '—'}
                    </small>
                  </div>
                  <div className="doc-meta-grid doc-collection">
                    <label>
                      Коллекция
                      <select
                        value={selectedDocument.collectionId || ''}
                        onChange={(event) => {
                          const value = event.target.value.trim();
                          void onAssignCollection(selectedDocument.id, value || undefined);
                        }}
                      >
                        <option value="">Без коллекции</option>
                        {collections.map((collection) => (
                          <option key={collection.id} value={collection.id}>
                            {collection.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <div className="action-row doc-actions doc-actions-grid">
                    <button type="button" className="btn primary" onClick={() => onOpenReader(selectedDocument.id)}>
                      Открыть выбранную
                    </button>
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => onOpenHighlights(selectedDocument.id)}
                    >
                      Хайлайты выбранной
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => void onExportPdf(selectedDocument.id)}
                    >
                      Экспорт PDF
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => void onExportMarkdown(selectedDocument.id)}
                    >
                      Экспорт Markdown
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => void onExportObsidianBundle(selectedDocument.id)}
                    >
                      Obsidian bundle
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => void onExportNotionBundle(selectedDocument.id)}
                    >
                      Notion bundle
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => void onCopyDeepLink(selectedDocument.id)}
                    >
                      Скопировать ссылку
                    </button>
                    <button
                      type="button"
                      className="btn ghost danger"
                      onClick={() => void onResetProgress(selectedDocument.id, selectedDocument.title)}
                    >
                      Сброс прогресса
                    </button>
                    <button
                      type="button"
                      className="btn ghost danger"
                      onClick={() => void onDeleteDocument(selectedDocument.id, selectedDocument.title)}
                    >
                      Удалить
                    </button>
                  </div>
                </>
              ) : (
                <p className="muted">Выберите книгу в списке, чтобы увидеть подробности и действия.</p>
              )}
            </LiquidSurface>
            <LiquidSurface className="glass-panel library-config-card library-config-item">
              <h2>Интерфейс</h2>
              <p className="muted">Тема приложения фиксирована: белая.</p>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={settings.focusMode}
                  onChange={(event) => {
                    void onSaveFocusMode(event.target.checked);
                  }}
                />
                <span>Фокус-режим читалки</span>
              </label>
            </LiquidSurface>
            <LiquidSurface className="glass-panel library-config-card library-config-item">
              <h2>Коллекции</h2>
              <p className="muted">Создавайте полки и распределяйте книги по темам.</p>
              <label>
                Новая коллекция
                <input
                  type="text"
                  value={collectionName}
                  placeholder="Например: Философия"
                  onChange={(event) => {
                    setCollectionName(event.target.value);
                  }}
                />
              </label>
              <button
                type="button"
                className="btn secondary"
                onClick={() => {
                  const next = collectionName.trim();
                  if (!next) {
                    return;
                  }
                  void onCreateCollection(next);
                  setCollectionName('');
                }}
              >
                Создать коллекцию
              </button>
            </LiquidSurface>
          </section>
        </aside>
      </section>
    </section>
  );
}
