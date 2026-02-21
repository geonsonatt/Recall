import { describe, expect, it, vi } from 'vitest';
import { createRecallApi, exposeRecallApi } from '../app/main/preload.js';

describe('preload bridge', () => {
  it('builds recall api and maps methods to IPC channels', async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    const on = vi.fn();
    const removeListener = vi.fn();
    const bridgeApi = createRecallApi({ invoke, on, removeListener });

    await bridgeApi.listDocuments();
    expect(invoke).toHaveBeenLastCalledWith('library:list-documents');

    await bridgeApi.importPdf();
    expect(invoke).toHaveBeenLastCalledWith('library:import-pdf');

    await bridgeApi.importPdfPaths(['/tmp/a.pdf']);
    expect(invoke).toHaveBeenLastCalledWith('library:import-pdf-paths', { paths: ['/tmp/a.pdf'] });

    await bridgeApi.updateDocumentMeta({ documentId: 'doc-1', isPinned: true });
    expect(invoke).toHaveBeenLastCalledWith('library:update-document-meta', {
      documentId: 'doc-1',
      isPinned: true,
    });

    await bridgeApi.deleteDocument('doc-1');
    expect(invoke).toHaveBeenLastCalledWith('library:delete-document', 'doc-1');

    await bridgeApi.resetDocumentReadingState('doc-1');
    expect(invoke).toHaveBeenLastCalledWith('library:reset-reading-state', { documentId: 'doc-1' });

    await bridgeApi.getDocument('doc-1');
    expect(invoke).toHaveBeenLastCalledWith('document:get', 'doc-1');

    await bridgeApi.updateDocumentReadingState({ documentId: 'doc-1', pageIndex: 2 });
    expect(invoke).toHaveBeenLastCalledWith('document:update-reading-state', {
      documentId: 'doc-1',
      pageIndex: 2,
    });

    await bridgeApi.readDocumentPdfBytes('doc-1');
    expect(invoke).toHaveBeenLastCalledWith('document:read-pdf-bytes', 'doc-1');

    await bridgeApi.listHighlights({ documentId: 'doc-1' });
    expect(invoke).toHaveBeenLastCalledWith('highlight:list', { documentId: 'doc-1' });

    await bridgeApi.listAllHighlights({ documentId: 'doc-1' });
    expect(invoke).toHaveBeenLastCalledWith('highlight:list-all', { documentId: 'doc-1' });

    await bridgeApi.addHighlight({ documentId: 'doc-1' });
    expect(invoke).toHaveBeenLastCalledWith('highlight:add', { documentId: 'doc-1' });

    await bridgeApi.updateHighlight({ id: 'hl-1' });
    expect(invoke).toHaveBeenLastCalledWith('highlight:update', { id: 'hl-1' });

    await bridgeApi.deleteHighlight('hl-1');
    expect(invoke).toHaveBeenLastCalledWith('highlight:delete', 'hl-1');

    await bridgeApi.deleteHighlightsMany(['hl-1']);
    expect(invoke).toHaveBeenLastCalledWith('highlight:delete-many', { ids: ['hl-1'] });

    await bridgeApi.listBookmarks('doc-1');
    expect(invoke).toHaveBeenLastCalledWith('bookmark:list', 'doc-1');

    await bridgeApi.addBookmark({ documentId: 'doc-1' });
    expect(invoke).toHaveBeenLastCalledWith('bookmark:add', { documentId: 'doc-1' });

    await bridgeApi.updateBookmark({ id: 'bm-1' });
    expect(invoke).toHaveBeenLastCalledWith('bookmark:update', { id: 'bm-1' });

    await bridgeApi.deleteBookmark('bm-1');
    expect(invoke).toHaveBeenLastCalledWith('bookmark:delete', 'bm-1');

    await bridgeApi.deleteBookmarksMany(['bm-1']);
    expect(invoke).toHaveBeenLastCalledWith('bookmark:delete-many', { ids: ['bm-1'] });

    await bridgeApi.listCollections();
    expect(invoke).toHaveBeenLastCalledWith('collection:list');

    await bridgeApi.createCollection({ name: 'Новая' });
    expect(invoke).toHaveBeenLastCalledWith('collection:create', { name: 'Новая' });

    await bridgeApi.updateCollection({ id: 'col-1', name: 'Name' });
    expect(invoke).toHaveBeenLastCalledWith('collection:update', { id: 'col-1', name: 'Name' });

    await bridgeApi.deleteCollection('col-1');
    expect(invoke).toHaveBeenLastCalledWith('collection:delete', 'col-1');

    await bridgeApi.getSettings();
    expect(invoke).toHaveBeenLastCalledWith('settings:get');

    await bridgeApi.updateSettings({ focusMode: true });
    expect(invoke).toHaveBeenLastCalledWith('settings:update', { focusMode: true });

    await bridgeApi.getReadingOverview();
    expect(invoke).toHaveBeenLastCalledWith('reading:get-overview');

    await bridgeApi.exportMarkdown('doc-1');
    expect(invoke).toHaveBeenLastCalledWith('export:markdown', 'doc-1');

    await bridgeApi.exportMarkdownCustom({ documentId: 'doc-1' });
    expect(invoke).toHaveBeenLastCalledWith('export:markdown-custom', { documentId: 'doc-1' });

    await bridgeApi.exportAnnotatedPdf('doc-1');
    expect(invoke).toHaveBeenLastCalledWith('export:annotated-pdf', 'doc-1');

    await bridgeApi.exportObsidianBundle({ documentIds: ['doc-1'] });
    expect(invoke).toHaveBeenLastCalledWith('export:obsidian-bundle', { documentIds: ['doc-1'] });

    await bridgeApi.exportNotionBundle({ documentIds: ['doc-1'] });
    expect(invoke).toHaveBeenLastCalledWith('export:notion-bundle', { documentIds: ['doc-1'] });

    await bridgeApi.generateSrsDeck({ documentId: 'doc-1', dueOnly: true });
    expect(invoke).toHaveBeenLastCalledWith('insights:generate-srs', { documentId: 'doc-1', dueOnly: true });

    await bridgeApi.buildReadingDigest({ period: 'daily' });
    expect(invoke).toHaveBeenLastCalledWith('insights:build-digest', { period: 'daily' });

    await bridgeApi.buildKnowledgeGraph({ topConcepts: 80 });
    expect(invoke).toHaveBeenLastCalledWith('insights:build-graph', { topConcepts: 80 });

    await bridgeApi.askLibrary({ query: 'симулякры' });
    expect(invoke).toHaveBeenLastCalledWith('insights:ask-library', { query: 'симулякры' });

    await bridgeApi.summarizeHighlights({ documentId: 'doc-1' });
    expect(invoke).toHaveBeenLastCalledWith('insights:summarize-highlights', { documentId: 'doc-1' });

    await bridgeApi.reviewHighlightSrs({ highlightId: 'hl-1', grade: 'good' });
    expect(invoke).toHaveBeenLastCalledWith('insights:review-highlight', { highlightId: 'hl-1', grade: 'good' });

    await bridgeApi.generateAiAssistantBrief({ mode: 'review', provider: 'local' });
    expect(invoke).toHaveBeenLastCalledWith('insights:ai-assistant', { mode: 'review', provider: 'local' });

    await bridgeApi.getStoragePaths();
    expect(invoke).toHaveBeenLastCalledWith('app:get-storage-paths');

    await bridgeApi.backupData();
    expect(invoke).toHaveBeenLastCalledWith('app:backup-data');

    await bridgeApi.restoreData();
    expect(invoke).toHaveBeenLastCalledWith('app:restore-data');

    await bridgeApi.revealUserData();
    expect(invoke).toHaveBeenLastCalledWith('app:reveal-user-data');

    await bridgeApi.setDiagnosticsTrayCapture({ enabled: true });
    expect(invoke).toHaveBeenLastCalledWith('diagnostics:set-tray-capture', { enabled: true });

    await bridgeApi.pushDiagnosticsEvents({
      events: [
        {
          id: 'dbg-1',
          ts: '2026-02-21T10:00:00.000Z',
          scope: 'ui',
          level: 'info',
          type: 'event',
          name: 'ui.click',
        },
      ],
    });
    expect(invoke).toHaveBeenLastCalledWith('diagnostics:push-events', {
      events: [
        {
          id: 'dbg-1',
          ts: '2026-02-21T10:00:00.000Z',
          scope: 'ui',
          level: 'info',
          type: 'event',
          name: 'ui.click',
        },
      ],
    });

    const listener = vi.fn();
    const unsubscribe = bridgeApi.onDeepLink(listener);
    expect(on).toHaveBeenCalledTimes(1);
    expect(on.mock.calls[0][0]).toBe('app:deep-link');
    expect(typeof on.mock.calls[0][1]).toBe('function');

    on.mock.calls[0][1](undefined, 'recall://open?view=reader');
    expect(listener).toHaveBeenCalledWith('recall://open?view=reader');

    unsubscribe();
    expect(removeListener).toHaveBeenCalledTimes(1);
    expect(removeListener.mock.calls[0][0]).toBe('app:deep-link');
    expect(removeListener.mock.calls[0][1]).toBe(on.mock.calls[0][1]);
  });

  it('exposes bridge into contextBridge', () => {
    const exposeInMainWorld = vi.fn();
    const invoke = vi.fn();

    exposeRecallApi({ exposeInMainWorld }, { invoke });
    expect(exposeInMainWorld).toHaveBeenCalledTimes(1);
    expect(exposeInMainWorld.mock.calls[0][0]).toBe('recallApi');
    expect(typeof exposeInMainWorld.mock.calls[0][1].listDocuments).toBe('function');
  });
});
