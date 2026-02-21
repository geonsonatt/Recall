// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../app/renderer/src/app/store/useAppStore';

const { apiMocks, libraryPropsSpy, readerPropsSpy, highlightsPropsSpy } = vi.hoisted(() => ({
  apiMocks: {
    listDocuments: vi.fn(),
    listCollections: vi.fn(),
    getSettings: vi.fn(),
    getReadingOverview: vi.fn(),
    getStoragePaths: vi.fn(),
    listAllHighlights: vi.fn(),
    importPdf: vi.fn(),
    importPdfPaths: vi.fn(),
    deleteDocument: vi.fn(),
    exportAnnotatedPdf: vi.fn(),
    exportMarkdown: vi.fn(),
    exportObsidianBundle: vi.fn(),
    exportNotionBundle: vi.fn(),
    generateSrsDeck: vi.fn(),
    buildReadingDigest: vi.fn(),
    buildKnowledgeGraph: vi.fn(),
    askLibrary: vi.fn(),
    summarizeHighlights: vi.fn(),
    reviewHighlightSrs: vi.fn(),
    updateDocumentMeta: vi.fn(),
    createCollection: vi.fn(),
    updateSettings: vi.fn(),
    revealUserData: vi.fn(),
    backupData: vi.fn(),
    restoreData: vi.fn(),
    resetDocumentReadingState: vi.fn(),
    deleteHighlight: vi.fn(),
  },
  libraryPropsSpy: vi.fn(),
  readerPropsSpy: vi.fn(),
  highlightsPropsSpy: vi.fn(),
}));

vi.mock('../app/renderer/src/app/api', () => apiMocks);

vi.mock('../app/renderer/src/app/components/LiquidSurface', () => ({
  LiquidSurface: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('../app/renderer/src/app/components/Toast', () => ({
  Toast: ({ message }: { message: string }) => <div data-testid="toast">{message}</div>,
}));

vi.mock('../app/renderer/src/app/components/TopTabs', () => ({
  TopTabs: ({
    onChange,
    canOpenReader,
    canOpenHighlights,
    canOpenInsights,
  }: {
    onChange: (value: 'library' | 'reader' | 'highlights' | 'insights') => void;
    canOpenReader: boolean;
    canOpenHighlights: boolean;
    canOpenInsights: boolean;
  }) => (
    <div>
      <span data-testid="tab-cap-reader">{String(canOpenReader)}</span>
      <span data-testid="tab-cap-highlights">{String(canOpenHighlights)}</span>
      <span data-testid="tab-cap-insights">{String(canOpenInsights)}</span>
      <button type="button" onClick={() => onChange('library')}>
        tab-library
      </button>
      <button type="button" onClick={() => onChange('reader')}>
        tab-reader
      </button>
      <button type="button" onClick={() => onChange('highlights')}>
        tab-highlights
      </button>
      <button type="button" onClick={() => onChange('insights')}>
        tab-insights
      </button>
    </div>
  ),
}));

vi.mock('../app/renderer/src/app/features/library/LibraryView', () => ({
  LibraryView: (props: any) => {
    libraryPropsSpy(props);
    return (
      <div data-testid="library-view">
        <button type="button" onClick={() => props.onOpenReader('doc-1')}>
          open-reader
        </button>
        <button type="button" onClick={() => props.onOpenHighlights('doc-1')}>
          open-highlights
        </button>
        <button type="button" onClick={() => props.onSaveFocusMode(true)}>
          save-focus
        </button>
      </div>
    );
  },
}));

vi.mock('../app/renderer/src/app/features/reader/ReaderView', () => ({
  ReaderView: (props: any) => {
    readerPropsSpy(props);
    return <div data-testid="reader-view">reader</div>;
  },
}));

vi.mock('../app/renderer/src/app/features/highlights/HighlightsView', () => ({
  HighlightsView: (props: any) => {
    highlightsPropsSpy(props);
    return <div data-testid="highlights-view">highlights</div>;
  },
}));

vi.mock('../app/renderer/src/app/features/insights/InsightsView', () => ({
  InsightsView: () => <div data-testid="insights-view">insights</div>,
}));

import App from '../app/renderer/src/app/App';

const doc = {
  id: 'doc-1',
  title: 'Книга',
  filePath: '/tmp/doc.pdf',
  createdAt: '2026-02-19T10:00:00.000Z',
  highlightsCount: 0,
  lastReadPageIndex: 3,
  maxReadPageIndex: 3,
  lastReadTotalPages: 10,
};

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.confirm = vi.fn(() => true);

    apiMocks.listDocuments.mockResolvedValue([doc]);
    apiMocks.listCollections.mockResolvedValue([]);
    apiMocks.getSettings.mockResolvedValue({
      theme: 'white',
      focusMode: false,
      goals: { pagesPerDay: 20, pagesPerWeek: 140 },
      savedHighlightQueries: [],
    });
    apiMocks.getReadingOverview.mockResolvedValue({ readingLog: {}, settings: { theme: 'white' } });
    apiMocks.getStoragePaths.mockResolvedValue({
      userDataPath: '/tmp',
      documentsDir: '/tmp/docs',
      exportsDir: '/tmp/exports',
      backupDir: '/tmp/backups',
      dbPath: '/tmp/db.json',
    });
    apiMocks.listAllHighlights.mockResolvedValue([]);
    apiMocks.updateSettings.mockResolvedValue({
      theme: 'white',
      focusMode: true,
      goals: { pagesPerDay: 20, pagesPerWeek: 140 },
      savedHighlightQueries: [],
    });
    apiMocks.importPdf.mockResolvedValue({ canceled: true });
    apiMocks.importPdfPaths.mockResolvedValue({ imported: [], duplicates: [], errors: [] });
    apiMocks.createCollection.mockResolvedValue({ id: 'col-1', name: 'X' });
    apiMocks.deleteDocument.mockResolvedValue({ deleted: true, documentId: 'doc-1' });
    apiMocks.deleteHighlight.mockResolvedValue({ deleted: true });
    apiMocks.exportAnnotatedPdf.mockResolvedValue({ canceled: true });
    apiMocks.exportMarkdown.mockResolvedValue({ canceled: true });
    apiMocks.exportObsidianBundle.mockResolvedValue({ canceled: true });
    apiMocks.exportNotionBundle.mockResolvedValue({ canceled: true });
    apiMocks.generateSrsDeck.mockResolvedValue({
      generatedAt: '2026-02-21T10:00:00.000Z',
      dueOnly: true,
      totalCandidates: 0,
      dueCount: 0,
      newCount: 0,
      deckName: 'SRS',
      cards: [],
      markdown: '',
      ankiTsv: '',
    });
    apiMocks.buildReadingDigest.mockResolvedValue({
      generatedAt: '2026-02-21T10:00:00.000Z',
      period: 'daily',
      range: { start: '', end: '', label: '' },
      stats: { pages: 0, seconds: 0, highlights: 0, activeDocuments: 0 },
      topDocuments: [],
      topTags: [],
      inbox: [],
      markdown: '',
    });
    apiMocks.buildKnowledgeGraph.mockResolvedValue({
      generatedAt: '2026-02-21T10:00:00.000Z',
      stats: { highlights: 0, documents: 0, concepts: 0, edges: 0 },
      nodes: [],
      edges: [],
      mermaid: 'graph LR',
    });
    apiMocks.askLibrary.mockResolvedValue({
      generatedAt: '2026-02-21T10:00:00.000Z',
      query: 'q',
      answer: 'a',
      citations: [],
      confidence: 0.2,
    });
    apiMocks.summarizeHighlights.mockResolvedValue({
      generatedAt: '2026-02-21T10:00:00.000Z',
      documentId: 'doc-1',
      documentTitle: 'Doc',
      usedHighlightsCount: 0,
      keyPoints: [],
      summary: '',
      sourceHighlightIds: [],
    });
    apiMocks.reviewHighlightSrs.mockResolvedValue({ id: 'hl-1', documentId: 'doc-1' });
    apiMocks.updateDocumentMeta.mockResolvedValue(doc);
    apiMocks.revealUserData.mockResolvedValue({ ok: true });
    apiMocks.backupData.mockResolvedValue({ canceled: true });
    apiMocks.restoreData.mockResolvedValue({ canceled: true });
    apiMocks.resetDocumentReadingState.mockResolvedValue(doc);
  });

  it('bootstraps state, keeps white theme class and passes library props without onSaveTheme', async () => {
    const { container } = render(<App />);

    await waitFor(() => {
      expect(screen.getByTestId('library-view')).toBeInTheDocument();
    });

    expect(container.querySelector('.app-root')).toHaveClass('theme-white');
    expect(apiMocks.listDocuments).toHaveBeenCalledTimes(1);
    expect(apiMocks.listCollections).toHaveBeenCalledTimes(1);
    expect(apiMocks.getSettings).toHaveBeenCalledTimes(1);
    expect(apiMocks.listAllHighlights).toHaveBeenCalledTimes(1);

    const latestLibraryProps = libraryPropsSpy.mock.calls.at(-1)?.[0];
    expect(latestLibraryProps).toBeTruthy();
    expect('onSaveTheme' in latestLibraryProps).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'save-focus' }));
    await waitFor(() => {
      expect(apiMocks.updateSettings).toHaveBeenCalledWith({ focusMode: true });
    });
  });

  it('switches to reader/highlights and shows guard toasts for unavailable tabs', async () => {
    const firstRender = render(<App />);
    await waitFor(() => {
      expect(screen.getByTestId('library-view')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'open-reader' }));
    await waitFor(() => {
      expect(screen.getByTestId('reader-view')).toBeInTheDocument();
    });
    expect(readerPropsSpy).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'tab-highlights' }));
    await waitFor(() => {
      expect(screen.getByTestId('highlights-view')).toBeInTheDocument();
    });
    expect(highlightsPropsSpy).toHaveBeenCalled();
    firstRender.unmount();

    // Empty bootstrap branch: no documents => guarded navigation with toast.
    useAppStore.setState(useAppStore.getInitialState(), true);
    apiMocks.listDocuments.mockResolvedValueOnce([]);
    const secondRender = render(<App />);
    await waitFor(() => {
      expect(secondRender.getByTestId('library-view')).toBeInTheDocument();
    });

    fireEvent.click(secondRender.getByRole('button', { name: 'tab-reader' }));
    await waitFor(() => {
      expect(secondRender.getByTestId('toast')).toHaveTextContent(
        'Сначала откройте книгу из библиотеки.',
      );
    });
  });
});
