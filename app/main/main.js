const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const {
  ensureStorage,
  listDocuments,
  importDocumentFromPath,
  importDocumentsFromPaths,
  getStoragePaths,
  getDocumentById,
  updateDocumentMeta,
  updateDocumentReadingState,
  resetDocumentReadingState,
  listHighlights,
  listAllHighlights,
  addHighlight,
  updateHighlight,
  deleteHighlight,
  deleteHighlightsByIds,
  listBookmarks,
  addBookmark,
  updateBookmark,
  deleteBookmark,
  deleteBookmarksByIds,
  listCollections,
  createCollection,
  updateCollection,
  deleteCollection,
  getSettings,
  updateSettings,
  getReadingOverview,
  deleteDocument,
} = require('../data/storage');
const { buildAnnotatedPdf } = require('../export/annotatedPdf');
const { buildHighlightsMarkdown } = require('../export/markdown');
const { checkForUpdates, normalizeHttpUrl } = require('./updateChecker');

let mainWindow;
let storagePaths;
let updateCheckPromise = null;
let latestUpdateState = {
  status: 'idle',
  updateAvailable: false,
  currentVersion: app.getVersion(),
  latestVersion: app.getVersion(),
  manifestUrl: '',
  checkedAt: null,
  downloadUrl: '',
  notes: '',
  publishedAt: '',
  error: '',
};

app.disableHardwareAcceleration();

function sanitizeFileName(value) {
  return String(value ?? '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getDefaultExportBaseName(document) {
  return sanitizeFileName(document.title) || `документ-${document.id.slice(0, 8)}`;
}

function timestampForFile() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, '0');
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    '-',
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join('');
}

function normalizeIds(values) {
  if (!Array.isArray(values)) {
    return [];
  }
  const unique = new Set(values.map((value) => String(value)).filter(Boolean));
  return [...unique];
}

function resolveManifestUrl(settings, overrideUrl = '') {
  const fromOverride = normalizeHttpUrl(overrideUrl);
  if (fromOverride) {
    return fromOverride;
  }

  const fromSettings = normalizeHttpUrl(settings?.updates?.manifestUrl);
  if (fromSettings) {
    return fromSettings;
  }

  return normalizeHttpUrl(process.env.RECALL_UPDATE_MANIFEST_URL);
}

function sendUpdateStateToRenderer() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send('app:update-state-changed', latestUpdateState);
}

async function runUpdateCheck(options = {}) {
  if (!storagePaths) {
    return latestUpdateState;
  }

  if (updateCheckPromise) {
    return updateCheckPromise;
  }

  updateCheckPromise = (async () => {
    const settings = await getSettings(storagePaths);
    const autoCheckEnabled = settings?.updates?.autoCheck !== false;
    const shouldRespectAutoCheck = !Boolean(options?.manual);
    const manifestUrl = resolveManifestUrl(settings, options?.manifestUrl);

    if (shouldRespectAutoCheck && !autoCheckEnabled) {
      latestUpdateState = {
        status: 'disabled',
        updateAvailable: false,
        currentVersion: app.getVersion(),
        latestVersion: app.getVersion(),
        manifestUrl,
        checkedAt: new Date().toISOString(),
        downloadUrl: '',
        notes: '',
        publishedAt: '',
        error: 'Автопроверка обновлений отключена в настройках.',
      };
      sendUpdateStateToRenderer();
      return latestUpdateState;
    }

    const checkResult = await checkForUpdates({
      manifestUrl,
      currentVersion: app.getVersion(),
      platform: process.platform,
    });

    latestUpdateState = {
      ...checkResult,
      autoCheckEnabled,
    };
    sendUpdateStateToRenderer();
    return latestUpdateState;
  })();

  try {
    return await updateCheckPromise;
  } finally {
    updateCheckPromise = null;
  }
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1320,
    height: 900,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: '#11161d',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;

  if (devServerUrl) {
    mainWindow.loadURL(devServerUrl);
  } else {
    mainWindow.loadFile(path.join(app.getAppPath(), 'dist/renderer/index.html'));
  }

  mainWindow.webContents.on('did-finish-load', () => {
    sendUpdateStateToRenderer();
  });
}

function isTrustedIpcSender(event) {
  const senderUrl = String(event?.senderFrame?.url ?? event?.sender?.getURL?.() ?? '');
  if (!senderUrl) {
    return false;
  }

  if (senderUrl.startsWith('file://')) {
    return true;
  }

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (!devServerUrl) {
    return false;
  }

  try {
    const senderOrigin = new URL(senderUrl).origin;
    const allowedOrigin = new URL(devServerUrl).origin;
    return senderOrigin === allowedOrigin;
  } catch {
    return false;
  }
}

function assertTrustedIpcSender(event, channel) {
  if (isTrustedIpcSender(event)) {
    return;
  }

  const senderUrl = String(event?.senderFrame?.url ?? event?.sender?.getURL?.() ?? 'unknown');
  throw new Error(`Недоверенный IPC источник для "${channel}": ${senderUrl}`);
}

function registerTrustedIpcHandle(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrustedIpcSender(event, channel);
    return handler(event, ...args);
  });
}

function registerIpc() {
  registerTrustedIpcHandle('library:list-documents', async () => {
    return listDocuments(storagePaths);
  });

  registerTrustedIpcHandle('library:import-pdf', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Импорт PDF',
      properties: ['openFile'],
      filters: [{ name: 'PDF документы', extensions: ['pdf'] }],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }

    const sourceFilePath = result.filePaths[0];
    const imported = await importDocumentFromPath(storagePaths, sourceFilePath);

    return {
      canceled: false,
      document: imported.document,
      alreadyExists: imported.alreadyExists,
    };
  });

  registerTrustedIpcHandle('library:import-pdf-paths', async (_event, payload) => {
    const paths = Array.isArray(payload?.paths)
      ? payload.paths.map((item) => String(item)).filter(Boolean)
      : [];
    const pdfPaths = paths.filter((filePath) => filePath.toLowerCase().endsWith('.pdf'));

    if (pdfPaths.length === 0) {
      return {
        imported: [],
        duplicates: [],
        errors: paths.length > 0 ? [{ filePath: '', message: 'Нет PDF-файлов для импорта.' }] : [],
      };
    }

    return importDocumentsFromPaths(storagePaths, pdfPaths);
  });

  registerTrustedIpcHandle('library:update-document-meta', async (_event, payload) => {
    const documentId = String(payload?.documentId ?? '');
    if (!documentId) {
      throw new Error('Не передан идентификатор документа.');
    }

    return updateDocumentMeta(storagePaths, documentId, {
      isPinned: payload?.isPinned,
      collectionId: payload?.collectionId,
    });
  });

  registerTrustedIpcHandle('library:delete-document', async (_event, documentId) => {
    const id = String(documentId ?? '');
    if (!id) {
      throw new Error('Не передан идентификатор документа.');
    }

    return deleteDocument(storagePaths, id);
  });

  registerTrustedIpcHandle('library:reset-reading-state', async (_event, payload) => {
    const documentId = String(payload?.documentId ?? '');
    if (!documentId) {
      throw new Error('Не передан идентификатор документа.');
    }

    return resetDocumentReadingState(storagePaths, documentId);
  });

  registerTrustedIpcHandle('document:get', async (_event, documentId) => {
    return getDocumentById(storagePaths, String(documentId));
  });

  registerTrustedIpcHandle('document:update-reading-state', async (_event, payload) => {
    const documentId = String(payload?.documentId ?? '');
    if (!documentId) {
      throw new Error('Не передан идентификатор документа.');
    }

    return updateDocumentReadingState(storagePaths, documentId, {
      pageIndex: payload?.pageIndex,
      totalPages: payload?.totalPages,
      scale: payload?.scale,
      lastOpenedAt: payload?.lastOpenedAt,
      readingSeconds: payload?.readingSeconds,
      pagesDelta: payload?.pagesDelta,
      allowFirstPage: payload?.allowFirstPage,
    });
  });

  registerTrustedIpcHandle('document:read-pdf-bytes', async (_event, documentId) => {
    const document = await getDocumentById(storagePaths, String(documentId));

    if (!document) {
      throw new Error('Документ не найден.');
    }

    return fs.readFile(document.filePath);
  });

  registerTrustedIpcHandle('highlight:list', async (_event, payload) => {
    const documentId =
      typeof payload === 'string'
        ? payload
        : String(payload?.documentId ?? '');

    return listHighlights(storagePaths, documentId, {
      since: payload?.since,
      tags: payload?.tags,
      ids: payload?.ids,
    });
  });

  registerTrustedIpcHandle('highlight:list-all', async (_event, payload) => {
    return listAllHighlights(storagePaths, {
      documentId: payload?.documentId,
      since: payload?.since,
      tags: payload?.tags,
      ids: payload?.ids,
    });
  });

  registerTrustedIpcHandle('highlight:add', async (_event, payload) => {
    const documentId = String(payload?.documentId ?? '');
    const document = await getDocumentById(storagePaths, documentId);

    if (!document) {
      throw new Error('Документ не найден.');
    }

    const highlight = {
      id: crypto.randomUUID(),
      documentId,
      pageIndex: payload.pageIndex,
      rects: payload.rects,
      selectedText: payload.selectedText,
      selectedRichText: payload.selectedRichText,
      color: payload.color,
      note: payload.note,
      tags: payload.tags,
      createdAt: new Date().toISOString(),
    };

    return addHighlight(storagePaths, highlight);
  });

  registerTrustedIpcHandle('highlight:update', async (_event, payload) => {
    const highlightId = String(payload?.id ?? '');
    if (!highlightId) {
      throw new Error('Не передан идентификатор выделения.');
    }

    const patch = {
      pageIndex: payload?.pageIndex,
      rects: payload?.rects,
      selectedText: payload?.selectedText,
      selectedRichText: payload?.selectedRichText,
      color: payload?.color,
      note: payload?.note,
      tags: payload?.tags,
    };

    return updateHighlight(storagePaths, highlightId, patch);
  });

  registerTrustedIpcHandle('highlight:delete', async (_event, highlightId) => {
    const id = String(highlightId ?? '');
    if (!id) {
      throw new Error('Не передан идентификатор выделения.');
    }

    return deleteHighlight(storagePaths, id);
  });

  registerTrustedIpcHandle('highlight:delete-many', async (_event, payload) => {
    const ids = normalizeIds(payload?.ids);
    return deleteHighlightsByIds(storagePaths, ids);
  });

  registerTrustedIpcHandle('bookmark:list', async (_event, documentId) => {
    return listBookmarks(storagePaths, String(documentId ?? ''));
  });

  registerTrustedIpcHandle('bookmark:add', async (_event, payload) => {
    const documentId = String(payload?.documentId ?? '');
    if (!documentId) {
      throw new Error('Не передан идентификатор документа.');
    }

    const document = await getDocumentById(storagePaths, documentId);
    if (!document) {
      throw new Error('Документ не найден.');
    }

    return addBookmark(storagePaths, {
      id: crypto.randomUUID(),
      documentId,
      pageIndex: payload?.pageIndex,
      label: payload?.label,
      createdAt: new Date().toISOString(),
    });
  });

  registerTrustedIpcHandle('bookmark:update', async (_event, payload) => {
    const bookmarkId = String(payload?.id ?? '');
    if (!bookmarkId) {
      throw new Error('Не передан идентификатор закладки.');
    }

    return updateBookmark(storagePaths, bookmarkId, {
      pageIndex: payload?.pageIndex,
      label: payload?.label,
    });
  });

  registerTrustedIpcHandle('bookmark:delete', async (_event, bookmarkId) => {
    return deleteBookmark(storagePaths, String(bookmarkId ?? ''));
  });

  registerTrustedIpcHandle('bookmark:delete-many', async (_event, payload) => {
    const ids = normalizeIds(payload?.ids);
    return deleteBookmarksByIds(storagePaths, ids);
  });

  registerTrustedIpcHandle('collection:list', async () => {
    return listCollections(storagePaths);
  });

  registerTrustedIpcHandle('collection:create', async (_event, payload) => {
    return createCollection(storagePaths, {
      id: payload?.id || crypto.randomUUID(),
      name: payload?.name,
    });
  });

  registerTrustedIpcHandle('collection:update', async (_event, payload) => {
    const collectionId = String(payload?.id ?? '');
    if (!collectionId) {
      throw new Error('Не передан идентификатор коллекции.');
    }

    return updateCollection(storagePaths, collectionId, {
      name: payload?.name,
    });
  });

  registerTrustedIpcHandle('collection:delete', async (_event, collectionId) => {
    return deleteCollection(storagePaths, String(collectionId ?? ''));
  });

  registerTrustedIpcHandle('settings:get', async () => {
    return getSettings(storagePaths);
  });

  registerTrustedIpcHandle('settings:update', async (_event, payload) => {
    return updateSettings(storagePaths, payload || {});
  });

  registerTrustedIpcHandle('reading:get-overview', async () => {
    return getReadingOverview(storagePaths);
  });

  registerTrustedIpcHandle('export:markdown', async (_event, documentId) => {
    const document = await getDocumentById(storagePaths, String(documentId));
    if (!document) {
      throw new Error('Документ не найден.');
    }

    const highlights = await listHighlights(storagePaths, document.id);
    const markdown = buildHighlightsMarkdown(document.title, highlights);

    const defaultBaseName = getDefaultExportBaseName(document);
    const saveDialog = await dialog.showSaveDialog({
      title: 'Экспорт Markdown с выделениями',
      defaultPath: path.join(storagePaths.exportsDir, `${defaultBaseName}.md`),
      filters: [{ name: 'Markdown файл', extensions: ['md'] }],
    });

    if (saveDialog.canceled || !saveDialog.filePath) {
      return { canceled: true };
    }

    await fs.writeFile(saveDialog.filePath, markdown, 'utf8');

    return {
      canceled: false,
      filePath: saveDialog.filePath,
    };
  });

  registerTrustedIpcHandle('export:markdown-custom', async (_event, payload) => {
    const documentId = String(payload?.documentId ?? '');
    const document = await getDocumentById(storagePaths, documentId);
    if (!document) {
      throw new Error('Документ не найден.');
    }

    const highlights = await listHighlights(storagePaths, document.id, {
      ids: payload?.highlightIds,
      since: payload?.since,
      tags: payload?.tags,
    });
    const markdownTitle = sanitizeFileName(payload?.title || document.title) || document.title;
    const markdown = buildHighlightsMarkdown(markdownTitle, highlights);

    const defaultBaseName = getDefaultExportBaseName(document);
    const suffix = payload?.suffix ? `-${sanitizeFileName(payload.suffix)}` : '-custom';
    const saveDialog = await dialog.showSaveDialog({
      title: 'Экспорт Markdown (выборка)',
      defaultPath: path.join(storagePaths.exportsDir, `${defaultBaseName}${suffix}.md`),
      filters: [{ name: 'Markdown файл', extensions: ['md'] }],
    });

    if (saveDialog.canceled || !saveDialog.filePath) {
      return { canceled: true };
    }

    await fs.writeFile(saveDialog.filePath, markdown, 'utf8');
    return {
      canceled: false,
      filePath: saveDialog.filePath,
      exportedCount: highlights.length,
    };
  });

  registerTrustedIpcHandle('export:annotated-pdf', async (_event, documentId) => {
    const document = await getDocumentById(storagePaths, String(documentId));

    if (!document) {
      throw new Error('Документ не найден.');
    }

    const highlights = await listHighlights(storagePaths, document.id);
    const sourcePdfBytes = await fs.readFile(document.filePath);
    const annotatedPdfBytes = await buildAnnotatedPdf(sourcePdfBytes, highlights);

    const defaultBaseName = getDefaultExportBaseName(document);
    const saveDialog = await dialog.showSaveDialog({
      title: 'Экспорт аннотированного PDF',
      defaultPath: path.join(storagePaths.exportsDir, `${defaultBaseName}-annotated.pdf`),
      filters: [{ name: 'PDF файл', extensions: ['pdf'] }],
    });

    if (saveDialog.canceled || !saveDialog.filePath) {
      return { canceled: true };
    }

    await fs.writeFile(saveDialog.filePath, Buffer.from(annotatedPdfBytes));

    return {
      canceled: false,
      filePath: saveDialog.filePath,
    };
  });

  registerTrustedIpcHandle('app:get-version', async () => {
    return {
      version: app.getVersion(),
    };
  });

  registerTrustedIpcHandle('app:get-update-state', async () => {
    return latestUpdateState;
  });

  registerTrustedIpcHandle('app:check-for-updates', async (_event, payload) => {
    return runUpdateCheck({
      manual: Boolean(payload?.manual),
      manifestUrl: payload?.manifestUrl,
    });
  });

  registerTrustedIpcHandle('app:open-update-download', async (_event, payload) => {
    const url = normalizeHttpUrl(
      typeof payload === 'string' ? payload : payload?.url || latestUpdateState?.downloadUrl,
    );

    if (!url) {
      throw new Error('Ссылка на обновление не найдена.');
    }

    await shell.openExternal(url);
    return {
      ok: true,
      url,
    };
  });

  registerTrustedIpcHandle('app:get-storage-paths', () => {
    return getStoragePaths(storagePaths);
  });

  registerTrustedIpcHandle('app:backup-data', async () => {
    const pick = await dialog.showOpenDialog({
      title: 'Выберите папку для бэкапа',
      properties: ['openDirectory', 'createDirectory'],
    });

    if (pick.canceled || pick.filePaths.length === 0) {
      return { canceled: true };
    }

    const targetRoot = pick.filePaths[0];
    const backupPath = path.join(targetRoot, `recall-backup-${timestampForFile()}`);
    await fs.mkdir(backupPath, { recursive: true });

    await Promise.all([
      fs.copyFile(storagePaths.dbPath, path.join(backupPath, 'db.json')),
      fs.cp(storagePaths.documentsDir, path.join(backupPath, 'documents'), {
        recursive: true,
        force: true,
      }),
      fs.cp(storagePaths.exportsDir, path.join(backupPath, 'exports'), {
        recursive: true,
        force: true,
      }),
    ]);

    await fs.writeFile(
      path.join(backupPath, 'meta.json'),
      JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          app: 'pdf-recall-desktop',
        },
        null,
        2,
      ),
      'utf8',
    );

    return {
      canceled: false,
      backupPath,
    };
  });

  registerTrustedIpcHandle('app:restore-data', async () => {
    const pick = await dialog.showOpenDialog({
      title: 'Выберите папку бэкапа',
      properties: ['openDirectory'],
    });

    if (pick.canceled || pick.filePaths.length === 0) {
      return { canceled: true };
    }

    const backupPath = pick.filePaths[0];
    const backupDbPath = path.join(backupPath, 'db.json');
    const backupDocumentsDir = path.join(backupPath, 'documents');
    const backupExportsDir = path.join(backupPath, 'exports');

    const hasDb = await fs
      .access(backupDbPath)
      .then(() => true)
      .catch(() => false);
    if (!hasDb) {
      throw new Error('В выбранной папке нет файла db.json.');
    }

    const autoBackupPath = path.join(storagePaths.backupDir, `auto-before-restore-${timestampForFile()}`);
    await fs.mkdir(autoBackupPath, { recursive: true });
    await Promise.all([
      fs.copyFile(storagePaths.dbPath, path.join(autoBackupPath, 'db.json')),
      fs.cp(storagePaths.documentsDir, path.join(autoBackupPath, 'documents'), {
        recursive: true,
        force: true,
      }),
    ]);

    await fs.copyFile(backupDbPath, storagePaths.dbPath);

    await fs.rm(storagePaths.documentsDir, { recursive: true, force: true });
    await fs.mkdir(storagePaths.documentsDir, { recursive: true });
    await fs.cp(backupDocumentsDir, storagePaths.documentsDir, {
      recursive: true,
      force: true,
    });

    const hasExports = await fs
      .access(backupExportsDir)
      .then(() => true)
      .catch(() => false);
    if (hasExports) {
      await fs.rm(storagePaths.exportsDir, { recursive: true, force: true });
      await fs.mkdir(storagePaths.exportsDir, { recursive: true });
      await fs.cp(backupExportsDir, storagePaths.exportsDir, {
        recursive: true,
        force: true,
      });
    }

    return {
      canceled: false,
      backupPath,
      autoBackupPath,
    };
  });

  registerTrustedIpcHandle('app:reveal-user-data', async () => {
    await shell.openPath(storagePaths.userDataPath);
    return { ok: true };
  });
}

app.whenReady().then(async () => {
  storagePaths = await ensureStorage(app.getPath('userData'));
  registerIpc();
  createMainWindow();
  runUpdateCheck().catch(() => {
    // Ignore startup check errors; renderer can request manual check.
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
