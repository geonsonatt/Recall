import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as rendererApi from '../app/renderer/src/app/api';

function createRecallApiMock() {
  return {
    listDocuments: vi.fn().mockResolvedValue([]),
    importPdf: vi.fn().mockResolvedValue({ canceled: true }),
    importPdfPaths: vi.fn().mockResolvedValue({ imported: [], duplicates: [], errors: [] }),
    updateDocumentMeta: vi.fn().mockResolvedValue({ id: 'doc-1' }),
    deleteDocument: vi.fn().mockResolvedValue({ deleted: true }),
    resetDocumentReadingState: vi.fn().mockResolvedValue({ id: 'doc-1' }),
    getDocument: vi.fn().mockResolvedValue({ id: 'doc-1' }),
    updateDocumentReadingState: vi.fn().mockResolvedValue({ id: 'doc-1' }),
    readDocumentPdfBytes: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
    listHighlights: vi.fn().mockResolvedValue([]),
    listAllHighlights: vi.fn().mockResolvedValue([]),
    addHighlight: vi.fn().mockResolvedValue({ id: 'hl-1' }),
    updateHighlight: vi.fn().mockResolvedValue({ id: 'hl-1' }),
    deleteHighlight: vi.fn().mockResolvedValue({ deleted: true }),
    deleteHighlightsMany: vi.fn().mockResolvedValue({ deleted: true, deletedCount: 1 }),
    listCollections: vi.fn().mockResolvedValue([]),
    createCollection: vi.fn().mockResolvedValue({ id: 'col-1', name: 'Коллекция' }),
    updateCollection: vi.fn().mockResolvedValue({ id: 'col-1', name: 'Коллекция 2' }),
    deleteCollection: vi.fn().mockResolvedValue({ deleted: true }),
    getSettings: vi.fn().mockResolvedValue({ theme: 'white', focusMode: false, goals: { pagesPerDay: 20, pagesPerWeek: 140 } }),
    updateSettings: vi.fn().mockResolvedValue({ theme: 'white', focusMode: true, goals: { pagesPerDay: 20, pagesPerWeek: 140 } }),
    getReadingOverview: vi.fn().mockResolvedValue({ readingLog: {}, settings: { theme: 'white', focusMode: false, goals: { pagesPerDay: 20, pagesPerWeek: 140 } } }),
    exportMarkdown: vi.fn().mockResolvedValue({ canceled: false, filePath: '/tmp/file.md' }),
    exportMarkdownCustom: vi.fn().mockResolvedValue({ canceled: false, filePath: '/tmp/file-custom.md' }),
    exportAnnotatedPdf: vi.fn().mockResolvedValue({ canceled: false, filePath: '/tmp/file.pdf' }),
    exportObsidianBundle: vi.fn().mockResolvedValue({ canceled: false, bundlePath: '/tmp/obsidian' }),
    exportNotionBundle: vi.fn().mockResolvedValue({ canceled: false, bundlePath: '/tmp/notion' }),
    generateSrsDeck: vi.fn().mockResolvedValue({ generatedAt: '2026-02-21T10:00:00.000Z', dueOnly: true, totalCandidates: 1, dueCount: 1, newCount: 1, deckName: 'SRS', cards: [], markdown: '# SRS', ankiTsv: '' }),
    buildReadingDigest: vi.fn().mockResolvedValue({ generatedAt: '2026-02-21T10:00:00.000Z', period: 'daily', range: { start: '', end: '', label: '' }, stats: { pages: 1, seconds: 1, highlights: 1, activeDocuments: 1 }, topDocuments: [], topTags: [], inbox: [], markdown: '# digest' }),
    buildKnowledgeGraph: vi.fn().mockResolvedValue({ generatedAt: '2026-02-21T10:00:00.000Z', stats: { highlights: 1, documents: 1, concepts: 1, edges: 1 }, nodes: [], edges: [], mermaid: 'graph LR' }),
    askLibrary: vi.fn().mockResolvedValue({ generatedAt: '2026-02-21T10:00:00.000Z', query: 'q', answer: 'a', citations: [], confidence: 0.8 }),
    summarizeHighlights: vi.fn().mockResolvedValue({ generatedAt: '2026-02-21T10:00:00.000Z', documentId: 'doc-1', documentTitle: 'Doc', usedHighlightsCount: 1, keyPoints: [], summary: 's', sourceHighlightIds: [] }),
    reviewHighlightSrs: vi.fn().mockResolvedValue({ id: 'hl-1' }),
    generateAiAssistantBrief: vi.fn().mockResolvedValue({ generatedAt: '2026-02-21T10:00:00.000Z', mode: 'review', provider: 'local', text: 'x', recommendations: [], metrics: { dueCount: 0, digestPages: 0, digestHighlights: 0, summaryHighlights: 0 }, topConcepts: [] }),
    getStoragePaths: vi.fn().mockResolvedValue({ userDataPath: '/tmp', documentsDir: '/tmp/docs', exportsDir: '/tmp/exports', backupDir: '/tmp/backups', dbPath: '/tmp/db.json' }),
    backupData: vi.fn().mockResolvedValue({ canceled: false, backupPath: '/tmp/backup' }),
    restoreData: vi.fn().mockResolvedValue({ canceled: false, backupPath: '/tmp/backup' }),
    revealUserData: vi.fn().mockResolvedValue({ ok: true }),
  };
}

describe('renderer api wrappers', () => {
  beforeEach(() => {
    const recallApi = createRecallApiMock();
    (globalThis as any).window = { recallApi };
  });

  it('throws a descriptive error when preload api is missing', async () => {
    (globalThis as any).window = {};
    await expect(rendererApi.listDocuments()).rejects.toThrow('Preload API недоступен.');
  });

  it('proxies all calls to window.recallApi with original payloads', async () => {
    const recallApi = (window as any).recallApi;

    await rendererApi.listDocuments();
    expect(recallApi.listDocuments).toHaveBeenCalledTimes(1);

    await rendererApi.importPdf();
    expect(recallApi.importPdf).toHaveBeenCalledTimes(1);

    await rendererApi.importPdfPaths(['/a.pdf']);
    expect(recallApi.importPdfPaths).toHaveBeenCalledWith(['/a.pdf']);

    await rendererApi.deleteDocument('doc-1');
    expect(recallApi.deleteDocument).toHaveBeenCalledWith('doc-1');

    await rendererApi.getDocument('doc-1');
    expect(recallApi.getDocument).toHaveBeenCalledWith('doc-1');

    await rendererApi.readDocumentPdfBytes('doc-1');
    expect(recallApi.readDocumentPdfBytes).toHaveBeenCalledWith('doc-1');

    await rendererApi.updateReadingState({ documentId: 'doc-1', pageIndex: 2 });
    expect(recallApi.updateDocumentReadingState).toHaveBeenCalledWith({
      documentId: 'doc-1',
      pageIndex: 2,
    });

    await rendererApi.listHighlights('doc-1');
    expect(recallApi.listHighlights).toHaveBeenCalledWith({ documentId: 'doc-1' });

    await rendererApi.listAllHighlights({ since: '2026-02-19T00:00:00.000Z' });
    expect(recallApi.listAllHighlights).toHaveBeenCalledWith({
      since: '2026-02-19T00:00:00.000Z',
    });

    await rendererApi.listAllHighlights();
    expect(recallApi.listAllHighlights).toHaveBeenCalledWith({});

    await rendererApi.addHighlight({
      documentId: 'doc-1',
      pageIndex: 1,
      rects: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.05 }],
      selectedText: 'Текст',
      color: 'yellow',
    });
    expect(recallApi.addHighlight).toHaveBeenCalledTimes(1);

    await rendererApi.updateHighlight({ id: 'hl-1', note: 'n' });
    expect(recallApi.updateHighlight).toHaveBeenCalledWith({ id: 'hl-1', note: 'n' });

    await rendererApi.deleteHighlight('hl-1');
    expect(recallApi.deleteHighlight).toHaveBeenCalledWith('hl-1');

    await rendererApi.exportAnnotatedPdf('doc-1');
    expect(recallApi.exportAnnotatedPdf).toHaveBeenCalledWith('doc-1');

    await rendererApi.exportMarkdown('doc-1');
    expect(recallApi.exportMarkdown).toHaveBeenCalledWith('doc-1');

    await rendererApi.exportObsidianBundle({ documentIds: ['doc-1'] });
    expect(recallApi.exportObsidianBundle).toHaveBeenCalledWith({ documentIds: ['doc-1'] });

    await rendererApi.exportNotionBundle({ documentIds: ['doc-1'] });
    expect(recallApi.exportNotionBundle).toHaveBeenCalledWith({ documentIds: ['doc-1'] });

    await rendererApi.generateSrsDeck({ documentId: 'doc-1' });
    expect(recallApi.generateSrsDeck).toHaveBeenCalledWith({ documentId: 'doc-1' });

    await rendererApi.buildReadingDigest({ period: 'daily' });
    expect(recallApi.buildReadingDigest).toHaveBeenCalledWith({ period: 'daily' });

    await rendererApi.buildKnowledgeGraph({ topConcepts: 80 });
    expect(recallApi.buildKnowledgeGraph).toHaveBeenCalledWith({ topConcepts: 80 });

    await rendererApi.askLibrary({ query: 'симулякры' });
    expect(recallApi.askLibrary).toHaveBeenCalledWith({ query: 'симулякры' });

    await rendererApi.summarizeHighlights({ documentId: 'doc-1' });
    expect(recallApi.summarizeHighlights).toHaveBeenCalledWith({ documentId: 'doc-1' });

    await rendererApi.reviewHighlightSrs({ highlightId: 'hl-1', grade: 'easy' });
    expect(recallApi.reviewHighlightSrs).toHaveBeenCalledWith({ highlightId: 'hl-1', grade: 'easy' });

    await rendererApi.generateAiAssistantBrief({ mode: 'review', provider: 'local' });
    expect(recallApi.generateAiAssistantBrief).toHaveBeenCalledWith({ mode: 'review', provider: 'local' });

    await rendererApi.listCollections();
    expect(recallApi.listCollections).toHaveBeenCalledTimes(1);

    await rendererApi.createCollection('Философия');
    expect(recallApi.createCollection).toHaveBeenCalledWith({ name: 'Философия' });

    await rendererApi.updateDocumentMeta({ documentId: 'doc-1', isPinned: true });
    expect(recallApi.updateDocumentMeta).toHaveBeenCalledWith({
      documentId: 'doc-1',
      isPinned: true,
    });

    await rendererApi.resetDocumentReadingState('doc-1');
    expect(recallApi.resetDocumentReadingState).toHaveBeenCalledWith('doc-1');

    await rendererApi.getSettings();
    expect(recallApi.getSettings).toHaveBeenCalledTimes(1);

    await rendererApi.updateSettings({ focusMode: true });
    expect(recallApi.updateSettings).toHaveBeenCalledWith({ focusMode: true });

    await rendererApi.getReadingOverview();
    expect(recallApi.getReadingOverview).toHaveBeenCalledTimes(1);

    await rendererApi.getStoragePaths();
    expect(recallApi.getStoragePaths).toHaveBeenCalledTimes(1);

    await rendererApi.revealUserData();
    expect(recallApi.revealUserData).toHaveBeenCalledTimes(1);

    await rendererApi.backupData();
    expect(recallApi.backupData).toHaveBeenCalledTimes(1);

    await rendererApi.restoreData();
    expect(recallApi.restoreData).toHaveBeenCalledTimes(1);
  });
});
