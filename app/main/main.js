const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const {
  ensureStorage,
  loadDB,
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
const {
  buildObsidianBundleFiles,
  buildNotionBundleFiles,
  writeBundleFiles,
} = require('../export/bundles');
const {
  generateSrsDeck,
  applySrsReviewGrade,
  buildReadingDigest,
  buildKnowledgeGraph,
  askLibrary,
  summarizeHighlights,
} = require('../intelligence/insights');
const { generateAiAssistantBrief } = require('../intelligence/aiAssistant');
const {
  sanitizeFileName,
  getDefaultExportBaseName,
  timestampForFile,
  normalizeIds,
  pickOwnProps,
  isTrustedIpcSender,
  assertTrustedIpcSender,
} = require('./ipcUtils');
const {
  IPC_CHANNELS,
  IPC_EVENTS,
  validateChannelPayload,
  ensureAppError,
} = require('../shared/contracts');
const {
  initializeDiagnosticsTray,
  setDiagnosticsTrayCapture,
  appendDiagnosticsEvents,
} = require('./diagnosticsTray');

const MAIN_DEBUG_BOOT_ENABLED = process.env.RECALL_DEBUG_BOOT === '1';
const MAIN_DEBUG_BOOT_PATH = path.join(process.cwd(), '.recall-main.log');

function debugBoot(message) {
  if (!MAIN_DEBUG_BOOT_ENABLED) {
    return;
  }
  try {
    fsSync.appendFileSync(
      MAIN_DEBUG_BOOT_PATH,
      `[${new Date().toISOString()}] ${String(message)}\n`,
      'utf8',
    );
  } catch {
    // ignore debug write errors
  }
}

debugBoot('main module loaded');

let mainWindow;
let storagePaths;
let pendingExternalDeepLink = null;
const IS_DEV = Boolean(process.env.VITE_DEV_SERVER_URL);
const IS_UI_SNAP = process.env.RECALL_UI_SNAP === '1';
const DEEP_LINK_PREFIX = 'recall://';
const SUPPORTED_APP_VIEWS = new Set(['library', 'reader', 'highlights', 'insights']);

const isSnapRuntime = Boolean(process.env.SNAP || process.env.SNAP_NAME);
if (process.env.RECALL_DISABLE_GPU === '1' || isSnapRuntime) {
  app.disableHardwareAcceleration();
}

function normalizeExternalDeepLink(rawLink) {
  const raw = String(rawLink ?? '').trim();
  if (!raw || !raw.startsWith(DEEP_LINK_PREFIX)) {
    return null;
  }

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'recall:') {
      return null;
    }

    const viewFromParams = String(parsed.searchParams.get('view') || '').trim().toLowerCase();
    if (viewFromParams && !SUPPORTED_APP_VIEWS.has(viewFromParams)) {
      parsed.searchParams.delete('view');
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

function resolveDeepLinkView(urlObject) {
  const viewFromParams = String(urlObject.searchParams.get('view') || '').trim().toLowerCase();
  if (SUPPORTED_APP_VIEWS.has(viewFromParams)) {
    return viewFromParams;
  }

  const host = String(urlObject.hostname || '').trim().toLowerCase();
  if (SUPPORTED_APP_VIEWS.has(host)) {
    return host;
  }

  const pathSegment = String(urlObject.pathname || '')
    .replace(/^\/+/, '')
    .split('/')[0]
    .trim()
    .toLowerCase();
  if (SUPPORTED_APP_VIEWS.has(pathSegment)) {
    return pathSegment;
  }

  return 'library';
}

function externalDeepLinkToHash(rawLink) {
  const normalized = normalizeExternalDeepLink(rawLink);
  if (!normalized) {
    return '';
  }

  try {
    const parsed = new URL(normalized);
    const view = resolveDeepLinkView(parsed);
    const params = new URLSearchParams(parsed.search);
    params.delete('view');
    const query = params.toString();
    return `#/${view}${query ? `?${query}` : ''}`;
  } catch {
    return '';
  }
}

function findExternalDeepLink(argv = []) {
  if (!Array.isArray(argv)) {
    return null;
  }
  for (const arg of argv) {
    const normalized = normalizeExternalDeepLink(arg);
    if (normalized) {
      return normalized;
    }
  }
  return null;
}

function flushPendingExternalDeepLink() {
  if (!pendingExternalDeepLink || !mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  if (mainWindow.webContents.isLoadingMainFrame()) {
    return;
  }
  mainWindow.webContents.send(IPC_EVENTS.APP_DEEP_LINK, pendingExternalDeepLink);
  pendingExternalDeepLink = null;
}

function handleExternalDeepLink(rawLink) {
  const normalized = normalizeExternalDeepLink(rawLink);
  if (!normalized) {
    return false;
  }

  pendingExternalDeepLink = normalized;
  if (!mainWindow || mainWindow.isDestroyed()) {
    return true;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
  flushPendingExternalDeepLink();
  return true;
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
    return;
  }
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function createMainWindow() {
  debugBoot('createMainWindow called');
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
  const initialDeepLinkHash = externalDeepLinkToHash(pendingExternalDeepLink);
  if (initialDeepLinkHash) {
    pendingExternalDeepLink = null;
  }

  if (devServerUrl) {
    const targetUrl = initialDeepLinkHash ? `${devServerUrl}${initialDeepLinkHash}` : devServerUrl;
    debugBoot(`loadURL ${targetUrl}`);
    mainWindow.loadURL(targetUrl);
  } else {
    debugBoot('loadFile dist/renderer/index.html');
    const filePath = path.join(app.getAppPath(), 'dist/renderer/index.html');
    if (initialDeepLinkHash) {
      mainWindow.loadFile(filePath, {
        hash: initialDeepLinkHash.slice(1),
      });
    } else {
      mainWindow.loadFile(filePath);
    }
  }

  mainWindow.once('ready-to-show', () => {
    debugBoot('ready-to-show');
    if (IS_DEV) {
      console.log('[main] Окно готово, показываю приложение');
    }
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(
      `[main] Не удалось загрузить окно: code=${errorCode} ${errorDescription}; url=${validatedURL}`,
    );
  });

  mainWindow.webContents.on('did-finish-load', () => {
    flushPendingExternalDeepLink();
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[main] Renderer process завершился:', details?.reason || 'unknown');
  });

}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForRendererReady(windowRef, timeoutMs = 20000) {
  const script = `
    new Promise((resolve, reject) => {
      const timeoutAt = Date.now() + ${Number(timeoutMs)};
      const check = () => {
        const root = document.querySelector('#app .app-root');
        const tabs = document.querySelector('[role="tablist"]');
        if (root && tabs) {
          if (document.fonts?.ready?.then) {
            document.fonts.ready.then(() => {
              requestAnimationFrame(() => resolve(true));
            }).catch(() => resolve(true));
            return;
          }
          requestAnimationFrame(() => resolve(true));
          return;
        }

        if (Date.now() >= timeoutAt) {
          reject(new Error('UI не успела инициализироваться.'));
          return;
        }

        setTimeout(check, 120);
      };

      check();
    });
  `;

  await windowRef.webContents.executeJavaScript(script, true);
}

async function waitForSelector(windowRef, selector, timeoutMs = 10000) {
  const script = `
    new Promise((resolve) => {
      const timeoutAt = Date.now() + ${Number(timeoutMs)};
      const target = ${JSON.stringify(String(selector || ''))};
      const check = () => {
        if (document.querySelector(target)) {
          resolve(true);
          return;
        }
        if (Date.now() >= timeoutAt) {
          resolve(false);
          return;
        }
        setTimeout(check, 120);
      };
      check();
    });
  `;

  return Boolean(await windowRef.webContents.executeJavaScript(script, true));
}

async function waitForReaderIdle(windowRef, timeoutMs = 18000) {
  const script = `
    new Promise((resolve) => {
      const timeoutAt = Date.now() + ${Number(timeoutMs)};
      const check = () => {
        const host = document.querySelector('#reader-webviewer-host');
        const hasIframe = Boolean(host && host.querySelector('iframe'));
        const hasViewerContent = Boolean(host && (host.childElementCount > 0 || hasIframe));
        const pageInput = document.querySelector('.reader-page-label input');
        const readerTitle = document.querySelector('.reader-header-main h1');
        const hasReaderMeta = Boolean(pageInput && String(pageInput.value || '').trim() && readerTitle);
        const loadingOverlay = document.querySelector('.reader-overlay:not(.error)');
        const errorOverlay = document.querySelector('.reader-overlay.error');
        const isReady = Boolean(host && !loadingOverlay && (hasViewerContent || hasReaderMeta));
        if (isReady) {
          resolve({
            ready: true,
            error: Boolean(errorOverlay),
            hasHost: Boolean(host),
            hasViewerContent,
            hasIframe,
            hasReaderMeta,
            loadingOverlay: Boolean(loadingOverlay),
          });
          return;
        }
        if (Date.now() >= timeoutAt) {
          resolve({
            ready: false,
            error: Boolean(errorOverlay),
            hasHost: Boolean(host),
            hasViewerContent,
            hasIframe,
            hasReaderMeta,
            loadingOverlay: Boolean(loadingOverlay),
          });
          return;
        }
        setTimeout(check, 180);
      };

      check();
    });
  `;

  return windowRef.webContents.executeJavaScript(script, true);
}

async function readReaderUiState(windowRef) {
  const script = `
    (() => {
      const pageInput = document.querySelector('.reader-page-label input');
      const titleNode = document.querySelector('.reader-header-main h1');
      const progressNode = document.querySelector('.reader-header-main .muted');
      return {
        pageInput: pageInput ? String(pageInput.value || '') : '',
        title: titleNode ? String(titleNode.textContent || '').trim() : '',
        progressText: progressNode ? String(progressNode.textContent || '').trim() : '',
      };
    })();
  `;

  return windowRef.webContents.executeJavaScript(script, true);
}

async function readHighlightsUiState(windowRef) {
  const script = `
    (() => {
      const highlightItems = Array.from(document.querySelectorAll('.highlights-list .highlight-item'));
      const jumpButtons = Array.from(document.querySelectorAll('button'))
        .filter((node) => String(node.textContent || '').replace(/\\s+/g, ' ').trim() === 'Перейти');
      const emptyState = document.querySelector('.highlights-groups .empty-state');
      return {
        highlightItems: highlightItems.length,
        jumpButtons: jumpButtons.length,
        hasEmptyState: Boolean(emptyState),
      };
    })();
  `;

  return windowRef.webContents.executeJavaScript(script, true);
}

async function clickButtonByText(windowRef, text) {
  const script = `
    (() => {
      const target = ${JSON.stringify(String(text || ''))};
      const normalize = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
      const nodes = Array.from(document.querySelectorAll('button, [role="button"], [role="tab"]'));
      const match = nodes.find((node) => {
        if (node instanceof HTMLButtonElement && node.disabled) {
          return false;
        }
        if (String(node.getAttribute('aria-disabled') || '') === 'true') {
          return false;
        }
        return normalize(node.textContent) === target;
      });
      if (!match) {
        return false;
      }
      match.click();
      return true;
    })();
  `;

  return Boolean(await windowRef.webContents.executeJavaScript(script, true));
}

async function captureWindow(windowRef, outputDir, fileName) {
  await fs.mkdir(outputDir, { recursive: true });
  const targetPath = path.join(outputDir, fileName);
  const image = await windowRef.webContents.capturePage();
  await fs.writeFile(targetPath, image.toPNG());
  return targetPath;
}

async function waitForPaint(windowRef, frames = 2) {
  const safeFrames = Math.max(1, Math.trunc(Number(frames || 1)));
  const script = `
    new Promise((resolve) => {
      let remaining = ${safeFrames};
      const next = () => {
        if (remaining <= 0) {
          resolve(true);
          return;
        }
        remaining -= 1;
        requestAnimationFrame(next);
      };
      next();
    });
  `;
  await windowRef.webContents.executeJavaScript(script, true);
}

async function readTopTabsState(windowRef) {
  const script = `
    (() => {
      return Array.from(document.querySelectorAll('[role="tab"]')).map((node) => ({
        text: String(node.textContent || '').trim(),
        ariaSelected: String(node.getAttribute('aria-selected') || ''),
        dataActive: String(node.getAttribute('data-active') || ''),
        className: String(node.className || ''),
        disabled: Boolean(node.hasAttribute('disabled')),
      }));
    })();
  `;

  return windowRef.webContents.executeJavaScript(script, true);
}

async function runUiSnapshotMode() {
  const outputDir =
    String(process.env.RECALL_UI_SNAP_OUT_DIR || '').trim() ||
    path.join(app.getPath('temp'), `recall-ui-snap-${timestampForFile()}`);

  storagePaths = await ensureStorage(app.getPath('userData'));
  registerIpc();

  const windowRef = new BrowserWindow({
    width: 1540,
    height: 980,
    show: true,
    backgroundColor: '#f6f6f4',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  const manifest = {
    createdAt: new Date().toISOString(),
    outputDir,
    captures: [],
    notes: [],
    tabsState: {},
    readerState: {},
    highlightsState: {},
  };

  let snapError = null;

  try {
    if (process.env.VITE_DEV_SERVER_URL) {
      await windowRef.loadURL(process.env.VITE_DEV_SERVER_URL);
    } else {
      await windowRef.loadFile(path.join(app.getAppPath(), 'dist/renderer/index.html'));
    }

    await waitForRendererReady(windowRef);
    await sleep(500);
    await waitForPaint(windowRef, 3);
    manifest.tabsState.library = await readTopTabsState(windowRef);

    const libraryCapture = await captureWindow(windowRef, outputDir, '01-library.png');
    manifest.captures.push(libraryCapture);

    const openedReader = await clickButtonByText(windowRef, 'Открыть');
    if (!openedReader) {
      manifest.notes.push('Кнопка "Открыть" не найдена. Вероятно, библиотека пуста.');
    } else {
      await waitForSelector(windowRef, '#reader-webviewer-host', 14000);
      const readerIdle = await waitForReaderIdle(windowRef, 22000);
      manifest.readerState.readerFirstOpen = {
        ...(readerIdle || {}),
        ...(await readReaderUiState(windowRef)),
      };
      if (!readerIdle?.ready) {
        manifest.notes.push('Reader не перешёл в готовое состояние перед первым скриншотом.');
      }
      await sleep(600);
      await waitForPaint(windowRef, 3);
      manifest.tabsState.reader = await readTopTabsState(windowRef);
      const readerCapture = await captureWindow(windowRef, outputDir, '02-reader.png');
      manifest.captures.push(readerCapture);

      const openedHighlights =
        (await clickButtonByText(windowRef, 'Вкладка хайлайтов')) ||
        (await clickButtonByText(windowRef, 'Хайлайты'));

      if (!openedHighlights) {
        manifest.notes.push('Не удалось переключиться на экран хайлайтов.');
      } else {
        await waitForSelector(windowRef, '.highlights-filters', 9000);
        await sleep(550);
        await waitForPaint(windowRef, 3);
        manifest.tabsState.highlights = await readTopTabsState(windowRef);
        manifest.highlightsState = await readHighlightsUiState(windowRef);
        const highlightsCapture = await captureWindow(windowRef, outputDir, '03-highlights.png');
        manifest.captures.push(highlightsCapture);
        manifest.tabsState.highlightsAfterCapture = await readTopTabsState(windowRef);

        const hasJumpTargets = Number(manifest.highlightsState?.jumpButtons || 0) > 0;
        if (!hasJumpTargets) {
          manifest.readerState.jumpFromHighlightsClicked = false;
          manifest.notes.push('Переход по хайлайту пропущен: нет карточек с кнопкой "Перейти".');
        } else {
          const jumpedFromHighlights = await clickButtonByText(windowRef, 'Перейти');
          manifest.readerState.jumpFromHighlightsClicked = jumpedFromHighlights;
          if (jumpedFromHighlights) {
            await waitForSelector(windowRef, '#reader-webviewer-host', 9000);
            const readerIdleAfterJump = await waitForReaderIdle(windowRef, 18000);
            manifest.readerState.afterHighlightJump = {
              ...(readerIdleAfterJump || {}),
              ...(await readReaderUiState(windowRef)),
            };
            await sleep(420);
            await waitForPaint(windowRef, 3);
            manifest.tabsState.readerAfterJump = await readTopTabsState(windowRef);
            const readerAfterJumpCapture = await captureWindow(
              windowRef,
              outputDir,
              '04-reader-after-highlight-jump.png',
            );
            manifest.captures.push(readerAfterJumpCapture);
          } else {
            manifest.notes.push('Не удалось нажать кнопку "Перейти" на экране хайлайтов.');
          }
        }
      }
    }
    console.log(`[ui:snap] Скриншоты сохранены в ${outputDir}`);
  } catch (error) {
    snapError = error;
    manifest.notes.push(`UI snap error: ${String(error?.message || error)}`);
  } finally {
    try {
      await fs.writeFile(
        path.join(outputDir, 'manifest.json'),
        JSON.stringify(manifest, null, 2),
        'utf8',
      );
    } catch (manifestError) {
      console.error('[ui:snap] Не удалось сохранить manifest:', manifestError);
    }

    if (!windowRef.isDestroyed()) {
      windowRef.destroy();
    }
  }

  if (snapError) {
    throw snapError;
  }
}

function registerTrustedIpcHandle(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrustedIpcSender(event, channel);
    try {
      return await handler(event, ...args);
    } catch (error) {
      const fallbackCode = `E_IPC_${String(channel).replace(/[^A-Za-z0-9]+/g, '_').toUpperCase()}`;
      throw ensureAppError(error, fallbackCode);
    }
  });
}

function filterBundleDocuments(documents, documentIds) {
  const normalizedIds = Array.isArray(documentIds)
    ? [...new Set(documentIds.map((id) => String(id)).filter(Boolean))]
    : [];

  if (normalizedIds.length === 0) {
    return [...documents];
  }

  const allowed = new Set(normalizedIds);
  return documents.filter((document) => allowed.has(String(document.id)));
}

function registerIpc() {
  registerTrustedIpcHandle(IPC_CHANNELS.LIBRARY_LIST_DOCUMENTS, async () => {
    return listDocuments(storagePaths);
  });

  registerTrustedIpcHandle(IPC_CHANNELS.LIBRARY_IMPORT_PDF, async () => {
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

  registerTrustedIpcHandle(IPC_CHANNELS.LIBRARY_IMPORT_PDF_PATHS, async (_event, payload) => {
    const validated = validateChannelPayload(IPC_CHANNELS.LIBRARY_IMPORT_PDF_PATHS, payload);
    const paths = Array.isArray(validated?.paths)
      ? validated.paths.map((item) => String(item)).filter(Boolean)
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

  registerTrustedIpcHandle(IPC_CHANNELS.LIBRARY_UPDATE_DOCUMENT_META, async (_event, payload) => {
    const validated = validateChannelPayload(IPC_CHANNELS.LIBRARY_UPDATE_DOCUMENT_META, payload);
    const patch = pickOwnProps(validated, ['isPinned', 'collectionId']);
    return updateDocumentMeta(storagePaths, validated.documentId, patch);
  });

  registerTrustedIpcHandle(IPC_CHANNELS.LIBRARY_DELETE_DOCUMENT, async (_event, documentId) => {
    const id = String(documentId ?? '');
    if (!id) {
      throw new Error('Не передан идентификатор документа.');
    }

    return deleteDocument(storagePaths, id);
  });

  registerTrustedIpcHandle(IPC_CHANNELS.LIBRARY_RESET_READING_STATE, async (_event, payload) => {
    const validated = validateChannelPayload(IPC_CHANNELS.LIBRARY_RESET_READING_STATE, payload);
    return resetDocumentReadingState(storagePaths, validated.documentId);
  });

  registerTrustedIpcHandle(IPC_CHANNELS.DOCUMENT_GET, async (_event, documentId) => {
    return getDocumentById(storagePaths, String(documentId));
  });

  registerTrustedIpcHandle(IPC_CHANNELS.DOCUMENT_UPDATE_READING_STATE, async (_event, payload) => {
    const validated = validateChannelPayload(IPC_CHANNELS.DOCUMENT_UPDATE_READING_STATE, payload);
    return updateDocumentReadingState(storagePaths, validated.documentId, {
      pageIndex: validated.pageIndex,
      totalPages: validated.totalPages,
      scale: validated.scale,
      lastOpenedAt: validated.lastOpenedAt,
      readingSeconds: validated.readingSeconds,
      pagesDelta: validated.pagesDelta,
      allowFirstPage: validated.allowFirstPage,
    });
  });

  registerTrustedIpcHandle(IPC_CHANNELS.DOCUMENT_READ_PDF_BYTES, async (_event, documentId) => {
    const document = await getDocumentById(storagePaths, String(documentId));

    if (!document) {
      throw new Error('Документ не найден.');
    }

    return fs.readFile(document.filePath);
  });

  registerTrustedIpcHandle(IPC_CHANNELS.HIGHLIGHT_LIST, async (_event, payload) => {
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

  registerTrustedIpcHandle(IPC_CHANNELS.HIGHLIGHT_LIST_ALL, async (_event, payload) => {
    return listAllHighlights(storagePaths, {
      documentId: payload?.documentId,
      since: payload?.since,
      tags: payload?.tags,
      ids: payload?.ids,
    });
  });

  registerTrustedIpcHandle(IPC_CHANNELS.HIGHLIGHT_ADD, async (_event, payload) => {
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

  registerTrustedIpcHandle(IPC_CHANNELS.HIGHLIGHT_UPDATE, async (_event, payload) => {
    const validated = validateChannelPayload(IPC_CHANNELS.HIGHLIGHT_UPDATE, payload);

    const patch = pickOwnProps(validated, [
      'pageIndex',
      'rects',
      'selectedText',
      'selectedRichText',
      'color',
      'note',
      'tags',
    ]);

    return updateHighlight(storagePaths, validated.id, patch);
  });

  registerTrustedIpcHandle(IPC_CHANNELS.HIGHLIGHT_DELETE, async (_event, highlightId) => {
    const id = String(highlightId ?? '');
    if (!id) {
      throw new Error('Не передан идентификатор выделения.');
    }

    return deleteHighlight(storagePaths, id);
  });

  registerTrustedIpcHandle(IPC_CHANNELS.HIGHLIGHT_DELETE_MANY, async (_event, payload) => {
    const validated = validateChannelPayload(IPC_CHANNELS.HIGHLIGHT_DELETE_MANY, payload);
    const ids = normalizeIds(validated?.ids);
    return deleteHighlightsByIds(storagePaths, ids);
  });

  registerTrustedIpcHandle(IPC_CHANNELS.BOOKMARK_LIST, async (_event, documentId) => {
    return listBookmarks(storagePaths, String(documentId ?? ''));
  });

  registerTrustedIpcHandle(IPC_CHANNELS.BOOKMARK_ADD, async (_event, payload) => {
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

  registerTrustedIpcHandle(IPC_CHANNELS.BOOKMARK_UPDATE, async (_event, payload) => {
    const validated = validateChannelPayload(IPC_CHANNELS.BOOKMARK_UPDATE, payload);
    const patch = pickOwnProps(validated, ['pageIndex', 'label']);
    return updateBookmark(storagePaths, validated.id, patch);
  });

  registerTrustedIpcHandle(IPC_CHANNELS.BOOKMARK_DELETE, async (_event, bookmarkId) => {
    return deleteBookmark(storagePaths, String(bookmarkId ?? ''));
  });

  registerTrustedIpcHandle(IPC_CHANNELS.BOOKMARK_DELETE_MANY, async (_event, payload) => {
    const validated = validateChannelPayload(IPC_CHANNELS.BOOKMARK_DELETE_MANY, payload);
    const ids = normalizeIds(validated?.ids);
    return deleteBookmarksByIds(storagePaths, ids);
  });

  registerTrustedIpcHandle(IPC_CHANNELS.COLLECTION_LIST, async () => {
    return listCollections(storagePaths);
  });

  registerTrustedIpcHandle(IPC_CHANNELS.COLLECTION_CREATE, async (_event, payload) => {
    const validated = validateChannelPayload(IPC_CHANNELS.COLLECTION_CREATE, payload);
    return createCollection(storagePaths, {
      id: validated?.id || crypto.randomUUID(),
      name: validated?.name,
    });
  });

  registerTrustedIpcHandle(IPC_CHANNELS.COLLECTION_UPDATE, async (_event, payload) => {
    const validated = validateChannelPayload(IPC_CHANNELS.COLLECTION_UPDATE, payload);
    return updateCollection(storagePaths, validated.id, {
      name: validated.name,
    });
  });

  registerTrustedIpcHandle(IPC_CHANNELS.COLLECTION_DELETE, async (_event, collectionId) => {
    return deleteCollection(storagePaths, String(collectionId ?? ''));
  });

  registerTrustedIpcHandle(IPC_CHANNELS.SETTINGS_GET, async () => {
    return getSettings(storagePaths);
  });

  registerTrustedIpcHandle(IPC_CHANNELS.SETTINGS_UPDATE, async (_event, payload) => {
    return updateSettings(storagePaths, payload || {});
  });

  registerTrustedIpcHandle(IPC_CHANNELS.READING_GET_OVERVIEW, async () => {
    return getReadingOverview(storagePaths);
  });

  registerTrustedIpcHandle(IPC_CHANNELS.EXPORT_MARKDOWN, async (_event, documentId) => {
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

  registerTrustedIpcHandle(IPC_CHANNELS.EXPORT_MARKDOWN_CUSTOM, async (_event, payload) => {
    const validated = validateChannelPayload(IPC_CHANNELS.EXPORT_MARKDOWN_CUSTOM, payload);
    const document = await getDocumentById(storagePaths, validated.documentId);
    if (!document) {
      throw new Error('Документ не найден.');
    }

    const highlights = await listHighlights(storagePaths, document.id, {
      ids: validated.highlightIds,
      since: validated.since,
      tags: validated.tags,
    });
    const markdownTitle = sanitizeFileName(validated.title || document.title) || document.title;
    const markdown = buildHighlightsMarkdown(markdownTitle, highlights);

    const defaultBaseName = getDefaultExportBaseName(document);
    const suffix = validated.suffix ? `-${sanitizeFileName(validated.suffix)}` : '-custom';
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

  registerTrustedIpcHandle(IPC_CHANNELS.EXPORT_ANNOTATED_PDF, async (_event, documentId) => {
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

  registerTrustedIpcHandle(IPC_CHANNELS.EXPORT_OBSIDIAN_BUNDLE, async (_event, payload) => {
    const validated = validateChannelPayload(IPC_CHANNELS.EXPORT_OBSIDIAN_BUNDLE, payload || {});
    const db = await loadDB(storagePaths);
    const documents = filterBundleDocuments(db.documents, validated.documentIds);
    if (documents.length === 0) {
      throw new Error('Нет документов для экспорта.');
    }

    const documentIdSet = new Set(documents.map((item) => item.id));
    const highlights = db.highlights.filter((item) => documentIdSet.has(item.documentId));

    const srsDeck = generateSrsDeck(db, {
      documentIds: [...documentIdSet],
      dueOnly: false,
      limit: 800,
    });
    const dailyDigest = buildReadingDigest(db, {
      period: 'daily',
      documentIds: [...documentIdSet],
    });
    const weeklyDigest = buildReadingDigest(db, {
      period: 'weekly',
      documentIds: [...documentIdSet],
    });
    const graph = buildKnowledgeGraph(db, {
      documentIds: [...documentIdSet],
      topConcepts: 96,
      minEdgeWeight: 2,
    });

    const files = buildObsidianBundleFiles({
      documents,
      highlights,
      srsDeck,
      dailyDigest,
      weeklyDigest,
      graph,
    });

    const pick = await dialog.showOpenDialog({
      title: 'Выберите папку для Obsidian bundle',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (pick.canceled || pick.filePaths.length === 0) {
      return { canceled: true };
    }

    const written = await writeBundleFiles(
      pick.filePaths[0],
      `recall-obsidian-bundle-${timestampForFile()}`,
      files,
    );

    return {
      canceled: false,
      bundlePath: written.bundlePath,
      fileCount: written.fileCount,
      documentCount: documents.length,
    };
  });

  registerTrustedIpcHandle(IPC_CHANNELS.EXPORT_NOTION_BUNDLE, async (_event, payload) => {
    const validated = validateChannelPayload(IPC_CHANNELS.EXPORT_NOTION_BUNDLE, payload || {});
    const db = await loadDB(storagePaths);
    const documents = filterBundleDocuments(db.documents, validated.documentIds);
    if (documents.length === 0) {
      throw new Error('Нет документов для экспорта.');
    }

    const documentIdSet = new Set(documents.map((item) => item.id));
    const highlights = db.highlights.filter((item) => documentIdSet.has(item.documentId));

    const srsDeck = generateSrsDeck(db, {
      documentIds: [...documentIdSet],
      dueOnly: false,
      limit: 800,
    });
    const dailyDigest = buildReadingDigest(db, {
      period: 'daily',
      documentIds: [...documentIdSet],
    });
    const weeklyDigest = buildReadingDigest(db, {
      period: 'weekly',
      documentIds: [...documentIdSet],
    });
    const graph = buildKnowledgeGraph(db, {
      documentIds: [...documentIdSet],
      topConcepts: 96,
      minEdgeWeight: 2,
    });

    const files = buildNotionBundleFiles({
      documents,
      highlights,
      srsDeck,
      dailyDigest,
      weeklyDigest,
      graph,
    });

    const pick = await dialog.showOpenDialog({
      title: 'Выберите папку для Notion bundle',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (pick.canceled || pick.filePaths.length === 0) {
      return { canceled: true };
    }

    const written = await writeBundleFiles(
      pick.filePaths[0],
      `recall-notion-bundle-${timestampForFile()}`,
      files,
    );

    return {
      canceled: false,
      bundlePath: written.bundlePath,
      fileCount: written.fileCount,
      documentCount: documents.length,
    };
  });

  registerTrustedIpcHandle(IPC_CHANNELS.INSIGHTS_GENERATE_SRS, async (_event, payload) => {
    const validated = validateChannelPayload(IPC_CHANNELS.INSIGHTS_GENERATE_SRS, payload || {});
    const db = await loadDB(storagePaths);
    return generateSrsDeck(db, validated);
  });

  registerTrustedIpcHandle(IPC_CHANNELS.INSIGHTS_BUILD_DIGEST, async (_event, payload) => {
    const validated = validateChannelPayload(IPC_CHANNELS.INSIGHTS_BUILD_DIGEST, payload || {});
    const db = await loadDB(storagePaths);
    return buildReadingDigest(db, validated);
  });

  registerTrustedIpcHandle(IPC_CHANNELS.INSIGHTS_BUILD_GRAPH, async (_event, payload) => {
    const validated = validateChannelPayload(IPC_CHANNELS.INSIGHTS_BUILD_GRAPH, payload || {});
    const db = await loadDB(storagePaths);
    return buildKnowledgeGraph(db, validated);
  });

  registerTrustedIpcHandle(IPC_CHANNELS.INSIGHTS_ASK_LIBRARY, async (_event, payload) => {
    const validated = validateChannelPayload(IPC_CHANNELS.INSIGHTS_ASK_LIBRARY, payload || {});
    const db = await loadDB(storagePaths);
    return askLibrary(db, validated);
  });

  registerTrustedIpcHandle(IPC_CHANNELS.INSIGHTS_SUMMARIZE_HIGHLIGHTS, async (_event, payload) => {
    const validated = validateChannelPayload(
      IPC_CHANNELS.INSIGHTS_SUMMARIZE_HIGHLIGHTS,
      payload || {},
    );
    const db = await loadDB(storagePaths);
    return summarizeHighlights(db, validated);
  });

  registerTrustedIpcHandle(IPC_CHANNELS.INSIGHTS_REVIEW_HIGHLIGHT, async (_event, payload) => {
    const validated = validateChannelPayload(IPC_CHANNELS.INSIGHTS_REVIEW_HIGHLIGHT, payload || {});
    const db = await loadDB(storagePaths);
    const highlight = db.highlights.find((item) => item.id === validated.highlightId);
    if (!highlight) {
      throw new Error('Хайлайт для review не найден.');
    }

    const patch = applySrsReviewGrade(highlight, {
      grade: validated.grade,
      nowIso: validated.nowIso,
    });
    return updateHighlight(storagePaths, validated.highlightId, patch);
  });

  registerTrustedIpcHandle(IPC_CHANNELS.INSIGHTS_AI_ASSISTANT, async (_event, payload) => {
    const validated = validateChannelPayload(IPC_CHANNELS.INSIGHTS_AI_ASSISTANT, payload || {});
    const db = await loadDB(storagePaths);
    return generateAiAssistantBrief(db, {
      documentId: validated.documentId,
      documentIds: validated.documentIds,
      question: validated.question,
      task: validated.task,
      mode: validated.mode,
      maxEvidence: validated.maxEvidence,
      maxActions: validated.maxActions,
      provider: 'api',
    });
  });

  registerTrustedIpcHandle(IPC_CHANNELS.APP_GET_STORAGE_PATHS, () => {
    return getStoragePaths(storagePaths);
  });

  registerTrustedIpcHandle(IPC_CHANNELS.APP_BACKUP_DATA, async () => {
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

  registerTrustedIpcHandle(IPC_CHANNELS.APP_RESTORE_DATA, async () => {
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

  registerTrustedIpcHandle(IPC_CHANNELS.APP_REVEAL_USER_DATA, async () => {
    await shell.openPath(storagePaths.userDataPath);
    return { ok: true };
  });

  registerTrustedIpcHandle(IPC_CHANNELS.DIAGNOSTICS_SET_TRAY_CAPTURE, async (_event, payload) => {
    const validated = validateChannelPayload(IPC_CHANNELS.DIAGNOSTICS_SET_TRAY_CAPTURE, payload);
    return setDiagnosticsTrayCapture(Boolean(validated.enabled));
  });

  registerTrustedIpcHandle(IPC_CHANNELS.DIAGNOSTICS_PUSH_EVENTS, async (_event, payload) => {
    const validated = validateChannelPayload(IPC_CHANNELS.DIAGNOSTICS_PUSH_EVENTS, payload);
    return appendDiagnosticsEvents(validated.events);
  });
}

function startApp() {
  const singleInstanceLock = app.requestSingleInstanceLock();
  if (!singleInstanceLock) {
    app.quit();
    return;
  }

  pendingExternalDeepLink = findExternalDeepLink(process.argv);

  app.on('second-instance', (_event, argv) => {
    const externalLink = findExternalDeepLink(argv);
    if (externalLink) {
      handleExternalDeepLink(externalLink);
      return;
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.on('open-url', (event, rawLink) => {
    event.preventDefault();
    handleExternalDeepLink(rawLink);
  });

  app
    .whenReady()
    .then(async () => {
      debugBoot('app.whenReady resolved');
      try {
        app.setAsDefaultProtocolClient('recall');
      } catch {
        // ignore protocol registration failures
      }
      if (IS_DEV) {
        console.log('[main] App готов, инициализирую storage и окно');
      }
      storagePaths = await ensureStorage(app.getPath('userData'));
      debugBoot(`storage ready at ${storagePaths.userDataPath}`);
      if (IS_DEV) {
        console.log('[main] Storage готов:', storagePaths.userDataPath);
      }
      initializeDiagnosticsTray({
        appName: 'Recall PDF',
        userDataPath: storagePaths.userDataPath,
        onOpenMainWindow: () => {
          focusMainWindow();
        },
      });
      registerIpc();
      debugBoot('ipc registered');
      createMainWindow();
      flushPendingExternalDeepLink();

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
          createMainWindow();
        } else {
          flushPendingExternalDeepLink();
        }
      });
    })
    .catch((error) => {
      debugBoot(`startup error: ${error?.stack || error?.message || error}`);
      console.error('[main] Критическая ошибка старта:', error);
      try {
        app.quit();
      } catch {
        // ignore
      }
    });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

if (IS_UI_SNAP) {
  app
    .whenReady()
    .then(() => runUiSnapshotMode())
    .then(() => {
      app.quit();
    })
    .catch((error) => {
      console.error('[ui:snap] Ошибка создания скриншотов:', error);
      try {
        app.exit(1);
      } catch {
        // ignore
      }
    });
} else {
  startApp();
}

module.exports = {
  startApp,
  __private: {
    sanitizeFileName,
    getDefaultExportBaseName,
    timestampForFile,
    normalizeIds,
    pickOwnProps,
    isTrustedIpcSender,
    assertTrustedIpcSender,
  },
};
