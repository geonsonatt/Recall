// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../app/renderer/src/app/store/useAppStore';
import type { DocumentRecord, HighlightRecord } from '../app/renderer/src/app/types';

function makeDocument(patch: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id: 'doc-1',
    title: 'Книга',
    filePath: '/tmp/book.pdf',
    createdAt: '2026-02-19T00:00:00.000Z',
    highlightsCount: 0,
    ...patch,
  };
}

function makeHighlight(patch: Partial<HighlightRecord> = {}): HighlightRecord {
  return {
    id: 'hl-1',
    documentId: 'doc-1',
    pageIndex: 0,
    rects: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.05 }],
    selectedText: 'Текст',
    color: 'yellow',
    createdAt: '2026-02-19T10:00:00.000Z',
    ...patch,
  };
}

describe('useAppStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useAppStore.setState(useAppStore.getInitialState(), true);
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('keeps only white theme and merges settings patches', () => {
    const { setSettings, patchSettings } = useAppStore.getState();
    setSettings({
      theme: 'white',
      focusMode: false,
      goals: { pagesPerDay: 20, pagesPerWeek: 140 },
      savedHighlightQueries: [],
    });

    patchSettings({
      focusMode: true,
      goals: { pagesPerDay: 30 },
    });

    const { settings } = useAppStore.getState();
    expect(settings.theme).toBe('white');
    expect(settings.focusMode).toBe(true);
    expect(settings.goals.pagesPerDay).toBe(30);
    expect(settings.goals.pagesPerWeek).toBe(140);
  });

  it('manages documents and active navigation state', () => {
    const first = makeDocument({ id: 'doc-a', title: 'A' });
    const second = makeDocument({ id: 'doc-b', title: 'B' });
    const {
      setDocuments,
      upsertDocument,
      removeDocument,
      setActiveDocumentId,
      setCurrentPageState,
      setPendingNavigation,
    } = useAppStore.getState();

    setDocuments([first]);
    upsertDocument(second);
    setActiveDocumentId('doc-b');
    setCurrentPageState(5.8, 12.4);
    setPendingNavigation({ documentId: 'doc-b', pageIndex: 5, highlightId: 'hl-2' });

    let state = useAppStore.getState();
    expect(state.documents).toHaveLength(2);
    expect(state.currentPageIndex).toBe(5);
    expect(state.totalPages).toBe(12);
    expect(state.pendingNavigation?.highlightId).toBe('hl-2');

    removeDocument('doc-b');
    state = useAppStore.getState();
    expect(state.documents).toHaveLength(1);
    expect(state.activeDocumentId).toBeNull();
  });

  it('syncs highlights and updates document counters', () => {
    const doc = makeDocument({ id: 'doc-1', highlightsCount: 3 });
    const first = makeHighlight({
      id: 'hl-1',
      pageIndex: 2,
      createdAt: '2026-02-19T12:00:00.000Z',
    });
    const second = makeHighlight({
      id: 'hl-2',
      pageIndex: 1,
      createdAt: '2026-02-19T11:00:00.000Z',
    });
    const third = makeHighlight({
      id: 'hl-3',
      pageIndex: 1,
      createdAt: '2026-02-19T10:00:00.000Z',
    });

    const {
      setDocuments,
      setDocumentHighlights,
      upsertDocumentHighlight,
      removeDocumentHighlight,
      setAllHighlights,
    } = useAppStore.getState();

    setDocuments([doc]);
    setDocumentHighlights(doc.id, [first, second, third]);

    let state = useAppStore.getState();
    expect(state.highlightsByDocument[doc.id].map((item) => item.id)).toEqual([
      'hl-3',
      'hl-2',
      'hl-1',
    ]);
    expect(state.documents[0].highlightsCount).toBe(3);

    upsertDocumentHighlight({
      ...third,
      id: 'hl-4',
      pageIndex: 5,
    });
    state = useAppStore.getState();
    expect(state.documents[0].highlightsCount).toBe(4);

    removeDocumentHighlight(doc.id, 'hl-2');
    state = useAppStore.getState();
    expect(state.documents[0].highlightsCount).toBe(3);
    expect(state.allHighlights.find((item) => item.id === 'hl-2')).toBeUndefined();

    setAllHighlights([first]);
    expect(useAppStore.getState().allHighlights).toEqual([first]);
  });

  it('decrements highlightsCount when deleting highlight that exists only in allHighlights', () => {
    const doc = makeDocument({ id: 'doc-1', highlightsCount: 1 });
    const highlight = makeHighlight({ id: 'hl-only-all', documentId: doc.id });

    const { setDocuments, setAllHighlights, removeDocumentHighlight } = useAppStore.getState();
    setDocuments([doc]);
    setAllHighlights([highlight]);

    removeDocumentHighlight(doc.id, highlight.id);

    const state = useAppStore.getState();
    expect(state.documents[0].highlightsCount).toBe(0);
    expect(state.allHighlights).toHaveLength(0);
    expect(state.highlightsByDocument[doc.id]).toEqual([]);
  });

  it('updates highlight filters and toast lifecycle', () => {
    const {
      setHighlightsSearch,
      setHighlightsContextOnly,
      setHighlightsDocumentFilter,
      showToast,
      clearToast,
    } = useAppStore.getState();

    setHighlightsSearch('Ключ');
    setHighlightsContextOnly(true);
    setHighlightsDocumentFilter('doc-1');
    showToast('Сохранено', 'success');

    let state = useAppStore.getState();
    expect(state.highlightsSearch).toBe('Ключ');
    expect(state.highlightsContextOnly).toBe(true);
    expect(state.highlightsDocumentFilter).toBe('doc-1');
    expect(state.toast?.message).toBe('Сохранено');

    vi.advanceTimersByTime(3401);
    state = useAppStore.getState();
    expect(state.toast).toBeNull();

    showToast('Ошибка', 'error');
    expect(useAppStore.getState().toast?.type).toBe('error');
    clearToast();
    expect(useAppStore.getState().toast).toBeNull();
  });
});
