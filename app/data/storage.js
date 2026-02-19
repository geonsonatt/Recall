const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const DB_FILE_NAME = 'db.json';
const ALLOWED_COLORS = new Set(['yellow', 'green', 'pink']);
const ALLOWED_THEMES = new Set(['light', 'sepia', 'contrast']);

const DEFAULT_SETTINGS = {
  theme: 'light',
  focusMode: false,
  goals: {
    pagesPerDay: 20,
    pagesPerWeek: 140,
  },
  updates: {
    manifestUrl: '',
    autoCheck: true,
  },
  savedHighlightQueries: [],
};

const EMPTY_DB = {
  documents: [],
  highlights: [],
  bookmarks: [],
  collections: [],
  settings: {
    ...DEFAULT_SETTINGS,
    goals: { ...DEFAULT_SETTINGS.goals },
    updates: { ...DEFAULT_SETTINGS.updates },
    savedHighlightQueries: [...DEFAULT_SETTINGS.savedHighlightQueries],
  },
  readingLog: {},
};

function normalizeIsoString(value) {
  const iso = String(value ?? '').trim();
  if (!iso) {
    return undefined;
  }

  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) {
    return undefined;
  }

  return date.toISOString();
}

function normalizePositiveInt(value, fallback = 0) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) {
    return Math.max(0, Number(fallback) | 0);
  }
  return Math.max(0, Math.trunc(raw));
}

function normalizeScaleValue(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) {
    return undefined;
  }
  return Math.max(0.1, raw);
}

function normalizeText(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeHttpUrl(value) {
  const raw = normalizeText(value);
  if (!raw) {
    return '';
  }

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    return parsed.toString();
  } catch {
    return '';
  }
}

function repairPdfTextArtifacts(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/([\p{L}\p{N}])\u00ad\s*([\p{L}\p{N}])/gu, '$1$2')
    .replace(/\u00ad/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/([\p{L}\p{N}])[-‐‑]\s+([\p{L}\p{N}])/gu, '$1$2')
    .replace(/(^|[\s([{«"'])([БГДЖЗЙЛМНПРТФХЦЧШЩЬЪЫЭЮ])\s+([а-яё]{2,})/gu, '$1$2$3')
    .replace(/\s+([,.;:!?»)\]}\u2026])/g, '$1')
    .replace(/([«([{])\s+/g, '$1');
}

function normalizeHighlightText(value) {
  return normalizeText(
    repairPdfTextArtifacts(String(value ?? ''))
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n+/g, ' '),
  );
}

function normalizeRichText(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return undefined;
  }

  return raw.slice(0, 24000);
}

function decodeHtmlEntities(value) {
  return String(value ?? '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function richTextToPlainText(value) {
  const rich = normalizeRichText(value);
  if (!rich) {
    return '';
  }

  const withLineBreaks = rich
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<p[^>]*>/gi, '')
    .replace(/<\/div\s*>/gi, '\n')
    .replace(/<div[^>]*>/gi, '');
  const stripped = withLineBreaks.replace(/<[^>]+>/g, ' ');
  return normalizeHighlightText(decodeHtmlEntities(stripped));
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) {
    return [];
  }

  const unique = new Set();
  for (const rawTag of tags) {
    const tag = normalizeText(rawTag).slice(0, 40);
    if (!tag) {
      continue;
    }
    unique.add(tag);
  }

  return [...unique];
}

function clamp01(number) {
  if (Number.isNaN(number) || !Number.isFinite(number)) {
    return 0;
  }
  return Math.min(1, Math.max(0, number));
}

function normalizeRect(rect) {
  const x = clamp01(Number(rect?.x ?? 0));
  const y = clamp01(Number(rect?.y ?? 0));
  const w = clamp01(Number(rect?.w ?? 0));
  const h = clamp01(Number(rect?.h ?? 0));

  return { x, y, w, h };
}

function normalizeDocument(document) {
  const lastReadTotalPages = normalizePositiveInt(document?.lastReadTotalPages, 0);
  const normalizedTotalPages = lastReadTotalPages > 0 ? lastReadTotalPages : undefined;
  const rawLastReadPageIndex = normalizePositiveInt(document?.lastReadPageIndex, 0);
  const rawMaxReadPageIndex = normalizePositiveInt(
    document?.maxReadPageIndex,
    rawLastReadPageIndex,
  );
  const clampPage = (value) =>
    normalizedTotalPages
      ? Math.min(value, Math.max(0, normalizedTotalPages - 1))
      : value;
  const lastReadPageIndex = clampPage(rawLastReadPageIndex);
  const maxReadPageIndex = Math.max(lastReadPageIndex, clampPage(rawMaxReadPageIndex));
  const lastReadScale = normalizeScaleValue(document?.lastReadScale);
  const readingSeconds = normalizePositiveInt(document?.totalReadingSeconds, 0);
  const collectionId = normalizeText(document?.collectionId) || undefined;

  return {
    ...document,
    id: String(document?.id ?? ''),
    title: normalizeText(document?.title),
    filePath: String(document?.filePath ?? ''),
    createdAt: normalizeIsoString(document?.createdAt) || new Date().toISOString(),
    lastReadPageIndex,
    maxReadPageIndex,
    lastReadTotalPages: normalizedTotalPages,
    lastReadScale,
    lastOpenedAt: normalizeIsoString(document?.lastOpenedAt),
    totalReadingSeconds: readingSeconds,
    collectionId,
    isPinned: Boolean(document?.isPinned),
  };
}

function normalizeHighlight(highlight) {
  const normalizedColor = ALLOWED_COLORS.has(highlight?.color)
    ? highlight.color
    : 'yellow';

  const note = normalizeText(highlight?.note);
  const selectedRichText = normalizeRichText(highlight?.selectedRichText);
  const selectedText =
    normalizeHighlightText(highlight?.selectedText) || richTextToPlainText(selectedRichText);
  const reviewCount = normalizePositiveInt(highlight?.reviewCount, 0);
  const reviewIntervalDays = normalizePositiveInt(highlight?.reviewIntervalDays, 0);
  const lastReviewedAt = normalizeIsoString(highlight?.lastReviewedAt);
  const nextReviewAt = normalizeIsoString(highlight?.nextReviewAt);
  const reviewLastGradeRaw = normalizeText(highlight?.reviewLastGrade).toLowerCase();
  const reviewLastGrade =
    reviewLastGradeRaw === 'hard' ||
    reviewLastGradeRaw === 'good' ||
    reviewLastGradeRaw === 'easy'
      ? reviewLastGradeRaw
      : undefined;

  return {
    id: String(highlight?.id ?? ''),
    documentId: String(highlight?.documentId ?? ''),
    pageIndex: Math.max(0, Number(highlight?.pageIndex ?? 0) | 0),
    rects: Array.isArray(highlight?.rects)
      ? highlight.rects.map(normalizeRect).filter((rect) => rect.w > 0 && rect.h > 0)
      : [],
    selectedText,
    selectedRichText,
    color: normalizedColor,
    note: note || undefined,
    tags: normalizeTags(highlight?.tags),
    reviewCount,
    reviewIntervalDays,
    lastReviewedAt,
    nextReviewAt,
    reviewLastGrade,
    createdAt: normalizeIsoString(highlight?.createdAt) || new Date().toISOString(),
  };
}

function normalizeBookmark(bookmark) {
  return {
    id: String(bookmark?.id ?? ''),
    documentId: String(bookmark?.documentId ?? ''),
    pageIndex: normalizePositiveInt(bookmark?.pageIndex, 0),
    label: normalizeText(bookmark?.label) || undefined,
    createdAt: normalizeIsoString(bookmark?.createdAt) || new Date().toISOString(),
  };
}

function normalizeCollection(collection) {
  return {
    id: String(collection?.id ?? ''),
    name: normalizeText(collection?.name).slice(0, 80),
    createdAt: normalizeIsoString(collection?.createdAt) || new Date().toISOString(),
  };
}

function normalizeSavedHighlightQuery(item) {
  return {
    id: String(item?.id || crypto.randomUUID()),
    name: normalizeText(item?.name).slice(0, 80) || 'Поисковый пресет',
    query: normalizeText(item?.query).slice(0, 320),
    createdAt: normalizeIsoString(item?.createdAt) || new Date().toISOString(),
  };
}

function normalizeSavedHighlightQueries(list) {
  if (!Array.isArray(list)) {
    return [];
  }

  const result = [];
  const seenIds = new Set();
  for (const entry of list) {
    const normalized = normalizeSavedHighlightQuery(entry);
    if (!normalized.query) {
      continue;
    }
    if (seenIds.has(normalized.id)) {
      continue;
    }
    seenIds.add(normalized.id);
    result.push(normalized);
  }

  return result.slice(0, 30);
}

function normalizeSettings(settings) {
  const nextTheme = ALLOWED_THEMES.has(settings?.theme) ? settings.theme : DEFAULT_SETTINGS.theme;
  const pagesPerDay = Math.max(
    1,
    normalizePositiveInt(settings?.goals?.pagesPerDay, DEFAULT_SETTINGS.goals.pagesPerDay),
  );
  const pagesPerWeek = Math.max(
    pagesPerDay,
    normalizePositiveInt(settings?.goals?.pagesPerWeek, DEFAULT_SETTINGS.goals.pagesPerWeek),
  );
  const manifestFromEnv = normalizeHttpUrl(process.env.RECALL_UPDATE_MANIFEST_URL);
  const manifestUrl = normalizeHttpUrl(settings?.updates?.manifestUrl) || manifestFromEnv;

  return {
    theme: nextTheme,
    focusMode: Boolean(settings?.focusMode),
    goals: {
      pagesPerDay,
      pagesPerWeek,
    },
    updates: {
      manifestUrl,
      autoCheck:
        typeof settings?.updates?.autoCheck === 'boolean'
          ? settings.updates.autoCheck
          : DEFAULT_SETTINGS.updates.autoCheck,
    },
    savedHighlightQueries: normalizeSavedHighlightQueries(settings?.savedHighlightQueries),
  };
}

function normalizeDateKey(value) {
  const normalized = String(value ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return '';
  }
  return normalized;
}

function normalizeReadingLog(readingLog) {
  if (!readingLog || typeof readingLog !== 'object') {
    return {};
  }

  const normalized = {};
  for (const [key, entry] of Object.entries(readingLog)) {
    const dateKey = normalizeDateKey(key);
    if (!dateKey) {
      continue;
    }

    normalized[dateKey] = {
      pages: normalizePositiveInt(entry?.pages, 0),
      seconds: normalizePositiveInt(entry?.seconds, 0),
    };
  }

  return normalized;
}

function normalizeDBShape(parsed) {
  return {
    documents: (Array.isArray(parsed?.documents) ? parsed.documents : [])
      .map(normalizeDocument)
      .filter((doc) => doc.id && doc.title && doc.filePath),
    highlights: (Array.isArray(parsed?.highlights) ? parsed.highlights : [])
      .map(normalizeHighlight)
      .filter((highlight) => highlight.id && highlight.documentId),
    bookmarks: (Array.isArray(parsed?.bookmarks) ? parsed.bookmarks : [])
      .map(normalizeBookmark)
      .filter((bookmark) => bookmark.id && bookmark.documentId),
    collections: (Array.isArray(parsed?.collections) ? parsed.collections : [])
      .map(normalizeCollection)
      .filter((collection) => collection.id && collection.name),
    settings: normalizeSettings(parsed?.settings),
    readingLog: normalizeReadingLog(parsed?.readingLog),
  };
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function atomicWriteJson(filePath, value) {
  const tempFilePath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const json = JSON.stringify(value, null, 2);
  await fs.writeFile(tempFilePath, json, 'utf8');
  await fs.rename(tempFilePath, filePath);
}

async function ensureStorage(userDataPath) {
  const documentsDir = path.join(userDataPath, 'documents');
  const exportsDir = path.join(userDataPath, 'exports');
  const backupDir = path.join(userDataPath, 'backups');
  const dbPath = path.join(userDataPath, DB_FILE_NAME);

  await Promise.all([
    fs.mkdir(userDataPath, { recursive: true }),
    fs.mkdir(documentsDir, { recursive: true }),
    fs.mkdir(exportsDir, { recursive: true }),
    fs.mkdir(backupDir, { recursive: true }),
  ]);

  if (!(await fileExists(dbPath))) {
    await atomicWriteJson(dbPath, EMPTY_DB);
  }

  return {
    userDataPath,
    documentsDir,
    exportsDir,
    backupDir,
    dbPath,
  };
}

async function loadDB(storagePaths) {
  const raw = await fs.readFile(storagePaths.dbPath, 'utf8');

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Некорректный формат базы данных');
    }

    return normalizeDBShape(parsed);
  } catch {
    const corruptPath = `${storagePaths.dbPath}.corrupt.${Date.now()}`;
    await fs.writeFile(corruptPath, raw, 'utf8');
    await atomicWriteJson(storagePaths.dbPath, EMPTY_DB);
    return {
      ...EMPTY_DB,
      settings: {
        ...DEFAULT_SETTINGS,
        goals: { ...DEFAULT_SETTINGS.goals },
        updates: { ...DEFAULT_SETTINGS.updates },
        savedHighlightQueries: [...DEFAULT_SETTINGS.savedHighlightQueries],
      },
    };
  }
}

async function saveDB(storagePaths, db) {
  await atomicWriteJson(storagePaths.dbPath, normalizeDBShape(db));
}

function buildHighlightsCountMap(highlights) {
  const map = new Map();
  for (const highlight of highlights) {
    map.set(highlight.documentId, (map.get(highlight.documentId) ?? 0) + 1);
  }
  return map;
}

function buildBookmarksCountMap(bookmarks) {
  const map = new Map();
  for (const bookmark of bookmarks) {
    map.set(bookmark.documentId, (map.get(bookmark.documentId) ?? 0) + 1);
  }
  return map;
}

function enrichDocument(doc, countMap, bookmarkMap) {
  return {
    ...doc,
    highlightsCount: countMap.get(doc.id) ?? 0,
    bookmarksCount: bookmarkMap.get(doc.id) ?? 0,
  };
}

function sortDocumentsForLibrary(documents) {
  return [...documents].sort((a, b) => {
    if (a.isPinned !== b.isPinned) {
      return a.isPinned ? -1 : 1;
    }

    const aLast = new Date(a.lastOpenedAt || a.createdAt).valueOf();
    const bLast = new Date(b.lastOpenedAt || b.createdAt).valueOf();
    return bLast - aLast;
  });
}

async function listDocuments(storagePaths) {
  const db = await loadDB(storagePaths);
  const countMap = buildHighlightsCountMap(db.highlights);
  const bookmarkMap = buildBookmarksCountMap(db.bookmarks);

  return sortDocumentsForLibrary(
    db.documents.map((doc) => enrichDocument(doc, countMap, bookmarkMap)),
  );
}

async function getDocumentById(storagePaths, documentId) {
  const db = await loadDB(storagePaths);
  const doc = db.documents.find((item) => item.id === String(documentId));
  if (!doc) {
    return null;
  }

  const countMap = buildHighlightsCountMap(db.highlights);
  const bookmarkMap = buildBookmarksCountMap(db.bookmarks);
  return enrichDocument(doc, countMap, bookmarkMap);
}

function filterHighlights(highlights, options = {}) {
  const documentId = normalizeText(options.documentId);
  const sinceIso = normalizeIsoString(options.since);
  const tagFilter = normalizeTags(options.tags);
  const idSet = Array.isArray(options.ids)
    ? new Set(options.ids.map((id) => String(id)))
    : null;

  let filtered = highlights;

  if (documentId) {
    filtered = filtered.filter((item) => item.documentId === documentId);
  }

  if (sinceIso) {
    const sinceTs = new Date(sinceIso).valueOf();
    filtered = filtered.filter((item) => new Date(item.createdAt).valueOf() >= sinceTs);
  }

  if (idSet) {
    filtered = filtered.filter((item) => idSet.has(item.id));
  }

  if (tagFilter.length > 0) {
    filtered = filtered.filter((item) => {
      const itemTags = normalizeTags(item.tags);
      return tagFilter.every((tag) => itemTags.includes(tag));
    });
  }

  return filtered;
}

function sortHighlights(highlights) {
  return [...highlights].sort((a, b) => {
    if (a.pageIndex === b.pageIndex) {
      return new Date(a.createdAt).valueOf() - new Date(b.createdAt).valueOf();
    }
    return a.pageIndex - b.pageIndex;
  });
}

async function listHighlights(storagePaths, documentId, options = {}) {
  const db = await loadDB(storagePaths);

  const filtered = filterHighlights(db.highlights, {
    ...options,
    documentId,
  });

  return sortHighlights(filtered);
}

async function listAllHighlights(storagePaths, options = {}) {
  const db = await loadDB(storagePaths);
  return sortHighlights(filterHighlights(db.highlights, options));
}

async function upsertDocument(storagePaths, document) {
  const db = await loadDB(storagePaths);
  const normalized = normalizeDocument(document);
  const index = db.documents.findIndex((item) => item.id === normalized.id);

  if (index >= 0) {
    const existing = db.documents[index];
    db.documents[index] = {
      ...existing,
      ...normalized,
      createdAt: existing.createdAt,
    };
  } else {
    db.documents.push(normalized);
  }

  await saveDB(storagePaths, db);
  return getDocumentById(storagePaths, normalized.id);
}

async function updateDocumentMeta(storagePaths, documentId, patch = {}) {
  const id = String(documentId ?? '');
  if (!id) {
    throw new Error('Не передан идентификатор документа.');
  }

  const db = await loadDB(storagePaths);
  const index = db.documents.findIndex((doc) => doc.id === id);
  if (index < 0) {
    throw new Error('Документ не найден.');
  }

  const existing = db.documents[index];
  const pinned =
    patch && Object.prototype.hasOwnProperty.call(patch, 'isPinned')
      ? Boolean(patch.isPinned)
      : existing.isPinned;
  const collectionIdRaw =
    patch && Object.prototype.hasOwnProperty.call(patch, 'collectionId')
      ? normalizeText(patch.collectionId)
      : existing.collectionId;
  const collectionId =
    collectionIdRaw && db.collections.some((collection) => collection.id === collectionIdRaw)
      ? collectionIdRaw
      : undefined;

  db.documents[index] = {
    ...existing,
    isPinned: pinned,
    collectionId,
  };

  await saveDB(storagePaths, db);
  return getDocumentById(storagePaths, id);
}

function dateKeyFromIso(value) {
  const iso = normalizeIsoString(value) || new Date().toISOString();
  return iso.slice(0, 10);
}

async function updateDocumentReadingState(storagePaths, documentId, readingState = {}) {
  const id = String(documentId ?? '');
  if (!id) {
    throw new Error('Не передан идентификатор документа.');
  }

  const db = await loadDB(storagePaths);
  const index = db.documents.findIndex((doc) => doc.id === id);
  if (index < 0) {
    throw new Error('Документ не найден.');
  }

  const existing = db.documents[index];
  const nextTotalPagesRaw = normalizePositiveInt(
    readingState.totalPages,
    existing.lastReadTotalPages ?? 0,
  );
  const nextTotalPages = nextTotalPagesRaw > 0 ? nextTotalPagesRaw : existing.lastReadTotalPages;
  const incomingPageIndex = normalizePositiveInt(
    readingState.pageIndex,
    existing.lastReadPageIndex ?? 0,
  );
  const nextPageIndex = nextTotalPages
    ? Math.min(incomingPageIndex, Math.max(0, nextTotalPages - 1))
    : incomingPageIndex;
  const existingMaxReadPageIndex = normalizePositiveInt(
    existing.maxReadPageIndex,
    existing.lastReadPageIndex ?? 0,
  );
  const allowFirstPage = Boolean(readingState.allowFirstPage);
  let safeNextPageIndex = nextPageIndex;
  if (!allowFirstPage && safeNextPageIndex === 0 && existingMaxReadPageIndex > 0) {
    const existingLastReadPageIndex = normalizePositiveInt(
      existing.lastReadPageIndex,
      existingMaxReadPageIndex,
    );
    safeNextPageIndex = Math.max(existingLastReadPageIndex, existingMaxReadPageIndex);
  }
  const nextMaxReadPageIndexRaw = Math.max(existingMaxReadPageIndex, nextPageIndex);
  const nextMaxReadPageIndex = nextTotalPages
    ? Math.min(nextMaxReadPageIndexRaw, Math.max(0, nextTotalPages - 1))
    : nextMaxReadPageIndexRaw;
  const nextScale =
    normalizeScaleValue(readingState.scale) ??
    normalizeScaleValue(existing.lastReadScale) ??
    undefined;
  const nextLastOpenedAt =
    normalizeIsoString(readingState.lastOpenedAt) || new Date().toISOString();

  const readingSecondsDelta = normalizePositiveInt(readingState.readingSeconds, 0);
  const pagesDelta = normalizePositiveInt(readingState.pagesDelta, 0);
  const nextTotalReadingSeconds = normalizePositiveInt(existing.totalReadingSeconds, 0) + readingSecondsDelta;

  db.documents[index] = {
    ...existing,
    lastReadPageIndex: safeNextPageIndex,
    maxReadPageIndex: nextMaxReadPageIndex,
    lastReadTotalPages: nextTotalPages,
    lastReadScale: nextScale,
    lastOpenedAt: nextLastOpenedAt,
    totalReadingSeconds: nextTotalReadingSeconds,
  };

  if (readingSecondsDelta > 0 || pagesDelta > 0) {
    const dateKey = dateKeyFromIso(nextLastOpenedAt);
    const currentEntry = db.readingLog[dateKey] || { pages: 0, seconds: 0 };
    db.readingLog[dateKey] = {
      pages: normalizePositiveInt(currentEntry.pages, 0) + pagesDelta,
      seconds: normalizePositiveInt(currentEntry.seconds, 0) + readingSecondsDelta,
    };
  }

  await saveDB(storagePaths, db);
  return getDocumentById(storagePaths, id);
}

async function resetDocumentReadingState(storagePaths, documentId) {
  const id = String(documentId ?? '');
  if (!id) {
    throw new Error('Не передан идентификатор документа.');
  }

  const db = await loadDB(storagePaths);
  const index = db.documents.findIndex((doc) => doc.id === id);
  if (index < 0) {
    throw new Error('Документ не найден.');
  }

  const existing = db.documents[index];
  db.documents[index] = {
    ...existing,
    lastReadPageIndex: 0,
    maxReadPageIndex: 0,
    lastReadTotalPages: undefined,
    lastReadScale: undefined,
    lastOpenedAt: undefined,
    totalReadingSeconds: 0,
  };

  await saveDB(storagePaths, db);
  return getDocumentById(storagePaths, id);
}

async function addHighlight(storagePaths, highlight) {
  const db = await loadDB(storagePaths);
  const normalizedHighlight = normalizeHighlight(highlight);

  if (!normalizedHighlight.selectedText) {
    throw new Error('Текст выделения пуст.');
  }

  if (normalizedHighlight.rects.length === 0) {
    throw new Error('У выделения нет корректных прямоугольников.');
  }

  db.highlights.push(normalizedHighlight);
  await saveDB(storagePaths, db);

  return normalizedHighlight;
}

async function updateHighlight(storagePaths, highlightId, patch) {
  const db = await loadDB(storagePaths);
  const id = String(highlightId ?? '');
  const index = db.highlights.findIndex((item) => item.id === id);

  if (index < 0) {
    throw new Error('Выделение не найдено.');
  }

  const existing = db.highlights[index];
  const merged = normalizeHighlight({
    ...existing,
    ...patch,
    id: existing.id,
    documentId: existing.documentId,
    createdAt: existing.createdAt,
    selectedText:
      patch && Object.prototype.hasOwnProperty.call(patch, 'selectedText')
        ? patch.selectedText
        : existing.selectedText,
    selectedRichText:
      patch && Object.prototype.hasOwnProperty.call(patch, 'selectedRichText')
        ? patch.selectedRichText
        : existing.selectedRichText,
    rects:
      patch && Object.prototype.hasOwnProperty.call(patch, 'rects')
        ? patch.rects
        : existing.rects,
    tags:
      patch && Object.prototype.hasOwnProperty.call(patch, 'tags')
        ? patch.tags
        : existing.tags,
  });

  if (!merged.selectedText) {
    merged.selectedText = existing.selectedText;
  }

  if (!Array.isArray(merged.rects) || merged.rects.length === 0) {
    merged.rects = existing.rects;
  }

  db.highlights[index] = merged;
  await saveDB(storagePaths, db);
  return merged;
}

async function deleteHighlight(storagePaths, highlightId) {
  return deleteHighlightsByIds(storagePaths, [highlightId]);
}

async function deleteHighlightsByIds(storagePaths, highlightIds = []) {
  const ids = [...new Set((highlightIds ?? []).map((id) => String(id)).filter(Boolean))];
  if (ids.length === 0) {
    return { deleted: false, deletedCount: 0 };
  }

  const db = await loadDB(storagePaths);
  const idSet = new Set(ids);
  const nextHighlights = db.highlights.filter((item) => !idSet.has(item.id));
  const deletedCount = db.highlights.length - nextHighlights.length;

  if (deletedCount === 0) {
    return { deleted: false, deletedCount: 0 };
  }

  db.highlights = nextHighlights;
  await saveDB(storagePaths, db);
  return { deleted: true, deletedCount };
}

async function listBookmarks(storagePaths, documentId) {
  const db = await loadDB(storagePaths);
  return db.bookmarks
    .filter((item) => item.documentId === String(documentId))
    .sort((a, b) => a.pageIndex - b.pageIndex || new Date(a.createdAt).valueOf() - new Date(b.createdAt).valueOf());
}

async function addBookmark(storagePaths, bookmark) {
  const db = await loadDB(storagePaths);
  const normalized = normalizeBookmark(bookmark);
  if (!normalized.documentId) {
    throw new Error('Не передан идентификатор документа.');
  }

  db.bookmarks.push(normalized);
  await saveDB(storagePaths, db);
  return normalized;
}

async function updateBookmark(storagePaths, bookmarkId, patch = {}) {
  const db = await loadDB(storagePaths);
  const id = String(bookmarkId ?? '');
  const index = db.bookmarks.findIndex((bookmark) => bookmark.id === id);
  if (index < 0) {
    throw new Error('Закладка не найдена.');
  }

  const existing = db.bookmarks[index];
  const merged = normalizeBookmark({
    ...existing,
    ...patch,
    id: existing.id,
    documentId: existing.documentId,
    createdAt: existing.createdAt,
  });

  db.bookmarks[index] = merged;
  await saveDB(storagePaths, db);
  return merged;
}

async function deleteBookmark(storagePaths, bookmarkId) {
  const id = String(bookmarkId ?? '');
  const db = await loadDB(storagePaths);
  const nextBookmarks = db.bookmarks.filter((bookmark) => bookmark.id !== id);
  if (nextBookmarks.length === db.bookmarks.length) {
    return { deleted: false };
  }

  db.bookmarks = nextBookmarks;
  await saveDB(storagePaths, db);
  return { deleted: true };
}

async function deleteBookmarksByIds(storagePaths, bookmarkIds = []) {
  const ids = [...new Set((bookmarkIds ?? []).map((id) => String(id)).filter(Boolean))];
  if (ids.length === 0) {
    return { deleted: false, deletedCount: 0 };
  }

  const idSet = new Set(ids);
  const db = await loadDB(storagePaths);
  const nextBookmarks = db.bookmarks.filter((bookmark) => !idSet.has(bookmark.id));
  const deletedCount = db.bookmarks.length - nextBookmarks.length;

  if (deletedCount === 0) {
    return { deleted: false, deletedCount: 0 };
  }

  db.bookmarks = nextBookmarks;
  await saveDB(storagePaths, db);
  return { deleted: true, deletedCount };
}

async function listCollections(storagePaths) {
  const db = await loadDB(storagePaths);
  return [...db.collections].sort(
    (a, b) => new Date(a.createdAt).valueOf() - new Date(b.createdAt).valueOf(),
  );
}

async function createCollection(storagePaths, input) {
  const name = normalizeText(input?.name).slice(0, 80);
  if (!name) {
    throw new Error('Название коллекции не может быть пустым.');
  }

  const db = await loadDB(storagePaths);
  if (db.collections.some((collection) => collection.name.toLowerCase() === name.toLowerCase())) {
    throw new Error('Коллекция с таким названием уже существует.');
  }

  const collection = normalizeCollection({
    id: String(input?.id || crypto.randomUUID()),
    name,
    createdAt: new Date().toISOString(),
  });

  db.collections.push(collection);
  await saveDB(storagePaths, db);
  return collection;
}

async function updateCollection(storagePaths, collectionId, patch = {}) {
  const id = String(collectionId ?? '');
  if (!id) {
    throw new Error('Не передан идентификатор коллекции.');
  }

  const db = await loadDB(storagePaths);
  const index = db.collections.findIndex((collection) => collection.id === id);
  if (index < 0) {
    throw new Error('Коллекция не найдена.');
  }

  const nextName = normalizeText(patch.name).slice(0, 80);
  if (!nextName) {
    throw new Error('Название коллекции не может быть пустым.');
  }

  if (db.collections.some((collection, itemIndex) => itemIndex !== index && collection.name.toLowerCase() === nextName.toLowerCase())) {
    throw new Error('Коллекция с таким названием уже существует.');
  }

  db.collections[index] = {
    ...db.collections[index],
    name: nextName,
  };

  await saveDB(storagePaths, db);
  return db.collections[index];
}

async function deleteCollection(storagePaths, collectionId) {
  const id = String(collectionId ?? '');
  if (!id) {
    return { deleted: false };
  }

  const db = await loadDB(storagePaths);
  const nextCollections = db.collections.filter((collection) => collection.id !== id);
  if (nextCollections.length === db.collections.length) {
    return { deleted: false };
  }

  db.collections = nextCollections;
  db.documents = db.documents.map((doc) => {
    if (doc.collectionId === id) {
      return {
        ...doc,
        collectionId: undefined,
      };
    }
    return doc;
  });

  await saveDB(storagePaths, db);
  return { deleted: true };
}

async function getSettings(storagePaths) {
  const db = await loadDB(storagePaths);
  return normalizeSettings(db.settings);
}

async function updateSettings(storagePaths, patch = {}) {
  const db = await loadDB(storagePaths);
  db.settings = normalizeSettings({
    ...db.settings,
    ...patch,
    goals: {
      ...(db.settings?.goals || {}),
      ...(patch?.goals || {}),
    },
    updates: {
      ...(db.settings?.updates || {}),
      ...(patch?.updates || {}),
    },
  });
  await saveDB(storagePaths, db);
  return db.settings;
}

async function getReadingOverview(storagePaths) {
  const db = await loadDB(storagePaths);
  return {
    readingLog: normalizeReadingLog(db.readingLog),
    settings: normalizeSettings(db.settings),
  };
}

async function deleteDocument(storagePaths, documentId) {
  const id = String(documentId ?? '');
  const db = await loadDB(storagePaths);
  const index = db.documents.findIndex((item) => item.id === id);

  if (index < 0) {
    return { deleted: false };
  }

  const [removedDocument] = db.documents.splice(index, 1);
  const beforeHighlightsCount = db.highlights.length;
  const beforeBookmarksCount = db.bookmarks.length;
  db.highlights = db.highlights.filter((item) => item.documentId !== id);
  db.bookmarks = db.bookmarks.filter((item) => item.documentId !== id);
  const removedHighlightsCount = beforeHighlightsCount - db.highlights.length;
  const removedBookmarksCount = beforeBookmarksCount - db.bookmarks.length;

  await saveDB(storagePaths, db);

  const documentFilePath =
    removedDocument?.filePath || path.join(storagePaths.documentsDir, `${id}.pdf`);

  fs.unlink(documentFilePath).catch(() => {
    // Ignore filesystem errors for missing/locked file to keep DB consistent.
  });

  return {
    deleted: true,
    documentId: id,
    removedHighlightsCount,
    removedBookmarksCount,
  };
}

async function computeSha256(filePath) {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function importDocumentFromPath(storagePaths, sourceFilePath) {
  const id = await computeSha256(sourceFilePath);
  const destinationPath = path.join(storagePaths.documentsDir, `${id}.pdf`);

  const db = await loadDB(storagePaths);
  const existing = db.documents.find((doc) => doc.id === id) || null;
  if (existing) {
    const countMap = buildHighlightsCountMap(db.highlights);
    const bookmarkMap = buildBookmarksCountMap(db.bookmarks);
    return {
      alreadyExists: true,
      document: enrichDocument(existing, countMap, bookmarkMap),
    };
  }

  if (!(await fileExists(destinationPath))) {
    await fs.copyFile(sourceFilePath, destinationPath);
  }

  const title = path.basename(sourceFilePath, path.extname(sourceFilePath));

  const document = normalizeDocument({
    id,
    title,
    filePath: destinationPath,
    createdAt: new Date().toISOString(),
    highlightsCount: 0,
    lastReadPageIndex: 0,
    maxReadPageIndex: 0,
    lastReadTotalPages: undefined,
    lastReadScale: undefined,
    lastOpenedAt: undefined,
    totalReadingSeconds: 0,
    isPinned: false,
    collectionId: undefined,
  });

  db.documents.push(document);
  await saveDB(storagePaths, db);

  return {
    alreadyExists: false,
    document: enrichDocument(document, buildHighlightsCountMap(db.highlights), buildBookmarksCountMap(db.bookmarks)),
  };
}

async function importDocumentsFromPaths(storagePaths, sourceFilePaths = []) {
  const imported = [];
  const duplicates = [];
  const errors = [];

  for (const sourceFilePath of sourceFilePaths) {
    try {
      const importedResult = await importDocumentFromPath(storagePaths, sourceFilePath);
      if (importedResult.alreadyExists) {
        duplicates.push(importedResult.document);
      } else {
        imported.push(importedResult.document);
      }
    } catch (error) {
      errors.push({
        filePath: sourceFilePath,
        message: error?.message ?? 'Неизвестная ошибка',
      });
    }
  }

  return {
    imported,
    duplicates,
    errors,
  };
}

function getStoragePaths(storagePaths) {
  return {
    userDataPath: storagePaths.userDataPath,
    documentsDir: storagePaths.documentsDir,
    exportsDir: storagePaths.exportsDir,
    backupDir: storagePaths.backupDir,
    dbPath: storagePaths.dbPath,
  };
}

module.exports = {
  ensureStorage,
  loadDB,
  saveDB,
  listDocuments,
  getDocumentById,
  upsertDocument,
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
  importDocumentFromPath,
  importDocumentsFromPaths,
  getStoragePaths,
};
