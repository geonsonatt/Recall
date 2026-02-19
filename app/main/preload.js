const { contextBridge, ipcRenderer } = require('electron');

const UPDATE_STATE_CHANNEL = 'app:update-state-changed';

contextBridge.exposeInMainWorld('recallApi', {
  listDocuments: () => ipcRenderer.invoke('library:list-documents'),
  importPdf: () => ipcRenderer.invoke('library:import-pdf'),
  importPdfPaths: (paths) => ipcRenderer.invoke('library:import-pdf-paths', { paths }),
  updateDocumentMeta: (payload) => ipcRenderer.invoke('library:update-document-meta', payload),
  deleteDocument: (documentId) => ipcRenderer.invoke('library:delete-document', documentId),
  resetDocumentReadingState: (documentId) =>
    ipcRenderer.invoke('library:reset-reading-state', { documentId }),

  getDocument: (documentId) => ipcRenderer.invoke('document:get', documentId),
  updateDocumentReadingState: (payload) =>
    ipcRenderer.invoke('document:update-reading-state', payload),
  readDocumentPdfBytes: (documentId) =>
    ipcRenderer.invoke('document:read-pdf-bytes', documentId),

  listHighlights: (payload) => ipcRenderer.invoke('highlight:list', payload),
  listAllHighlights: (payload) => ipcRenderer.invoke('highlight:list-all', payload),
  addHighlight: (highlightInput) => ipcRenderer.invoke('highlight:add', highlightInput),
  updateHighlight: (highlightPatch) => ipcRenderer.invoke('highlight:update', highlightPatch),
  deleteHighlight: (highlightId) => ipcRenderer.invoke('highlight:delete', highlightId),
  deleteHighlightsMany: (ids) => ipcRenderer.invoke('highlight:delete-many', { ids }),

  listBookmarks: (documentId) => ipcRenderer.invoke('bookmark:list', documentId),
  addBookmark: (payload) => ipcRenderer.invoke('bookmark:add', payload),
  updateBookmark: (payload) => ipcRenderer.invoke('bookmark:update', payload),
  deleteBookmark: (bookmarkId) => ipcRenderer.invoke('bookmark:delete', bookmarkId),
  deleteBookmarksMany: (ids) => ipcRenderer.invoke('bookmark:delete-many', { ids }),

  listCollections: () => ipcRenderer.invoke('collection:list'),
  createCollection: (payload) => ipcRenderer.invoke('collection:create', payload),
  updateCollection: (payload) => ipcRenderer.invoke('collection:update', payload),
  deleteCollection: (collectionId) => ipcRenderer.invoke('collection:delete', collectionId),

  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (payload) => ipcRenderer.invoke('settings:update', payload),
  getReadingOverview: () => ipcRenderer.invoke('reading:get-overview'),

  exportMarkdown: (documentId) => ipcRenderer.invoke('export:markdown', documentId),
  exportMarkdownCustom: (payload) => ipcRenderer.invoke('export:markdown-custom', payload),
  exportAnnotatedPdf: (documentId) =>
    ipcRenderer.invoke('export:annotated-pdf', documentId),

  getAppVersion: () => ipcRenderer.invoke('app:get-version'),
  getUpdateState: () => ipcRenderer.invoke('app:get-update-state'),
  checkForUpdates: (payload = {}) => ipcRenderer.invoke('app:check-for-updates', payload),
  openUpdateDownload: (url) => ipcRenderer.invoke('app:open-update-download', { url }),
  onUpdateStateChanged: (callback) => {
    if (typeof callback !== 'function') {
      return () => {};
    }

    const listener = (_event, payload) => {
      callback(payload);
    };

    ipcRenderer.on(UPDATE_STATE_CHANNEL, listener);
    return () => ipcRenderer.removeListener(UPDATE_STATE_CHANNEL, listener);
  },

  getStoragePaths: () => ipcRenderer.invoke('app:get-storage-paths'),
  backupData: () => ipcRenderer.invoke('app:backup-data'),
  restoreData: () => ipcRenderer.invoke('app:restore-data'),
  revealUserData: () => ipcRenderer.invoke('app:reveal-user-data'),
});
