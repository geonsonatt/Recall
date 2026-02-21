import { create } from 'zustand';
import type {
  AppSettings,
  AppView,
  CollectionRecord,
  DocumentRecord,
  HighlightRecord,
  NavigateToHighlight,
  ReadingLogEntry,
  StoragePaths,
} from '../types';
import {
  addDebugEvent,
  incrementDebugCounter,
  setDebugGauge,
  summarizeForDebug,
} from '../lib/debugTrace';

type ToastType = 'info' | 'error' | 'success';

interface ToastState {
  id: number;
  type: ToastType;
  message: string;
}

interface AppStoreState {
  view: AppView;
  documents: DocumentRecord[];
  collections: CollectionRecord[];
  settings: AppSettings;
  readingLog: Record<string, ReadingLogEntry>;
  storagePaths: StoragePaths | null;

  activeDocumentId: string | null;
  currentPageIndex: number;
  totalPages: number;

  highlightsByDocument: Record<string, HighlightRecord[]>;
  allHighlights: HighlightRecord[];
  highlightsSearch: string;
  highlightsContextOnly: boolean;
  highlightsDocumentFilter: string;

  pendingNavigation: NavigateToHighlight | null;

  loading: boolean;
  toast: ToastState | null;

  setView: (view: AppView) => void;
  setDocuments: (documents: DocumentRecord[]) => void;
  upsertDocument: (documentInfo: DocumentRecord) => void;
  removeDocument: (documentId: string) => void;
  setCollections: (collections: CollectionRecord[]) => void;
  setSettings: (settings: AppSettings) => void;
  patchSettings: (patch: Partial<AppSettings>) => void;
  setReadingLog: (readingLog: Record<string, ReadingLogEntry>) => void;
  setStoragePaths: (storagePaths: StoragePaths | null) => void;

  setActiveDocumentId: (documentId: string | null) => void;
  setCurrentPageState: (pageIndex: number, totalPages: number) => void;

  setDocumentHighlights: (documentId: string, highlights: HighlightRecord[]) => void;
  upsertDocumentHighlight: (highlight: HighlightRecord) => void;
  removeDocumentHighlight: (documentId: string, highlightId: string) => void;
  setAllHighlights: (highlights: HighlightRecord[]) => void;

  setHighlightsSearch: (value: string) => void;
  setHighlightsContextOnly: (value: boolean) => void;
  setHighlightsDocumentFilter: (value: string) => void;

  setPendingNavigation: (payload: NavigateToHighlight | null) => void;

  setLoading: (value: boolean) => void;
  showToast: (message: string, type?: ToastType) => void;
  clearToast: () => void;
}

const defaultSettings: AppSettings = {
  theme: 'white',
  focusMode: false,
  goals: {
    pagesPerDay: 20,
    pagesPerWeek: 140,
  },
  savedHighlightViews: [],
  savedHighlightQueries: [],
};

function sortByPageAndDate(highlights: HighlightRecord[]): HighlightRecord[] {
  return [...highlights].sort((left, right) => {
    if (left.pageIndex === right.pageIndex) {
      return new Date(left.createdAt).valueOf() - new Date(right.createdAt).valueOf();
    }
    return left.pageIndex - right.pageIndex;
  });
}

function withUpdatedHighlightsCount(
  documents: DocumentRecord[],
  documentId: string,
  updater: (current: number) => number,
) {
  return documents.map((documentInfo) => {
    if (documentInfo.id !== documentId) {
      return documentInfo;
    }

    const current = Math.max(0, Math.trunc(Number(documentInfo.highlightsCount ?? 0)));
    return {
      ...documentInfo,
      highlightsCount: Math.max(0, Math.trunc(updater(current))),
    };
  });
}

function withSetHighlightsCount(
  documents: DocumentRecord[],
  documentId: string,
  nextCountRaw: number,
) {
  const nextCount = Math.max(0, Math.trunc(Number(nextCountRaw || 0)));
  return documents.map((documentInfo) => {
    if (documentInfo.id !== documentId) {
      return documentInfo;
    }

    return {
      ...documentInfo,
      highlightsCount: nextCount,
    };
  });
}

export const useAppStore = create<AppStoreState>((set, get) => ({
  view: 'library',
  documents: [],
  collections: [],
  settings: defaultSettings,
  readingLog: {},
  storagePaths: null,

  activeDocumentId: null,
  currentPageIndex: 0,
  totalPages: 0,

  highlightsByDocument: {},
  allHighlights: [],
  highlightsSearch: '',
  highlightsContextOnly: false,
  highlightsDocumentFilter: 'all',

  pendingNavigation: null,

  loading: false,
  toast: null,

  setView: (view) => {
    addDebugEvent('store', 'set-view', {
      details: String(view),
    });
    set({ view });
  },

  setDocuments: (documents) => {
    setDebugGauge('store.documents.count', documents.length, 'store');
    addDebugEvent('store', 'set-documents', {
      details: `count=${documents.length}`,
    });
    set({ documents });
  },
  upsertDocument: (documentInfo) =>
    set((state) => {
      const index = state.documents.findIndex((item) => item.id === documentInfo.id);
      if (index < 0) {
        incrementDebugCounter('store.documents.upsert.added', 1, 'store', {
          documentId: documentInfo.id,
        });
        return {
          documents: [documentInfo, ...state.documents],
        };
      }

      incrementDebugCounter('store.documents.upsert.updated', 1, 'store', {
        documentId: documentInfo.id,
      });
      const next = [...state.documents];
      next[index] = {
        ...next[index],
        ...documentInfo,
      };
      return { documents: next };
    }),
  removeDocument: (documentId) =>
    set((state) => {
      addDebugEvent('store', 'remove-document', {
        documentId,
      });
      const nextByDocument = { ...state.highlightsByDocument };
      delete nextByDocument[documentId];

      const nextAllHighlights = state.allHighlights.filter(
        (highlight) => highlight.documentId !== documentId,
      );

      return {
        documents: state.documents.filter((item) => item.id !== documentId),
        highlightsByDocument: nextByDocument,
        allHighlights: nextAllHighlights,
        activeDocumentId:
          state.activeDocumentId === documentId ? null : state.activeDocumentId,
      };
    }),

  setCollections: (collections) => {
    setDebugGauge('store.collections.count', collections.length, 'store');
    addDebugEvent('store', 'set-collections', {
      details: `count=${collections.length}`,
    });
    set({ collections });
  },

  setSettings: (settings) => {
    addDebugEvent('store', 'set-settings', {
      details: `focusMode=${Boolean(settings?.focusMode)}`,
      data: summarizeForDebug(settings),
    });
    set({ settings: { ...defaultSettings, ...settings } });
  },
  patchSettings: (patch) =>
    set((state) => {
      addDebugEvent('store', 'patch-settings', {
        data: summarizeForDebug(patch),
      });
      return {
        settings: {
          ...state.settings,
          ...patch,
          goals: {
            ...state.settings.goals,
            ...(patch.goals ?? {}),
          },
        },
      };
    }),

  setReadingLog: (readingLog) => {
    setDebugGauge('store.reading-log.days', Object.keys(readingLog).length, 'store');
    set({ readingLog });
  },
  setStoragePaths: (storagePaths) => {
    addDebugEvent('store', 'set-storage-paths', {
      data: summarizeForDebug(storagePaths),
    });
    set({ storagePaths });
  },

  setActiveDocumentId: (documentId) => {
    addDebugEvent('store', 'set-active-document', {
      documentId: documentId || undefined,
      details: String(documentId || 'null'),
    });
    set({ activeDocumentId: documentId });
  },
  setCurrentPageState: (pageIndex, totalPages) =>
    set((state) => {
      const nextPage = Math.max(0, Math.trunc(pageIndex || 0));
      const nextTotalPages = Math.max(0, Math.trunc(totalPages || 0));
      if (state.currentPageIndex !== nextPage || state.totalPages !== nextTotalPages) {
        addDebugEvent('store', 'set-current-page-state', {
          details: `page=${nextPage + 1}/${nextTotalPages || '?'}`,
        });
      }
      return {
        currentPageIndex: nextPage,
        totalPages: nextTotalPages,
      };
    }),

  setDocumentHighlights: (documentId, highlights) =>
    set((state) => {
      const sorted = sortByPageAndDate(highlights);
      const nextAllHighlights = [
        ...state.allHighlights.filter((item) => item.documentId !== documentId),
        ...sorted,
      ];

      setDebugGauge('store.highlights.document.count', sorted.length, 'store', {
        documentId,
      });

      return {
        documents: withSetHighlightsCount(state.documents, documentId, sorted.length),
        highlightsByDocument: {
          ...state.highlightsByDocument,
          [documentId]: sorted,
        },
        allHighlights: nextAllHighlights,
      };
    }),

  upsertDocumentHighlight: (highlight) =>
    set((state) => {
      addDebugEvent('store', 'upsert-highlight', {
        documentId: highlight.documentId,
        highlightId: highlight.id,
      });
      const existing = state.highlightsByDocument[highlight.documentId] ?? [];
      const index = existing.findIndex((item) => item.id === highlight.id);
      const next = [...existing];
      const allIndex = state.allHighlights.findIndex((item) => item.id === highlight.id);
      const nextAllHighlights = [...state.allHighlights];
      let isAdded = false;

      if (index < 0) {
        next.push(highlight);
        isAdded = true;
      } else {
        next[index] = {
          ...next[index],
          ...highlight,
        };
      }

      if (allIndex < 0) {
        nextAllHighlights.push(highlight);
      } else {
        nextAllHighlights[allIndex] = {
          ...nextAllHighlights[allIndex],
          ...highlight,
        };
      }

      return {
        documents: isAdded
          ? withUpdatedHighlightsCount(state.documents, highlight.documentId, (current) => current + 1)
          : state.documents,
        highlightsByDocument: {
          ...state.highlightsByDocument,
          [highlight.documentId]: sortByPageAndDate(next),
        },
        allHighlights: nextAllHighlights,
      };
    }),

  removeDocumentHighlight: (documentId, highlightId) =>
    set((state) => {
      const current = state.highlightsByDocument[documentId] ?? [];
      const removedFromDocument = current.some((highlight) => highlight.id === highlightId);
      const removedFromAll = state.allHighlights.some(
        (highlight) => highlight.documentId === documentId && highlight.id === highlightId,
      );
      const shouldDecrement = removedFromDocument || removedFromAll;
      if (shouldDecrement) {
        incrementDebugCounter('store.highlights.removed', 1, 'store', {
          documentId,
          highlightId,
        });
      }
      return {
        documents: shouldDecrement
          ? withUpdatedHighlightsCount(state.documents, documentId, (count) => count - 1)
          : state.documents,
        highlightsByDocument: {
          ...state.highlightsByDocument,
          [documentId]: current.filter((highlight) => highlight.id !== highlightId),
        },
        allHighlights: state.allHighlights.filter((highlight) => highlight.id !== highlightId),
      };
    }),

  setAllHighlights: (highlights) => {
    setDebugGauge('store.highlights.all.count', highlights.length, 'store');
    set({ allHighlights: highlights });
  },

  setHighlightsSearch: (value) => {
    addDebugEvent('store', 'set-highlights-search', {
      details: value ? `len=${value.length}` : 'empty',
    });
    set({ highlightsSearch: value });
  },
  setHighlightsContextOnly: (value) => {
    addDebugEvent('store', 'set-highlights-context-only', {
      details: value ? 'on' : 'off',
    });
    set({ highlightsContextOnly: value });
  },
  setHighlightsDocumentFilter: (value) => {
    addDebugEvent('store', 'set-highlights-document-filter', {
      documentId: value === 'all' ? undefined : value,
      details: String(value),
    });
    set({ highlightsDocumentFilter: value });
  },

  setPendingNavigation: (payload) => {
    addDebugEvent('store', 'set-pending-navigation', {
      actionId: payload ? `nav:${payload.documentId}:${payload.pageIndex}` : undefined,
      documentId: payload?.documentId,
      highlightId: payload?.highlightId,
      details: payload ? `page=${payload.pageIndex + 1}` : 'cleared',
      data: summarizeForDebug(payload),
    });
    set({ pendingNavigation: payload });
  },

  setLoading: (value) => {
    setDebugGauge('store.loading', value ? 1 : 0, 'store');
    set({ loading: value });
  },

  showToast: (message, type = 'info') => {
    const nextId = Date.now();
    incrementDebugCounter('store.toast.shown', 1, 'store', {}, { type });
    addDebugEvent(
      'ui',
      'toast.show',
      {
        details: `${type}: ${message}`,
        data: {
          id: nextId,
          message,
          type,
        },
      },
      type === 'error' ? 'error' : 'info',
    );
    set({
      toast: {
        id: nextId,
        message,
        type,
      },
    });

    window.setTimeout(() => {
      const state = get();
      if (state.toast?.id === nextId) {
        set({ toast: null });
      }
    }, 3400);
  },

  clearToast: () => {
    addDebugEvent('ui', 'toast.clear');
    set({ toast: null });
  },
}));
