const { IPC_CHANNELS, IPC_EVENTS } = require('../shared/contracts');

function createRecallApi(ipcRenderer) {
  const subscribeDeepLink = (listener) => {
    if (typeof listener !== 'function') {
      return () => {};
    }
    if (!ipcRenderer || typeof ipcRenderer.on !== 'function') {
      return () => {};
    }

    const handler = (_event, rawLink) => {
      listener(String(rawLink ?? ''));
    };
    ipcRenderer.on(IPC_EVENTS.APP_DEEP_LINK, handler);
    return () => {
      if (typeof ipcRenderer.removeListener === 'function') {
        ipcRenderer.removeListener(IPC_EVENTS.APP_DEEP_LINK, handler);
      }
    };
  };

  return {
    listDocuments: () => ipcRenderer.invoke(IPC_CHANNELS.LIBRARY_LIST_DOCUMENTS),
    importPdf: () => ipcRenderer.invoke(IPC_CHANNELS.LIBRARY_IMPORT_PDF),
    importPdfPaths: (paths) => ipcRenderer.invoke(IPC_CHANNELS.LIBRARY_IMPORT_PDF_PATHS, { paths }),
    updateDocumentMeta: (payload) => ipcRenderer.invoke(IPC_CHANNELS.LIBRARY_UPDATE_DOCUMENT_META, payload),
    deleteDocument: (documentId) => ipcRenderer.invoke(IPC_CHANNELS.LIBRARY_DELETE_DOCUMENT, documentId),
    resetDocumentReadingState: (documentId) =>
      ipcRenderer.invoke(IPC_CHANNELS.LIBRARY_RESET_READING_STATE, { documentId }),

    getDocument: (documentId) => ipcRenderer.invoke(IPC_CHANNELS.DOCUMENT_GET, documentId),
    updateDocumentReadingState: (payload) =>
      ipcRenderer.invoke(IPC_CHANNELS.DOCUMENT_UPDATE_READING_STATE, payload),
    readDocumentPdfBytes: (documentId) =>
      ipcRenderer.invoke(IPC_CHANNELS.DOCUMENT_READ_PDF_BYTES, documentId),

    listHighlights: (payload) => ipcRenderer.invoke(IPC_CHANNELS.HIGHLIGHT_LIST, payload),
    listAllHighlights: (payload) => ipcRenderer.invoke(IPC_CHANNELS.HIGHLIGHT_LIST_ALL, payload),
    addHighlight: (highlightInput) => ipcRenderer.invoke(IPC_CHANNELS.HIGHLIGHT_ADD, highlightInput),
    updateHighlight: (highlightPatch) => ipcRenderer.invoke(IPC_CHANNELS.HIGHLIGHT_UPDATE, highlightPatch),
    deleteHighlight: (highlightId) => ipcRenderer.invoke(IPC_CHANNELS.HIGHLIGHT_DELETE, highlightId),
    deleteHighlightsMany: (ids) => ipcRenderer.invoke(IPC_CHANNELS.HIGHLIGHT_DELETE_MANY, { ids }),

    listBookmarks: (documentId) => ipcRenderer.invoke(IPC_CHANNELS.BOOKMARK_LIST, documentId),
    addBookmark: (payload) => ipcRenderer.invoke(IPC_CHANNELS.BOOKMARK_ADD, payload),
    updateBookmark: (payload) => ipcRenderer.invoke(IPC_CHANNELS.BOOKMARK_UPDATE, payload),
    deleteBookmark: (bookmarkId) => ipcRenderer.invoke(IPC_CHANNELS.BOOKMARK_DELETE, bookmarkId),
    deleteBookmarksMany: (ids) => ipcRenderer.invoke(IPC_CHANNELS.BOOKMARK_DELETE_MANY, { ids }),

    listCollections: () => ipcRenderer.invoke(IPC_CHANNELS.COLLECTION_LIST),
    createCollection: (payload) => ipcRenderer.invoke(IPC_CHANNELS.COLLECTION_CREATE, payload),
    updateCollection: (payload) => ipcRenderer.invoke(IPC_CHANNELS.COLLECTION_UPDATE, payload),
    deleteCollection: (collectionId) => ipcRenderer.invoke(IPC_CHANNELS.COLLECTION_DELETE, collectionId),

    getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET),
    updateSettings: (payload) => ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_UPDATE, payload),
    getReadingOverview: () => ipcRenderer.invoke(IPC_CHANNELS.READING_GET_OVERVIEW),

    exportMarkdown: (documentId) => ipcRenderer.invoke(IPC_CHANNELS.EXPORT_MARKDOWN, documentId),
    exportMarkdownCustom: (payload) => ipcRenderer.invoke(IPC_CHANNELS.EXPORT_MARKDOWN_CUSTOM, payload),
    exportAnnotatedPdf: (documentId) =>
      ipcRenderer.invoke(IPC_CHANNELS.EXPORT_ANNOTATED_PDF, documentId),
    exportObsidianBundle: (payload) =>
      ipcRenderer.invoke(IPC_CHANNELS.EXPORT_OBSIDIAN_BUNDLE, payload),
    exportNotionBundle: (payload) =>
      ipcRenderer.invoke(IPC_CHANNELS.EXPORT_NOTION_BUNDLE, payload),

    generateSrsDeck: (payload) =>
      ipcRenderer.invoke(IPC_CHANNELS.INSIGHTS_GENERATE_SRS, payload),
    buildReadingDigest: (payload) =>
      ipcRenderer.invoke(IPC_CHANNELS.INSIGHTS_BUILD_DIGEST, payload),
    buildKnowledgeGraph: (payload) =>
      ipcRenderer.invoke(IPC_CHANNELS.INSIGHTS_BUILD_GRAPH, payload),
    askLibrary: (payload) => ipcRenderer.invoke(IPC_CHANNELS.INSIGHTS_ASK_LIBRARY, payload),
    summarizeHighlights: (payload) =>
      ipcRenderer.invoke(IPC_CHANNELS.INSIGHTS_SUMMARIZE_HIGHLIGHTS, payload),
    reviewHighlightSrs: (payload) =>
      ipcRenderer.invoke(IPC_CHANNELS.INSIGHTS_REVIEW_HIGHLIGHT, payload),
    generateAiAssistantBrief: (payload) =>
      ipcRenderer.invoke(IPC_CHANNELS.INSIGHTS_AI_ASSISTANT, payload),

    getStoragePaths: () => ipcRenderer.invoke(IPC_CHANNELS.APP_GET_STORAGE_PATHS),
    backupData: () => ipcRenderer.invoke(IPC_CHANNELS.APP_BACKUP_DATA),
    restoreData: () => ipcRenderer.invoke(IPC_CHANNELS.APP_RESTORE_DATA),
    revealUserData: () => ipcRenderer.invoke(IPC_CHANNELS.APP_REVEAL_USER_DATA),
    setDiagnosticsTrayCapture: (payload) =>
      ipcRenderer.invoke(IPC_CHANNELS.DIAGNOSTICS_SET_TRAY_CAPTURE, payload),
    pushDiagnosticsEvents: (payload) =>
      ipcRenderer.invoke(IPC_CHANNELS.DIAGNOSTICS_PUSH_EVENTS, payload),
    onDeepLink: (listener) => subscribeDeepLink(listener),
  };
}

function exposeRecallApi(contextBridge, ipcRenderer) {
  contextBridge.exposeInMainWorld('recallApi', createRecallApi(ipcRenderer));
}

try {
  const { contextBridge, ipcRenderer } = require('electron');
  if (contextBridge && ipcRenderer) {
    exposeRecallApi(contextBridge, ipcRenderer);
  }
} catch {
  // In test/runtime without electron preload context do nothing.
}

module.exports = {
  createRecallApi,
  exposeRecallApi,
};
