const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const DB_FILE_NAME = 'db.json';
const BACKUP_DB_DIR_NAME = 'db';
const BACKUP_DOCUMENTS_DIR_NAME = 'documents';
const MAX_DOCUMENT_BACKUPS_PER_ID = 20;
const ALLOWED_COLORS = new Set(['yellow', 'green', 'pink', 'blue', 'orange', 'purple']);
const ALLOWED_THEMES = new Set(['white']);

const DEFAULT_SETTINGS = {
  theme: 'white',
  focusMode: false,
  apryseLicenseKey: undefined,
  goals: {
    pagesPerDay: 20,
    pagesPerWeek: 140,
  },
  savedHighlightViews: [],
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
    savedHighlightViews: [...DEFAULT_SETTINGS.savedHighlightViews],
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

function repairPdfTextArtifacts(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/\ufb00/g, 'ff')
    .replace(/\ufb01/g, 'fi')
    .replace(/\ufb02/g, 'fl')
    .replace(/\ufb03/g, 'ffi')
    .replace(/\ufb04/g, 'ffl')
    .replace(/([\p{L}\p{N}])\u00ad\s*([\p{L}\p{N}])/gu, '$1$2')
    .replace(/\u00ad/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[‐‑‒−]/g, '-')
    .replace(/([\p{L}\p{N}])[-‐‑]\s+([\p{L}\p{N}])/gu, '$1$2')
    .replace(/([\p{L}\p{N}])\s+\|\s+([\p{L}\p{N}])/gu, '$1 $2')
    .replace(
      /(^|[\s([{«"'])((?:[А-ЯЁ][ \t]){2,}[А-ЯЁ])(?=$|[\s,.;:!?»)\]}\u2026])/gu,
      (_match, prefix, word) => `${prefix}${word.replace(/[ \t]/g, '')}`,
    )
    .replace(
      /(^|[\s([{«"'])((?:[\p{L}\p{N}][ \t]){3,}[\p{L}\p{N}])(?=$|[\s,.;:!?»)\]}\u2026])/gu,
      (_match, prefix, word) => `${prefix}${word.replace(/[ \t]/g, '')}`,
    )
    .replace(/(^|[\s([{«"'])([А-ЯЁA-Z])\s+([А-ЯЁA-Z][А-ЯЁа-яёA-Za-z]{1,})/gu, '$1$2$3')
    .replace(/[|¦]{2,}/g, ' ')
    .replace(/([!?.,;:]){2,}/g, '$1')
    .replace(/\s+([,.;:!?»)\]}\u2026])/g, '$1')
    .replace(/([«([{])\s+/g, '$1')
    .replace(/[ \t]{2,}/g, ' ');
}

function normalizeOcrLineBreaks(value) {
  const lines = String(value ?? '')
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v]+/g, ' ').trim());
  const merged = [];

  for (const line of lines) {
    if (!line) {
      if (merged.length > 0 && merged[merged.length - 1] !== '') {
        merged.push('');
      }
      continue;
    }

    const last = merged[merged.length - 1];
    if (!last || last === '') {
      merged.push(line);
      continue;
    }

    const looksLikeHeading = /^[\p{Lu}\d][\p{Lu}\d .,:;!?"'()/-]{6,}$/u.test(line);
    const shouldJoin =
      !/[.!?;:»”"')\]]$/.test(last) &&
      !/^[\u2022*#>]/.test(line) &&
      !/^\d+[.)]\s/.test(line) &&
      !looksLikeHeading;

    if (shouldJoin) {
      merged[merged.length - 1] = `${last} ${line}`;
      continue;
    }

    merged.push(line);
  }

  return merged.join('\n').replace(/\n{3,}/g, '\n\n');
}

function normalizeHighlightText(value) {
  return normalizeText(
    normalizeOcrLineBreaks(repairPdfTextArtifacts(String(value ?? '')).replace(/\r\n?/g, '\n'))
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/\n/g, ' '),
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
  const documentTitle = normalizeText(highlight?.documentTitle).slice(0, 240);
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
    documentTitle: documentTitle || undefined,
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

function normalizeSmartHighlightFilter(filter) {
  const raw = filter && typeof filter === 'object' ? filter : {};
  const colorRaw = String(raw.colorFilter ?? '').trim().toLowerCase();
  const colorFilter = ALLOWED_COLORS.has(colorRaw) ? colorRaw : 'all';
  const groupMode = String(raw.groupMode ?? '').trim().toLowerCase() === 'timeline' ? 'timeline' : 'document';

  return {
    search: normalizeText(raw.search).slice(0, 320),
    documentFilter: normalizeText(raw.documentFilter) || 'all',
    contextOnly: Boolean(raw.contextOnly),
    colorFilter,
    notesOnly: Boolean(raw.notesOnly),
    inboxOnly: Boolean(raw.inboxOnly),
    groupMode,
  };
}

function normalizeSavedHighlightView(item) {
  return {
    id: String(item?.id || crypto.randomUUID()),
    name: normalizeText(item?.name).slice(0, 80) || 'Представление',
    createdAt: normalizeIsoString(item?.createdAt) || new Date().toISOString(),
    updatedAt:
      normalizeIsoString(item?.updatedAt) ||
      normalizeIsoString(item?.createdAt) ||
      new Date().toISOString(),
    isPinned: Boolean(item?.isPinned),
    lastUsedAt: normalizeIsoString(item?.lastUsedAt),
    filter: normalizeSmartHighlightFilter(item?.filter),
  };
}

function normalizeSavedHighlightViews(list) {
  if (!Array.isArray(list)) {
    return [];
  }

  const result = [];
  const seenIds = new Set();
  for (const entry of list) {
    const normalized = normalizeSavedHighlightView(entry);
    if (seenIds.has(normalized.id)) {
      continue;
    }
    seenIds.add(normalized.id);
    result.push(normalized);
  }

  return result.slice(0, 40);
}

function parseSmartFilterFromLegacyQuery(rawQuery) {
  const query = normalizeText(rawQuery);
  if (!query) {
    return null;
  }

  if (query.startsWith('smart:')) {
    try {
      const parsed = JSON.parse(query.slice(6));
      if (parsed && typeof parsed === 'object') {
        return normalizeSmartHighlightFilter(parsed);
      }
    } catch {
      // fallback to plain text query
    }
  }

  return normalizeSmartHighlightFilter({
    search: query,
  });
}

function migrateViewsFromSavedQueries(list) {
  if (!Array.isArray(list)) {
    return [];
  }

  const result = [];
  const seenIds = new Set();
  for (const entry of list) {
    const normalized = normalizeSavedHighlightQuery(entry);
    if (!normalized.query || seenIds.has(normalized.id)) {
      continue;
    }

    const filter = parseSmartFilterFromLegacyQuery(normalized.query);
    if (!filter) {
      continue;
    }

    seenIds.add(normalized.id);
    result.push(
      normalizeSavedHighlightView({
        id: normalized.id,
        name: normalized.name,
        createdAt: normalized.createdAt,
        updatedAt: normalized.createdAt,
        filter,
      }),
    );
  }

  return result.slice(0, 40);
}

function convertViewsToSavedQueries(views) {
  return normalizeSavedHighlightQueries(
    views.map((view) => ({
      id: view.id,
      name: view.name,
      query: `smart:${JSON.stringify(view.filter)}`,
      createdAt: view.createdAt,
    })),
  );
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
  const rawTheme = String(settings?.theme ?? '').trim().toLowerCase();
  const nextTheme = ALLOWED_THEMES.has(rawTheme) ? rawTheme : 'white';
  const pagesPerDay = Math.max(
    1,
    normalizePositiveInt(settings?.goals?.pagesPerDay, DEFAULT_SETTINGS.goals.pagesPerDay),
  );
  const pagesPerWeek = Math.max(
    pagesPerDay,
    normalizePositiveInt(settings?.goals?.pagesPerWeek, DEFAULT_SETTINGS.goals.pagesPerWeek),
  );
  const normalizedViews = normalizeSavedHighlightViews(settings?.savedHighlightViews);
  const migratedViews =
    normalizedViews.length > 0
      ? normalizedViews
      : migrateViewsFromSavedQueries(settings?.savedHighlightQueries);
  const savedHighlightViews = migratedViews.slice(0, 40);
  const savedHighlightQueries =
    normalizeSavedHighlightQueries(settings?.savedHighlightQueries).length > 0 &&
    normalizedViews.length === 0
      ? normalizeSavedHighlightQueries(settings?.savedHighlightQueries)
      : convertViewsToSavedQueries(savedHighlightViews);
  const apryseLicenseKey = normalizeText(settings?.apryseLicenseKey).slice(0, 4096) || undefined;

  return {
    theme: nextTheme,
    focusMode: Boolean(settings?.focusMode),
    apryseLicenseKey,
    goals: {
      pagesPerDay,
      pagesPerWeek,
    },
    savedHighlightViews,
    savedHighlightQueries,
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

function sanitizeBackupToken(value, fallback = 'snapshot') {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function backupOrderToken(fileName) {
  const match = /^(\d+)/.exec(String(fileName || ''));
  return match ? Number(match[1]) : 0;
}

function sortBackupFileNamesDesc(fileNames = []) {
  return [...fileNames].sort((left, right) => {
    const leftOrder = backupOrderToken(left);
    const rightOrder = backupOrderToken(right);
    if (leftOrder !== rightOrder) {
      return rightOrder - leftOrder;
    }
    return String(right).localeCompare(String(left));
  });
}

function normalizeDBShape(parsed) {
  const documents = (Array.isArray(parsed?.documents) ? parsed.documents : [])
    .map(normalizeDocument)
    .filter((doc) => doc.id && doc.title && doc.filePath);
  const documentTitleMap = new Map(documents.map((doc) => [doc.id, doc.title]));
  const highlights = (Array.isArray(parsed?.highlights) ? parsed.highlights : [])
    .map(normalizeHighlight)
    .filter((highlight) => highlight.id && highlight.documentId)
    .map((highlight) => {
      if (highlight.documentTitle) {
        return highlight;
      }
      const linkedTitle = documentTitleMap.get(highlight.documentId);
      if (!linkedTitle) {
        return highlight;
      }
      return {
        ...highlight,
        documentTitle: linkedTitle,
      };
    });

  return {
    documents,
    highlights,
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

async function pruneDocumentBackups(documentBackupDir, maxSnapshots = MAX_DOCUMENT_BACKUPS_PER_ID) {
  const entries = await fs.readdir(documentBackupDir).catch(() => []);
  const jsonFiles = sortBackupFileNamesDesc(
    entries.filter((entry) => String(entry).toLowerCase().endsWith('.json')),
  );

  for (const staleJsonFile of jsonFiles.slice(Math.max(0, Number(maxSnapshots) | 0))) {
    const baseName = staleJsonFile.slice(0, -5);
    const jsonPath = path.join(documentBackupDir, staleJsonFile);
    const pdfPath = path.join(documentBackupDir, `${baseName}.pdf`);
    await Promise.all([
      fs.rm(jsonPath, { force: true }),
      fs.rm(pdfPath, { force: true }),
    ]);
  }
}

async function writeDocumentBackup(storagePaths, db, documentId, reason = 'snapshot') {
  const id = String(documentId ?? '').trim();
  if (!id) {
    return null;
  }

  const document = db.documents.find((item) => item.id === id) || null;
  const highlights = db.highlights.filter((item) => item.documentId === id);
  const bookmarks = db.bookmarks.filter((item) => item.documentId === id);

  if (!document && highlights.length === 0 && bookmarks.length === 0) {
    return null;
  }

  const documentBackupDir = path.join(storagePaths.backupDir, BACKUP_DOCUMENTS_DIR_NAME, id);
  await fs.mkdir(documentBackupDir, { recursive: true });

  const stamp = String(Date.now());
  const token = sanitizeBackupToken(reason, 'snapshot');
  const baseName = `${stamp}-${token}`;
  const payloadPath = path.join(documentBackupDir, `${baseName}.json`);
  const payload = {
    version: 1,
    createdAt: new Date().toISOString(),
    reason: String(reason ?? 'snapshot'),
    documentId: id,
    document,
    highlights,
    bookmarks,
  };

  await atomicWriteJson(payloadPath, payload);

  const candidatePdfPath = document?.filePath || path.join(storagePaths.documentsDir, `${id}.pdf`);
  const hasPdfSource = await fileExists(candidatePdfPath);
  if (hasPdfSource) {
    await fs.copyFile(candidatePdfPath, path.join(documentBackupDir, `${baseName}.pdf`));
  }

  await pruneDocumentBackups(documentBackupDir);
  return {
    payloadPath,
    pdfPath: hasPdfSource ? path.join(documentBackupDir, `${baseName}.pdf`) : undefined,
    documentId: id,
  };
}

async function writeDocumentBackupSafe(storagePaths, db, documentId, reason = 'snapshot') {
  try {
    return await writeDocumentBackup(storagePaths, db, documentId, reason);
  } catch {
    return null;
  }
}

async function readLatestDocumentBackup(storagePaths, documentId) {
  const id = String(documentId ?? '').trim();
  if (!id) {
    return null;
  }

  const documentBackupDir = path.join(storagePaths.backupDir, BACKUP_DOCUMENTS_DIR_NAME, id);
  const entries = await fs.readdir(documentBackupDir).catch(() => []);
  const jsonFiles = sortBackupFileNamesDesc(
    entries.filter((entry) => String(entry).toLowerCase().endsWith('.json')),
  );

  for (const jsonFileName of jsonFiles) {
    const payloadPath = path.join(documentBackupDir, jsonFileName);
    const baseName = jsonFileName.slice(0, -5);
    const pdfPath = path.join(documentBackupDir, `${baseName}.pdf`);

    try {
      const raw = await fs.readFile(payloadPath, 'utf8');
      const payload = JSON.parse(raw);
      if (!payload || typeof payload !== 'object') {
        continue;
      }
      return {
        payloadPath,
        payload,
        pdfPath: (await fileExists(pdfPath)) ? pdfPath : undefined,
      };
    } catch {
      // Skip broken snapshot and continue to previous backup.
    }
  }

  return null;
}

async function readLatestDocumentBackupWithPdf(storagePaths, documentId) {
  const id = String(documentId ?? '').trim();
  if (!id) {
    return null;
  }

  const documentBackupDir = path.join(storagePaths.backupDir, BACKUP_DOCUMENTS_DIR_NAME, id);
  const entries = await fs.readdir(documentBackupDir).catch(() => []);
  const jsonFiles = sortBackupFileNamesDesc(
    entries.filter((entry) => String(entry).toLowerCase().endsWith('.json')),
  );

  for (const jsonFileName of jsonFiles) {
    const payloadPath = path.join(documentBackupDir, jsonFileName);
    const baseName = jsonFileName.slice(0, -5);
    const pdfPath = path.join(documentBackupDir, `${baseName}.pdf`);
    if (!(await fileExists(pdfPath))) {
      continue;
    }

    try {
      const raw = await fs.readFile(payloadPath, 'utf8');
      const payload = JSON.parse(raw);
      if (!payload || typeof payload !== 'object') {
        continue;
      }
      return {
        payloadPath,
        payload,
        pdfPath,
      };
    } catch {
      // Skip broken snapshot and continue to previous backup.
    }
  }

  return null;
}

async function readLatestDocumentBackupWithDocument(storagePaths, documentId) {
  const id = String(documentId ?? '').trim();
  if (!id) {
    return null;
  }

  const documentBackupDir = path.join(storagePaths.backupDir, BACKUP_DOCUMENTS_DIR_NAME, id);
  const entries = await fs.readdir(documentBackupDir).catch(() => []);
  const jsonFiles = sortBackupFileNamesDesc(
    entries.filter((entry) => String(entry).toLowerCase().endsWith('.json')),
  );

  for (const jsonFileName of jsonFiles) {
    const payloadPath = path.join(documentBackupDir, jsonFileName);
    const baseName = jsonFileName.slice(0, -5);
    const pdfPath = path.join(documentBackupDir, `${baseName}.pdf`);

    try {
      const raw = await fs.readFile(payloadPath, 'utf8');
      const payload = JSON.parse(raw);
      if (!payload || typeof payload !== 'object' || !payload.document) {
        continue;
      }
      return {
        payloadPath,
        payload,
        pdfPath: (await fileExists(pdfPath)) ? pdfPath : undefined,
      };
    } catch {
      // Skip broken snapshot and continue to previous backup.
    }
  }

  return null;
}

async function readLatestDocumentBackupWithHighlights(storagePaths, documentId) {
  const id = String(documentId ?? '').trim();
  if (!id) {
    return null;
  }

  const documentBackupDir = path.join(storagePaths.backupDir, BACKUP_DOCUMENTS_DIR_NAME, id);
  const entries = await fs.readdir(documentBackupDir).catch(() => []);
  const jsonFiles = sortBackupFileNamesDesc(
    entries.filter((entry) => String(entry).toLowerCase().endsWith('.json')),
  );

  for (const jsonFileName of jsonFiles) {
    const payloadPath = path.join(documentBackupDir, jsonFileName);
    const baseName = jsonFileName.slice(0, -5);
    const pdfPath = path.join(documentBackupDir, `${baseName}.pdf`);

    try {
      const raw = await fs.readFile(payloadPath, 'utf8');
      const payload = JSON.parse(raw);
      if (!payload || typeof payload !== 'object') {
        continue;
      }
      if (!Array.isArray(payload.highlights) || payload.highlights.length === 0) {
        continue;
      }
      return {
        payloadPath,
        payload,
        pdfPath: (await fileExists(pdfPath)) ? pdfPath : undefined,
      };
    } catch {
      // Skip broken snapshot and continue to previous backup.
    }
  }

  return null;
}

async function readLatestDocumentBackupWithBookmarks(storagePaths, documentId) {
  const id = String(documentId ?? '').trim();
  if (!id) {
    return null;
  }

  const documentBackupDir = path.join(storagePaths.backupDir, BACKUP_DOCUMENTS_DIR_NAME, id);
  const entries = await fs.readdir(documentBackupDir).catch(() => []);
  const jsonFiles = sortBackupFileNamesDesc(
    entries.filter((entry) => String(entry).toLowerCase().endsWith('.json')),
  );

  for (const jsonFileName of jsonFiles) {
    const payloadPath = path.join(documentBackupDir, jsonFileName);
    const baseName = jsonFileName.slice(0, -5);
    const pdfPath = path.join(documentBackupDir, `${baseName}.pdf`);

    try {
      const raw = await fs.readFile(payloadPath, 'utf8');
      const payload = JSON.parse(raw);
      if (!payload || typeof payload !== 'object') {
        continue;
      }
      if (!Array.isArray(payload.bookmarks) || payload.bookmarks.length === 0) {
        continue;
      }
      return {
        payloadPath,
        payload,
        pdfPath: (await fileExists(pdfPath)) ? pdfPath : undefined,
      };
    } catch {
      // Skip broken snapshot and continue to previous backup.
    }
  }

  return null;
}

async function ensureStorage(userDataPath) {
  const documentsDir = path.join(userDataPath, 'documents');
  const exportsDir = path.join(userDataPath, 'exports');
  const backupDir = path.join(userDataPath, 'backups');
  const backupDocumentsDir = path.join(backupDir, BACKUP_DOCUMENTS_DIR_NAME);
  const backupDbDir = path.join(backupDir, BACKUP_DB_DIR_NAME);
  const dbPath = path.join(userDataPath, DB_FILE_NAME);

  await Promise.all([
    fs.mkdir(userDataPath, { recursive: true }),
    fs.mkdir(documentsDir, { recursive: true }),
    fs.mkdir(exportsDir, { recursive: true }),
    fs.mkdir(backupDir, { recursive: true }),
    fs.mkdir(backupDocumentsDir, { recursive: true }),
    fs.mkdir(backupDbDir, { recursive: true }),
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
        savedHighlightViews: [...DEFAULT_SETTINGS.savedHighlightViews],
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

    const aCreatedAt = new Date(a.createdAt).valueOf();
    const bCreatedAt = new Date(b.createdAt).valueOf();
    const aLastOpenedAt = a.lastOpenedAt ? new Date(a.lastOpenedAt).valueOf() : 0;
    const bLastOpenedAt = b.lastOpenedAt ? new Date(b.lastOpenedAt).valueOf() : 0;
    const aLast = Math.max(aCreatedAt, aLastOpenedAt);
    const bLast = Math.max(bCreatedAt, bLastOpenedAt);
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

  if (!normalizedHighlight.documentTitle) {
    const linkedDocument = db.documents.find((document) => document.id === normalizedHighlight.documentId);
    if (linkedDocument?.title) {
      normalizedHighlight.documentTitle = linkedDocument.title;
    }
  }

  if (!normalizedHighlight.selectedText) {
    throw new Error('Текст выделения пуст.');
  }

  if (normalizedHighlight.rects.length === 0) {
    throw new Error('У выделения нет корректных прямоугольников.');
  }

  db.highlights.push(normalizedHighlight);
  await writeDocumentBackupSafe(storagePaths, db, normalizedHighlight.documentId, 'after-highlight-add');
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
  if (!merged.documentTitle) {
    merged.documentTitle =
      existing.documentTitle ||
      db.documents.find((document) => document.id === existing.documentId)?.title ||
      undefined;
  }

  db.highlights[index] = merged;
  await writeDocumentBackupSafe(storagePaths, db, existing.documentId, 'after-highlight-update');
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
  const affectedDocumentIds = [
    ...new Set(
      db.highlights
        .filter((item) => idSet.has(item.id))
        .map((item) => item.documentId),
    ),
  ];
  for (const documentId of affectedDocumentIds) {
    await writeDocumentBackupSafe(storagePaths, db, documentId, 'before-highlight-delete');
  }
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
  await writeDocumentBackupSafe(storagePaths, db, normalized.documentId, 'after-bookmark-add');
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
  await writeDocumentBackupSafe(storagePaths, db, existing.documentId, 'after-bookmark-update');
  await saveDB(storagePaths, db);
  return merged;
}

async function deleteBookmark(storagePaths, bookmarkId) {
  const id = String(bookmarkId ?? '');
  const db = await loadDB(storagePaths);
  const target = db.bookmarks.find((bookmark) => bookmark.id === id);
  if (target?.documentId) {
    await writeDocumentBackupSafe(storagePaths, db, target.documentId, 'before-bookmark-delete');
  }
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
  const affectedDocumentIds = [
    ...new Set(
      db.bookmarks
        .filter((bookmark) => idSet.has(bookmark.id))
        .map((bookmark) => bookmark.documentId),
    ),
  ];
  for (const documentId of affectedDocumentIds) {
    await writeDocumentBackupSafe(storagePaths, db, documentId, 'before-bookmark-delete-many');
  }
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

  await writeDocumentBackupSafe(storagePaths, db, id, 'before-document-delete');

  const [removedDocument] = db.documents.splice(index, 1);
  const detachedHighlightsCount = db.highlights.filter((item) => item.documentId === id).length;
  const detachedBookmarksCount = db.bookmarks.filter((item) => item.documentId === id).length;

  if (removedDocument?.title && detachedHighlightsCount > 0) {
    db.highlights = db.highlights.map((item) => {
      if (item.documentId !== id || normalizeText(item.documentTitle)) {
        return item;
      }
      return {
        ...item,
        documentTitle: removedDocument.title,
      };
    });
  }

  await saveDB(storagePaths, db);

  const documentFilePath =
    removedDocument?.filePath || path.join(storagePaths.documentsDir, `${id}.pdf`);

  try {
    await fs.unlink(documentFilePath);
  } catch {
    // Ignore filesystem errors for missing/locked file to keep DB consistent.
  }

  return {
    deleted: true,
    documentId: id,
    removedHighlightsCount: 0,
    removedBookmarksCount: 0,
    detachedHighlightsCount,
    detachedBookmarksCount,
  };
}

async function restoreDocumentFromBackup(storagePaths, documentId, options = {}) {
  const id = String(documentId ?? '').trim();
  if (!id) {
    throw new Error('Не передан идентификатор документа.');
  }

  const latest = await readLatestDocumentBackup(storagePaths, id);
  if (!latest) {
    return {
      restored: false,
      documentId: id,
      reason: 'backup_not_found',
    };
  }

  let snapshotForRestore = latest;
  let payload =
    snapshotForRestore.payload && typeof snapshotForRestore.payload === 'object'
      ? snapshotForRestore.payload
      : {};
  let backupDocument = payload.document && typeof payload.document === 'object' ? payload.document : null;
  let backupHighlights = Array.isArray(payload.highlights) ? payload.highlights : [];
  let backupBookmarks = Array.isArray(payload.bookmarks) ? payload.bookmarks : [];

  if (!backupDocument) {
    const withDocument = await readLatestDocumentBackupWithDocument(storagePaths, id);
    if (withDocument?.payload?.document) {
      backupDocument = withDocument.payload.document;
    }
  }
  if (backupHighlights.length === 0) {
    const withHighlights = await readLatestDocumentBackupWithHighlights(storagePaths, id);
    if (Array.isArray(withHighlights?.payload?.highlights) && withHighlights.payload.highlights.length > 0) {
      backupHighlights = withHighlights.payload.highlights;
    }
  }
  if (backupBookmarks.length === 0) {
    const withBookmarks = await readLatestDocumentBackupWithBookmarks(storagePaths, id);
    if (Array.isArray(withBookmarks?.payload?.bookmarks) && withBookmarks.payload.bookmarks.length > 0) {
      backupBookmarks = withBookmarks.payload.bookmarks;
    }
  }

  const db = await loadDB(storagePaths);
  const existingDocument = db.documents.find((item) => item.id === id) || null;

  const fallbackTitle =
    normalizeText(backupDocument?.title) ||
    normalizeText(backupHighlights[0]?.documentTitle) ||
    normalizeText(existingDocument?.title) ||
    `Документ ${id.slice(0, 8)}`;
  const destinationPdfPath =
    String(existingDocument?.filePath || backupDocument?.filePath || '').trim() ||
    path.join(storagePaths.documentsDir, `${id}.pdf`);

  let restoredFile = false;
  const needsPdfRestore = !(await fileExists(destinationPdfPath));
  let snapshotForPdf = snapshotForRestore;
  if (needsPdfRestore && !snapshotForPdf.pdfPath) {
    snapshotForPdf = (await readLatestDocumentBackupWithPdf(storagePaths, id)) || snapshotForRestore;
  }
  if (needsPdfRestore && snapshotForPdf?.payload) {
    snapshotForRestore = snapshotForPdf;
    payload =
      snapshotForRestore.payload && typeof snapshotForRestore.payload === 'object'
        ? snapshotForRestore.payload
        : payload;
  }
  if (needsPdfRestore && snapshotForPdf.pdfPath) {
    await fs.mkdir(path.dirname(destinationPdfPath), { recursive: true });
    await fs.copyFile(snapshotForPdf.pdfPath, destinationPdfPath);
    restoredFile = true;
  }

  const restoredDocument = normalizeDocument({
    ...backupDocument,
    ...existingDocument,
    id,
    title: fallbackTitle,
    filePath: destinationPdfPath,
    createdAt: backupDocument?.createdAt || existingDocument?.createdAt || new Date().toISOString(),
  });

  const documentIndex = db.documents.findIndex((item) => item.id === id);
  if (documentIndex >= 0) {
    const originalCreatedAt = db.documents[documentIndex].createdAt;
    db.documents[documentIndex] = {
      ...db.documents[documentIndex],
      ...restoredDocument,
      createdAt: originalCreatedAt,
    };
  } else {
    db.documents.push(restoredDocument);
  }

  const shouldRestoreAnnotations = options?.restoreAnnotations !== false;
  let restoredHighlightsCount = 0;
  let restoredBookmarksCount = 0;
  if (shouldRestoreAnnotations) {
    const normalizedHighlights = backupHighlights
      .map((item) =>
        normalizeHighlight({
          ...item,
          documentId: id,
          documentTitle: normalizeText(item?.documentTitle) || fallbackTitle,
        }),
      )
      .filter((item) => item.id && item.documentId === id);
    const normalizedBookmarks = backupBookmarks
      .map((item) =>
        normalizeBookmark({
          ...item,
          documentId: id,
        }),
      )
      .filter((item) => item.id && item.documentId === id);

    db.highlights = db.highlights.filter((item) => item.documentId !== id);
    db.bookmarks = db.bookmarks.filter((item) => item.documentId !== id);
    db.highlights.push(...normalizedHighlights);
    db.bookmarks.push(...normalizedBookmarks);
    restoredHighlightsCount = normalizedHighlights.length;
    restoredBookmarksCount = normalizedBookmarks.length;
  }

  await saveDB(storagePaths, db);
  const document = await getDocumentById(storagePaths, id);
  return {
    restored: true,
    documentId: id,
    document,
    restoredFile,
    restoredHighlightsCount,
    restoredBookmarksCount,
    backupPath: snapshotForRestore.payloadPath,
  };
}

async function computeSha256(filePath) {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function ensureReadablePdfSource(sourceFilePath) {
  const normalizedPath = String(sourceFilePath ?? '').trim();
  if (!normalizedPath) {
    throw new Error('Не передан путь к PDF-файлу.');
  }

  const resolvedPath = path.resolve(normalizedPath);
  const sourceStats = await fs
    .stat(resolvedPath)
    .catch(() => null);

  if (!sourceStats || !sourceStats.isFile()) {
    throw new Error('Файл для импорта не найден.');
  }

  if (path.extname(resolvedPath).toLowerCase() !== '.pdf') {
    throw new Error('Поддерживается только импорт PDF-файлов.');
  }

  return resolvedPath;
}

async function importDocumentFromPath(storagePaths, sourceFilePathRaw) {
  const sourceFilePath = await ensureReadablePdfSource(sourceFilePathRaw);
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
  await writeDocumentBackupSafe(storagePaths, db, document.id, 'after-import');
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
  restoreDocumentFromBackup,
  importDocumentFromPath,
  importDocumentsFromPaths,
  getStoragePaths,
};
