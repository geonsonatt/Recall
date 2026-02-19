import '@fontsource-variable/manrope';
import Split from 'split.js';
import Fuse from 'fuse.js';
import { computePosition, flip, offset, shift } from '@floating-ui/dom';
import {
  ArrowRight,
  BookOpen,
  BookOpenCheck,
  BookOpenText,
  FileOutput,
  FileText,
  FileUp,
  FolderOpen,
  Hand,
  Highlighter,
  LibraryBig,
  List,
  NotebookPen,
  Trash2,
  createIcons,
} from 'lucide/dist/cjs/lucide.js';

const appNode = document.querySelector('#app');

const HIGHLIGHT_COLORS = ['yellow', 'green', 'pink'];
const READER_ENGINE = 'webviewer';
const WEBVIEWER_CUSTOM_ID_KEY = 'recallHighlightId';
const WEBVIEWER_CUSTOM_TEXT_KEY = 'recallSelectedText';
const WEBVIEWER_CUSTOM_RICH_TEXT_KEY = 'recallSelectedRichText';
const MAX_RICH_TEXT_LENGTH = 24000;
let webViewerFactoryPromise = null;
let pdfjsFactoryPromise = null;
let pdfjsModule = null;
const ICON_SET = {
  ArrowRight,
  BookOpen,
  BookOpenCheck,
  BookOpenText,
  FileOutput,
  FileText,
  FileUp,
  FolderOpen,
  Hand,
  Highlighter,
  LibraryBig,
  List,
  NotebookPen,
  Trash2,
};
const COLOR_LABELS = {
  yellow: 'Желтый',
  green: 'Зеленый',
  pink: 'Розовый',
};

const state = {
  view: 'library',
  documents: [],
  storagePaths: null,
  libraryError: '',
  libraryInfo: '',
  libraryDropActive: false,
  collections: [],
  readingLog: {},
  settings: {
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
  },
  updateState: {
    status: 'idle',
    updateAvailable: false,
    currentVersion: '',
    latestVersion: '',
    manifestUrl: '',
    checkedAt: '',
    downloadUrl: '',
    notes: '',
    publishedAt: '',
    error: '',
    autoCheckEnabled: true,
  },
  libraryProgressFilter: 'all',
  librarySortMode: 'last-opened',
  libraryCollectionFilter: 'all',

  currentDocument: null,
  currentHighlights: [],
  currentHighlightCursor: -1,
  pendingSelection: null,
  focusHighlightId: null,
  readerMessage: '',
  readerError: '',
  readerInteractionMode: 'text-select',
  readerHighlightColor: 'yellow',

  highlightsQuery: '',
  highlightsContextOnly: false,
  highlightsByDocument: {},
  highlightsBookFilter: 'all',
  highlightsSinceDate: '',
  highlightsTagFilter: '',
  selectedHighlightIds: [],

  commandPaletteOpen: false,
  commandPaletteQuery: '',
  commandPaletteSelectedIndex: 0,
  commandPaletteItems: [],

  highlightReviewActive: false,
  highlightReviewQueueIds: [],
  highlightReviewIndex: 0,
  highlightReviewCurrentId: '',
  highlightReviewCompleted: 0,
  highlightReviewScopeKey: '',
};

const readerRuntime = {
  renderToken: 0,
  scale: 1.55,
  minScale: 0.8,
  maxScale: 3,
  pageRefs: new Map(),
  totalPages: 0,
  currentPageIndex: 0,
  pdfDocument: null,
  activeDocumentId: null,
  splitInstance: null,
  resizeHandler: null,
  progressSaveTimer: null,
  pageSyncTimer: null,
  lastSavedProgressKey: '',
  sessionStartTs: 0,
  lastPersistTs: 0,
  lastPersistPageIndex: 0,
  openingDocument: false,
  openingToken: 0,
  openGuardPageIndex: -1,
  openGuardUntilTs: 0,
  allowFirstPagePersistUntilTs: 0,
  allowFirstPagePersistDocumentId: '',
  navigationHistory: [],
  navigationHistoryIndex: -1,
  navigationHistoryLocked: false,
  highlightNavigationRequestToken: 0,
};

const webViewerRuntime = {
  instance: null,
  host: null,
  eventsBound: false,
  suppressSync: false,
  lastTextSelection: null,
  highlightNavToken: 0,
  cssInjected: false,
  repairingZoom: false,
  lastKnownPageIndex: 0,
};

let unsubscribeUpdateState = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderIcon(name) {
  return `<i data-lucide="${escapeHtml(name)}" class="ui-icon" aria-hidden="true"></i>`;
}

function hydrateIcons() {
  createIcons({
    icons: ICON_SET,
    attrs: {
      'stroke-width': '1.9',
    },
  });
}

function clamp(value, min, max) {
  const safeMin = Number.isFinite(Number(min)) ? Number(min) : 0;
  const safeMax = Number.isFinite(Number(max)) ? Number(max) : safeMin;
  const low = Math.min(safeMin, safeMax);
  const high = Math.max(safeMin, safeMax);
  const safeValue = Number.isFinite(Number(value)) ? Number(value) : low;
  return Math.max(low, Math.min(high, safeValue));
}

function normalizePageIndex(value, fallback = 0) {
  const isEmptyString = typeof value === 'string' && value.trim() === '';
  const raw = !isEmptyString && Number.isFinite(Number(value)) ? Number(value) : Number(fallback);
  return Math.max(0, Math.trunc(raw));
}

function clampPageIndex(value, totalPages = readerRuntime.totalPages) {
  const total = Math.max(1, normalizePageIndex(totalPages, 1));
  return clamp(normalizePageIndex(value, 0), 0, total - 1);
}

function normalizeScale(value, fallback = 1.55) {
  const fallbackScale = clamp(Number(fallback), readerRuntime.minScale, readerRuntime.maxScale);
  const raw = Number(value);
  if (!Number.isFinite(raw)) {
    return fallbackScale;
  }

  return clamp(raw, readerRuntime.minScale, readerRuntime.maxScale);
}

function getCurrentPageIndexSafe(totalPages = readerRuntime.totalPages) {
  return clampPageIndex(readerRuntime.currentPageIndex, totalPages);
}

function getCurrentPageNumberSafe(totalPages = readerRuntime.totalPages) {
  return getCurrentPageIndexSafe(totalPages) + 1;
}

function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) {
    return 'Неизвестная дата';
  }

  return new Intl.DateTimeFormat('ru-RU', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatPercent(value) {
  return `${Math.round(clamp(value, 0, 1) * 100)}%`;
}

function getReadingProgressStats(pageIndex, totalPages) {
  const safeTotal = normalizePageIndex(totalPages, 0);
  const rawPageIndex = normalizePageIndex(pageIndex, 0);
  if (safeTotal <= 0) {
    return {
      totalPages: 0,
      pageIndex: rawPageIndex,
      pageNumber: rawPageIndex + 1,
      progress: 0,
    };
  }

  const safePageIndex = clamp(rawPageIndex, 0, safeTotal - 1);
  const progress = clamp((safePageIndex + 1) / safeTotal, 0, 1);
  return {
    totalPages: safeTotal,
    pageIndex: safePageIndex,
    pageNumber: safePageIndex + 1,
    progress,
  };
}

function getDocumentReadingStats(documentInfo) {
  const progressPageIndex = Number.isFinite(Number(documentInfo?.maxReadPageIndex))
    ? Number(documentInfo.maxReadPageIndex)
    : Number(documentInfo?.lastReadPageIndex ?? 0);

  return getReadingProgressStats(
    progressPageIndex,
    documentInfo?.lastReadTotalPages ?? 0,
  );
}

function getCurrentReadingStats() {
  return getReadingProgressStats(readerRuntime.currentPageIndex, readerRuntime.totalPages);
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) {
    return [];
  }

  const unique = new Set();
  for (const value of tags) {
    const tag = normalizeText(value).slice(0, 40);
    if (!tag) {
      continue;
    }
    unique.add(tag);
  }

  return [...unique];
}

function normalizeIsoTimestamp(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return undefined;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.valueOf())) {
    return undefined;
  }
  return date.toISOString();
}

function normalizeSavedHighlightQueryEntry(entry) {
  const id = String(entry?.id ?? '').trim();
  const name = normalizeText(entry?.name).slice(0, 80);
  const query = normalizeText(entry?.query).slice(0, 320);
  if (!id || !name || !query) {
    return null;
  }

  return {
    id,
    name,
    query,
    createdAt: normalizeIsoTimestamp(entry?.createdAt) || new Date().toISOString(),
  };
}

function normalizeSavedHighlightQueries(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  const result = [];
  const seen = new Set();
  for (const item of values) {
    const normalized = normalizeSavedHighlightQueryEntry(item);
    if (!normalized) {
      continue;
    }
    if (seen.has(normalized.id)) {
      continue;
    }
    seen.add(normalized.id);
    result.push(normalized);
  }

  return result.slice(0, 30);
}

function normalizeClientSettings(settings) {
  const allowedThemes = new Set(['light', 'sepia', 'contrast']);
  const theme = allowedThemes.has(settings?.theme) ? settings.theme : 'light';
  const pagesPerDay = Math.max(1, normalizePageIndex(settings?.goals?.pagesPerDay, 20));
  const pagesPerWeek = Math.max(pagesPerDay, normalizePageIndex(settings?.goals?.pagesPerWeek, 140));
  const manifestUrl = normalizeHttpUrl(settings?.updates?.manifestUrl);

  return {
    theme,
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
          : true,
    },
    savedHighlightQueries: normalizeSavedHighlightQueries(settings?.savedHighlightQueries),
  };
}

function applySettingsPatch(settingsPatch) {
  state.settings = normalizeClientSettings({
    ...state.settings,
    ...(settingsPatch || {}),
    goals: {
      ...state.settings.goals,
      ...(settingsPatch?.goals || {}),
    },
    updates: {
      ...(state.settings?.updates || {}),
      ...(settingsPatch?.updates || {}),
    },
  });
}

function applyTheme(theme) {
  const allowed = new Set(['light', 'sepia', 'contrast']);
  const nextTheme = allowed.has(theme) ? theme : 'light';
  document.documentElement.setAttribute('data-theme', nextTheme);
  state.settings.theme = nextTheme;
}

function getDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.valueOf())) {
    return '';
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getDateFromKey(dateKey) {
  const raw = normalizeText(dateKey);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return null;
  }

  const date = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(date.valueOf())) {
    return null;
  }

  return date;
}

function addDays(dateKey, daysDelta) {
  const baseDate = getDateFromKey(dateKey);
  if (!baseDate) {
    return '';
  }

  const next = new Date(baseDate);
  next.setDate(next.getDate() + Number(daysDelta || 0));
  return getDateKey(next);
}

function getWeekStartDateKey(dateKey = getDateKey()) {
  const date = getDateFromKey(dateKey) || new Date();
  const day = date.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + mondayOffset);
  return getDateKey(date);
}

function getReadingLogEntry(dateKey) {
  const entry = state.readingLog[dateKey];
  if (!entry) {
    return { pages: 0, seconds: 0 };
  }

  return {
    pages: normalizePageIndex(entry.pages, 0),
    seconds: normalizePageIndex(entry.seconds, 0),
  };
}

function getDailyStreak() {
  const todayKey = getDateKey();
  if (!todayKey) {
    return 0;
  }

  let streak = 0;
  let cursor = todayKey;
  while (cursor) {
    const entry = getReadingLogEntry(cursor);
    if (entry.pages <= 0 && entry.seconds <= 0) {
      break;
    }
    streak += 1;
    cursor = addDays(cursor, -1);
  }

  return streak;
}

function getReadingStreakStats() {
  const todayKey = getDateKey();
  if (!todayKey) {
    return {
      currentStreak: 0,
      bestStreak: 0,
      activeDaysLast7: 0,
      last7Pages: 0,
      last7Minutes: 0,
    };
  }

  const dateKeys = Object.keys(state.readingLog || {})
    .filter((key) => Boolean(getDateFromKey(key)))
    .sort();
  let bestStreak = 0;
  let runningStreak = 0;
  let previousActiveKey = '';

  for (const dateKey of dateKeys) {
    const entry = getReadingLogEntry(dateKey);
    const isActive = entry.pages > 0 || entry.seconds > 0;
    if (!isActive) {
      runningStreak = 0;
      previousActiveKey = '';
      continue;
    }

    if (previousActiveKey && addDays(previousActiveKey, 1) === dateKey) {
      runningStreak += 1;
    } else {
      runningStreak = 1;
    }
    bestStreak = Math.max(bestStreak, runningStreak);
    previousActiveKey = dateKey;
  }

  let activeDaysLast7 = 0;
  let last7Pages = 0;
  let last7Minutes = 0;
  for (let offset = 0; offset < 7; offset += 1) {
    const key = addDays(todayKey, -offset);
    const entry = getReadingLogEntry(key);
    if (entry.pages > 0 || entry.seconds > 0) {
      activeDaysLast7 += 1;
    }
    last7Pages += entry.pages;
    last7Minutes += Math.round(entry.seconds / 60);
  }

  return {
    currentStreak: getDailyStreak(),
    bestStreak,
    activeDaysLast7,
    last7Pages,
    last7Minutes,
  };
}

function getCalendarDays(daysCount = 28) {
  const safeDays = Math.max(7, normalizePageIndex(daysCount, 28));
  const cells = [];
  const todayKey = getDateKey();
  for (let index = safeDays - 1; index >= 0; index -= 1) {
    const key = addDays(todayKey, -index);
    const entry = getReadingLogEntry(key);
    const intensity = clamp(
      entry.pages / Math.max(1, state.settings.goals?.pagesPerDay ?? 20),
      0,
      1,
    );
    cells.push({
      key,
      pages: entry.pages,
      seconds: entry.seconds,
      intensity,
      isToday: key === todayKey,
    });
  }

  return cells;
}

function getMonthLabel(dateKey) {
  const date = getDateFromKey(dateKey);
  if (!date) {
    return '';
  }
  return new Intl.DateTimeFormat('ru-RU', { month: 'short' })
    .format(date)
    .replace('.', '');
}

function buildReadingCalendarHeatmap(weeksCount = 12) {
  const safeWeeks = Math.max(4, normalizePageIndex(weeksCount, 12));
  const todayKey = getDateKey();
  const currentWeekStart = getWeekStartDateKey(todayKey);
  const firstWeekStart = addDays(currentWeekStart, -((safeWeeks - 1) * 7));
  const dayGoal = Math.max(1, normalizePageIndex(state.settings?.goals?.pagesPerDay, 20));

  const weekdayLabels = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const weeks = [];
  const monthLabels = [];
  let previousMonth = '';
  let activeDays = 0;

  for (let weekIndex = 0; weekIndex < safeWeeks; weekIndex += 1) {
    const weekStartKey = addDays(firstWeekStart, weekIndex * 7);
    const month = getMonthLabel(weekStartKey);
    if (month && month !== previousMonth) {
      monthLabels.push({
        column: weekIndex + 1,
        label: month,
      });
      previousMonth = month;
    }

    const days = [];
    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      const key = addDays(weekStartKey, dayIndex);
      const entry = getReadingLogEntry(key);
      const hasReading = entry.pages > 0 || entry.seconds > 0;
      if (hasReading) {
        activeDays += 1;
      }
      const intensity = clamp(
        Math.max(entry.pages / dayGoal, entry.seconds / (35 * 60)),
        0,
        1,
      );
      days.push({
        key,
        pages: entry.pages,
        seconds: entry.seconds,
        level: Math.max(0, Math.ceil(intensity * 4)),
        isToday: key === todayKey,
      });
    }

    weeks.push({
      index: weekIndex,
      days,
    });
  }

  return {
    weeks,
    monthLabels,
    weekdayLabels,
    totalDays: safeWeeks * 7,
    activeDays,
    currentStreak: getDailyStreak(),
  };
}

function getGoalProgress() {
  const goals = state.settings?.goals || { pagesPerDay: 20, pagesPerWeek: 140 };
  const dayGoal = Math.max(1, normalizePageIndex(goals.pagesPerDay, 20));
  const weekGoal = Math.max(dayGoal, normalizePageIndex(goals.pagesPerWeek, 140));
  const todayKey = getDateKey();
  const weekStart = getWeekStartDateKey(todayKey);

  const todayPages = getReadingLogEntry(todayKey).pages;
  let weekPages = 0;
  for (let offset = 0; offset < 7; offset += 1) {
    const key = addDays(weekStart, offset);
    weekPages += getReadingLogEntry(key).pages;
  }

  return {
    todayPages,
    dayGoal,
    todayProgress: clamp(todayPages / dayGoal, 0, 1),
    weekPages,
    weekGoal,
    weekProgress: clamp(weekPages / weekGoal, 0, 1),
  };
}

function getDocumentProgressState(documentInfo) {
  const stats = getDocumentReadingStats(documentInfo);
  if (stats.totalPages <= 0 || stats.progress < 0.01) {
    return 'not-started';
  }
  if (stats.progress >= 0.98) {
    return 'completed';
  }
  return 'in-progress';
}

function formatDurationSeconds(totalSeconds) {
  const safeSeconds = normalizePageIndex(totalSeconds, 0);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  if (hours > 0) {
    return `${hours} ч ${minutes} мин`;
  }
  return `${minutes} мин`;
}

function generateLocalId(prefix = 'local') {
  const safePrefix = normalizeText(prefix) || 'local';
  if (globalThis.crypto?.randomUUID) {
    return `${safePrefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${safePrefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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

function normalizeUpdateState(value) {
  const allowedStatuses = new Set([
    'idle',
    'disabled',
    'up-to-date',
    'update-available',
    'error',
  ]);
  const status = allowedStatuses.has(value?.status) ? value.status : 'idle';

  return {
    status,
    updateAvailable: Boolean(value?.updateAvailable),
    currentVersion: normalizeText(value?.currentVersion),
    latestVersion: normalizeText(value?.latestVersion),
    manifestUrl: normalizeHttpUrl(value?.manifestUrl),
    checkedAt: normalizeIsoTimestamp(value?.checkedAt) || '',
    downloadUrl: normalizeHttpUrl(value?.downloadUrl),
    notes: normalizeText(value?.notes),
    publishedAt: normalizeIsoTimestamp(value?.publishedAt) || '',
    error: normalizeText(value?.error),
    autoCheckEnabled:
      typeof value?.autoCheckEnabled === 'boolean' ? value.autoCheckEnabled : true,
  };
}

function formatUpdateStatusLine(updateState) {
  const safe = normalizeUpdateState(updateState);
  if (safe.status === 'update-available') {
    return `Доступно обновление ${safe.latestVersion || 'новой версии'} (текущая ${safe.currentVersion || 'неизвестна'}).`;
  }
  if (safe.status === 'up-to-date') {
    return `У вас актуальная версия ${safe.currentVersion || ''}.`;
  }
  if (safe.status === 'disabled') {
    return safe.error || 'Проверка обновлений отключена.';
  }
  if (safe.status === 'error') {
    return safe.error || 'Не удалось проверить обновления.';
  }
  if (!safe.checkedAt) {
    return 'Проверка обновлений не выполнялась.';
  }
  return 'Состояние обновлений обновлено.';
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

function normalizeSelectionRawText(value) {
  return repairPdfTextArtifacts(value)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function normalizeHighlightSelectedText(value) {
  return normalizeText(
    normalizeSelectionRawText(value)
      .replace(/\n+/g, ' ')
      .replace(/\s{2,}/g, ' '),
  );
}

function wrapRichTextByStyle(html, styleText = '') {
  let output = html;
  const style = String(styleText ?? '').toLowerCase();
  if (!style || !output) {
    return output;
  }

  if (/vertical-align\s*:\s*super/.test(style)) {
    output = `<sup>${output}</sup>`;
  } else if (/vertical-align\s*:\s*sub/.test(style)) {
    output = `<sub>${output}</sub>`;
  }

  if (/text-decoration[^;]*underline/.test(style)) {
    output = `<u>${output}</u>`;
  }

  if (/font-style\s*:\s*italic/.test(style)) {
    output = `<em>${output}</em>`;
  }

  if (/font-weight\s*:\s*(bold|[6-9]00)/.test(style)) {
    output = `<strong>${output}</strong>`;
  }

  return output;
}

function sanitizeHighlightRichText(value) {
  const raw = String(value ?? '').trim();
  if (!raw || typeof DOMParser === 'undefined') {
    return '';
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${raw}</div>`, 'text/html');
  const root = doc.body.firstElementChild;
  if (!root) {
    return '';
  }

  const sanitizeNode = (node) => {
    if (!node) {
      return '';
    }

    if (node.nodeType === Node.TEXT_NODE) {
      return escapeHtml(node.textContent ?? '');
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return '';
    }

    const element = node;
    const tag = element.tagName.toLowerCase();
    if (tag === 'script' || tag === 'style') {
      return '';
    }

    if (tag === 'br') {
      return '<br>';
    }

    const childrenHtml = Array.from(element.childNodes).map(sanitizeNode).join('');
    if (!childrenHtml) {
      return '';
    }

    if (tag === 'b' || tag === 'strong') {
      return `<strong>${childrenHtml}</strong>`;
    }

    if (tag === 'i' || tag === 'em') {
      return `<em>${childrenHtml}</em>`;
    }

    if (tag === 'u') {
      return `<u>${childrenHtml}</u>`;
    }

    if (tag === 'sup') {
      return `<sup>${childrenHtml}</sup>`;
    }

    if (tag === 'sub') {
      return `<sub>${childrenHtml}</sub>`;
    }

    if (tag === 'p' || tag === 'div') {
      return `<p>${childrenHtml}</p>`;
    }

    if (tag === 'li') {
      return `<p>• ${childrenHtml}</p>`;
    }

    const styled = wrapRichTextByStyle(childrenHtml, element.getAttribute('style'));
    return styled;
  };

  const cleaned = Array.from(root.childNodes).map(sanitizeNode).join('');
  return cleaned
    .replace(/(?:<br>\s*){3,}/g, '<br><br>')
    .replace(/\s*<\/p>\s*<p>\s*/g, '</p><p>')
    .trim()
    .slice(0, MAX_RICH_TEXT_LENGTH);
}

function plainTextToRichText(value) {
  const normalized = normalizeSelectionRawText(value);
  if (!normalized) {
    return '';
  }

  return escapeHtml(normalized).replace(/\n/g, '<br>');
}

function selectionRangeToRichText(range, fallbackText = '') {
  if (!range) {
    return plainTextToRichText(fallbackText);
  }

  const wrapper = document.createElement('div');
  wrapper.appendChild(range.cloneContents());
  const richText = sanitizeHighlightRichText(wrapper.innerHTML);
  if (richText) {
    return richText;
  }

  return plainTextToRichText(fallbackText);
}

function selectionObjectToRichText(selection, fallbackText = '') {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return plainTextToRichText(fallbackText);
  }

  return selectionRangeToRichText(selection.getRangeAt(0), fallbackText);
}

function truncate(value, max = 140) {
  if (!value) {
    return '';
  }

  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function median(values) {
  if (!Array.isArray(values) || values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }

  return sorted[middle];
}

function toArrayBuffer(bytes) {
  const view = toUint8Array(bytes);
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}

function round5(value) {
  return Math.round(value * 100000) / 100000;
}

function waitMs(delay) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, delay);
  });
}

async function waitForReaderReady(documentId, timeoutMs = 3200) {
  const targetDocumentId = String(documentId ?? '');
  if (!targetDocumentId) {
    return false;
  }

  const deadline = Date.now() + Math.max(200, Number(timeoutMs) || 3200);
  while (Date.now() <= deadline) {
    const isSameDoc = state.currentDocument?.id === targetDocumentId;
    const readerOpen = state.view === 'reader';
    const notOpening = !readerRuntime.openingDocument;
    if (readerOpen && isSameDoc && notOpening) {
      if (READER_ENGINE !== 'webviewer') {
        return true;
      }
      if (webViewerRuntime.instance) {
        const pageCount = normalizePageIndex(
          webViewerRuntime.instance.Core.documentViewer.getPageCount(),
          0,
        );
        if (pageCount > 0) {
          return true;
        }
      }
    }
    await waitMs(45);
  }

  return false;
}

async function getWebViewerFactory() {
  if (!webViewerFactoryPromise) {
    webViewerFactoryPromise = import('@pdftron/webviewer')
      .then((module) => module?.default ?? module)
      .catch((error) => {
        webViewerFactoryPromise = null;
        throw error;
      });
  }

  return webViewerFactoryPromise;
}

async function getPdfJsLib() {
  if (pdfjsModule) {
    return pdfjsModule;
  }

  if (!pdfjsFactoryPromise) {
    pdfjsFactoryPromise = Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.mjs?url'),
    ])
      .then(([pdfjs, workerModule]) => {
        const resolvedPdfjs = pdfjs?.default ?? pdfjs;
        const workerSrc = workerModule?.default ?? workerModule;
        resolvedPdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
        pdfjsModule = resolvedPdfjs;
        return resolvedPdfjs;
      })
      .catch((error) => {
        pdfjsFactoryPromise = null;
        throw error;
      });
  }

  return pdfjsFactoryPromise;
}

function normalizeRect01(rect) {
  const x = clamp(Number(rect?.x ?? 0), 0, 1);
  const y = clamp(Number(rect?.y ?? 0), 0, 1);
  const w = clamp(Number(rect?.w ?? 0), 0, 1);
  const h = clamp(Number(rect?.h ?? 0), 0, 1);

  return { x, y, w, h };
}

function mergeNormalizedRects(rects) {
  const prepared = (rects ?? [])
    .map((rect) => normalizeRect01(rect))
    .filter((rect) => rect.w > 0.001 && rect.h > 0.001);

  if (prepared.length <= 1) {
    return prepared;
  }

  const medianHeight = Math.max(0.006, median(prepared.map((rect) => rect.h)));
  const lineTolerance = Math.max(0.004, medianHeight * 0.55);
  const gapTolerance = Math.max(0.003, medianHeight * 0.72);

  const sorted = [...prepared].sort((a, b) => {
    const aCenterY = a.y + a.h * 0.5;
    const bCenterY = b.y + b.h * 0.5;
    if (Math.abs(aCenterY - bCenterY) > lineTolerance) {
      return aCenterY - bCenterY;
    }
    return a.x - b.x;
  });

  const merged = [];

  for (const rect of sorted) {
    const current = {
      x: round5(rect.x),
      y: round5(rect.y),
      w: round5(rect.w),
      h: round5(rect.h),
    };

    const previous = merged[merged.length - 1];
    if (!previous) {
      merged.push(current);
      continue;
    }

    const previousCenterY = previous.y + previous.h * 0.5;
    const currentCenterY = current.y + current.h * 0.5;
    const sameLine = Math.abs(previousCenterY - currentCenterY) <= lineTolerance;
    const previousRight = previous.x + previous.w;
    const currentRight = current.x + current.w;
    const intersectsOrNear = current.x <= previousRight + gapTolerance;

    if (sameLine && intersectsOrNear) {
      const left = Math.min(previous.x, current.x);
      const top = Math.min(previous.y, current.y);
      const right = Math.max(previousRight, currentRight);
      const bottom = Math.max(previous.y + previous.h, current.y + current.h);
      previous.x = round5(left);
      previous.y = round5(top);
      previous.w = round5(right - left);
      previous.h = round5(bottom - top);
      continue;
    }

    merged.push(current);
  }

  return merged
    .map((rect) => normalizeRect01(rect))
    .filter((rect) => rect.w > 0.001 && rect.h > 0.001);
}

function webViewerColorToHighlight(color) {
  const r = Number(color?.R ?? 255);
  const g = Number(color?.G ?? 235);
  const b = Number(color?.B ?? 120);

  const distance = (targetR, targetG, targetB) =>
    Math.abs(r - targetR) + Math.abs(g - targetG) + Math.abs(b - targetB);

  const candidates = [
    { color: 'yellow', score: distance(245, 210, 85) },
    { color: 'green', score: distance(98, 214, 130) },
    { color: 'pink', score: distance(241, 130, 176) },
  ];

  candidates.sort((a, b) => a.score - b.score);
  return candidates[0]?.color ?? 'yellow';
}

function highlightToWebViewerColor(color, Annotations) {
  if (color === 'green') {
    return new Annotations.Color(98, 214, 130, 0.28);
  }

  if (color === 'pink') {
    return new Annotations.Color(241, 130, 176, 0.27);
  }

  return new Annotations.Color(245, 210, 85, 0.3);
}

function buildQuadSignature(quads = []) {
  return quads
    .map((quad) => {
      return [
        round5(quad?.x1 ?? 0),
        round5(quad?.y1 ?? 0),
        round5(quad?.x2 ?? 0),
        round5(quad?.y2 ?? 0),
        round5(quad?.x3 ?? 0),
        round5(quad?.y3 ?? 0),
        round5(quad?.x4 ?? 0),
        round5(quad?.y4 ?? 0),
      ].join(':');
    })
    .join('|');
}

function webViewerQuadToNormalizedRect(quad, pageInfo) {
  const pageWidth = Math.max(1, Number(pageInfo?.width ?? 1));
  const pageHeight = Math.max(1, Number(pageInfo?.height ?? 1));
  const xs = [quad?.x1, quad?.x2, quad?.x3, quad?.x4]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
  const ys = [quad?.y1, quad?.y2, quad?.y3, quad?.y4]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));

  if (xs.length === 0 || ys.length === 0) {
    return null;
  }

  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const lower = Math.min(...ys);
  const upper = Math.max(...ys);

  const x = clamp(left / pageWidth, 0, 1);
  const y = clamp((pageHeight - upper) / pageHeight, 0, 1);
  const w = clamp((right - left) / pageWidth, 0, 1);
  const h = clamp((upper - lower) / pageHeight, 0, 1);

  if (w <= 0.001 || h <= 0.001) {
    return null;
  }

  return { x, y, w, h };
}

function normalizedRectToWebViewerQuad(rect, pageInfo, MathCore) {
  const pageWidth = Math.max(1, Number(pageInfo?.width ?? 1));
  const pageHeight = Math.max(1, Number(pageInfo?.height ?? 1));
  const left = clamp(Number(rect?.x ?? 0), 0, 1) * pageWidth;
  const right = clamp(Number(rect?.x ?? 0) + Number(rect?.w ?? 0), 0, 1) * pageWidth;
  const top = pageHeight - clamp(Number(rect?.y ?? 0), 0, 1) * pageHeight;
  const bottom =
    pageHeight -
    clamp(Number(rect?.y ?? 0) + Number(rect?.h ?? 0), 0, 1) * pageHeight;

  return new MathCore.Quad(left, bottom, right, bottom, right, top, left, top);
}

function sortHighlightsForDocument(highlights) {
  return [...highlights].sort((a, b) => {
    if (a.pageIndex === b.pageIndex) {
      return new Date(a.createdAt).valueOf() - new Date(b.createdAt).valueOf();
    }
    return a.pageIndex - b.pageIndex;
  });
}

function normalizeHighlightStateEntry(highlight, fallbackDocumentId = '') {
  const documentId = String(highlight?.documentId ?? fallbackDocumentId ?? '');
  const selectedText = normalizeHighlightSelectedText(highlight?.selectedText);
  const selectedRichText =
    sanitizeHighlightRichText(highlight?.selectedRichText) ||
    plainTextToRichText(selectedText);
  const reviewLastGradeRaw = normalizeText(highlight?.reviewLastGrade).toLowerCase();
  const reviewLastGrade =
    reviewLastGradeRaw === 'hard' ||
    reviewLastGradeRaw === 'good' ||
    reviewLastGradeRaw === 'easy'
      ? reviewLastGradeRaw
      : undefined;

  return {
    ...highlight,
    id: String(highlight?.id ?? ''),
    documentId,
    pageIndex: normalizePageIndex(highlight?.pageIndex, 0),
    rects: mergeNormalizedRects(highlight?.rects ?? []),
    selectedText,
    selectedRichText: selectedRichText || undefined,
    color: HIGHLIGHT_COLORS.includes(highlight?.color) ? highlight.color : 'yellow',
    note: normalizeText(highlight?.note) || undefined,
    tags: normalizeTags(highlight?.tags),
    reviewCount: normalizePageIndex(highlight?.reviewCount, 0),
    reviewIntervalDays: normalizePageIndex(highlight?.reviewIntervalDays, 0),
    lastReviewedAt: normalizeIsoTimestamp(highlight?.lastReviewedAt),
    nextReviewAt: normalizeIsoTimestamp(highlight?.nextReviewAt),
    reviewLastGrade,
    createdAt: String(highlight?.createdAt ?? new Date().toISOString()),
  };
}

function normalizeHighlightsCollection(highlights, documentId = '') {
  return sortHighlightsForDocument(
    (Array.isArray(highlights) ? highlights : [])
      .map((highlight) => normalizeHighlightStateEntry(highlight, documentId))
      .filter((highlight) => highlight.id && highlight.documentId),
  );
}

function updateHighlightsForDocument(documentId, highlights) {
  const id = String(documentId ?? '');
  if (!id) {
    return;
  }

  const normalized = normalizeHighlightsCollection(highlights, id);
  state.highlightsByDocument[id] = normalized;

  if (state.currentDocument?.id === id) {
    state.currentHighlights = [...normalized];
    updateMiniMap();
  }
}

function hydrateHighlightsByDocumentMap(allHighlights = []) {
  const nextMap = {};

  for (const doc of state.documents) {
    nextMap[doc.id] = [];
  }

  for (const highlight of allHighlights) {
    const normalized = normalizeHighlightStateEntry(highlight);
    if (!normalized.id || !normalized.documentId) {
      continue;
    }

    if (!Array.isArray(nextMap[normalized.documentId])) {
      nextMap[normalized.documentId] = [];
    }

    nextMap[normalized.documentId].push(normalized);
  }

  for (const [documentId, items] of Object.entries(nextMap)) {
    nextMap[documentId] = sortHighlightsForDocument(items);
  }

  state.highlightsByDocument = nextMap;
  if (state.currentDocument?.id) {
    state.currentHighlights = [...(nextMap[state.currentDocument.id] ?? [])];
  }
}

function getDocumentTitleById(documentId) {
  return (
    state.documents.find((doc) => doc.id === documentId)?.title ||
    (state.currentDocument?.id === documentId ? state.currentDocument.title : '') ||
    'Без названия'
  );
}

function getAllKnownHighlights() {
  const highlights = [];
  for (const doc of state.documents) {
    const items = state.highlightsByDocument[doc.id] ?? [];
    for (const highlight of items) {
      highlights.push(highlight);
    }
  }
  return highlights;
}

function upsertCurrentHighlight(highlight) {
  const normalized = normalizeHighlightStateEntry(highlight, state.currentDocument?.id);
  if (!normalized.id || !normalized.documentId) {
    return;
  }

  const bucket = [...(state.highlightsByDocument[normalized.documentId] ?? [])];
  const index = bucket.findIndex((item) => item.id === normalized.id);
  if (index >= 0) {
    bucket[index] = normalized;
  } else {
    bucket.push(normalized);
  }

  state.highlightsByDocument[normalized.documentId] = sortHighlightsForDocument(bucket);

  if (state.currentDocument?.id === normalized.documentId) {
    state.currentHighlights = [...state.highlightsByDocument[normalized.documentId]];
  }

  updateMiniMap();
}

function findHighlightById(highlightId, preferredDocumentId = '') {
  const id = String(highlightId ?? '');
  if (!id) {
    return null;
  }

  const preferred = String(preferredDocumentId ?? '');
  const searchOrder = [];
  if (preferred) {
    searchOrder.push(preferred);
  }
  if (state.currentDocument?.id && !searchOrder.includes(state.currentDocument.id)) {
    searchOrder.push(state.currentDocument.id);
  }

  for (const docId of Object.keys(state.highlightsByDocument)) {
    if (!searchOrder.includes(docId)) {
      searchOrder.push(docId);
    }
  }

  for (const docId of searchOrder) {
    const match = (state.highlightsByDocument[docId] ?? []).find((item) => item.id === id);
    if (match) {
      return { highlight: match, documentId: docId };
    }
  }

  const fallbackCurrent = state.currentHighlights.find((item) => item.id === id) ?? null;
  if (fallbackCurrent) {
    return { highlight: fallbackCurrent, documentId: fallbackCurrent.documentId };
  }

  return null;
}

function removeCurrentHighlight(highlightId, preferredDocumentId = '') {
  const found = findHighlightById(highlightId, preferredDocumentId);
  if (!found) {
    return null;
  }

  const { highlight, documentId } = found;
  const nextBucket = (state.highlightsByDocument[documentId] ?? []).filter(
    (item) => item.id !== highlight.id,
  );
  state.highlightsByDocument[documentId] = nextBucket;

  if (state.currentDocument?.id === documentId) {
    state.currentHighlights = [...nextBucket];
  }

  updateMiniMap();

  return highlight;
}

async function deleteHighlightById(highlightId, options = {}) {
  const showError = Boolean(options.showError);
  const skipViewerDelete = Boolean(options.skipViewerDelete);
  const preferredDocumentId = String(options.documentId ?? state.currentDocument?.id ?? '');
  const removed = removeCurrentHighlight(highlightId, preferredDocumentId);

  if (!removed) {
    return { deleted: false };
  }

  decrementDocumentHighlightCount(removed.documentId);
  state.selectedHighlightIds = state.selectedHighlightIds.filter((id) => id !== String(highlightId));
  if (state.focusHighlightId === highlightId) {
    state.focusHighlightId = null;
  }
  updateReaderHeader();
  updateHighlightsSummary();
  renderHighlightsList();

  if (!skipViewerDelete) {
    removeWebViewerHighlightAnnotation(highlightId);
  }

  try {
    const result = await window.recallApi.deleteHighlight(highlightId);
    if (!result?.deleted) {
      throw new Error('Выделение не найдено.');
    }

    return { deleted: true };
  } catch (error) {
    upsertCurrentHighlight(removed);
    incrementDocumentHighlightCount(removed.documentId);
    updateReaderHeader();
    updateHighlightsSummary();
    renderHighlightsList();

    if (showError) {
      setReaderMessage(
        `Не удалось удалить выделение: ${error?.message ?? 'неизвестная ошибка'}`,
        true,
      );
    }

    return { deleted: false, error };
  }
}

function setLibraryError(message) {
  state.libraryError = message || '';
}

function setLibraryInfo(message) {
  state.libraryInfo = message || '';
}

function isMissingIpcHandlerError(error, channelName = '') {
  const message = String(error?.message || '');
  if (!message.includes('No handler registered for')) {
    return false;
  }

  if (!channelName) {
    return true;
  }

  return message.includes(`'${channelName}'`);
}

async function safeOptionalIpcCall(call, fallbackValue, channelName) {
  try {
    return await call();
  } catch (error) {
    if (isMissingIpcHandlerError(error, channelName)) {
      return fallbackValue;
    }
    throw error;
  }
}

function setReaderMessage(message, asError = false) {
  state.readerMessage = asError ? '' : message || '';
  state.readerError = asError ? message || '' : '';

  const messageNode = document.querySelector('#reader-message');
  const errorNode = document.querySelector('#reader-error');

  if (messageNode) {
    messageNode.textContent = state.readerMessage;
    messageNode.classList.toggle('hidden', !state.readerMessage);
  }

  if (errorNode) {
    errorNode.textContent = state.readerError;
    errorNode.classList.toggle('hidden', !state.readerError);
  }
}

function destroyReaderSplit() {
  if (readerRuntime.splitInstance?.destroy) {
    readerRuntime.splitInstance.destroy();
  }
  readerRuntime.splitInstance = null;
}

function teardownReaderLayout() {
  destroyReaderSplit();
  readerRuntime.openingDocument = false;
  readerRuntime.openGuardPageIndex = -1;
  readerRuntime.openGuardUntilTs = 0;
  readerRuntime.allowFirstPagePersistUntilTs = 0;
  readerRuntime.allowFirstPagePersistDocumentId = '';

  if (readerRuntime.resizeHandler) {
    window.removeEventListener('resize', readerRuntime.resizeHandler);
    readerRuntime.resizeHandler = null;
  }

  if (readerRuntime.pageSyncTimer) {
    window.clearInterval(readerRuntime.pageSyncTimer);
    readerRuntime.pageSyncTimer = null;
  }
}

function clearOpenPageGuard() {
  readerRuntime.openGuardPageIndex = -1;
  readerRuntime.openGuardUntilTs = 0;
}

function armOpenPageGuard(pageIndex, durationMs = 2600) {
  readerRuntime.openGuardPageIndex = Math.max(0, normalizePageIndex(pageIndex, 0));
  readerRuntime.openGuardUntilTs = Date.now() + Math.max(250, Number(durationMs) || 2600);
}

function isOpenPageGuardActive() {
  return (
    readerRuntime.openGuardPageIndex >= 0 &&
    Date.now() <= Number(readerRuntime.openGuardUntilTs || 0)
  );
}

function allowFirstPagePersist(durationMs = 15000) {
  const currentDocumentId = String(state.currentDocument?.id ?? '');
  if (!currentDocumentId) {
    return;
  }

  readerRuntime.allowFirstPagePersistDocumentId = currentDocumentId;
  readerRuntime.allowFirstPagePersistUntilTs = Date.now() + Math.max(3000, Number(durationMs) || 15000);
}

function clearFirstPagePersistAllowance() {
  readerRuntime.allowFirstPagePersistUntilTs = 0;
  readerRuntime.allowFirstPagePersistDocumentId = '';
}

function canPersistFirstPageForCurrentDocument() {
  const currentDocumentId = String(state.currentDocument?.id ?? '');
  if (!currentDocumentId) {
    return false;
  }

  return (
    readerRuntime.allowFirstPagePersistDocumentId === currentDocumentId &&
    Date.now() <= Number(readerRuntime.allowFirstPagePersistUntilTs || 0)
  );
}

function syncWebViewerCurrentPage(options = {}) {
  const force = Boolean(options.force);

  if (
    READER_ENGINE !== 'webviewer' ||
    state.view !== 'reader' ||
    !webViewerRuntime.instance ||
    !state.currentDocument?.id
  ) {
    return;
  }

  const guardActive = isOpenPageGuardActive();
  if (readerRuntime.openingDocument && !force && !guardActive) {
    return;
  }

  const { documentViewer } = webViewerRuntime.instance.Core;
  const rawTotalPages = normalizePageIndex(documentViewer.getPageCount(), 0);
  const knownTotalPages = Math.max(1, normalizePageIndex(readerRuntime.totalPages, 1));
  if (rawTotalPages <= 0 && !force && !guardActive && knownTotalPages <= 1) {
    return;
  }
  if (
    readerRuntime.openingDocument &&
    rawTotalPages <= 1 &&
    knownTotalPages > 1 &&
    !force &&
    !guardActive
  ) {
    return;
  }
  const totalPages = Math.max(1, rawTotalPages, knownTotalPages);
  const guardPageIndex = guardActive
    ? clampPageIndex(readerRuntime.openGuardPageIndex, totalPages)
    : -1;
  const rawPageNumber = Number(documentViewer.getCurrentPage());
  const hasValidPageNumber = Number.isFinite(rawPageNumber) && rawPageNumber > 0;
  if (!hasValidPageNumber && !force && !guardActive) {
    return;
  }
  const fallbackPageNumber = guardActive
    ? guardPageIndex + 1
    : clampPageIndex(readerRuntime.currentPageIndex, totalPages) + 1;
  const safePageNumber = hasValidPageNumber ? rawPageNumber : fallbackPageNumber;
  const nextPageIndex = clamp(
    normalizePageIndex(safePageNumber, fallbackPageNumber) - 1,
    0,
    Math.max(0, totalPages - 1),
  );

  if (guardActive) {
    if (nextPageIndex !== guardPageIndex) {
      requestWebViewerPageIndex(guardPageIndex);
      if (readerRuntime.currentPageIndex !== guardPageIndex) {
        setCurrentPageIndex(guardPageIndex, {
          persist: false,
        });
      } else {
        updateReaderControls();
        updateReaderHeader();
        updateHighlightsSummary();
        updateMiniMap();
      }
      webViewerRuntime.lastKnownPageIndex = guardPageIndex;
      return;
    }
  } else if (readerRuntime.openGuardPageIndex >= 0) {
    clearOpenPageGuard();
  }

  const pageChanged = nextPageIndex !== readerRuntime.currentPageIndex;
  const totalChanged = totalPages !== readerRuntime.totalPages;
  if (!pageChanged && !totalChanged && webViewerRuntime.lastKnownPageIndex === nextPageIndex) {
    return;
  }

  readerRuntime.totalPages = totalPages;
  if (pageChanged) {
    setCurrentPageIndex(nextPageIndex);
  } else {
    updateReaderControls();
    updateReaderHeader();
    updateHighlightsSummary();
    updateMiniMap();
  }
  webViewerRuntime.lastKnownPageIndex = nextPageIndex;
}

function requestWebViewerPageIndex(pageIndex) {
  if (READER_ENGINE !== 'webviewer' || !webViewerRuntime.instance) {
    return;
  }

  const safeIndex = Math.max(0, normalizePageIndex(pageIndex, 0));
  const pageNumber = safeIndex + 1;
  const { UI, Core } = webViewerRuntime.instance;

  if (typeof UI.setCurrentPage === 'function') {
    try {
      UI.setCurrentPage(pageNumber);
    } catch {
      // Ignore API differences across WebViewer versions.
    }
  }

  try {
    Core.documentViewer.setCurrentPage(pageNumber);
  } catch {
    // Ignore transient errors while document is still initializing.
  }
}

async function settleWebViewerCurrentPage(targetPageIndex, timeoutMs = 1400) {
  if (!webViewerRuntime.instance || READER_ENGINE !== 'webviewer') {
    return {
      pageIndex: getCurrentPageIndexSafe(readerRuntime.totalPages),
      matchedTarget: false,
    };
  }

  const safeTarget = Math.max(0, normalizePageIndex(targetPageIndex, 0));
  armOpenPageGuard(safeTarget, Math.max(5000, Number(timeoutMs) || 2200));
  const readViewerCurrentPageIndex = () => {
    if (!webViewerRuntime.instance || READER_ENGINE !== 'webviewer') {
      return getCurrentPageIndexSafe(readerRuntime.totalPages);
    }

    const { documentViewer } = webViewerRuntime.instance.Core;
    const totalPages = Math.max(1, normalizePageIndex(documentViewer.getPageCount(), readerRuntime.totalPages));
    const rawPageNumber = Number(documentViewer.getCurrentPage());
    if (!Number.isFinite(rawPageNumber) || rawPageNumber <= 0) {
      return clampPageIndex(readerRuntime.currentPageIndex, totalPages);
    }

    return clampPageIndex(rawPageNumber - 1, totalPages);
  };
  const deadline = Date.now() + Math.max(200, Number(timeoutMs) || 1400);
  while (Date.now() < deadline) {
    requestWebViewerPageIndex(safeTarget);
    syncWebViewerCurrentPage({ force: true });
    const current = readViewerCurrentPageIndex();
    if (current === safeTarget) {
      return {
        pageIndex: current,
        matchedTarget: true,
      };
    }
    await waitMs(55);
  }

  syncWebViewerCurrentPage({ force: true });
  const current = readViewerCurrentPageIndex();
  return {
    pageIndex: current,
    matchedTarget: current === safeTarget,
  };
}

function startWebViewerPageSync() {
  if (readerRuntime.pageSyncTimer) {
    window.clearInterval(readerRuntime.pageSyncTimer);
    readerRuntime.pageSyncTimer = null;
  }

  if (READER_ENGINE !== 'webviewer') {
    return;
  }

  readerRuntime.pageSyncTimer = window.setInterval(() => {
    syncWebViewerCurrentPage();
  }, 150);
}

function setupReaderSplitLayout() {
  destroyReaderSplit();

  if (state.settings.focusMode) {
    return;
  }

  const documentPane = document.querySelector('#reader-document-pane');
  const notesPane = document.querySelector('#reader-notes-pane');
  if (!documentPane || !notesPane) {
    return;
  }

  if (window.innerWidth <= 1100) {
    return;
  }

  readerRuntime.splitInstance = Split([documentPane, notesPane], {
    sizes: [74, 26],
    minSize: [420, 300],
    gutterSize: 10,
    snapOffset: 18,
    cursor: 'col-resize',
    onDragEnd: () => {
      if (READER_ENGINE === 'webviewer' && webViewerRuntime.instance) {
        try {
          webViewerRuntime.instance.UI.resize();
        } catch {
          // ignore viewer resize failures during rapid drag.
        }
      }
    },
  });
}

function incrementDocumentHighlightCount(documentId) {
  const libraryDocument = state.documents.find((doc) => doc.id === documentId);
  if (libraryDocument) {
    libraryDocument.highlightsCount = (libraryDocument.highlightsCount ?? 0) + 1;
  }

  if (state.currentDocument?.id === documentId) {
    state.currentDocument.highlightsCount =
      (state.currentDocument.highlightsCount ?? 0) + 1;
  }
}

function decrementDocumentHighlightCount(documentId) {
  const libraryDocument = state.documents.find((doc) => doc.id === documentId);
  if (libraryDocument) {
    libraryDocument.highlightsCount = Math.max(0, (libraryDocument.highlightsCount ?? 0) - 1);
  }

  if (state.currentDocument?.id === documentId) {
    state.currentDocument.highlightsCount = Math.max(
      0,
      (state.currentDocument.highlightsCount ?? 0) - 1,
    );
  }
}

function upsertDocumentInState(documentInfo) {
  if (!documentInfo?.id) {
    return;
  }

  const rawScale = Number(documentInfo.lastReadScale);
  const normalizedScale =
    Number.isFinite(rawScale) && rawScale > 0 ? normalizeScale(rawScale, rawScale) : undefined;
  const normalizedTotalPages = normalizePageIndex(documentInfo.lastReadTotalPages, 0) || undefined;
  const normalizedLastReadPageIndex = normalizedTotalPages
    ? clamp(normalizePageIndex(documentInfo.lastReadPageIndex, 0), 0, normalizedTotalPages - 1)
    : normalizePageIndex(documentInfo.lastReadPageIndex, 0);
  const normalizedMaxReadPageIndexRaw = normalizePageIndex(
    documentInfo.maxReadPageIndex,
    normalizedLastReadPageIndex,
  );
  const normalizedMaxReadPageIndex = normalizedTotalPages
    ? clamp(normalizedMaxReadPageIndexRaw, normalizedLastReadPageIndex, normalizedTotalPages - 1)
    : Math.max(normalizedLastReadPageIndex, normalizedMaxReadPageIndexRaw);

  const next = {
    ...documentInfo,
    lastReadPageIndex: normalizedLastReadPageIndex,
    maxReadPageIndex: normalizedMaxReadPageIndex,
    lastReadTotalPages: normalizedTotalPages,
    lastReadScale: normalizedScale,
    totalReadingSeconds: normalizePageIndex(documentInfo.totalReadingSeconds, 0),
    isPinned: Boolean(documentInfo.isPinned),
    collectionId: normalizeText(documentInfo.collectionId) || undefined,
  };

  const index = state.documents.findIndex((doc) => doc.id === next.id);
  if (index >= 0) {
    state.documents[index] = {
      ...state.documents[index],
      ...next,
    };
  } else {
    state.documents.push(next);
  }

  if (state.currentDocument?.id === next.id) {
    state.currentDocument = {
      ...state.currentDocument,
      ...next,
    };
  }
}

function getDocumentResumeOptions(documentId) {
  const id = String(documentId ?? '');
  if (!id) {
    return {};
  }

  const documentInfo =
    state.documents.find((item) => item.id === id) ??
    (state.currentDocument?.id === id ? state.currentDocument : null);

  if (!documentInfo) {
    return {};
  }

  const options = {};

  const rawScale = Number(documentInfo.lastReadScale);
  if (Number.isFinite(rawScale) && rawScale > 0) {
    options.focusScale = normalizeScale(rawScale, rawScale);
  }

  return options;
}

function getTabsMarkup(activeView) {
  const hasDocument = Boolean(state.currentDocument?.id);
  const hasAnyDocument = state.documents.length > 0;
  const tabIcons = {
    library: 'library-big',
    reader: 'book-open-text',
    highlights: 'highlighter',
  };

  const buildTab = (view, label) => {
    const isActive = activeView === view;
    const isLocked =
      (view === 'reader' && !hasDocument) ||
      (view === 'highlights' && !hasAnyDocument);
    const iconName = tabIcons[view] || 'library-big';

    return `
      <button
        class="app-tab-btn ${isActive ? 'is-active' : ''}"
        data-app-tab="${view}"
        title="${label}"
        aria-label="${label}"
        ${isLocked ? 'disabled' : ''}
      >
        ${renderIcon(iconName)}
        <span class="tab-label">${label}</span>
      </button>
    `;
  };

  return `
    <nav class="app-tabs" aria-label="Разделы приложения">
      ${buildTab('library', 'Библиотека')}
      ${buildTab('reader', 'Читалка')}
      ${buildTab('highlights', 'Хайлайты')}
    </nav>
  `;
}

function buildCommandPaletteCandidates() {
  const items = [
    {
      id: 'goto-library',
      kind: 'goto-library',
      title: 'Перейти: Библиотека',
      subtitle: 'Список книг и чтение-прогресс',
      keywords: ['библиотека', 'library', 'главная'],
      weight: 90,
    },
    {
      id: 'goto-highlights',
      kind: 'goto-highlights',
      title: 'Перейти: Хайлайты',
      subtitle: 'Глобальный список выделений',
      keywords: ['хайлайты', 'поиск', 'highlights'],
      weight: 85,
    },
    {
      id: 'import-pdf',
      kind: 'import-pdf',
      title: 'Импорт PDF',
      subtitle: 'Выбрать файлы и добавить в библиотеку',
      keywords: ['import', 'pdf', 'добавить'],
      weight: 88,
    },
    {
      id: 'reveal-data',
      kind: 'reveal-data',
      title: 'Открыть папку данных',
      subtitle: 'Показать userData, документы и экспорты',
      keywords: ['папка', 'данные', 'exports', 'userData'],
      weight: 65,
    },
  ];

  if (state.currentDocument?.id) {
    items.push(
      {
        id: 'goto-reader-current',
        kind: 'goto-reader-current',
        title: `Открыть читалку: ${state.currentDocument.title}`,
        subtitle: 'Возврат к месту чтения',
        keywords: ['reader', 'читалка', 'resume', state.currentDocument.title],
        weight: 96,
      },
      {
        id: 'export-markdown-current',
        kind: 'export-markdown-current',
        title: 'Экспорт Markdown (текущая книга)',
        subtitle: state.currentDocument.title,
        keywords: ['экспорт', 'markdown', 'md'],
        weight: 72,
      },
      {
        id: 'export-pdf-current',
        kind: 'export-pdf-current',
        title: 'Экспорт Annotated PDF (текущая книга)',
        subtitle: state.currentDocument.title,
        keywords: ['экспорт', 'pdf', 'annotated', 'подсветки'],
        weight: 72,
      },
      {
        id: 'reset-progress-current',
        kind: 'reset-progress-current',
        title: 'Сброс прогресса чтения (текущая книга)',
        subtitle: state.currentDocument.title,
        keywords: ['сброс', 'прогресс', 'reset'],
        weight: 58,
      },
      {
        id: 'toggle-focus',
        kind: 'toggle-focus',
        title: state.settings.focusMode ? 'Выключить фокус-режим' : 'Включить фокус-режим',
        subtitle: 'Скрыть/показать правую панель Reader',
        keywords: ['focus', 'режим', 'панель'],
        weight: 61,
      },
    );
  }

  if (state.documents.length > 0) {
    const docs = [...state.documents].sort((a, b) => {
      if (a.isPinned !== b.isPinned) {
        return a.isPinned ? -1 : 1;
      }
      return (
        new Date(b.lastOpenedAt || b.createdAt).valueOf() -
        new Date(a.lastOpenedAt || a.createdAt).valueOf()
      );
    });

    for (const doc of docs.slice(0, 40)) {
      const stats = getDocumentReadingStats(doc);
      const subtitle =
        stats.totalPages > 0
          ? `${Math.round(stats.progress * 100)}% · стр. ${stats.pageNumber}/${stats.totalPages}`
          : 'Не начато';
      items.push({
        id: `open-doc:${doc.id}`,
        kind: 'open-document',
        documentId: doc.id,
        title: `Открыть: ${doc.title}`,
        subtitle,
        keywords: [doc.title, 'книга', 'open', doc.id.slice(0, 12)],
        weight: 54,
      });
    }
  }

  const savedPresets = getSavedHighlightQueryPresets();
  for (const preset of savedPresets.slice(0, 20)) {
    items.push({
      id: `apply-query:${preset.id}`,
      kind: 'apply-saved-query',
      presetId: preset.id,
      title: `Пресет: ${preset.name}`,
      subtitle: preset.query,
      keywords: ['пресет', 'query', 'поиск', preset.name, preset.query],
      weight: 70,
    });
  }

  const reviewScope = getHighlightsScope();
  const dueCount = getDueHighlightsForScope(reviewScope).length;
  if (dueCount > 0) {
    items.push({
      id: 'start-review-session',
      kind: 'start-review-session',
      title: `Повторение выделений (${dueCount})`,
      subtitle: 'Запустить SRS-сессию по текущему контексту',
      keywords: ['повторение', 'review', 'srs', 'хайлайты'],
      weight: 84,
    });
  }

  const rawQuery = normalizeText(state.commandPaletteQuery);
  if (rawQuery) {
    items.push({
      id: 'search-highlights',
      kind: 'search-highlights',
      query: rawQuery,
      title: `Искать хайлайты: ${rawQuery}`,
      subtitle: 'Откроет вкладку «Хайлайты» и применит запрос',
      keywords: ['search', 'поиск', 'операторы', rawQuery],
      weight: 120,
    });
  }

  return items;
}

function scoreCommandPaletteItem(item, query, tokens = []) {
  if (!query) {
    return Number(item.weight || 0);
  }

  const title = normalizeSearchTerm(item.title);
  const subtitle = normalizeSearchTerm(item.subtitle);
  const keywords = Array.isArray(item.keywords) ? item.keywords.join(' ') : '';
  const haystack = `${title} ${subtitle} ${normalizeSearchTerm(keywords)}`.trim();

  let score = Number(item.weight || 0);
  if (title.startsWith(query)) {
    score += 60;
  }
  if (haystack.includes(query)) {
    score += 36;
  }

  let tokenHits = 0;
  for (const token of tokens) {
    if (token.length < 2) {
      continue;
    }
    if (haystack.includes(token)) {
      tokenHits += 1;
      score += 10;
    }
  }

  if (tokens.length > 0 && tokenHits === 0 && !haystack.includes(query)) {
    return null;
  }

  return score;
}

function refreshCommandPaletteItems() {
  const rawQuery = normalizeSearchTerm(state.commandPaletteQuery);
  const queryTokens = tokenizeQuery(rawQuery);
  const scored = [];

  for (const item of buildCommandPaletteCandidates()) {
    const score = scoreCommandPaletteItem(item, rawQuery, queryTokens);
    if (score === null) {
      continue;
    }
    scored.push({ item, score });
  }

  scored.sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title, 'ru'));
  state.commandPaletteItems = scored.slice(0, 32).map((entry) => entry.item);

  if (state.commandPaletteItems.length === 0) {
    state.commandPaletteSelectedIndex = 0;
    return;
  }
  state.commandPaletteSelectedIndex = clamp(
    state.commandPaletteSelectedIndex,
    0,
    state.commandPaletteItems.length - 1,
  );
}

function getCommandPaletteListMarkup() {
  if (!state.commandPaletteItems.length) {
    return '<div class="command-palette-empty">Ничего не найдено. Попробуйте другой запрос.</div>';
  }

  return state.commandPaletteItems
    .map((item, index) => {
      const isSelected = index === state.commandPaletteSelectedIndex;
      return `
        <button
          class="command-palette-item ${isSelected ? 'is-selected' : ''}"
          type="button"
          data-command-index="${index}"
        >
          <span class="command-palette-item-title">${escapeHtml(item.title)}</span>
          <span class="command-palette-item-subtitle">${escapeHtml(item.subtitle || '')}</span>
        </button>
      `;
    })
    .join('');
}

function getCommandPaletteMarkup() {
  return `
    <section
      id="command-palette-root"
      class="command-palette-root ${state.commandPaletteOpen ? '' : 'hidden'}"
      aria-hidden="${state.commandPaletteOpen ? 'false' : 'true'}"
    >
      <button
        class="command-palette-backdrop"
        type="button"
        aria-label="Закрыть"
        data-action="close-command-palette"
      ></button>
      <div class="command-palette-panel" role="dialog" aria-modal="true" aria-label="Командная палитра">
        <div class="command-palette-input-row">
          <input
            id="command-palette-input"
            type="search"
            placeholder="Команда, книга или запрос хайлайтов..."
            value="${escapeHtml(state.commandPaletteQuery)}"
            autocomplete="off"
          />
          <button class="ghost-btn" type="button" data-action="close-command-palette">Esc</button>
        </div>
        <div id="command-palette-list" class="command-palette-list">${getCommandPaletteListMarkup()}</div>
        <p class="command-palette-hint">Enter: выполнить · ↑/↓: выбрать · Esc: закрыть</p>
      </div>
    </section>
  `;
}

function updateCommandPaletteUi(options = {}) {
  const root = document.querySelector('#command-palette-root');
  if (!root) {
    return;
  }

  root.classList.toggle('hidden', !state.commandPaletteOpen);
  root.setAttribute('aria-hidden', state.commandPaletteOpen ? 'false' : 'true');

  const input = root.querySelector('#command-palette-input');
  const list = root.querySelector('#command-palette-list');
  if (input && input.value !== state.commandPaletteQuery) {
    input.value = state.commandPaletteQuery;
  }
  if (list) {
    list.innerHTML = getCommandPaletteListMarkup();
  }

  if (state.commandPaletteOpen && options.focusInput && input) {
    input.focus();
    input.select();
  }

  const selected = root.querySelector('.command-palette-item.is-selected');
  if (selected) {
    selected.scrollIntoView({ block: 'nearest' });
  }
}

function openCommandPalette(initialQuery = '') {
  state.commandPaletteOpen = true;
  state.commandPaletteQuery = String(initialQuery ?? '');
  state.commandPaletteSelectedIndex = 0;
  refreshCommandPaletteItems();
  updateCommandPaletteUi({ focusInput: true });
}

function closeCommandPalette(options = {}) {
  state.commandPaletteOpen = false;
  if (options.clearQuery) {
    state.commandPaletteQuery = '';
  }
  updateCommandPaletteUi();
}

function moveCommandPaletteSelection(delta) {
  if (!state.commandPaletteOpen || state.commandPaletteItems.length === 0) {
    return;
  }
  state.commandPaletteSelectedIndex = clamp(
    state.commandPaletteSelectedIndex + Number(delta || 0),
    0,
    state.commandPaletteItems.length - 1,
  );
  updateCommandPaletteUi();
}

async function executeCommandPaletteItem(item) {
  if (!item) {
    return;
  }

  closeCommandPalette();

  if (item.kind === 'goto-library') {
    await showLibraryView();
    return;
  }

  if (item.kind === 'goto-highlights') {
    await renderHighlightsView();
    return;
  }

  if (item.kind === 'goto-reader-current') {
    if (state.currentDocument?.id) {
      await openReaderView(state.currentDocument.id, getDocumentResumeOptions(state.currentDocument.id));
    }
    return;
  }

  if (item.kind === 'open-document') {
    if (item.documentId) {
      await openReaderView(item.documentId, getDocumentResumeOptions(item.documentId));
    }
    return;
  }

  if (item.kind === 'import-pdf') {
    await showLibraryView();
    document.querySelector('#import-btn')?.click();
    return;
  }

  if (item.kind === 'reveal-data') {
    try {
      await window.recallApi.revealUserData();
    } catch (error) {
      setReaderMessage(`Не удалось открыть папку данных: ${error?.message ?? 'неизвестная ошибка'}`, true);
    }
    return;
  }

  if (item.kind === 'search-highlights') {
    state.highlightsQuery = String(item.query ?? '');
    if (state.view === 'highlights') {
      const input = document.querySelector('#highlights-search');
      if (input) {
        input.value = state.highlightsQuery;
      }
      renderHighlightsList();
    } else if (state.view === 'reader') {
      const input = document.querySelector('#reader-highlights-search');
      if (input) {
        input.value = state.highlightsQuery;
      }
      renderHighlightsList();
    } else {
      await renderHighlightsView();
    }
    return;
  }

  if (item.kind === 'apply-saved-query') {
    const presetId = String(item.presetId || '');
    if (!presetId) {
      return;
    }
    const preset = getSavedHighlightQueryPresets().find((entry) => entry.id === presetId);
    if (!preset) {
      return;
    }

    state.highlightsQuery = preset.query;
    if (state.view !== 'highlights') {
      await renderHighlightsView();
    } else {
      const input = document.querySelector('#highlights-search');
      if (input) {
        input.value = preset.query;
      }
      renderHighlightsList();
    }
    return;
  }

  if (item.kind === 'start-review-session') {
    if (state.view !== 'highlights') {
      await renderHighlightsView();
    }
    startHighlightsReviewSession(getHighlightsScope());
    return;
  }

  if (item.kind === 'export-markdown-current') {
    await onExportMarkdown();
    return;
  }

  if (item.kind === 'export-pdf-current') {
    await onExportAnnotatedPdf();
    return;
  }

  if (item.kind === 'reset-progress-current') {
    if (state.currentDocument?.id) {
      await resetDocumentProgressById(state.currentDocument.id, state.currentDocument.title);
    }
    return;
  }

  if (item.kind === 'toggle-focus') {
    if (state.view === 'reader') {
      await toggleReaderFocusMode();
      return;
    }

    const nextFocusMode = !state.settings.focusMode;
    state.settings.focusMode = nextFocusMode;
    try {
      await safeOptionalIpcCall(
        () => window.recallApi.updateSettings({ focusMode: nextFocusMode }),
        null,
        'settings:update',
      );
    } catch (error) {
      setLibraryError(`Не удалось сохранить фокус-режим: ${error?.message ?? 'неизвестная ошибка'}`);
    }
    renderLibraryView();
  }
}

function handleCommandPaletteKeyDown(event) {
  if (!state.commandPaletteOpen) {
    return false;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    closeCommandPalette();
    return true;
  }

  if (event.key === 'ArrowDown') {
    event.preventDefault();
    moveCommandPaletteSelection(1);
    return true;
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault();
    moveCommandPaletteSelection(-1);
    return true;
  }

  if (event.key === 'Enter') {
    event.preventDefault();
    const item = state.commandPaletteItems[state.commandPaletteSelectedIndex];
    void executeCommandPaletteItem(item);
    return true;
  }

  return false;
}

function bindCommandPaletteEvents() {
  const root = document.querySelector('#command-palette-root');
  if (!root || root.dataset.bound === '1') {
    return;
  }

  root.dataset.bound = '1';

  root.querySelectorAll('[data-action="close-command-palette"]').forEach((button) => {
    button.addEventListener('click', () => {
      closeCommandPalette();
    });
  });

  const input = root.querySelector('#command-palette-input');
  input?.addEventListener('input', (event) => {
    state.commandPaletteQuery = String(event.currentTarget.value || '');
    state.commandPaletteSelectedIndex = 0;
    refreshCommandPaletteItems();
    updateCommandPaletteUi();
  });
  input?.addEventListener('keydown', (event) => {
    if (handleCommandPaletteKeyDown(event)) {
      return;
    }
  });

  const list = root.querySelector('#command-palette-list');
  list?.addEventListener('mousemove', (event) => {
    const itemNode = event.target.closest('[data-command-index]');
    if (!itemNode) {
      return;
    }
    const index = normalizePageIndex(itemNode.getAttribute('data-command-index'), 0);
    if (index !== state.commandPaletteSelectedIndex) {
      state.commandPaletteSelectedIndex = clamp(index, 0, Math.max(0, state.commandPaletteItems.length - 1));
      updateCommandPaletteUi();
    }
  });
  list?.addEventListener('click', (event) => {
    const itemNode = event.target.closest('[data-command-index]');
    if (!itemNode) {
      return;
    }
    const index = normalizePageIndex(itemNode.getAttribute('data-command-index'), 0);
    const item = state.commandPaletteItems[index];
    void executeCommandPaletteItem(item);
  });
}

function bindCommandPaletteTriggers() {
  document.querySelectorAll('[data-action="open-command-palette"]').forEach((button) => {
    button.addEventListener('click', () => {
      openCommandPalette();
    });
  });
}

function bindGlobalTabs() {
  document.querySelectorAll('[data-app-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      const targetView = button.getAttribute('data-app-tab');
      if (targetView === 'library') {
        showLibraryView();
        return;
      }

      if (targetView === 'reader') {
        if (state.currentDocument) {
          const shouldPreservePage = state.view === 'reader';
          const options = shouldPreservePage
            ? {
                ...getDocumentResumeOptions(state.currentDocument.id),
                focusPageIndex: getCurrentPageIndexSafe(readerRuntime.totalPages),
              }
            : getDocumentResumeOptions(state.currentDocument.id);
          openReaderView(state.currentDocument.id, options);
        }
        return;
      }

      if (targetView === 'highlights') {
        if (state.documents.length > 0) {
          void renderHighlightsView();
        }
      }
    });
  });
}

async function loadLibraryData() {
  const [documents, storagePaths] = await Promise.all([
    window.recallApi.listDocuments(),
    window.recallApi.getStoragePaths(),
  ]);

  const [collections, settings, readingOverview, updateState] = await Promise.all([
    safeOptionalIpcCall(() => window.recallApi.listCollections(), [], 'collection:list'),
    safeOptionalIpcCall(() => window.recallApi.getSettings(), null, 'settings:get'),
    safeOptionalIpcCall(() => window.recallApi.getReadingOverview(), null, 'reading:get-overview'),
    safeOptionalIpcCall(() => window.recallApi.getUpdateState(), null, 'app:get-update-state'),
  ]);

  state.documents = documents;
  state.storagePaths = storagePaths;
  state.collections = Array.isArray(collections) ? collections : [];
  applySettingsPatch(settings || {});
  state.readingLog =
    readingOverview && typeof readingOverview.readingLog === 'object'
      ? readingOverview.readingLog
      : {};
  state.updateState = normalizeUpdateState(updateState);

  if (!Array.isArray(collections) || !settings || !readingOverview) {
    setLibraryInfo(
      'Обнаружена старая версия main-процесса. Некоторые функции отключены до перезапуска приложения.',
    );
  }

  applyTheme(state.settings.theme);

  const nextHighlightsByDocument = {};
  for (const doc of documents) {
    nextHighlightsByDocument[doc.id] = state.highlightsByDocument[doc.id] ?? [];
  }
  state.highlightsByDocument = nextHighlightsByDocument;

  if (state.currentDocument) {
    const freshDocument = documents.find((doc) => doc.id === state.currentDocument.id) ?? null;
    if (freshDocument) {
      state.currentDocument = {
        ...state.currentDocument,
        ...freshDocument,
      };
    } else {
      state.currentDocument = null;
      state.currentHighlights = [];
      state.focusHighlightId = null;
    }
  }
}

function renderLibraryProgressCell(documentInfo) {
  const stats = getDocumentReadingStats(documentInfo);
  if (stats.totalPages <= 0) {
    return '<div class="reading-progress-empty">Не начато</div>';
  }

  const progressPercent = Math.round(stats.progress * 100);
  const barWidth = clamp(progressPercent, 2, 100);
  const lastOpenedText = documentInfo?.lastOpenedAt
    ? formatDate(documentInfo.lastOpenedAt)
    : '';

  return `
    <div class="reading-progress-cell">
      <div class="reading-progress-track">
        <span style="width: ${barWidth}%"></span>
      </div>
      <div class="reading-progress-main">
        <span class="reading-progress-percent">${formatPercent(stats.progress)}</span>
        <span class="reading-progress-pages">стр. ${stats.pageNumber} из ${stats.totalPages}</span>
      </div>
      ${
        lastOpenedText
          ? `<div class="reading-progress-time">Последнее чтение: ${escapeHtml(lastOpenedText)}</div>`
          : ''
      }
    </div>
  `;
}

function getCollectionName(collectionId) {
  if (!collectionId) {
    return 'Без коллекции';
  }
  return (
    state.collections.find((collection) => collection.id === collectionId)?.name ||
    'Без коллекции'
  );
}

function getFilteredSortedLibraryDocuments() {
  let docs = [...state.documents];
  if (state.libraryCollectionFilter !== 'all') {
    docs = docs.filter((doc) => String(doc.collectionId || '') === state.libraryCollectionFilter);
  }

  if (state.libraryProgressFilter !== 'all') {
    docs = docs.filter((doc) => getDocumentProgressState(doc) === state.libraryProgressFilter);
  }

  const sorters = {
    'last-opened': (a, b) =>
      new Date(b.lastOpenedAt || b.createdAt).valueOf() -
      new Date(a.lastOpenedAt || a.createdAt).valueOf(),
    created: (a, b) => new Date(b.createdAt).valueOf() - new Date(a.createdAt).valueOf(),
    title: (a, b) => a.title.localeCompare(b.title, 'ru'),
    progress: (a, b) =>
      getDocumentReadingStats(b).progress - getDocumentReadingStats(a).progress,
  };

  const sorter = sorters[state.librarySortMode] || sorters['last-opened'];
  docs.sort((a, b) => {
    if (a.isPinned !== b.isPinned) {
      return a.isPinned ? -1 : 1;
    }
    return sorter(a, b);
  });
  return docs;
}

function getContinueReadingDocuments(limit = 4) {
  const safeLimit = Math.max(1, normalizePageIndex(limit, 4));
  return [...state.documents]
    .map((doc) => {
      const stats = getDocumentReadingStats(doc);
      return {
        doc,
        stats,
      };
    })
    .filter((entry) => entry.stats.totalPages > 0 && entry.stats.progress < 0.999)
    .sort(
      (a, b) =>
        new Date(b.doc.lastOpenedAt || b.doc.createdAt).valueOf() -
        new Date(a.doc.lastOpenedAt || a.doc.createdAt).valueOf(),
    )
    .slice(0, safeLimit);
}

function renderLibraryCalendar() {
  const calendar = buildReadingCalendarHeatmap(12);
  const streakStats = getReadingStreakStats();
  const monthLabels = calendar.monthLabels
    .map(
      (item) =>
        `<span class="calendar-month-label" style="grid-column:${item.column}">${escapeHtml(item.label)}</span>`,
    )
    .join('');

  const weekColumns = calendar.weeks
    .map((week) => {
      const dayCells = week.days
        .map((day) => {
          const minutes = Math.round(day.seconds / 60);
          return `
            <button
              class="calendar-cell level-${day.level} ${day.isToday ? 'is-today' : ''}"
              title="${day.key}: ${day.pages} стр., ${minutes} мин"
              type="button"
              data-calendar-day="${day.key}"
            ></button>
          `;
        })
        .join('');

      return `<div class="calendar-week-column">${dayCells}</div>`;
    })
    .join('');

  return `
    <div class="calendar-heatmap">
      <div class="calendar-meta">
        <span>Активных дней: ${calendar.activeDays}/${calendar.totalDays}</span>
        <span>Лучшая серия: ${streakStats.bestStreak}</span>
      </div>
      <div class="calendar-meta compact">
        <span>7 дней: ${streakStats.activeDaysLast7}/7</span>
        <span>${streakStats.last7Pages} стр. · ${streakStats.last7Minutes} мин</span>
      </div>
      <div class="calendar-month-row">${monthLabels}</div>
      <div class="calendar-grid-shell">
        <div class="calendar-weekday-col">
          ${calendar.weekdayLabels.map((label) => `<span>${label}</span>`).join('')}
        </div>
        <div class="calendar-weeks-grid">${weekColumns}</div>
      </div>
      <div class="calendar-legend" aria-hidden="true">
        <span>Меньше</span>
        <span class="calendar-legend-cell level-0"></span>
        <span class="calendar-legend-cell level-1"></span>
        <span class="calendar-legend-cell level-2"></span>
        <span class="calendar-legend-cell level-3"></span>
        <span class="calendar-legend-cell level-4"></span>
        <span>Больше</span>
      </div>
    </div>
  `;
}

function renderCollectionOptions(selectedCollectionId = '') {
  return [
    '<option value="">Без коллекции</option>',
    ...state.collections.map((collection) => {
      const selected = collection.id === String(selectedCollectionId || '') ? 'selected' : '';
      return `<option value="${collection.id}" ${selected}>${escapeHtml(collection.name)}</option>`;
    }),
  ].join('');
}

async function importPdfPaths(paths = []) {
  try {
    const result = await safeOptionalIpcCall(
      () => window.recallApi.importPdfPaths(paths),
      null,
      'library:import-pdf-paths',
    );
    if (!result) {
      setLibraryInfo('Drag-and-drop импорт недоступен в текущей сессии. Перезапустите приложение.');
      return;
    }

    await loadLibraryData();
    const imported = result?.imported?.length ?? 0;
    const duplicates = result?.duplicates?.length ?? 0;
    const errors = result?.errors?.length ?? 0;
    setLibraryInfo(
      `Импорт: добавлено ${imported}, уже есть ${duplicates}${errors ? `, ошибок ${errors}` : ''}.`,
    );
  } catch (error) {
    setLibraryError(`Ошибка импорта: ${error?.message ?? 'неизвестная ошибка'}`);
  }
}

function renderLibraryView() {
  teardownReaderLayout();
  state.view = 'library';
  resetHighlightsReviewSession('');

  const streakStats = getReadingStreakStats();
  const goalProgress = getGoalProgress();
  const updateState = normalizeUpdateState(state.updateState);
  const updateStatusText = formatUpdateStatusLine(updateState);
  const updateCheckedAtLabel = updateState.checkedAt
    ? `Последняя проверка: ${formatDate(updateState.checkedAt)}`
    : 'Проверка ещё не запускалась';
  const filteredDocuments = getFilteredSortedLibraryDocuments();
  const progressCount = {
    all: state.documents.length,
    'not-started': state.documents.filter((doc) => getDocumentProgressState(doc) === 'not-started')
      .length,
    'in-progress': state.documents.filter((doc) => getDocumentProgressState(doc) === 'in-progress')
      .length,
    completed: state.documents.filter((doc) => getDocumentProgressState(doc) === 'completed')
      .length,
  };

  const collectionFilterOptions = [
    `<option value="all" ${state.libraryCollectionFilter === 'all' ? 'selected' : ''}>Все коллекции</option>`,
    ...state.collections.map((collection) => {
      const selected = state.libraryCollectionFilter === collection.id ? 'selected' : '';
      return `<option value="${collection.id}" ${selected}>${escapeHtml(collection.name)}</option>`;
    }),
  ].join('');

  const rowsHtml = filteredDocuments
    .map((doc) => {
      return `
        <tr>
          <td>
            <div class="doc-title-row">
              <button
                class="ghost-btn pin-btn ${doc.isPinned ? 'is-pinned' : ''}"
                data-action="toggle-pin"
                data-id="${doc.id}"
                title="${doc.isPinned ? 'Открепить' : 'Закрепить'} книгу"
              >
                ${doc.isPinned ? '★' : '☆'}
              </button>
              <div class="doc-title">${escapeHtml(truncate(doc.title, 90))}</div>
            </div>
            <div class="doc-id">${escapeHtml(doc.id.slice(0, 14))}...</div>
            <div class="doc-collection">Коллекция: ${escapeHtml(getCollectionName(doc.collectionId))}</div>
          </td>
          <td>${escapeHtml(formatDate(doc.createdAt))}</td>
          <td>${doc.highlightsCount ?? 0}</td>
          <td>${renderLibraryProgressCell(doc)}</td>
          <td>
            <div class="row-actions">
              <label class="doc-collection-select-wrap">
                <span>Коллекция</span>
                <select data-action="assign-collection" data-id="${doc.id}">
                  ${renderCollectionOptions(doc.collectionId)}
                </select>
              </label>
              <button class="ghost-btn" data-action="open-reader" data-id="${doc.id}">
                ${renderIcon('book-open-check')}
                Открыть
              </button>
              <button class="ghost-btn" data-action="reset-reading" data-id="${doc.id}">
                Сброс прогресса
              </button>
              <button
                class="danger-btn"
                data-action="delete-document"
                data-id="${doc.id}"
                data-title="${escapeHtml(doc.title)}"
              >
                ${renderIcon('trash-2')}
                Удалить
              </button>
            </div>
          </td>
        </tr>
      `;
    })
    .join('');

  const continueCards = getContinueReadingDocuments(4);
  const continueCardsHtml = continueCards
    .map(({ doc, stats }) => {
      return `
        <article class="continue-card">
          <h4>${escapeHtml(truncate(doc.title, 72))}</h4>
          <p>${Math.round(stats.progress * 100)}% · стр. ${stats.pageNumber}/${stats.totalPages}</p>
          <button class="secondary-btn" data-action="continue-reading" data-id="${doc.id}">
            ${renderIcon('book-open-check')}
            Продолжить
          </button>
        </article>
      `;
    })
    .join('');

  appNode.innerHTML = `
    <main class="library-screen">
      ${getTabsMarkup('library')}

      <header class="library-header">
        <div>
          <h1>PDF Recall Desktop</h1>
          <p class="subtitle">Локальная библиотека PDF и заметок</p>
        </div>
        <div class="header-actions">
          <button class="ghost-btn" data-action="open-command-palette">
            ${renderIcon('list')}
            Команды
          </button>
          <button id="reveal-btn" class="secondary-btn">
            ${renderIcon('folder-open')}
            Папка данных
          </button>
          <button id="backup-btn" class="secondary-btn">
            ${renderIcon('file-output')}
            Бэкап
          </button>
          <button id="restore-btn" class="secondary-btn">
            ${renderIcon('file-text')}
            Восстановить
          </button>
          <button id="import-btn" class="primary-btn">
            ${renderIcon('file-up')}
            Импорт PDF
          </button>
        </div>
      </header>

      <section class="continue-reading-panel">
        <header>
          <h3>Продолжить чтение</h3>
          <p>Быстрый возврат к последней позиции в книге</p>
        </header>
        <div class="continue-reading-grid">
          ${
            continueCardsHtml ||
            '<div class="continue-reading-empty">Пока нет начатых книг. Откройте книгу и прогресс появится автоматически.</div>'
          }
        </div>
      </section>

      <section class="library-dashboard">
        <article class="library-card">
          <h3>Серия чтения</h3>
          <p class="library-kpi">${streakStats.currentStreak} дней подряд</p>
          <div class="reading-calendar">${renderLibraryCalendar()}</div>
        </article>
        <article class="library-card">
          <h3>Цели</h3>
          <div class="goals-grid">
            <label>Стр./день <input id="goal-day-input" type="number" min="1" value="${state.settings.goals.pagesPerDay}" /></label>
            <label>Стр./неделю <input id="goal-week-input" type="number" min="1" value="${state.settings.goals.pagesPerWeek}" /></label>
            <button id="save-goals-btn" class="secondary-btn">Сохранить цели</button>
          </div>
          <p class="goals-hint">Сегодня: ${goalProgress.todayPages}/${goalProgress.dayGoal} · Неделя: ${goalProgress.weekPages}/${goalProgress.weekGoal}</p>
        </article>
        <article class="library-card">
          <h3>Интерфейс</h3>
          <div class="settings-grid">
            <label>Тема
              <select id="theme-select">
                <option value="light" ${state.settings.theme === 'light' ? 'selected' : ''}>Светлая</option>
                <option value="sepia" ${state.settings.theme === 'sepia' ? 'selected' : ''}>Сепия</option>
                <option value="contrast" ${state.settings.theme === 'contrast' ? 'selected' : ''}>Контраст</option>
              </select>
            </label>
            <label class="toggle-inline">
              <input id="focus-mode-default" type="checkbox" ${state.settings.focusMode ? 'checked' : ''} />
              <span>Фокус-режим в Reader</span>
            </label>
            <label>URL обновлений
              <input
                id="update-manifest-url"
                type="url"
                placeholder="https://example.com/recall/update-manifest.json"
                value="${escapeHtml(state.settings.updates.manifestUrl)}"
              />
            </label>
            <label class="toggle-inline">
              <input id="update-auto-check" type="checkbox" ${state.settings.updates.autoCheck ? 'checked' : ''} />
              <span>Проверять обновления при запуске</span>
            </label>
            <div class="inline-actions">
              <button id="save-update-settings-btn" class="secondary-btn">Сохранить обновления</button>
              <button id="check-updates-btn" class="secondary-btn">Проверить обновления</button>
            </div>
            <div class="update-status-block">
              <p class="goals-hint">${escapeHtml(updateStatusText)}</p>
              <p class="goals-hint">${escapeHtml(updateCheckedAtLabel)}</p>
              ${
                updateState.updateAvailable && updateState.downloadUrl
                  ? `<button id="download-update-btn" class="primary-btn">Скачать ${escapeHtml(updateState.latestVersion || 'обновление')}</button>`
                  : ''
              }
            </div>
            <button id="create-collection-btn" class="secondary-btn">Новая коллекция</button>
          </div>
        </article>
      </section>

      <section id="library-dropzone" class="library-content">
        ${state.libraryError ? `<div class="error-box">${escapeHtml(state.libraryError)}</div>` : ''}
        ${state.libraryInfo ? `<div class="note-box">${escapeHtml(state.libraryInfo)}</div>` : ''}

        <section class="library-filters">
          <label>Прогресс
            <select id="library-progress-filter">
              <option value="all" ${state.libraryProgressFilter === 'all' ? 'selected' : ''}>Все (${progressCount.all})</option>
              <option value="not-started" ${state.libraryProgressFilter === 'not-started' ? 'selected' : ''}>Не начато (${progressCount['not-started']})</option>
              <option value="in-progress" ${state.libraryProgressFilter === 'in-progress' ? 'selected' : ''}>В процессе (${progressCount['in-progress']})</option>
              <option value="completed" ${state.libraryProgressFilter === 'completed' ? 'selected' : ''}>Завершено (${progressCount.completed})</option>
            </select>
          </label>
          <label>Сортировка
            <select id="library-sort-mode">
              <option value="last-opened" ${state.librarySortMode === 'last-opened' ? 'selected' : ''}>По последнему чтению</option>
              <option value="created" ${state.librarySortMode === 'created' ? 'selected' : ''}>По дате импорта</option>
              <option value="progress" ${state.librarySortMode === 'progress' ? 'selected' : ''}>По прогрессу</option>
              <option value="title" ${state.librarySortMode === 'title' ? 'selected' : ''}>По названию</option>
            </select>
          </label>
          <label>Коллекция
            <select id="library-collection-filter">
              ${collectionFilterOptions}
            </select>
          </label>
        </section>

        <div class="table-wrap ${state.libraryDropActive ? 'drop-active' : ''}">
          <table class="docs-table">
            <thead>
              <tr>
                <th>Название</th>
                <th>Импортирован</th>
                <th>Выделения</th>
                <th>Прогресс</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              ${
                rowsHtml ||
                '<tr><td colspan="5" class="empty">Документов нет. Перетащите PDF сюда или нажмите «Импорт PDF».</td></tr>'
              }
            </tbody>
          </table>
        </div>
      </section>
    </main>
    ${getCommandPaletteMarkup()}
  `;

  bindGlobalTabs();
  refreshCommandPaletteItems();
  bindCommandPaletteEvents();
  bindCommandPaletteTriggers();
  updateCommandPaletteUi();

  document.querySelector('#import-btn')?.addEventListener('click', onImportPdf);
  document.querySelector('#reveal-btn')?.addEventListener('click', async () => {
    try {
      await window.recallApi.revealUserData();
    } catch (error) {
      setLibraryError(`Не удалось открыть папку данных: ${error?.message ?? 'неизвестная ошибка'}`);
      renderLibraryView();
    }
  });

  document.querySelector('#backup-btn')?.addEventListener('click', async () => {
    try {
      const result = await safeOptionalIpcCall(
        () => window.recallApi.backupData(),
        null,
        'app:backup-data',
      );
      if (!result) {
        setLibraryInfo('Бэкап недоступен в текущей сессии. Перезапустите приложение.');
        renderLibraryView();
        return;
      }
      if (!result?.canceled) {
        setLibraryInfo(`Бэкап создан: ${result.backupPath}`);
      }
    } catch (error) {
      setLibraryError(`Не удалось создать бэкап: ${error?.message ?? 'неизвестная ошибка'}`);
    }
    renderLibraryView();
  });

  document.querySelector('#restore-btn')?.addEventListener('click', async () => {
    const confirmed = window.confirm('Восстановить данные из бэкапа? Текущая база будет заменена.');
    if (!confirmed) {
      return;
    }
    try {
      const result = await safeOptionalIpcCall(
        () => window.recallApi.restoreData(),
        null,
        'app:restore-data',
      );
      if (!result) {
        setLibraryInfo('Восстановление недоступно в текущей сессии. Перезапустите приложение.');
        renderLibraryView();
        return;
      }
      if (!result?.canceled) {
        await loadLibraryData();
        setLibraryInfo(`Данные восстановлены из: ${result.backupPath}`);
      }
    } catch (error) {
      setLibraryError(`Не удалось восстановить данные: ${error?.message ?? 'неизвестная ошибка'}`);
    }
    renderLibraryView();
  });

  document.querySelector('#save-goals-btn')?.addEventListener('click', async () => {
    const day = Math.max(1, normalizePageIndex(document.querySelector('#goal-day-input')?.value, 20));
    const week = Math.max(day, normalizePageIndex(document.querySelector('#goal-week-input')?.value, 140));
    try {
      const settings = await safeOptionalIpcCall(
        () =>
          window.recallApi.updateSettings({
            goals: { pagesPerDay: day, pagesPerWeek: week },
          }),
        null,
        'settings:update',
      );
      if (!settings) {
        setLibraryInfo('Сохранение целей недоступно в текущей сессии. Перезапустите приложение.');
        renderLibraryView();
        return;
      }
      applySettingsPatch(settings || {});
      setLibraryInfo('Цели сохранены.');
    } catch (error) {
      setLibraryError(`Не удалось сохранить цели: ${error?.message ?? 'неизвестная ошибка'}`);
    }
    renderLibraryView();
  });

  document.querySelector('#theme-select')?.addEventListener('change', async (event) => {
    const theme = String(event.currentTarget.value || 'light');
    applyTheme(theme);
    try {
      const updated = await safeOptionalIpcCall(
        () => window.recallApi.updateSettings({ theme }),
        null,
        'settings:update',
      );
      if (!updated) {
        setLibraryInfo('Сохранение темы недоступно в текущей сессии. Перезапустите приложение.');
      } else {
        setLibraryInfo('Тема сохранена.');
      }
    } catch (error) {
      setLibraryError(`Не удалось сохранить тему: ${error?.message ?? 'неизвестная ошибка'}`);
    }
    renderLibraryView();
  });

  document.querySelector('#focus-mode-default')?.addEventListener('change', async (event) => {
    const focusMode = Boolean(event.currentTarget.checked);
    state.settings.focusMode = focusMode;
    try {
      const updated = await safeOptionalIpcCall(
        () => window.recallApi.updateSettings({ focusMode }),
        null,
        'settings:update',
      );
      if (!updated) {
        setLibraryInfo('Сохранение настройки недоступно в текущей сессии. Перезапустите приложение.');
      } else {
        setLibraryInfo('Настройка фокус-режима сохранена.');
      }
    } catch (error) {
      setLibraryError(`Не удалось сохранить настройку: ${error?.message ?? 'неизвестная ошибка'}`);
    }
    renderLibraryView();
  });

  document.querySelector('#save-update-settings-btn')?.addEventListener('click', async () => {
    const manifestUrl = normalizeHttpUrl(document.querySelector('#update-manifest-url')?.value);
    const autoCheck = Boolean(document.querySelector('#update-auto-check')?.checked);

    try {
      const updated = await safeOptionalIpcCall(
        () =>
          window.recallApi.updateSettings({
            updates: {
              manifestUrl,
              autoCheck,
            },
          }),
        null,
        'settings:update',
      );
      if (!updated) {
        setLibraryInfo('Настройки обновлений недоступны в текущей сессии. Перезапустите приложение.');
      } else {
        applySettingsPatch(updated || {});
        setLibraryInfo('Настройки обновлений сохранены.');
      }
    } catch (error) {
      setLibraryError(`Не удалось сохранить настройки обновлений: ${error?.message ?? 'неизвестная ошибка'}`);
    }
    renderLibraryView();
  });

  document.querySelector('#check-updates-btn')?.addEventListener('click', async () => {
    const manifestUrl = normalizeHttpUrl(document.querySelector('#update-manifest-url')?.value);
    const autoCheck = Boolean(document.querySelector('#update-auto-check')?.checked);

    try {
      const updatedSettings = await safeOptionalIpcCall(
        () =>
          window.recallApi.updateSettings({
            updates: {
              manifestUrl,
              autoCheck,
            },
          }),
        null,
        'settings:update',
      );
      if (updatedSettings) {
        applySettingsPatch(updatedSettings || {});
      }

      const result = await safeOptionalIpcCall(
        () =>
          window.recallApi.checkForUpdates({
            manual: true,
            manifestUrl,
          }),
        null,
        'app:check-for-updates',
      );

      if (!result) {
        setLibraryInfo('Проверка обновлений недоступна в текущей сессии. Перезапустите приложение.');
        renderLibraryView();
        return;
      }

      state.updateState = normalizeUpdateState(result);
      if (state.updateState.status === 'update-available') {
        setLibraryInfo(`Доступна версия ${state.updateState.latestVersion}. Можно скачать обновление.`);
      } else if (state.updateState.status === 'up-to-date') {
        setLibraryInfo(`Обновлений нет. Текущая версия: ${state.updateState.currentVersion || 'неизвестна'}.`);
      } else if (state.updateState.status === 'disabled') {
        setLibraryInfo(state.updateState.error || 'Проверка обновлений отключена.');
      } else if (state.updateState.status === 'error') {
        setLibraryError(state.updateState.error || 'Ошибка проверки обновлений.');
      }
    } catch (error) {
      setLibraryError(`Не удалось проверить обновления: ${error?.message ?? 'неизвестная ошибка'}`);
    }
    renderLibraryView();
  });

  document.querySelector('#download-update-btn')?.addEventListener('click', async () => {
    const downloadUrl = normalizeHttpUrl(state.updateState?.downloadUrl);
    if (!downloadUrl) {
      setLibraryError('Ссылка на загрузку обновления отсутствует.');
      renderLibraryView();
      return;
    }

    try {
      const opened = await safeOptionalIpcCall(
        () => window.recallApi.openUpdateDownload(downloadUrl),
        null,
        'app:open-update-download',
      );
      if (!opened) {
        setLibraryInfo('Открытие ссылки недоступно в текущей сессии. Перезапустите приложение.');
      } else {
        setLibraryInfo('Ссылка на обновление открыта в браузере.');
      }
    } catch (error) {
      setLibraryError(`Не удалось открыть ссылку на обновление: ${error?.message ?? 'неизвестная ошибка'}`);
    }
    renderLibraryView();
  });

  document.querySelector('#create-collection-btn')?.addEventListener('click', async () => {
    const name = normalizeText(window.prompt('Название коллекции:'));
    if (!name) {
      return;
    }
    try {
      const created = await safeOptionalIpcCall(
        () => window.recallApi.createCollection({ name }),
        null,
        'collection:create',
      );
      if (!created) {
        setLibraryInfo('Коллекции недоступны в текущей сессии. Перезапустите приложение.');
      } else {
        state.collections = await safeOptionalIpcCall(
          () => window.recallApi.listCollections(),
          state.collections,
          'collection:list',
        );
        setLibraryInfo('Коллекция создана.');
      }
    } catch (error) {
      setLibraryError(`Не удалось создать коллекцию: ${error?.message ?? 'неизвестная ошибка'}`);
    }
    renderLibraryView();
  });

  document.querySelector('#library-progress-filter')?.addEventListener('change', (event) => {
    state.libraryProgressFilter = String(event.currentTarget.value || 'all');
    renderLibraryView();
  });

  document.querySelector('#library-sort-mode')?.addEventListener('change', (event) => {
    state.librarySortMode = String(event.currentTarget.value || 'last-opened');
    renderLibraryView();
  });

  document.querySelector('#library-collection-filter')?.addEventListener('change', (event) => {
    state.libraryCollectionFilter = String(event.currentTarget.value || 'all');
    renderLibraryView();
  });

  document.querySelectorAll('[data-action="toggle-pin"]').forEach((button) => {
    button.addEventListener('click', async () => {
      const documentId = button.getAttribute('data-id');
      const documentInfo = state.documents.find((item) => item.id === documentId);
      if (!documentId || !documentInfo) {
        return;
      }

      const nextPinned = !Boolean(documentInfo.isPinned);
      upsertDocumentInState({ ...documentInfo, isPinned: nextPinned });
      renderLibraryView();

      try {
        const updated = await safeOptionalIpcCall(
          () =>
            window.recallApi.updateDocumentMeta({
              documentId,
              isPinned: nextPinned,
            }),
          null,
          'library:update-document-meta',
        );
        if (!updated) {
          setLibraryInfo('Закрепление недоступно в текущей сессии. Перезапустите приложение.');
        } else {
          upsertDocumentInState(updated);
        }
      } catch (error) {
        upsertDocumentInState(documentInfo);
        setLibraryError(`Не удалось закрепить книгу: ${error?.message ?? 'неизвестная ошибка'}`);
      }
      renderLibraryView();
    });
  });

  document.querySelectorAll('[data-action="assign-collection"]').forEach((selectNode) => {
    selectNode.addEventListener('change', async (event) => {
      const documentId = event.currentTarget.getAttribute('data-id');
      const collectionId = normalizeText(event.currentTarget.value) || undefined;
      if (!documentId) {
        return;
      }

      try {
        const updated = await safeOptionalIpcCall(
          () =>
            window.recallApi.updateDocumentMeta({
              documentId,
              collectionId,
            }),
          null,
          'library:update-document-meta',
        );
        if (!updated) {
          setLibraryInfo('Коллекции недоступны в текущей сессии. Перезапустите приложение.');
        } else {
          upsertDocumentInState(updated);
        }
      } catch (error) {
        setLibraryError(`Не удалось назначить коллекцию: ${error?.message ?? 'неизвестная ошибка'}`);
      }
      renderLibraryView();
    });
  });

  document.querySelectorAll('[data-action="open-reader"]').forEach((button) => {
    button.addEventListener('click', () => {
      const documentId = button.getAttribute('data-id');
      if (documentId) {
        openReaderView(documentId, getDocumentResumeOptions(documentId));
      }
    });
  });

  document.querySelectorAll('[data-action="continue-reading"]').forEach((button) => {
    button.addEventListener('click', () => {
      const documentId = button.getAttribute('data-id');
      if (!documentId) {
        return;
      }
      openReaderView(documentId, getDocumentResumeOptions(documentId));
    });
  });

  document.querySelectorAll('[data-action="reset-reading"]').forEach((button) => {
    button.addEventListener('click', async () => {
      const documentId = button.getAttribute('data-id');
      const documentTitle = state.documents.find((doc) => doc.id === documentId)?.title || 'документ';
      await resetDocumentProgressById(documentId, documentTitle);
    });
  });

  document.querySelectorAll('[data-action="delete-document"]').forEach((button) => {
    button.addEventListener('click', onDeleteDocument);
  });

  const dropZone = document.querySelector('#library-dropzone');
  const setDropState = (active) => {
    state.libraryDropActive = Boolean(active);
    dropZone?.classList.toggle('drop-active', state.libraryDropActive);
  };

  dropZone?.addEventListener('dragenter', (event) => {
    event.preventDefault();
    setDropState(true);
  });
  dropZone?.addEventListener('dragover', (event) => {
    event.preventDefault();
    setDropState(true);
  });
  dropZone?.addEventListener('dragleave', () => {
    setDropState(false);
  });
  dropZone?.addEventListener('drop', async (event) => {
    event.preventDefault();
    setDropState(false);
    const paths = Array.from(event.dataTransfer?.files || [])
      .map((file) => file.path)
      .filter(Boolean);
    if (paths.length === 0) {
      return;
    }

    await importPdfPaths(paths);
    renderLibraryView();
  });

  hydrateIcons();
}

async function showLibraryView() {
  if (state.view === 'reader') {
    await flushReaderProgressPersist();
  }

  clearSelectionState();
  setLibraryError('');
  setLibraryInfo('');
  appNode.innerHTML = '<div class="screen-loading">Загрузка библиотеки…</div>';

  try {
    await loadLibraryData();
  } catch (error) {
    setLibraryError(`Не удалось загрузить библиотеку: ${error?.message ?? 'неизвестная ошибка'}`);
  }

  renderLibraryView();
}

async function onImportPdf(event) {
  const importButton = event.currentTarget;
  importButton.disabled = true;
  importButton.textContent = 'Импорт...';
  setLibraryError('');
  setLibraryInfo('');

  try {
    const result = await window.recallApi.importPdf();
    if (!result?.canceled) {
      await loadLibraryData();
      if (result?.alreadyExists) {
        setLibraryInfo(`Книга уже есть в библиотеке: ${result?.document?.title || 'документ'}.`);
      } else {
        setLibraryInfo(`Импортировано: ${result?.document?.title || 'документ'}.`);
      }
    }
  } catch (error) {
    setLibraryError(`Ошибка импорта: ${error?.message ?? 'неизвестная ошибка'}`);
  }

  renderLibraryView();
}

async function deleteDocumentById(documentId, documentTitle = 'документ') {
  if (!documentId) {
    return;
  }

  const confirmed = window.confirm(
    `Удалить "${documentTitle}"?\n\nБудут удалены PDF и все его хайлайты.`,
  );
  if (!confirmed) {
    return;
  }

  const previousDocuments = [...state.documents];
  const previousDocument = state.currentDocument;
  const previousHighlights = [...state.currentHighlights];
  const previousFocusHighlightId = state.focusHighlightId;
  const previousHighlightsByDocument = { ...state.highlightsByDocument };
  const previousHighlightsBookFilter = state.highlightsBookFilter;

  state.documents = state.documents.filter((doc) => doc.id !== documentId);
  delete state.highlightsByDocument[documentId];
  if (state.highlightsBookFilter === documentId) {
    state.highlightsBookFilter = 'all';
  }

  if (state.currentDocument?.id === documentId) {
    state.currentDocument = null;
    state.currentHighlights = [];
    state.focusHighlightId = null;
    readerRuntime.activeDocumentId = null;
    readerRuntime.totalPages = 0;
    readerRuntime.currentPageIndex = 0;
    if (readerRuntime.pdfDocument?.destroy) {
      try {
        await readerRuntime.pdfDocument.destroy();
      } catch {
        // Ignore PDF.js destroy errors during optimistic UI update.
      }
    }
    readerRuntime.pdfDocument = null;
  }

  setLibraryError('');
  renderLibraryView();

  try {
    const result = await window.recallApi.deleteDocument(documentId);
    if (!result?.deleted) {
      throw new Error('Документ уже удален или не найден.');
    }
    setLibraryError('');
  } catch (error) {
    state.documents = previousDocuments;
    state.currentDocument = previousDocument;
    state.currentHighlights = previousHighlights;
    state.focusHighlightId = previousFocusHighlightId;
    state.highlightsByDocument = previousHighlightsByDocument;
    state.highlightsBookFilter = previousHighlightsBookFilter;
    setLibraryError(`Не удалось удалить документ: ${error?.message ?? 'неизвестная ошибка'}`);
    renderLibraryView();
  }
}

async function resetDocumentProgressById(documentId, documentTitle = 'документ', options = {}) {
  const id = String(documentId ?? '');
  if (!id) {
    return null;
  }

  const shouldConfirm = options.confirm !== false;
  if (shouldConfirm) {
    const confirmed = window.confirm(
      `Сбросить прогресс книги "${documentTitle}"?\n\nПозиция, общий прогресс и время чтения будут очищены.`,
    );
    if (!confirmed) {
      return null;
    }
  }

  try {
    const updatedDocument = await safeOptionalIpcCall(
      () => window.recallApi.resetDocumentReadingState(id),
      null,
      'library:reset-reading-state',
    );

    if (!updatedDocument) {
      const message = 'Сброс прогресса недоступен в текущей сессии. Перезапустите приложение.';
      if (state.view === 'reader') {
        setReaderMessage(message, true);
      } else {
        setLibraryInfo(message);
        renderLibraryView();
      }
      return null;
    }

    upsertDocumentInState(updatedDocument);

    if (state.currentDocument?.id === id) {
      state.currentDocument = {
        ...state.currentDocument,
        ...updatedDocument,
      };

      readerRuntime.lastPersistPageIndex = 0;
      readerRuntime.lastSavedProgressKey = '';
      readerRuntime.lastPersistTs = Date.now();

      if (state.view === 'reader') {
        resetReaderHistory(0);
        scrollToPage(0, 'auto', {
          recordHistory: false,
          userInitiated: true,
        });
        updateReaderHeader();
        updateReaderControls();
        updateMiniMap();
        setReaderMessage('Прогресс чтения сброшен.');
      }
    }

    if (state.view === 'library') {
      setLibraryInfo(`Прогресс книги "${documentTitle}" сброшен.`);
      renderLibraryView();
    }

    return updatedDocument;
  } catch (error) {
    const message = `Не удалось сбросить прогресс: ${error?.message ?? 'неизвестная ошибка'}`;
    if (state.view === 'reader') {
      setReaderMessage(message, true);
    } else {
      setLibraryError(message);
      renderLibraryView();
    }
    return null;
  }
}

async function onDeleteDocument(event) {
  const button = event.currentTarget;
  const documentId = button?.getAttribute('data-id');
  const documentTitle =
    state.documents.find((doc) => doc.id === documentId)?.title ||
    button?.getAttribute('data-title') ||
    'документ';

  await deleteDocumentById(documentId, documentTitle);
}

function toUint8Array(bytes) {
  if (bytes instanceof Uint8Array) {
    return bytes;
  }

  if (ArrayBuffer.isView(bytes)) {
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  if (bytes instanceof ArrayBuffer) {
    return new Uint8Array(bytes);
  }

  if (bytes && bytes.type === 'Buffer' && Array.isArray(bytes.data)) {
    return new Uint8Array(bytes.data);
  }

  throw new Error('Неподдерживаемый формат PDF-данных.');
}

function getPageElementFromNode(node) {
  if (!node) {
    return null;
  }

  if (node.nodeType === Node.ELEMENT_NODE) {
    return node.closest('.pdf-page');
  }

  return node.parentElement?.closest('.pdf-page') ?? null;
}

function clearSelectionState() {
  state.pendingSelection = null;
  const menu = document.querySelector('#selection-menu');
  if (menu) {
    menu.classList.add('hidden');
  }

  const noteModal = document.querySelector('#note-modal');
  if (noteModal) {
    noteModal.classList.add('hidden');
  }
}

function updateSelectionActions() {
  const hasSelection = Boolean(state.pendingSelection);
  const selectionDependent = document.querySelectorAll('[data-selection-action]');

  selectionDependent.forEach((button) => {
    button.disabled = !hasSelection;
  });
}

function mergeSelectionRectsToLines(pixelRects, pageRect) {
  const pageWidth = Math.max(1, pageRect.width);
  const pageHeight = Math.max(1, pageRect.height);

  const prepared = pixelRects
    .filter((rect) => rect.w >= 1.6 && rect.h >= 1.6)
    .map((rect) => {
      const x = clamp(rect.x, 0, pageWidth);
      const y = clamp(rect.y, 0, pageHeight);
      const w = clamp(rect.w, 0, pageWidth - x);
      const h = clamp(rect.h, 0, pageHeight - y);

      return { x, y, w, h };
    })
    .filter((rect) => rect.w > 0 && rect.h > 0);

  if (prepared.length === 0) {
    return [];
  }

  const medianHeight = Math.max(4, median(prepared.map((rect) => rect.h)));
  const lineTolerance = Math.max(5, medianHeight * 0.78);
  const mergeGap = Math.max(6, medianHeight * 0.92);

  const sorted = [...prepared].sort((a, b) => {
    const aCenterY = a.y + a.h * 0.5;
    const bCenterY = b.y + b.h * 0.5;
    if (Math.abs(aCenterY - bCenterY) > 1.2) {
      return aCenterY - bCenterY;
    }
    return a.x - b.x;
  });

  const lines = [];

  for (const rect of sorted) {
    const centerY = rect.y + rect.h * 0.5;
    let matchedLine = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const line of lines) {
      const distance = Math.abs(line.centerY - centerY);
      if (distance <= lineTolerance && distance < bestDistance) {
        matchedLine = line;
        bestDistance = distance;
      }
    }

    if (!matchedLine) {
      lines.push({
        centerY,
        minY: rect.y,
        maxY: rect.y + rect.h,
        rects: [{ ...rect }],
      });
      continue;
    }

    matchedLine.rects.push({ ...rect });
    matchedLine.minY = Math.min(matchedLine.minY, rect.y);
    matchedLine.maxY = Math.max(matchedLine.maxY, rect.y + rect.h);
    matchedLine.centerY = (matchedLine.minY + matchedLine.maxY) * 0.5;
  }

  const merged = [];

  lines
    .sort((a, b) => a.centerY - b.centerY)
    .forEach((line) => {
      const lineRects = line.rects.sort((a, b) => a.x - b.x);
      let current = null;

      for (const rect of lineRects) {
        if (!current) {
          current = { ...rect };
          continue;
        }

        const gap = rect.x - (current.x + current.w);
        const verticalOverlap =
          Math.min(current.y + current.h, rect.y + rect.h) -
          Math.max(current.y, rect.y);
        const overlapRatio =
          verticalOverlap / Math.max(1, Math.min(current.h, rect.h));

        if (gap <= mergeGap && overlapRatio > 0.18) {
          const right = Math.max(current.x + current.w, rect.x + rect.w);
          const bottom = Math.max(current.y + current.h, rect.y + rect.h);

          current.x = Math.min(current.x, rect.x);
          current.y = Math.min(current.y, rect.y);
          current.w = right - current.x;
          current.h = bottom - current.y;
          continue;
        }

        merged.push(current);
        current = { ...rect };
      }

      if (current) {
        merged.push(current);
      }
    });

  return merged
    .map((rect) => {
      const padX = Math.max(0.35, rect.h * 0.04);
      const padY = Math.max(0.2, rect.h * 0.08);
      const x = clamp((rect.x - padX) / pageWidth, 0, 1);
      const y = clamp((rect.y - padY) / pageHeight, 0, 1);
      const right = clamp((rect.x + rect.w + padX) / pageWidth, 0, 1);
      const bottom = clamp((rect.y + rect.h + padY) / pageHeight, 0, 1);

      return {
        x,
        y,
        w: clamp(right - x, 0, 1),
        h: clamp(bottom - y, 0, 1),
      };
    })
    .filter((rect) => rect.w > 0.0016 && rect.h > 0.0026);
}

function updateSelectionMenu() {
  const menu = document.querySelector('#selection-menu');
  const previewNode = document.querySelector('#selection-preview');
  if (!menu) {
    return;
  }

  if (!state.pendingSelection) {
    menu.classList.add('hidden');
    updateSelectionActions();
    return;
  }

  if (previewNode) {
    previewNode.textContent = truncate(state.pendingSelection.selectedText, 170);
  }

  menu.classList.remove('hidden');
  menu.style.left = '0px';
  menu.style.top = '0px';

  const selectionSnapshot = state.pendingSelection;
  const reference = {
    getBoundingClientRect() {
      const x = Number(selectionSnapshot?.anchorX ?? 0);
      const y = Number(selectionSnapshot?.anchorY ?? 0);
      return {
        x,
        y,
        left: x,
        top: y,
        right: x,
        bottom: y,
        width: 0,
        height: 0,
      };
    },
  };

  requestAnimationFrame(() => {
    computePosition(reference, menu, {
      strategy: 'fixed',
      placement: 'bottom-start',
      middleware: [offset(9), flip({ padding: 12 }), shift({ padding: 12 })],
    }).then(({ x, y }) => {
      if (state.pendingSelection !== selectionSnapshot) {
        return;
      }
      menu.style.left = `${Math.round(x)}px`;
      menu.style.top = `${Math.round(y)}px`;
    });
  });
  updateSelectionActions();
}

function captureSelection() {
  if (state.view !== 'reader') {
    return;
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    clearSelectionState();
    updateSelectionActions();
    return;
  }

  const rawSelectionText = normalizeSelectionRawText(selection.toString());
  const text = normalizeHighlightSelectedText(rawSelectionText);
  if (!text) {
    clearSelectionState();
    updateSelectionActions();
    return;
  }

  const range = selection.getRangeAt(0);
  const startPage = getPageElementFromNode(range.startContainer);
  const endPage = getPageElementFromNode(range.endContainer);

  if (!startPage || startPage !== endPage) {
    setReaderMessage('Выделяйте текст только в пределах одной страницы.', true);
    clearSelectionState();
    updateSelectionActions();
    return;
  }

  const textLayerNode = startPage.querySelector('.text-layer');
  const pageRect = (textLayerNode ?? startPage).getBoundingClientRect();
  const rawRects = Array.from(range.getClientRects());
  const pixelRects = [];

  let anchorX = pageRect.left + 12;
  let anchorY = pageRect.top + 12;

  for (const rawRect of rawRects) {
    const left = Math.max(rawRect.left, pageRect.left);
    const top = Math.max(rawRect.top, pageRect.top);
    const right = Math.min(rawRect.right, pageRect.right);
    const bottom = Math.min(rawRect.bottom, pageRect.bottom);

    const width = right - left;
    const height = bottom - top;

    if (width < 1.5 || height < 1.5) {
      continue;
    }

    pixelRects.push({
      x: left - pageRect.left,
      y: top - pageRect.top,
      w: width,
      h: height,
    });

    anchorX = right + 8;
    anchorY = bottom + 10;
  }

  const rects = mergeSelectionRectsToLines(pixelRects, pageRect);

  if (rects.length === 0) {
    clearSelectionState();
    updateSelectionActions();
    return;
  }

  state.pendingSelection = {
    pageIndex: Number(startPage.dataset.pageIndex ?? '0'),
    rects,
    selectedText: text,
    selectedRichText: selectionRangeToRichText(range, rawSelectionText),
    anchorX,
    anchorY,
  };

  updateSelectionMenu();
}

function highlightColorClass(color) {
  if (!HIGHLIGHT_COLORS.includes(color)) {
    return 'color-yellow';
  }
  return `color-${color}`;
}

function renderPageHighlights(pageIndex) {
  const pageRef = readerRuntime.pageRefs.get(pageIndex);
  if (!pageRef) {
    return;
  }

  pageRef.highlightLayer.innerHTML = '';

  const pageHighlights = state.currentHighlights.filter((item) => item.pageIndex === pageIndex);

  for (const highlight of pageHighlights) {
    for (const rect of highlight.rects ?? []) {
      const rectNode = document.createElement('div');
      rectNode.className = `highlight-rect ${highlightColorClass(highlight.color)}`;
      if (highlight.id === state.focusHighlightId) {
        rectNode.classList.add('focus-highlight');
      }

      rectNode.dataset.highlightId = highlight.id;
      rectNode.style.left = `${rect.x * 100}%`;
      rectNode.style.top = `${rect.y * 100}%`;
      rectNode.style.width = `${rect.w * 100}%`;
      rectNode.style.height = `${rect.h * 100}%`;
      pageRef.highlightLayer.appendChild(rectNode);
    }
  }
}

function updateReaderHeader() {
  const titleNode = document.querySelector('#reader-title');
  const subtitleNode = document.querySelector('#reader-subtitle');
  const timeNode = document.querySelector('#reader-time-total');

  if (!titleNode || !subtitleNode || !state.currentDocument) {
    return;
  }

  titleNode.textContent = state.currentDocument.title;
  const stats = getCurrentReadingStats();
  if (stats.totalPages > 0) {
    subtitleNode.textContent =
      `${state.currentHighlights.length} выделений · стр. ${stats.pageNumber}/${stats.totalPages} · прогресс ${formatPercent(stats.progress)}`;
    if (timeNode) {
      timeNode.textContent = `Всего: ${formatDurationSeconds(state.currentDocument.totalReadingSeconds ?? 0)}`;
    }
    return;
  }

  const contextPageNumber = getCurrentPageNumberSafe(readerRuntime.totalPages);
  subtitleNode.textContent = `${state.currentHighlights.length} выделений · стр. ${contextPageNumber}`;
  if (timeNode) {
    timeNode.textContent = `Всего: ${formatDurationSeconds(state.currentDocument.totalReadingSeconds ?? 0)}`;
  }
}

function updateReaderControls() {
  const scaleNode = document.querySelector('#reader-scale-label');
  const pageStatusNode = document.querySelector('#reader-page-status');
  const pageInputNode = document.querySelector('#reader-page-input');

  const totalPages = Math.max(1, normalizePageIndex(readerRuntime.totalPages, 1));
  const safeCurrentPage = getCurrentPageNumberSafe(totalPages);
  const safeScale = normalizeScale(readerRuntime.scale, 1.55);

  if (Math.abs(safeScale - readerRuntime.scale) > 0.0001) {
    readerRuntime.scale = safeScale;
  }

  if (scaleNode) {
    scaleNode.textContent = `${Math.round(safeScale * 100)}%`;
  }

  if (pageStatusNode) {
    pageStatusNode.textContent = `${safeCurrentPage} / ${totalPages}`;
  }

  if (pageInputNode) {
    pageInputNode.min = '1';
    pageInputNode.max = String(totalPages);
    pageInputNode.value = String(safeCurrentPage);
  }
}

function updateMiniMap() {
  const container = document.querySelector('#reader-minimap');
  if (!container) {
    return;
  }

  const totalPages = Math.max(1, normalizePageIndex(readerRuntime.totalPages, 1));
  const currentPage = getCurrentPageIndexSafe(totalPages);
  const highlightCountByPage = new Array(totalPages).fill(0);
  for (const highlight of state.currentHighlights) {
    const pageIndex = clampPageIndex(highlight.pageIndex, totalPages);
    highlightCountByPage[pageIndex] += 1;
  }

  const activePagesCount = highlightCountByPage.reduce(
    (count, value) => count + (value > 0 ? 1 : 0),
    0,
  );
  const binCount = Math.max(24, Math.min(96, Math.ceil(totalPages / 2)));
  const pagesPerBin = Math.max(1, Math.ceil(totalPages / binCount));
  const bins = [];
  let maxBinHighlights = 0;

  for (let pageStart = 0; pageStart < totalPages; pageStart += pagesPerBin) {
    const pageEnd = Math.min(totalPages - 1, pageStart + pagesPerBin - 1);
    let highlightsInBin = 0;
    for (let pageIndex = pageStart; pageIndex <= pageEnd; pageIndex += 1) {
      highlightsInBin += highlightCountByPage[pageIndex];
    }

    maxBinHighlights = Math.max(maxBinHighlights, highlightsInBin);
    bins.push({
      pageStart,
      pageEnd,
      highlightsInBin,
      includesCurrentPage: currentPage >= pageStart && currentPage <= pageEnd,
    });
  }

  const segments = bins
    .map((bin) => {
      const level =
        bin.highlightsInBin > 0
          ? Math.max(1, Math.ceil((bin.highlightsInBin / Math.max(1, maxBinHighlights)) * 4))
          : 0;
      return `
        <button
          class="minimap-segment level-${level} ${bin.includesCurrentPage ? 'is-current' : ''}"
          data-minimap-page="${bin.pageStart}"
          title="${
            bin.pageStart === bin.pageEnd
              ? `Стр. ${bin.pageStart + 1}`
              : `Стр. ${bin.pageStart + 1}-${bin.pageEnd + 1}`
          } · выделений: ${bin.highlightsInBin}"
          type="button"
        ></button>
      `;
    })
    .join('');

  const pointerLeft = clamp((currentPage / Math.max(1, totalPages - 1)) * 100, 0, 100);
  const middlePage = Math.max(1, Math.ceil(totalPages / 2));
  container.innerHTML = `
    <div class="minimap-headline">
      <span>Стр. ${currentPage + 1} / ${totalPages}</span>
      <span>Выделения: ${state.currentHighlights.length} · активных стр.: ${activePagesCount}</span>
    </div>
    <div class="minimap-track" style="--minimap-cols:${Math.max(1, bins.length)}">
      ${segments}
      <span class="minimap-pointer" style="left:${pointerLeft}%"></span>
    </div>
    <div class="minimap-footer">
      <span>1</span>
      <span>${middlePage}</span>
      <span>${totalPages}</span>
    </div>
  `;

  container.querySelectorAll('[data-minimap-page]').forEach((button) => {
    button.addEventListener('click', () => {
      const pageIndex = normalizePageIndex(button.getAttribute('data-minimap-page'), currentPage);
      scrollToPage(pageIndex, 'smooth', {
        userInitiated: true,
      });
    });
  });
}

function findAdjacentHighlight(direction = 1) {
  if (!Array.isArray(state.currentHighlights) || state.currentHighlights.length === 0) {
    return null;
  }

  const safeDirection = Number(direction) >= 0 ? 1 : -1;
  const sorted = sortHighlightsForDocument(state.currentHighlights);
  const currentPage = getCurrentPageIndexSafe(readerRuntime.totalPages);

  if (safeDirection > 0) {
    const next =
      sorted.find((item) => item.pageIndex > currentPage) ||
      sorted.find((item) => item.id === state.focusHighlightId) ||
      sorted[0];
    return next ?? null;
  }

  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    if (sorted[index].pageIndex < currentPage) {
      return sorted[index];
    }
  }

  return sorted[sorted.length - 1] ?? null;
}

async function jumpToAdjacentHighlight(direction = 1) {
  const target = findAdjacentHighlight(direction);
  if (!target) {
    setReaderMessage('В этой книге нет выделений.');
    return;
  }

  await navigateHighlightInReader(target.id, {
    documentId: target.documentId,
    pageIndex: target.pageIndex,
    behavior: 'smooth',
  });
}

function updateReaderModeButtons() {
  document.querySelectorAll('[data-reader-mode-btn]').forEach((button) => {
    const mode = button.getAttribute('data-reader-mode') || '';
    const color = button.getAttribute('data-color') || '';
    const isActiveMode = mode === state.readerInteractionMode;
    const isActiveColor =
      mode !== 'highlight' || color === state.readerHighlightColor;
    button.classList.toggle('is-active', isActiveMode && isActiveColor);
  });
}

function toggleWebViewerNotesPanel() {
  if (READER_ENGINE !== 'webviewer' || !webViewerRuntime.instance) {
    return;
  }

  const { UI } = webViewerRuntime.instance;
  const isOpen = UI.isElementOpen('leftPanel');

  if (isOpen) {
    UI.closeElements(['leftPanel']);
    return;
  }

  UI.openElements(['leftPanel']);
  UI.setActiveLeftPanel('notesPanel');
}

function applyReaderFocusMode() {
  const screen = document.querySelector('.reader-screen');
  if (!screen) {
    return;
  }

  screen.classList.toggle('focus-mode', Boolean(state.settings.focusMode));
  const toggleButton = document.querySelector('#reader-focus-mode-toggle');
  if (toggleButton) {
    toggleButton.innerHTML = `
      ${renderIcon('list')}
      ${state.settings.focusMode ? 'Обычный режим' : 'Фокус-режим'}
    `;
  }

  if (state.settings.focusMode) {
    destroyReaderSplit();
  } else {
    setupReaderSplitLayout();
  }

  if (READER_ENGINE === 'webviewer' && webViewerRuntime.instance) {
    try {
      webViewerRuntime.instance.UI.resize();
    } catch {
      // ignore viewer resize errors in focus mode toggle.
    }
  }
}

async function toggleReaderFocusMode() {
  state.settings.focusMode = !state.settings.focusMode;
  applyReaderFocusMode();
  hydrateIcons();

  try {
    const saved = await window.recallApi.updateSettings({
      focusMode: state.settings.focusMode,
    });
    applySettingsPatch(saved || {});
  } catch (error) {
    setReaderMessage(
      `Не удалось сохранить фокус-режим: ${error?.message ?? 'неизвестная ошибка'}`,
      true,
    );
  }
}

function setReaderInteractionMode(mode, color = state.readerHighlightColor) {
  if (mode === 'highlight' && !HIGHLIGHT_COLORS.includes(color)) {
    color = 'yellow';
  }

  state.readerInteractionMode = mode;
  if (mode === 'highlight') {
    state.readerHighlightColor = color;
  }

  updateReaderModeButtons();

  if (READER_ENGINE !== 'webviewer' || !webViewerRuntime.instance) {
    return;
  }

  const { UI, Core } = webViewerRuntime.instance;
  const { documentViewer, Tools, Annotations } = Core;

  if (mode === 'highlight') {
    const highlightTool = documentViewer.getTool(Tools.ToolNames.HIGHLIGHT);
    if (highlightTool?.defaults) {
      const strokeColor = highlightToWebViewerColor(color, Annotations);
      highlightTool.defaults.StrokeColor = strokeColor;
      highlightTool.defaults.Opacity = strokeColor.A;
    }

    UI.setToolMode(Tools.ToolNames.HIGHLIGHT);
    return;
  }

  if (mode === 'pan') {
    UI.setToolMode(Tools.ToolNames.PAN);
    return;
  }

  UI.setToolMode(Tools.ToolNames.TEXT_SELECT);
}

function applyReadwiseLikeWebViewerUi(instance) {
  const { UI } = instance;

  UI.disableFeatures(
    [
      UI.Feature.Ribbons,
      UI.Feature.Measurement,
      UI.Feature.Redaction,
      UI.Feature.FilePicker,
      UI.Feature.Print,
      UI.Feature.Download,
      UI.Feature.MultiTab,
      UI.Feature.SideBySideView,
      UI.Feature.ComparePages,
      UI.Feature.MultipleViewerMerging,
      UI.Feature.ThumbnailMerging,
      UI.Feature.ThumbnailReordering,
    ].filter(Boolean),
  );

  UI.disableElements([
    'leftPanelButton',
    'searchButton',
    'menuButton',
    'languageButton',
    'viewControlsButton',
    'toggleNotesButton',
    'toolsHeader',
    'header',
    'topHeader',
    'default-top-header',
    'defaultTopHeader',
    'ribbons',
    'ribbonPanel',
    'ribbonGroup',
    'viewToolbarGroup',
    'toolbarGroup-View',
    'toolbarGroup-Annotate',
    'toolbarGroup-Insert',
    'toolbarGroup-Shapes',
    'toolbarGroup-Edit',
    'zoomOverlayButton',
    'zoomButton',
    'zoomInButton',
    'zoomOutButton',
    'pageNavOverlayButton',
    'pageNavigationOverlayButton',
    'pageNumberInput',
    'pageNumberIndicator',
    'selectToolButton',
    'panToolButton',
    'selectHandToolButton',
    'header',
    'headerContainer',
    'toolsHeader',
    'toolbar',
    'toolbarGroup',
    'defaultToolbar',
    'floatingHeader',
    'topHeader',
    'mainHeader',
    'ribbonHeader',
  ]);

  UI.closeElements(['leftPanel', 'searchPanel', 'menuOverlay', 'toolsOverlay']);

  if (UI.Theme?.LIGHT) {
    UI.setTheme(UI.Theme.LIGHT);
  }

  if (UI.FitMode?.FitWidth) {
    UI.setFitMode(UI.FitMode.FitWidth);
  }

  if (typeof UI.setHeaderItems === 'function') {
    try {
      UI.setHeaderItems((header) => {
        if (header?.update) {
          header.update([]);
        }
      });
    } catch {
      // Ignore header customization errors across UI versions.
    }
  }

  if (typeof UI.setModularHeaders === 'function' && UI.Components?.ModularHeader) {
    try {
      UI.setModularHeaders([]);
    } catch {
      // Ignore modular header API differences.
    }
  }
}

function injectWebViewerMinimalCss(instance) {
  if (webViewerRuntime.cssInjected) {
    return;
  }

  const iframeDocument = instance?.UI?.iframeWindow?.document;
  if (!iframeDocument?.head) {
    return;
  }

  if (iframeDocument.getElementById('recall-webviewer-minimal-css')) {
    webViewerRuntime.cssInjected = true;
    return;
  }

  const style = iframeDocument.createElement('style');
  style.id = 'recall-webviewer-minimal-css';
  style.textContent = `
    [data-element="topHeader"],
    [data-element="top-header"],
    [data-element="header"],
    [data-element="default-top-header"],
    [data-element="defaultTopHeader"],
    [data-element="toolsHeader"],
    [data-element="tools-header"],
    [data-element="toolbarGroup-View"],
    [data-element="zoomOverlayButton"],
    [data-element="zoomButton"],
    [data-element="zoomInButton"],
    [data-element="zoomOutButton"],
    .Header,
    .ModularHeader,
    .modular-header,
    .DocumentHeader,
    .document-header {
      display: none !important;
    }

    [data-element="documentContainer"],
    [data-element="document-container"] {
      top: 0 !important;
      inset-top: 0 !important;
    }

    [data-element="mainPanel"],
    [data-element="main-panel"] {
      top: 0 !important;
    }
  `;

  iframeDocument.head.appendChild(style);
  webViewerRuntime.cssInjected = true;
}

async function stabilizeWebViewerZoom(instance, options = {}) {
  if (!instance) {
    return normalizeScale(readerRuntime.scale, 1.2);
  }

  const { UI, Core } = instance;
  const { documentViewer } = Core;
  const attempts = Math.max(1, Number(options.attempts ?? 4));
  const fallbackScale = normalizeScale(readerRuntime.scale, 1.2);

  webViewerRuntime.repairingZoom = true;
  try {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        UI.resize();
      } catch {
        // Ignore transient resize errors while viewer initializes.
      }

      const rawZoom = Number(documentViewer.getZoomLevel());
      if (Number.isFinite(rawZoom) && rawZoom > 0) {
        const normalized = normalizeScale(rawZoom, fallbackScale);
        readerRuntime.scale = normalized;
        updateReaderControls();
        return normalized;
      }

      if (UI.FitMode?.FitWidth) {
        try {
          UI.setFitMode(UI.FitMode.FitWidth);
        } catch {
          // Ignore if fit mode cannot be applied in current lifecycle stage.
        }
      }

      const fitZoom = Number(documentViewer.getZoomLevel());
      if (Number.isFinite(fitZoom) && fitZoom > 0) {
        const normalized = normalizeScale(fitZoom, fallbackScale);
        readerRuntime.scale = normalized;
        updateReaderControls();
        return normalized;
      }

      try {
        UI.setZoomLevel(fallbackScale);
      } catch {
        // Ignore if viewer cannot accept zoom before layout settles.
      }

      await waitMs(40 + attempt * 30);
    }
  } finally {
    webViewerRuntime.repairingZoom = false;
  }

  readerRuntime.scale = fallbackScale;
  updateReaderControls();
  return fallbackScale;
}

function buildReaderProgressPayload() {
  if (!state.currentDocument?.id || state.view !== 'reader') {
    return null;
  }

  const stats = getCurrentReadingStats();
  if (stats.totalPages <= 0) {
    return null;
  }

  const scale = normalizeScale(readerRuntime.scale, state.currentDocument.lastReadScale ?? 1.2);
  const now = Date.now();
  const lastPersistTs = Number(readerRuntime.lastPersistTs || now);
  let targetPageIndex = normalizePageIndex(stats.pageIndex, 0);
  const canPersistFirstPage = canPersistFirstPageForCurrentDocument();
  const maxReadPageIndex = normalizePageIndex(
    state.currentDocument?.maxReadPageIndex,
    targetPageIndex,
  );
  const lastReadPageIndex = normalizePageIndex(
    state.currentDocument?.lastReadPageIndex,
    maxReadPageIndex,
  );

  if (
    READER_ENGINE === 'webviewer' &&
    targetPageIndex === 0 &&
    maxReadPageIndex > 0 &&
    !canPersistFirstPage
  ) {
    targetPageIndex = Math.max(lastReadPageIndex, maxReadPageIndex);
  }
  const previousPersistPage = normalizePageIndex(
    readerRuntime.lastPersistPageIndex,
    targetPageIndex,
  );
  const readingSeconds = Math.max(0, Math.floor((now - lastPersistTs) / 1000));
  const rawPagesDelta = Math.max(0, targetPageIndex - previousPersistPage);
  const pagesDelta = Math.min(rawPagesDelta, 20);

  return {
    payload: {
      documentId: state.currentDocument.id,
      pageIndex: targetPageIndex,
      totalPages: stats.totalPages,
      scale,
      lastOpenedAt: new Date(now).toISOString(),
      readingSeconds,
      pagesDelta,
      allowFirstPage: canPersistFirstPage,
    },
    persistMeta: {
      now,
      pageIndex: targetPageIndex,
      readingSeconds,
      pagesDelta,
    },
  };
}

async function persistReaderProgress(options = {}) {
  const progressState = buildReaderProgressPayload();
  if (!progressState) {
    return null;
  }

  const { payload, persistMeta } = progressState;
  const key = [
    payload.documentId,
    payload.pageIndex,
    payload.totalPages,
    Math.round(payload.scale * 1000),
  ].join(':');

  const canSkipByKey = !options.force && readerRuntime.lastSavedProgressKey === key;
  if (canSkipByKey && persistMeta.readingSeconds < 8 && persistMeta.pagesDelta === 0) {
    return null;
  }

  try {
    const updatedDocument = await window.recallApi.updateDocumentReadingState(payload);
    readerRuntime.lastSavedProgressKey = key;
    readerRuntime.lastPersistTs = persistMeta.now;
    readerRuntime.lastPersistPageIndex = persistMeta.pageIndex;

    if (updatedDocument) {
      upsertDocumentInState(updatedDocument);
    }

    if (persistMeta.pagesDelta > 0 || persistMeta.readingSeconds >= 8) {
      state.readingLog = {
        ...state.readingLog,
      };
    }

    return updatedDocument;
  } catch (error) {
    if (options.showError) {
      setReaderMessage(
        `Не удалось сохранить позицию чтения: ${error?.message ?? 'неизвестная ошибка'}`,
        true,
      );
    }
    return null;
  }
}

function scheduleReaderProgressPersist(options = {}) {
  if (!state.currentDocument?.id || state.view !== 'reader') {
    return;
  }

  if (readerRuntime.progressSaveTimer) {
    window.clearTimeout(readerRuntime.progressSaveTimer);
  }

  const delayMs = options.immediate ? 120 : 280;

  readerRuntime.progressSaveTimer = window.setTimeout(() => {
    readerRuntime.progressSaveTimer = null;
    void persistReaderProgress();
  }, delayMs);
}

async function flushReaderProgressPersist(options = {}) {
  if (readerRuntime.progressSaveTimer) {
    window.clearTimeout(readerRuntime.progressSaveTimer);
    readerRuntime.progressSaveTimer = null;
  }

  await persistReaderProgress({
    force: true,
    ...options,
  });
}

function pushReaderHistory(pageIndex) {
  const safePage = clampPageIndex(pageIndex, readerRuntime.totalPages);
  const history = readerRuntime.navigationHistory;
  const current =
    readerRuntime.navigationHistoryIndex >= 0
      ? history[readerRuntime.navigationHistoryIndex]
      : undefined;

  if (current === safePage) {
    return;
  }

  if (readerRuntime.navigationHistoryIndex < history.length - 1) {
    history.splice(readerRuntime.navigationHistoryIndex + 1);
  }

  history.push(safePage);
  if (history.length > 120) {
    history.shift();
  }
  readerRuntime.navigationHistoryIndex = history.length - 1;
}

function updateHistoryButtons() {
  const backBtn = document.querySelector('#reader-nav-back');
  const forwardBtn = document.querySelector('#reader-nav-forward');
  if (!backBtn || !forwardBtn) {
    return;
  }

  backBtn.disabled = readerRuntime.navigationHistoryIndex <= 0;
  forwardBtn.disabled =
    readerRuntime.navigationHistoryIndex < 0 ||
    readerRuntime.navigationHistoryIndex >= readerRuntime.navigationHistory.length - 1;
}

function resetReaderHistory(initialPageIndex = 0) {
  const safe = clampPageIndex(initialPageIndex, readerRuntime.totalPages || 1);
  readerRuntime.navigationHistory = [safe];
  readerRuntime.navigationHistoryIndex = 0;
  updateHistoryButtons();
}

async function goReaderHistory(delta) {
  if (!Number.isFinite(Number(delta)) || delta === 0) {
    return;
  }

  const nextIndex = clamp(
    readerRuntime.navigationHistoryIndex + Number(delta),
    0,
    Math.max(0, readerRuntime.navigationHistory.length - 1),
  );

  if (nextIndex === readerRuntime.navigationHistoryIndex) {
    return;
  }

  readerRuntime.navigationHistoryIndex = nextIndex;
  updateHistoryButtons();

  const targetPage = clampPageIndex(
    readerRuntime.navigationHistory[nextIndex],
    readerRuntime.totalPages,
  );

  readerRuntime.navigationHistoryLocked = true;
  scrollToPage(targetPage, 'smooth', {
    recordHistory: false,
    userInitiated: true,
  });
  window.setTimeout(() => {
    readerRuntime.navigationHistoryLocked = false;
  }, 260);
}

function setCurrentPageIndex(pageIndex, options = {}) {
  const safe = clampPageIndex(pageIndex, readerRuntime.totalPages);
  const previousPageIndex = readerRuntime.currentPageIndex;
  readerRuntime.currentPageIndex = safe;
  if (options.recordHistory !== false && !readerRuntime.navigationHistoryLocked) {
    pushReaderHistory(safe);
  }
  updateReaderControls();
  updateReaderHeader();
  updateHighlightsSummary();
  updateMiniMap();
  updateHistoryButtons();
  if (options.persist !== false && !readerRuntime.openingDocument) {
    scheduleReaderProgressPersist({
      immediate: safe !== previousPageIndex,
    });
  }
  if (state.highlightsContextOnly) {
    renderHighlightsList();
  }
}

function scrollToPage(pageIndex, behavior = 'smooth', options = {}) {
  const safeIndex = clampPageIndex(pageIndex, readerRuntime.totalPages);
  if (options.userInitiated && safeIndex === 0) {
    allowFirstPagePersist();
  } else if (options.userInitiated) {
    clearFirstPagePersistAllowance();
  }

  if (READER_ENGINE === 'webviewer') {
    if (!readerRuntime.openingDocument) {
      clearOpenPageGuard();
    }
    requestWebViewerPageIndex(safeIndex);
    if (!readerRuntime.openingDocument) {
      setCurrentPageIndex(safeIndex, {
        recordHistory: options.recordHistory,
        persist: false,
      });
      window.setTimeout(() => {
        syncWebViewerCurrentPage();
      }, 70);
    } else {
      readerRuntime.currentPageIndex = safeIndex;
      updateReaderControls();
      updateReaderHeader();
      updateHighlightsSummary();
      updateMiniMap();
    }
    return;
  }

  const pageRef = readerRuntime.pageRefs.get(safeIndex);
  const container = document.querySelector('#pdf-scroll');
  if (!pageRef || !container) {
    return;
  }

  const top = Math.max(0, pageRef.card.offsetTop - 10);
  container.scrollTo({ top, behavior });
  setCurrentPageIndex(safeIndex, {
    recordHistory: options.recordHistory,
  });
}

function detectCurrentPageFromScroll() {
  if (READER_ENGINE === 'webviewer') {
    return;
  }

  const container = document.querySelector('#pdf-scroll');
  if (!container || readerRuntime.pageRefs.size === 0) {
    return;
  }

  const focusLine = container.scrollTop + container.clientHeight * 0.35;
  let bestIndex = getCurrentPageIndexSafe(readerRuntime.totalPages);
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const [pageIndex, pageRef] of readerRuntime.pageRefs.entries()) {
    const pageCenter = pageRef.card.offsetTop + pageRef.card.offsetHeight * 0.5;
    const distance = Math.abs(pageCenter - focusLine);

    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = pageIndex;
    }
  }

  if (bestIndex !== readerRuntime.currentPageIndex) {
    setCurrentPageIndex(bestIndex);
  }
}

async function renderSinglePdfPage(pdfDocument, pageIndex, container, token) {
  const pdfjsLib = await getPdfJsLib();
  const page = await pdfDocument.getPage(pageIndex + 1);

  if (token !== readerRuntime.renderToken || state.view !== 'reader') {
    return;
  }

  const viewport = page.getViewport({ scale: readerRuntime.scale });

  const card = document.createElement('section');
  card.className = 'pdf-page-card';
  card.dataset.pageIndex = String(pageIndex);
  card.innerHTML = `
    <div class="page-meta">Страница ${pageIndex + 1}</div>
    <div class="pdf-page" data-page-index="${pageIndex}">
      <canvas class="pdf-canvas"></canvas>
      <div class="text-layer"></div>
      <div class="highlight-layer"></div>
    </div>
  `;

  const pageNode = card.querySelector('.pdf-page');
  const canvas = card.querySelector('.pdf-canvas');
  const textLayer = card.querySelector('.text-layer');
  const highlightLayer = card.querySelector('.highlight-layer');

  pageNode.style.width = `${viewport.width}px`;
  pageNode.style.height = `${viewport.height}px`;
  textLayer.style.width = `${viewport.width}px`;
  textLayer.style.height = `${viewport.height}px`;
  highlightLayer.style.width = `${viewport.width}px`;
  highlightLayer.style.height = `${viewport.height}px`;

  container.appendChild(card);

  const outputScale = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * outputScale);
  canvas.height = Math.floor(viewport.height * outputScale);
  canvas.style.width = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;

  const context = canvas.getContext('2d', { alpha: false });
  context.setTransform(outputScale, 0, 0, outputScale, 0, 0);

  await page.render({
    canvasContext: context,
    viewport,
  }).promise;

  const textContent = await page.getTextContent();

  const textLayerBuilder = new pdfjsLib.TextLayer({
    textContentSource: textContent,
    container: textLayer,
    viewport,
  });

  await textLayerBuilder.render();

  readerRuntime.pageRefs.set(pageIndex, {
    card,
    pageNode,
    highlightLayer,
  });

  renderPageHighlights(pageIndex);
}

function focusHighlight(highlightId, doScroll = true) {
  state.focusHighlightId = highlightId || null;

  if (READER_ENGINE === 'webviewer') {
    if (highlightId) {
      focusWebViewerHighlight(highlightId, doScroll);
    }
    return;
  }

  for (const pageIndex of readerRuntime.pageRefs.keys()) {
    renderPageHighlights(pageIndex);
  }

  if (!doScroll || !highlightId) {
    return;
  }

  const target = Array.from(document.querySelectorAll('.highlight-rect')).find(
    (node) => node.dataset.highlightId === highlightId,
  );

  if (target) {
    const pageNode = target.closest('.pdf-page');
    const pageIndex = Number(pageNode?.dataset.pageIndex ?? '-1');

    if (pageIndex >= 0) {
      scrollToPage(pageIndex, 'smooth');
    }
  }
}

async function renderReaderPdf(options = {}) {
  const pdfContainer = document.querySelector('#pdf-scroll');
  if (!pdfContainer || !readerRuntime.pdfDocument || !state.currentDocument) {
    return;
  }

  const focusPageIndex =
    options.focusPageIndex ?? clamp(readerRuntime.currentPageIndex, 0, readerRuntime.totalPages - 1);
  const focusBehavior = options.focusBehavior ?? 'auto';

  const token = ++readerRuntime.renderToken;
  readerRuntime.pageRefs.clear();
  pdfContainer.innerHTML = '<div class="screen-loading">Рендеринг PDF…</div>';

  try {
    const pdfDocument = readerRuntime.pdfDocument;
    readerRuntime.totalPages = pdfDocument.numPages;
    setCurrentPageIndex(focusPageIndex);

    pdfContainer.innerHTML = '';

    for (let pageIndex = 0; pageIndex < pdfDocument.numPages; pageIndex += 1) {
      await renderSinglePdfPage(pdfDocument, pageIndex, pdfContainer, token);
    }

    if (token !== readerRuntime.renderToken || state.view !== 'reader') {
      return;
    }

    scrollToPage(focusPageIndex, focusBehavior);

    if (state.focusHighlightId) {
      focusHighlight(state.focusHighlightId, true);
    }
  } catch (error) {
    pdfContainer.innerHTML = `<div class="error-box">Не удалось отрисовать PDF: ${escapeHtml(error?.message ?? 'неизвестная ошибка')}</div>`;
  }
}

function isWebViewerHighlightAnnotation(annotation, Annotations) {
  return annotation instanceof Annotations.TextHighlightAnnotation;
}

function findWebViewerAnnotationByHighlightId(annotationManager, highlightId) {
  const targetId = String(highlightId ?? '');
  if (!targetId) {
    return null;
  }

  const byNativeId = annotationManager.getAnnotationById?.(targetId);
  if (byNativeId) {
    return byNativeId;
  }

  return (
    annotationManager
      .getAnnotationsList()
      .find((annot) => String(annot.getCustomData(WEBVIEWER_CUSTOM_ID_KEY) ?? '') === targetId) ??
    null
  );
}

function removeWebViewerHighlightAnnotation(highlightId) {
  if (READER_ENGINE !== 'webviewer' || !webViewerRuntime.instance || !highlightId) {
    return;
  }

  const { annotationManager } = webViewerRuntime.instance.Core;
  const annotation = findWebViewerAnnotationByHighlightId(annotationManager, highlightId);
  if (!annotation) {
    return;
  }

  const previousSuppress = webViewerRuntime.suppressSync;
  webViewerRuntime.suppressSync = true;
  try {
    annotationManager.deleteAnnotations([annotation], {
      imported: true,
      source: 'recall-ui-delete',
    });
  } finally {
    webViewerRuntime.suppressSync = previousSuppress;
  }
}

function buildHighlightPayloadFromAnnotation(annotation, documentViewer, selectionPayload) {
  const pageNumber = Number(annotation?.PageNumber ?? 0);
  const pageIndex = Math.max(0, pageNumber - 1);
  const pageInfo = documentViewer.getDocument().getPageInfo(pageNumber);
  const quads = Array.isArray(annotation?.getQuads?.()) ? annotation.getQuads() : [];
  const rects = mergeNormalizedRects(
    quads.map((quad) => webViewerQuadToNormalizedRect(quad, pageInfo)).filter(Boolean),
  );

  if (rects.length === 0) {
    return null;
  }

  const selectedText = normalizeHighlightSelectedText(selectionPayload?.selectedText);
  const selectedRichText =
    sanitizeHighlightRichText(selectionPayload?.selectedRichText) ||
    plainTextToRichText(selectedText);
  const note = normalizeText(annotation?.getContents?.() ?? '');
  return {
    pageIndex,
    rects,
    selectedText,
    selectedRichText: selectedRichText || undefined,
    color: webViewerColorToHighlight(annotation?.Color),
    note: note || undefined,
  };
}

function resolveSelectionForAnnotation(annotation, documentViewer) {
  const fromCustomData = normalizeHighlightSelectedText(
    annotation.getCustomData(WEBVIEWER_CUSTOM_TEXT_KEY),
  );
  const fromCustomRichText = sanitizeHighlightRichText(
    annotation.getCustomData(WEBVIEWER_CUSTOM_RICH_TEXT_KEY),
  );
  if (fromCustomData) {
    return {
      selectedText: fromCustomData,
      selectedRichText: fromCustomRichText || plainTextToRichText(fromCustomData),
    };
  }

  const currentSelectionText = normalizeHighlightSelectedText(
    documentViewer.getSelectedText(Number(annotation?.PageNumber ?? 0)),
  );
  const currentSelectionRichText = selectionObjectToRichText(
    webViewerRuntime.instance?.UI?.iframeWindow?.getSelection?.(),
    currentSelectionText,
  );
  if (currentSelectionText) {
    return {
      selectedText: currentSelectionText,
      selectedRichText: currentSelectionRichText || plainTextToRichText(currentSelectionText),
    };
  }

  const lastSelection = webViewerRuntime.lastTextSelection;
  if (!lastSelection) {
    return {
      selectedText: '',
      selectedRichText: '',
    };
  }

  if (Number(lastSelection.pageNumber ?? -1) !== Number(annotation?.PageNumber ?? -2)) {
    return {
      selectedText: '',
      selectedRichText: '',
    };
  }

  if (Date.now() - Number(lastSelection.timestamp ?? 0) > 8000) {
    return {
      selectedText: '',
      selectedRichText: '',
    };
  }

  const annotationSignature = buildQuadSignature(annotation.getQuads?.() ?? []);
  const sameShape = annotationSignature === lastSelection.signature;
  const selectedText = sameShape ? normalizeHighlightSelectedText(lastSelection.text) : '';
  return {
    selectedText,
    selectedRichText:
      selectedText &&
      (sanitizeHighlightRichText(lastSelection.richText) || plainTextToRichText(selectedText)),
  };
}

async function syncWebViewerAdd(annotation, instance) {
  const { documentViewer, annotationManager } = instance.Core;
  const existingId = annotation.getCustomData(WEBVIEWER_CUSTOM_ID_KEY);

  if (existingId) {
    return;
  }

  const selectionPayload = resolveSelectionForAnnotation(annotation, documentViewer);
  if (!selectionPayload.selectedText) {
    return;
  }

  const payload = buildHighlightPayloadFromAnnotation(annotation, documentViewer, selectionPayload);
  if (!payload) {
    return;
  }

  const saved = await window.recallApi.addHighlight({
    documentId: state.currentDocument.id,
    ...payload,
  });

  annotation.Id = String(saved.id);
  annotation.setCustomData(WEBVIEWER_CUSTOM_ID_KEY, String(saved.id));
  annotation.setCustomData(WEBVIEWER_CUSTOM_TEXT_KEY, saved.selectedText);
  annotation.setCustomData(WEBVIEWER_CUSTOM_RICH_TEXT_KEY, saved.selectedRichText ?? '');
  annotationManager.redrawAnnotation(annotation);

  upsertCurrentHighlight(saved);
  incrementDocumentHighlightCount(state.currentDocument.id);
  updateReaderHeader();
}

async function syncWebViewerModify(annotation, instance) {
  const highlightId = annotation.getCustomData(WEBVIEWER_CUSTOM_ID_KEY);
  if (!highlightId) {
    return;
  }

  const { documentViewer } = instance.Core;
  const existing =
    state.currentHighlights.find((item) => item.id === highlightId) ?? null;
  const selectionPayload = resolveSelectionForAnnotation(annotation, documentViewer);
  const selectedText =
    selectionPayload.selectedText || normalizeHighlightSelectedText(existing?.selectedText);
  if (!selectedText) {
    return;
  }
  const selectedRichText =
    selectionPayload.selectedRichText ||
    sanitizeHighlightRichText(existing?.selectedRichText) ||
    plainTextToRichText(selectedText);

  const payload = buildHighlightPayloadFromAnnotation(annotation, documentViewer, {
    selectedText,
    selectedRichText,
  });
  if (!payload) {
    return;
  }

  const updated = await window.recallApi.updateHighlight({
    id: highlightId,
    ...payload,
  });

  annotation.Id = String(updated.id);
  annotation.setCustomData(WEBVIEWER_CUSTOM_ID_KEY, String(updated.id));
  annotation.setCustomData(WEBVIEWER_CUSTOM_TEXT_KEY, updated.selectedText);
  annotation.setCustomData(WEBVIEWER_CUSTOM_RICH_TEXT_KEY, updated.selectedRichText ?? '');
  upsertCurrentHighlight(updated);
  updateReaderHeader();
}

async function syncWebViewerDelete(annotation) {
  const highlightId = annotation.getCustomData(WEBVIEWER_CUSTOM_ID_KEY);
  if (!highlightId) {
    return;
  }

  await deleteHighlightById(highlightId, {
    showError: true,
    skipViewerDelete: true,
  });
}

function bindWebViewerEvents(instance) {
  if (webViewerRuntime.eventsBound) {
    return;
  }

  const { documentViewer, annotationManager, Annotations } = instance.Core;

  documentViewer.addEventListener('pageNumberUpdated', () => {
    if (isOpenPageGuardActive()) {
      requestWebViewerPageIndex(readerRuntime.openGuardPageIndex);
      return;
    }

    if (readerRuntime.openingDocument) {
      return;
    }

    syncWebViewerCurrentPage();
  });

  documentViewer.addEventListener('documentLoaded', () => {
    if (readerRuntime.openingDocument || isOpenPageGuardActive()) {
      return;
    }
    syncWebViewerCurrentPage();
    startWebViewerPageSync();
  });

  documentViewer.addEventListener('zoomUpdated', (zoom) => {
    const rawZoom = Number(zoom);
    if (!Number.isFinite(rawZoom) || rawZoom <= 0) {
      if (!webViewerRuntime.repairingZoom) {
        void stabilizeWebViewerZoom(instance, { attempts: 3 });
      }
      return;
    }

    readerRuntime.scale = normalizeScale(rawZoom, readerRuntime.scale);
    updateReaderControls();
  });

  documentViewer.addEventListener('textSelected', (quads, text, pageNumber) => {
    const richText = selectionObjectToRichText(
      instance?.UI?.iframeWindow?.getSelection?.(),
      text,
    );
    webViewerRuntime.lastTextSelection = {
      pageNumber,
      text,
      richText,
      signature: buildQuadSignature(quads),
      timestamp: Date.now(),
    };
  });

  annotationManager.addEventListener('annotationChanged', async (annotations, action, info) => {
    if (state.view !== 'reader' || READER_ENGINE !== 'webviewer') {
      return;
    }

    if (webViewerRuntime.suppressSync || info?.imported) {
      return;
    }

    if (!state.currentDocument?.id) {
      return;
    }

    const normalizedAction = String(action ?? '').toLowerCase();
    const filtered = annotations.filter((annotation) =>
      isWebViewerHighlightAnnotation(annotation, Annotations),
    );

    if (filtered.length === 0) {
      return;
    }

    try {
      for (const annotation of filtered) {
        if (normalizedAction === 'add') {
          await syncWebViewerAdd(annotation, instance);
        } else if (normalizedAction === 'modify') {
          await syncWebViewerModify(annotation, instance);
        } else if (normalizedAction === 'delete') {
          await syncWebViewerDelete(annotation);
        }
      }

      updateHighlightsSummary();
      renderHighlightsList();
    } catch (error) {
      setReaderMessage(
        `Не удалось синхронизировать выделения: ${error?.message ?? 'неизвестная ошибка'}`,
        true,
      );
    }
  });

  webViewerRuntime.eventsBound = true;
}

async function ensureWebViewerInstance() {
  const host = document.querySelector('#webviewer-host');
  if (!host) {
    throw new Error('Контейнер WebViewer не найден.');
  }

  if (webViewerRuntime.instance && webViewerRuntime.host === host) {
    return webViewerRuntime.instance;
  }

  if (webViewerRuntime.instance && webViewerRuntime.host && webViewerRuntime.host !== host) {
    try {
      webViewerRuntime.instance.Core.documentViewer.unmount();
    } catch {
      // ignore unmount issues when switching views quickly
    }
    webViewerRuntime.instance = null;
    webViewerRuntime.cssInjected = false;
  }

  webViewerRuntime.host = host;
  webViewerRuntime.eventsBound = false;
  webViewerRuntime.lastTextSelection = null;
  webViewerRuntime.repairingZoom = false;

  const WebViewer = await getWebViewerFactory();
  const licenseKey = import.meta.env.VITE_APRYSE_LICENSE_KEY || undefined;
  const instance = await WebViewer(
    {
      path: '/webviewer',
      fullAPI: false,
      disableLogs: true,
      defaultLanguage: 'ru',
      enableAnnotations: true,
      licenseKey,
      notesInLeftPanel: true,
      initialDoc: undefined,
    },
    host,
  );

  webViewerRuntime.instance = instance;
  bindWebViewerEvents(instance);

  try {
    await instance.UI.setLanguage('ru');
  } catch {
    // If the RU locale is unavailable, keep default language.
  }

  applyReadwiseLikeWebViewerUi(instance);
  injectWebViewerMinimalCss(instance);
  setReaderInteractionMode(state.readerInteractionMode, state.readerHighlightColor);

  return instance;
}

async function renderWebViewerHighlights(instance) {
  const { documentViewer, annotationManager, Annotations, Math: MathCore } = instance.Core;

  const existing = annotationManager
    .getAnnotationsList()
    .filter((annotation) => annotation.getCustomData(WEBVIEWER_CUSTOM_ID_KEY));

  webViewerRuntime.suppressSync = true;
  try {
    if (existing.length > 0) {
      annotationManager.deleteAnnotations(existing, {
        imported: true,
        source: 'recall-import',
      });
    }

    const annotationsToImport = [];

    for (const highlight of state.currentHighlights) {
      const pageNumber = highlight.pageIndex + 1;
      const pageInfo = documentViewer.getDocument().getPageInfo(pageNumber);
      const quads = mergeNormalizedRects(highlight.rects ?? [])
        .map((rect) => normalizedRectToWebViewerQuad(rect, pageInfo, MathCore))
        .filter(Boolean);

      if (quads.length === 0) {
        continue;
      }

      const annotation = new Annotations.TextHighlightAnnotation();
      annotation.Id = String(highlight.id);
      annotation.PageNumber = pageNumber;
      annotation.Quads = quads;
      annotation.Color = highlightToWebViewerColor(highlight.color, Annotations);
      annotation.setContents(highlight.note ?? '');
      annotation.setCustomData(WEBVIEWER_CUSTOM_ID_KEY, String(highlight.id));
      annotation.setCustomData(WEBVIEWER_CUSTOM_TEXT_KEY, highlight.selectedText ?? '');
      annotation.setCustomData(WEBVIEWER_CUSTOM_RICH_TEXT_KEY, highlight.selectedRichText ?? '');
      annotation.Author = annotationManager.getCurrentUser?.() || 'PDF Recall';
      annotationsToImport.push(annotation);
    }

    if (annotationsToImport.length > 0) {
      annotationManager.addAnnotations(annotationsToImport, {
        imported: true,
        source: 'recall-import',
      });

      for (const annotation of annotationsToImport) {
        annotationManager.redrawAnnotation(annotation);
      }
    }
  } finally {
    webViewerRuntime.suppressSync = false;
  }
}

async function loadWebViewerDocument(documentInfo) {
  const instance = await ensureWebViewerInstance();
  const { documentViewer } = instance.Core;
  const pdfBytes = await window.recallApi.readDocumentPdfBytes(documentInfo.id);
  const pdfBuffer = toArrayBuffer(pdfBytes);

  await documentViewer.loadDocument(pdfBuffer, {
    filename: `${documentInfo.title}.pdf`,
    extension: 'pdf',
    docId: documentInfo.id,
  });

  const loadedPageCount = normalizePageIndex(documentViewer.getPageCount(), 0);
  const storedPageCount = normalizePageIndex(documentInfo.lastReadTotalPages, 0);
  readerRuntime.totalPages = Math.max(1, loadedPageCount, storedPageCount);
  syncWebViewerCurrentPage({
    force: true,
  });
  readerRuntime.scale = normalizeScale(documentViewer.getZoomLevel(), readerRuntime.scale);
  readerRuntime.activeDocumentId = documentInfo.id;

  applyReadwiseLikeWebViewerUi(instance);
  injectWebViewerMinimalCss(instance);
  updateReaderControls();
  setReaderInteractionMode(state.readerInteractionMode, state.readerHighlightColor);

  await renderWebViewerHighlights(instance);
  const stableZoom = await stabilizeWebViewerZoom(instance, { attempts: 5 });
  try {
    instance.UI.setZoomLevel(normalizeScale(stableZoom, 1.2));
  } catch {
    // keep recovered zoom even if UI setter fails in this lifecycle tick.
  }
  return instance;
}

async function navigateWebViewerToHighlight(highlightId, options = {}) {
  if (!highlightId || !webViewerRuntime.instance || !state.currentDocument?.id) {
    return false;
  }

  const highlight = state.currentHighlights.find((item) => item.id === highlightId) ?? null;
  if (!highlight) {
    return false;
  }

  const doScroll = options.doScroll !== false;
  const behavior = options.behavior === 'auto' ? 'auto' : 'smooth';
  const timeoutMs = Math.max(300, Number(options.timeoutMs ?? 2200));
  const pollMs = Math.max(25, Number(options.pollMs ?? 75));
  const targetPageIndex = clampPageIndex(
    options.pageIndex ?? highlight.pageIndex,
    readerRuntime.totalPages,
  );
  const documentId = state.currentDocument.id;
  const navToken = ++webViewerRuntime.highlightNavToken;

  await stabilizeWebViewerZoom(webViewerRuntime.instance, { attempts: 2 });

  if (doScroll) {
    scrollToPage(targetPageIndex, behavior, {
      userInitiated: true,
    });
  } else {
    setCurrentPageIndex(targetPageIndex);
  }

  const getAnnotation = () => {
    if (!webViewerRuntime.instance) {
      return null;
    }
    const { annotationManager } = webViewerRuntime.instance.Core;
    return findWebViewerAnnotationByHighlightId(annotationManager, highlightId);
  };

  let annotation = getAnnotation();
  const deadline = Date.now() + timeoutMs;

  while (!annotation && Date.now() < deadline) {
    if (
      navToken !== webViewerRuntime.highlightNavToken ||
      state.view !== 'reader' ||
      state.currentDocument?.id !== documentId
    ) {
      return false;
    }

    await waitMs(pollMs);
    annotation = getAnnotation();
  }

  if (!annotation && webViewerRuntime.instance && state.currentDocument?.id === documentId) {
    // Sometimes WebViewer drops imported highlight refs after quick view switches.
    // Re-import from local state and retry lookup once before giving up.
    await renderWebViewerHighlights(webViewerRuntime.instance);
    await stabilizeWebViewerZoom(webViewerRuntime.instance, { attempts: 2 });
    await waitMs(32);
    annotation = getAnnotation();
  }

  if (!annotation || !webViewerRuntime.instance) {
    setCurrentPageIndex(targetPageIndex);
    return true;
  }

  const { annotationManager } = webViewerRuntime.instance.Core;
  annotationManager.deselectAllAnnotations();
  annotationManager.selectAnnotation(annotation);

  if (doScroll) {
    try {
      annotationManager.jumpToAnnotation(annotation, {
        fitToView: false,
        animated: behavior === 'smooth',
      });
    } catch {
      // Keep page-level scroll fallback that already happened above.
    }
  }

  setCurrentPageIndex(targetPageIndex);
  return true;
}

function focusWebViewerHighlight(highlightId, doScroll = true) {
  void navigateWebViewerToHighlight(highlightId, {
    doScroll,
    behavior: doScroll ? 'smooth' : 'auto',
  });
}

async function loadPdfDocument(documentId) {
  const pdfjsLib = await getPdfJsLib();
  const pdfBytes = await window.recallApi.readDocumentPdfBytes(documentId);
  const loadingTask = pdfjsLib.getDocument({ data: toUint8Array(pdfBytes) });
  return loadingTask.promise;
}

async function setScale(newScale) {
  const currentScale = normalizeScale(readerRuntime.scale, 1.55);
  const nextScale = normalizeScale(newScale, currentScale);

  if (Math.abs(nextScale - currentScale) < 0.01) {
    return;
  }

  if (READER_ENGINE === 'webviewer') {
    readerRuntime.scale = nextScale;
    updateReaderControls();
    scheduleReaderProgressPersist();
    if (webViewerRuntime.instance) {
      const { UI, Core } = webViewerRuntime.instance;
      const hasDocument = Boolean(Core.documentViewer.getDocument());
      if (hasDocument) {
        try {
          UI.setZoomLevel(nextScale);
        } catch {
          // Zoom can throw while viewer is still mounting after fast navigation.
        }
        await stabilizeWebViewerZoom(webViewerRuntime.instance, { attempts: 2 });
      }
    }
    return;
  }

  const preservePage = readerRuntime.currentPageIndex;
  readerRuntime.scale = nextScale;
  updateReaderControls();
  scheduleReaderProgressPersist();

  await renderReaderPdf({
    focusPageIndex: preservePage,
    focusBehavior: 'auto',
  });
}

async function changeScale(delta) {
  await setScale(normalizeScale(readerRuntime.scale, 1.55) + Number(delta || 0));
}

function openNoteModal() {
  const noteModal = document.querySelector('#note-modal');
  if (!noteModal || !state.pendingSelection) {
    return;
  }

  noteModal.classList.remove('hidden');
  const textarea = noteModal.querySelector('textarea[name="note"]');
  if (textarea) {
    textarea.value = '';
    textarea.focus();
  }
}

function closeNoteModal() {
  const noteModal = document.querySelector('#note-modal');
  if (noteModal) {
    noteModal.classList.add('hidden');
  }
}

async function createHighlight(color, note = '') {
  if (!state.currentDocument || !state.pendingSelection) {
    return;
  }

  const payload = {
    documentId: state.currentDocument.id,
    pageIndex: state.pendingSelection.pageIndex,
    rects: state.pendingSelection.rects,
    selectedText: state.pendingSelection.selectedText,
    selectedRichText: state.pendingSelection.selectedRichText,
    color,
    note,
  };

  try {
    const savedHighlight = await window.recallApi.addHighlight(payload);
    upsertCurrentHighlight(savedHighlight);

    incrementDocumentHighlightCount(state.currentDocument.id);

    state.focusHighlightId = savedHighlight.id;
    for (const pageIndex of readerRuntime.pageRefs.keys()) {
      renderPageHighlights(pageIndex);
    }
    updateReaderHeader();

    state.pendingSelection = null;
    closeNoteModal();
    updateSelectionMenu();

    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
    }

    setReaderMessage('Выделение сохранено.');
  } catch (error) {
    setReaderMessage(
      `Не удалось сохранить выделение: ${error?.message ?? 'неизвестная ошибка'}`,
      true,
    );
  }
}

async function onExportAnnotatedPdf() {
  if (!state.currentDocument) {
    return;
  }

  setReaderMessage('Экспорт аннотированного PDF...');

  try {
    const result = await window.recallApi.exportAnnotatedPdf(state.currentDocument.id);

    if (result?.canceled) {
      setReaderMessage('Экспорт аннотированного PDF отменен.');
      return;
    }

    setReaderMessage(`Аннотированный PDF сохранен: ${result.filePath}`);
  } catch (error) {
    setReaderMessage(
      `Не удалось экспортировать аннотированный PDF: ${error?.message ?? 'неизвестная ошибка'}`,
      true,
    );
  }
}

async function onExportMarkdown() {
  if (!state.currentDocument) {
    return;
  }

  setReaderMessage('Экспорт Markdown...');

  try {
    const result = await window.recallApi.exportMarkdown(state.currentDocument.id);

    if (result?.canceled) {
      setReaderMessage('Экспорт Markdown отменен.');
      return;
    }

    setReaderMessage(`Markdown сохранен: ${result.filePath}`);
  } catch (error) {
    setReaderMessage(
      `Не удалось экспортировать Markdown: ${error?.message ?? 'неизвестная ошибка'}`,
      true,
    );
  }
}

function renderReaderShell() {
  state.view = 'reader';

  const pdfViewportMarkup =
    READER_ENGINE === 'webviewer'
      ? `
        <section class="reader-webviewer-wrap">
          <div id="webviewer-host" class="webviewer-host"></div>
        </section>
      `
      : '<section id="pdf-scroll" class="pdf-scroll"></section>';

  const selectionMarkup =
    READER_ENGINE === 'webviewer'
      ? ''
      : `
      <div id="selection-menu" class="selection-menu hidden">
        <div class="selection-title">Создать выделение</div>
        <div id="selection-preview" class="selection-preview"></div>

        <div class="selection-buttons">
          <button data-action="quick-highlight" data-color="yellow" class="highlight-action yellow" data-selection-action>
            Желтый
          </button>
          <button data-action="quick-highlight" data-color="green" class="highlight-action green" data-selection-action>
            Зеленый
          </button>
          <button data-action="quick-highlight" data-color="pink" class="highlight-action pink" data-selection-action>
            Розовый
          </button>
        </div>
        <div class="selection-buttons secondary-row">
          <button data-action="add-note" class="secondary-btn" data-selection-action>С заметкой...</button>
          <button data-action="cancel-selection" class="ghost-btn" data-selection-action>Сбросить</button>
        </div>
      </div>

      <div id="note-modal" class="modal hidden">
        <form id="note-form" class="modal-card">
          <h3>Заметка к выделению</h3>
          <label for="note-input">Текст заметки</label>
          <textarea id="note-input" name="note" rows="4" placeholder="Необязательная заметка"></textarea>

          <label for="note-color">Цвет</label>
          <select id="note-color" name="color">
            <option value="yellow">Желтый</option>
            <option value="green">Зеленый</option>
            <option value="pink">Розовый</option>
          </select>

          <div class="modal-actions">
            <button type="button" id="cancel-note" class="secondary-btn">Отмена</button>
            <button type="submit" class="primary-btn">Сохранить</button>
          </div>
        </form>
      </div>
    `;

  appNode.innerHTML = `
    <main class="reader-screen">
      ${getTabsMarkup('reader')}

      <header class="reader-toolbar">
        <div class="reader-headline">
          <h2 id="reader-title">Загрузка...</h2>
          <p id="reader-subtitle">Подготовка выделений...</p>
          <p id="reader-time-total" class="reader-time">Всего: 0 мин</p>
        </div>

        <div class="reader-right-actions">
          <button class="ghost-btn" data-action="open-command-palette">
            ${renderIcon('list')}
            Команды
          </button>
          <button id="reader-focus-mode-toggle" class="ghost-btn">
            ${renderIcon('list')}
            ${state.settings.focusMode ? 'Обычный режим' : 'Фокус-режим'}
          </button>
          <button id="export-annotated-btn" class="ghost-btn">
            ${renderIcon('file-output')}
            Экспорт PDF
          </button>
          <button id="export-markdown-btn" class="ghost-btn">
            ${renderIcon('file-text')}
            Экспорт Markdown
          </button>
          <button id="reader-reset-progress-btn" class="ghost-btn">
            Сброс прогресса
          </button>
          <button id="reader-delete-document-btn" class="danger-btn">
            ${renderIcon('trash-2')}
            Удалить книгу
          </button>
        </div>
      </header>

      <div id="reader-message" class="reader-flash hidden"></div>
      <div id="reader-error" class="reader-flash error hidden"></div>

      <section class="reader-workspace">
        <section id="reader-document-pane" class="reader-document-pane">
          <section class="reader-controls">
            <div class="reader-mode-controls">
              <button
                class="ghost-btn reader-mode-btn"
                data-reader-mode-btn
                data-reader-mode="text-select"
                title="Режим чтения и выделения текста"
              >
                ${renderIcon('hand')}
                Чтение
              </button>
              <button
                class="ghost-btn reader-mode-btn marker-yellow"
                data-reader-mode-btn
                data-reader-mode="highlight"
                data-color="yellow"
                title="Маркер: желтый"
              >
                ${renderIcon('highlighter')}
                Маркер ж
              </button>
              <button
                class="ghost-btn reader-mode-btn marker-green"
                data-reader-mode-btn
                data-reader-mode="highlight"
                data-color="green"
                title="Маркер: зеленый"
              >
                ${renderIcon('highlighter')}
                Маркер з
              </button>
              <button
                class="ghost-btn reader-mode-btn marker-pink"
                data-reader-mode-btn
                data-reader-mode="highlight"
                data-color="pink"
                title="Маркер: розовый"
              >
                ${renderIcon('highlighter')}
                Маркер р
              </button>
              <button
                id="reader-notes-panel-btn"
                class="ghost-btn reader-mode-btn"
                title="Открыть системную панель заметок PDF"
              >
                ${renderIcon('notebook-pen')}
                Заметки PDF
              </button>
            </div>

            <div class="reader-pdf-controls">
              <button id="reader-nav-back" class="secondary-btn" title="Назад по истории (Alt+←)">←</button>
              <button id="reader-nav-forward" class="secondary-btn" title="Вперед по истории (Alt+→)">→</button>
              <button id="zoom-out-btn" class="secondary-btn" title="Уменьшить">-</button>
              <button id="zoom-in-btn" class="secondary-btn" title="Увеличить">+</button>
              <button id="zoom-reset-btn" class="ghost-btn" title="Сбросить масштаб">100%</button>
              <span id="reader-scale-label" class="reader-badge">155%</span>

              <label class="page-input-wrap" for="reader-page-input">Страница</label>
              <input id="reader-page-input" type="number" min="1" step="1" />
              <button id="reader-page-go" class="secondary-btn">Перейти</button>
              <span id="reader-page-status" class="reader-badge">1 / 1</span>
              <button id="reader-prev-highlight" class="ghost-btn" title="Предыдущий хайлайт (Shift+J)">← Хайлайт</button>
              <button id="reader-next-highlight" class="ghost-btn" title="Следующий хайлайт (J)">Хайлайт →</button>
            </div>
          </section>

          ${pdfViewportMarkup}
        </section>

        <aside id="reader-notes-pane" class="reader-notes-pane">
          <section class="reader-minimap-wrap">
            <h4>Мини-карта</h4>
            <div id="reader-minimap" class="reader-minimap"></div>
          </section>

          <header class="reader-notes-header">
            <div>
              <h3>Хайлайты</h3>
              <p id="reader-highlights-summary">0 всего · текущая стр. 1</p>
            </div>
            <button id="reader-open-highlights-tab" class="ghost-btn">
              ${renderIcon('list')}
              Полный список
            </button>
          </header>

          <section class="reader-notes-search">
            <input
              id="reader-highlights-search"
              data-highlights-search
              type="search"
              placeholder='Поиск: book:, tag:, -tag:, color:, page:, has:, due:, before:, after:, sort:, "фраза"'
              value="${escapeHtml(state.highlightsQuery)}"
            />
            <label class="context-toggle compact" for="reader-context-only-toggle">
              <input
                id="reader-context-only-toggle"
                data-highlights-context-toggle
                type="checkbox"
                ${state.highlightsContextOnly ? 'checked' : ''}
              />
              <span>Только рядом с текущей страницей (±3)</span>
            </label>
            <div class="search-filter-chips hidden" data-highlights-filter-chips></div>
          </section>

          <section id="reader-highlights-list" class="highlights-list compact" data-highlights-list></section>
        </aside>
      </section>

      ${selectionMarkup}
    </main>
    ${getCommandPaletteMarkup()}
  `;

  bindGlobalTabs();
  refreshCommandPaletteItems();
  bindCommandPaletteEvents();
  bindCommandPaletteTriggers();
  updateCommandPaletteUi();

  document
    .querySelector('#export-annotated-btn')
    ?.addEventListener('click', onExportAnnotatedPdf);

  document
    .querySelector('#export-markdown-btn')
    ?.addEventListener('click', onExportMarkdown);

  document.querySelector('#reader-delete-document-btn')?.addEventListener('click', () => {
    if (!state.currentDocument?.id) {
      return;
    }

    deleteDocumentById(state.currentDocument.id, state.currentDocument.title);
  });

  document.querySelector('#reader-reset-progress-btn')?.addEventListener('click', async () => {
    if (!state.currentDocument?.id) {
      return;
    }
    await resetDocumentProgressById(state.currentDocument.id, state.currentDocument.title);
  });

  document.querySelector('#zoom-out-btn')?.addEventListener('click', () => {
    changeScale(-0.15);
  });

  document.querySelector('#zoom-in-btn')?.addEventListener('click', () => {
    changeScale(0.15);
  });

  document.querySelector('#zoom-reset-btn')?.addEventListener('click', () => {
    setScale(1);
  });

  document.querySelector('#reader-nav-back')?.addEventListener('click', () => {
    void goReaderHistory(-1);
  });

  document.querySelector('#reader-nav-forward')?.addEventListener('click', () => {
    void goReaderHistory(1);
  });

  document.querySelector('#reader-prev-highlight')?.addEventListener('click', () => {
    void jumpToAdjacentHighlight(-1);
  });

  document.querySelector('#reader-next-highlight')?.addEventListener('click', () => {
    void jumpToAdjacentHighlight(1);
  });

  document.querySelector('#reader-focus-mode-toggle')?.addEventListener('click', () => {
    void toggleReaderFocusMode();
  });

  const pageInput = document.querySelector('#reader-page-input');
  const pageGoButton = document.querySelector('#reader-page-go');
  const goToRequestedPage = () => {
    const fallbackPage = getCurrentPageNumberSafe(readerRuntime.totalPages);
    const requested = normalizePageIndex(pageInput?.value, fallbackPage) - 1;
    scrollToPage(requested, 'smooth', {
      userInitiated: true,
    });
  };

  pageGoButton?.addEventListener('click', () => {
    goToRequestedPage();
  });

  pageInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      goToRequestedPage();
    }
  });

  document.querySelectorAll('[data-reader-mode-btn]').forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.getAttribute('data-reader-mode') || 'text-select';
      const color = button.getAttribute('data-color') || state.readerHighlightColor;
      setReaderInteractionMode(mode, color);
    });
  });

  document.querySelector('#reader-notes-panel-btn')?.addEventListener('click', () => {
    toggleWebViewerNotesPanel();
  });

  document.querySelector('#reader-open-highlights-tab')?.addEventListener('click', () => {
    void renderHighlightsView();
  });

  document.querySelector('#reader-highlights-search')?.addEventListener('input', (event) => {
    state.highlightsQuery = event.currentTarget.value;
    renderHighlightsList();
  });

  document.querySelector('#reader-context-only-toggle')?.addEventListener('change', (event) => {
    state.highlightsContextOnly = Boolean(event.currentTarget.checked);
    renderHighlightsList();
  });

  if (READER_ENGINE !== 'webviewer') {
    document.querySelector('#pdf-scroll')?.addEventListener('scroll', () => {
      detectCurrentPageFromScroll();
    });

    document.querySelector('#pdf-scroll')?.addEventListener('mouseup', () => {
      window.setTimeout(captureSelection, 0);
    });

    document.querySelector('#pdf-scroll')?.addEventListener('keyup', () => {
      window.setTimeout(captureSelection, 0);
    });

    document.querySelectorAll('[data-action="quick-highlight"]').forEach((button) => {
      button.addEventListener('click', () => {
        const color = button.getAttribute('data-color') || 'yellow';
        createHighlight(color);
      });
    });

    document.querySelector('[data-action="cancel-selection"]')?.addEventListener('click', () => {
      clearSelectionState();
      updateSelectionActions();
    });

    document.querySelector('[data-action="add-note"]')?.addEventListener('click', () => {
      openNoteModal();
    });

    document.querySelector('#cancel-note')?.addEventListener('click', () => {
      closeNoteModal();
    });

    document.querySelector('#note-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();

      const form = event.currentTarget;
      const formData = new FormData(form);
      const note = normalizeText(formData.get('note'));
      const color = String(formData.get('color') || 'yellow');

      await createHighlight(color, note);
    });
  }

  updateReaderModeButtons();
  updateSelectionActions();
  updateHighlightsSummary();
  renderHighlightsList();
  updateMiniMap();
  updateHistoryButtons();

  if (readerRuntime.resizeHandler) {
    window.removeEventListener('resize', readerRuntime.resizeHandler);
  }

  const onResize = () => {
    setupReaderSplitLayout();
    if (READER_ENGINE === 'webviewer' && webViewerRuntime.instance) {
      try {
        webViewerRuntime.instance.UI.resize();
      } catch {
        // ignore viewer resize failures during fast window resizes.
      }
      void stabilizeWebViewerZoom(webViewerRuntime.instance, { attempts: 1 });
    }
  };
  readerRuntime.resizeHandler = onResize;
  window.addEventListener('resize', onResize);

  setupReaderSplitLayout();
  applyReaderFocusMode();
  hydrateIcons();
}

async function openReaderView(documentId, options = {}) {
  const targetDocumentId = String(documentId ?? '');
  if (!targetDocumentId) {
    return;
  }
  resetHighlightsReviewSession('');

  if (state.view === 'reader' && state.currentDocument?.id) {
    await flushReaderProgressPersist({
      force: true,
    });
  }

  const openToken = readerRuntime.openingToken + 1;
  readerRuntime.openingToken = openToken;
  readerRuntime.openingDocument = true;
  clearOpenPageGuard();
  clearFirstPagePersistAllowance();
  if (readerRuntime.pageSyncTimer) {
    window.clearInterval(readerRuntime.pageSyncTimer);
    readerRuntime.pageSyncTimer = null;
  }

  renderReaderShell();

  state.pendingSelection = null;
  state.focusHighlightId = options.focusHighlightId || null;
  setReaderMessage('Загружаю документ...');

  try {
    const [documentInfo, highlights] = await Promise.all([
      window.recallApi.getDocument(targetDocumentId),
      window.recallApi.listHighlights(targetDocumentId),
    ]);

    if (openToken !== readerRuntime.openingToken) {
      return;
    }

    if (!documentInfo) {
      throw new Error('Документ не найден.');
    }

    state.currentDocument = documentInfo;
    upsertDocumentInState(documentInfo);
    updateHighlightsForDocument(documentInfo.id, highlights);
    state.currentHighlights = [...(state.highlightsByDocument[documentInfo.id] ?? [])];

    const fallbackPageIndexRaw = normalizePageIndex(documentInfo.lastReadPageIndex, 0);
    const maxReadPageIndex = normalizePageIndex(
      documentInfo.maxReadPageIndex,
      fallbackPageIndexRaw,
    );
    const fallbackPageIndex =
      fallbackPageIndexRaw === 0 && maxReadPageIndex > 0 ? maxReadPageIndex : fallbackPageIndexRaw;
    const rawStoredScale = Number(documentInfo.lastReadScale);
    const hasStoredScale = Number.isFinite(rawStoredScale) && rawStoredScale > 0;
    const requestedScale = normalizeScale(
      options.focusScale ?? (hasStoredScale ? rawStoredScale : readerRuntime.scale),
      readerRuntime.scale,
    );
    const shouldApplyScale = Boolean(options.focusScale) || hasStoredScale;
    const requestedPage = normalizePageIndex(
      options.focusPageIndex ??
        (options.focusHighlightId
          ? state.currentHighlights.find((item) => item.id === options.focusHighlightId)?.pageIndex ??
            fallbackPageIndex
          : fallbackPageIndex),
      fallbackPageIndex,
    );

    updateReaderHeader();
    updateSelectionActions();
    updateHighlightsSummary();
    renderHighlightsList();
    setReaderMessage('');

    if (READER_ENGINE === 'webviewer') {
      await loadWebViewerDocument(documentInfo);
      if (shouldApplyScale && webViewerRuntime.instance) {
        try {
          webViewerRuntime.instance.UI.setZoomLevel(requestedScale);
        } catch {
          // Ignore viewer zoom errors while UI is still stabilizing.
        }
        readerRuntime.scale = requestedScale;
        updateReaderControls();
        await stabilizeWebViewerZoom(webViewerRuntime.instance, { attempts: 2 });
      }
      const safePageIndex = clampPageIndex(requestedPage, readerRuntime.totalPages);
      armOpenPageGuard(safePageIndex, 3200);
      resetReaderHistory(safePageIndex);
      readerRuntime.lastPersistPageIndex = safePageIndex;
      readerRuntime.lastPersistTs = Date.now();
      readerRuntime.lastSavedProgressKey = '';
      updateMiniMap();

      if (options.focusHighlightId) {
        const navigated = await navigateHighlightInReader(options.focusHighlightId, {
          behavior: 'smooth',
          timeoutMs: 2600,
        });

        if (!navigated) {
          scrollToPage(safePageIndex, 'smooth');
        }
      } else {
        scrollToPage(safePageIndex, 'auto');
      }

      const settled = await settleWebViewerCurrentPage(safePageIndex, 2200);
      if (openToken !== readerRuntime.openingToken) {
        return;
      }
      readerRuntime.openingDocument = false;

      if (!options.focusHighlightId && safePageIndex > 0 && !settled.matchedTarget) {
        setReaderMessage(
          `Не удалось стабильно перейти к странице ${safePageIndex + 1}. Повторите «Открыть».`,
          true,
        );
        return;
      }

      startWebViewerPageSync();
      await persistReaderProgress({
        force: true,
      });
      return;
    }

    if (readerRuntime.activeDocumentId !== documentInfo.id) {
      if (readerRuntime.pdfDocument?.destroy) {
        await readerRuntime.pdfDocument.destroy();
      }

      readerRuntime.pdfDocument = await loadPdfDocument(documentInfo.id);
      readerRuntime.activeDocumentId = documentInfo.id;
    }

    if (shouldApplyScale) {
      readerRuntime.scale = requestedScale;
    }
    readerRuntime.totalPages = readerRuntime.pdfDocument.numPages;
    const safePageIndex = clampPageIndex(requestedPage, readerRuntime.totalPages);
    setCurrentPageIndex(safePageIndex);
    resetReaderHistory(safePageIndex);
    readerRuntime.lastPersistPageIndex = safePageIndex;
    readerRuntime.lastPersistTs = Date.now();
    readerRuntime.lastSavedProgressKey = '';
    updateMiniMap();
    updateReaderControls();

    await renderReaderPdf({
      focusPageIndex: getCurrentPageIndexSafe(readerRuntime.totalPages),
      focusBehavior: options.focusHighlightId ? 'smooth' : 'auto',
    });

    if (openToken !== readerRuntime.openingToken) {
      return;
    }
    readerRuntime.openingDocument = false;
    clearOpenPageGuard();
    await persistReaderProgress({
      force: true,
    });
  } catch (error) {
    if (openToken === readerRuntime.openingToken) {
      readerRuntime.openingDocument = false;
      clearOpenPageGuard();
    }
    setReaderMessage(
      `Не удалось открыть документ: ${error?.message ?? 'неизвестная ошибка'}`,
      true,
    );
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tokenizeQuery(query) {
  const normalizedQuery = normalizeText(query).toLowerCase();
  if (!normalizedQuery) {
    return [];
  }

  return normalizedQuery.match(/[\p{L}\p{N}]+/gu) ?? [];
}

function normalizeSearchTerm(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeSearchTag(value) {
  return normalizeSearchTerm(String(value ?? '').replace(/^#/, ''));
}

function parseSearchDateTimestamp(rawValue, boundary = 'start') {
  const value = normalizeText(rawValue);
  if (!value) {
    return null;
  }

  let year = 0;
  let month = 0;
  let day = 0;

  const isoMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    year = Number(isoMatch[1]);
    month = Number(isoMatch[2]);
    day = Number(isoMatch[3]);
  } else {
    const ruMatch = value.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
    if (!ruMatch) {
      return null;
    }
    day = Number(ruMatch[1]);
    month = Number(ruMatch[2]);
    year = Number(ruMatch[3]);
  }

  if (!year || !month || !day) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(date.valueOf())) {
    return null;
  }

  if (boundary === 'end') {
    date.setUTCHours(23, 59, 59, 999);
  } else {
    date.setUTCHours(0, 0, 0, 0);
  }

  return date.valueOf();
}

function normalizeSearchHasFilter(value) {
  const normalized = normalizeSearchTerm(value);
  const map = {
    note: 'note',
    notes: 'note',
    заметка: 'note',
    заметки: 'note',
    n: 'note',
    tag: 'tags',
    tags: 'tags',
    теги: 'tags',
    тег: 'tags',
    t: 'tags',
  };
  return map[normalized] || '';
}

function normalizeSearchSortMode(value) {
  const normalized = normalizeSearchTerm(value);
  const map = {
    relevance: 'relevance',
    релевантность: 'relevance',
    рел: 'relevance',
    recent: 'recent',
    newest: 'recent',
    дата: 'recent',
    новые: 'recent',
    page: 'page',
    pages: 'page',
    страница: 'page',
    стр: 'page',
  };
  return map[normalized] || '';
}

function normalizeSearchDueFilter(value) {
  const normalized = normalizeSearchTerm(value);
  const map = {
    due: 'due',
    сегодня: 'today',
    today: 'today',
    overdue: 'overdue',
    просрочено: 'overdue',
    просроченные: 'overdue',
    new: 'new',
    новые: 'new',
    scheduled: 'scheduled',
    запланировано: 'scheduled',
    planned: 'scheduled',
  };
  return map[normalized] || '';
}

function normalizeSearchColor(value) {
  const normalized = normalizeSearchTerm(value);
  const map = {
    yellow: 'yellow',
    'желтый': 'yellow',
    'жёлтый': 'yellow',
    ж: 'yellow',
    green: 'green',
    'зеленый': 'green',
    'зелёный': 'green',
    з: 'green',
    pink: 'pink',
    'розовый': 'pink',
    р: 'pink',
  };

  return map[normalized] || '';
}

function parsePageFilters(rawValue) {
  const text = normalizeSearchTerm(rawValue);
  if (!text) {
    return [];
  }

  const parts = text.split(/[;,]+/).map((item) => item.trim()).filter(Boolean);
  const filters = [];

  for (const part of parts) {
    const rangeMatch = part.match(/^(\d{1,5})\s*-\s*(\d{1,5})$/);
    if (rangeMatch) {
      const start = Math.max(1, Number(rangeMatch[1]));
      const end = Math.max(start, Number(rangeMatch[2]));
      filters.push({ type: 'range', start, end });
      continue;
    }

    if (/^\d{1,5}$/.test(part)) {
      filters.push({ type: 'exact', page: Math.max(1, Number(part)) });
    }
  }

  return filters;
}

function matchesPageFilters(pageNumber, pageFilters = []) {
  if (!Array.isArray(pageFilters) || pageFilters.length === 0) {
    return true;
  }

  for (const filter of pageFilters) {
    if (filter?.type === 'exact' && pageNumber === Number(filter.page)) {
      return true;
    }
    if (
      filter?.type === 'range' &&
      pageNumber >= Number(filter.start) &&
      pageNumber <= Number(filter.end)
    ) {
      return true;
    }
  }

  return false;
}

function parseHighlightsAdvancedQuery(rawQuery) {
  let working = String(rawQuery ?? '');
  const filters = {
    book: [],
    tag: [],
    color: [],
    page: [],
    note: [],
    text: [],
    bookNot: [],
    tagNot: [],
    colorNot: [],
    noteNot: [],
    textNot: [],
    has: {
      note: false,
      tags: false,
    },
    sortMode: '',
    dueMode: '',
    afterTs: null,
    beforeTs: null,
  };
  const phrases = [];

  const keyAlias = {
    book: 'book',
    b: 'book',
    'книга': 'book',
    tag: 'tag',
    tags: 'tag',
    'тег': 'tag',
    'тэг': 'tag',
    color: 'color',
    c: 'color',
    'цвет': 'color',
    page: 'page',
    p: 'page',
    'стр': 'page',
    'страница': 'page',
    note: 'note',
    n: 'note',
    'заметка': 'note',
    text: 'text',
    t: 'text',
    'текст': 'text',
    has: 'has',
    'есть': 'has',
    sort: 'sort',
    сорт: 'sort',
    after: 'after',
    since: 'after',
    после: 'after',
    from: 'after',
    before: 'before',
    до: 'before',
    to: 'before',
    due: 'due',
    повтор: 'due',
    review: 'due',
  };

  const operatorPattern = /(-?)([a-zа-яё]+)\s*:\s*(?:"([^"]+)"|([^\s"]+))/giu;
  working = working.replace(
    operatorPattern,
    (fullMatch, negateToken, rawKey, quotedValue, bareValue) => {
      const key = keyAlias[normalizeSearchTerm(rawKey)];
      if (!key) {
        return fullMatch;
      }

      const isNegative = negateToken === '-';
      const rawValue = normalizeText(quotedValue || bareValue || '');
      if (!rawValue) {
        return ' ';
      }

      if (key === 'tag') {
        const tags = rawValue
          .split(/[,\s]+/)
          .map((item) => normalizeSearchTag(item))
          .filter(Boolean);
        if (isNegative) {
          filters.tagNot.push(...tags);
        } else {
          filters.tag.push(...tags);
        }
        return ' ';
      }

      if (key === 'color') {
        const color = normalizeSearchColor(rawValue);
        if (!color) {
          return ' ';
        }
        if (isNegative) {
          filters.colorNot.push(color);
        } else {
          filters.color.push(color);
        }
        return ' ';
      }

      if (key === 'page') {
        if (!isNegative) {
          filters.page.push(...parsePageFilters(rawValue));
        }
        return ' ';
      }

      if (key === 'has') {
        if (isNegative) {
          return ' ';
        }
        const hasFilter = normalizeSearchHasFilter(rawValue);
        if (hasFilter === 'note') {
          filters.has.note = true;
        } else if (hasFilter === 'tags') {
          filters.has.tags = true;
        }
        return ' ';
      }

      if (key === 'sort') {
        if (isNegative) {
          return ' ';
        }
        const sortMode = normalizeSearchSortMode(rawValue);
        if (sortMode) {
          filters.sortMode = sortMode;
        }
        return ' ';
      }

      if (key === 'due') {
        if (isNegative) {
          return ' ';
        }
        const dueMode = normalizeSearchDueFilter(rawValue);
        if (dueMode) {
          filters.dueMode = dueMode;
        }
        return ' ';
      }

      if (key === 'after') {
        if (isNegative) {
          return ' ';
        }
        const ts = parseSearchDateTimestamp(rawValue, 'start');
        if (ts !== null) {
          filters.afterTs = ts;
        }
        return ' ';
      }

      if (key === 'before') {
        if (isNegative) {
          return ' ';
        }
        const ts = parseSearchDateTimestamp(rawValue, 'end');
        if (ts !== null) {
          filters.beforeTs = ts;
        }
        return ' ';
      }

      if (isNegative) {
        if (key === 'book') {
          filters.bookNot.push(normalizeSearchTerm(rawValue));
        } else if (key === 'note') {
          filters.noteNot.push(normalizeSearchTerm(rawValue));
        } else if (key === 'text') {
          filters.textNot.push(normalizeSearchTerm(rawValue));
        }
        return ' ';
      }

      filters[key].push(normalizeSearchTerm(rawValue));
      return ' ';
    },
  );

  working = working.replace(/"([^"]+)"/g, (_full, phraseValue) => {
    const phrase = normalizeSearchTerm(phraseValue);
    if (phrase) {
      phrases.push(phrase);
    }
    return ' ';
  });

  const freeText = normalizeSearchTerm(working);
  const freeTokens = tokenizeQuery(freeText);

  const uniq = (values) => [...new Set(values.filter(Boolean))];
  filters.book = uniq(filters.book);
  filters.tag = uniq(filters.tag);
  filters.color = uniq(filters.color);
  filters.note = uniq(filters.note);
  filters.text = uniq(filters.text);
  filters.bookNot = uniq(filters.bookNot);
  filters.tagNot = uniq(filters.tagNot);
  filters.colorNot = uniq(filters.colorNot);
  filters.noteNot = uniq(filters.noteNot);
  filters.textNot = uniq(filters.textNot);
  const normalizedPages = [];
  for (const entry of filters.page) {
    if (!entry) {
      continue;
    }
    if (entry.type === 'exact') {
      normalizedPages.push({ type: 'exact', page: Math.max(1, Number(entry.page || 1)) });
      continue;
    }
    if (entry.type === 'range') {
      const start = Math.max(1, Number(entry.start || 1));
      const end = Math.max(start, Number(entry.end || start));
      normalizedPages.push({ type: 'range', start, end });
    }
  }
  filters.page = normalizedPages;
  const uniquePhrases = uniq(phrases);

  const hasOperatorFilters =
    filters.book.length > 0 ||
    filters.tag.length > 0 ||
    filters.color.length > 0 ||
    filters.page.length > 0 ||
    filters.note.length > 0 ||
    filters.text.length > 0 ||
    filters.bookNot.length > 0 ||
    filters.tagNot.length > 0 ||
    filters.colorNot.length > 0 ||
    filters.noteNot.length > 0 ||
    filters.textNot.length > 0 ||
    filters.has.note ||
    filters.has.tags ||
    Boolean(filters.sortMode) ||
    Boolean(filters.dueMode) ||
    filters.afterTs !== null ||
    filters.beforeTs !== null;

  return {
    freeText,
    freeTokens,
    phrases: uniquePhrases,
    filters,
    hasOperatorFilters,
  };
}

function buildSearchSnippet(sourceText, query, tokens) {
  const text = normalizeText(sourceText);
  if (!text) {
    return '';
  }

  if (!query) {
    return truncate(text, 190);
  }

  const lower = text.toLowerCase();
  let index = lower.indexOf(query);
  let matchLength = query.length;

  if (index < 0) {
    for (const token of tokens) {
      const tokenIndex = lower.indexOf(token);
      if (tokenIndex >= 0) {
        index = tokenIndex;
        matchLength = token.length;
        break;
      }
    }
  }

  if (index < 0) {
    return truncate(text, 190);
  }

  const start = Math.max(0, index - 48);
  const end = Math.min(text.length, index + matchLength + 84);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';

  return `${prefix}${text.slice(start, end)}${suffix}`;
}

function renderSnippetWithMarks(snippet, tokens) {
  if (!snippet) {
    return '';
  }

  const terms = [...new Set(tokens.filter((token) => token.length >= 2))]
    .sort((a, b) => b.length - a.length)
    .slice(0, 6);

  if (terms.length === 0) {
    return escapeHtml(snippet);
  }

  const regex = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
  let html = '';
  let lastIndex = 0;

  for (const match of snippet.matchAll(regex)) {
    const index = Number(match.index ?? 0);
    html += escapeHtml(snippet.slice(lastIndex, index));
    html += `<mark>${escapeHtml(match[0])}</mark>`;
    lastIndex = index + match[0].length;
  }

  html += escapeHtml(snippet.slice(lastIndex));
  return html;
}

async function refreshHighlightsIndex(force = false) {
  const documentIds = state.documents.map((doc) => doc.id);
  if (documentIds.length === 0) {
    state.highlightsByDocument = {};
    state.currentHighlights = [];
    return;
  }

  const hasCompleteCache =
    Object.keys(state.highlightsByDocument).length === documentIds.length &&
    documentIds.every((documentId) => Array.isArray(state.highlightsByDocument[documentId]));

  if (!force && hasCompleteCache) {
    return;
  }

  const allHighlights = await window.recallApi.listAllHighlights();
  hydrateHighlightsByDocumentMap(allHighlights);
}

function getHighlightsScope() {
  if (state.view !== 'highlights') {
    const documentId = state.currentDocument?.id ?? '';
    const contextPageIndex =
      state.highlightsContextOnly && documentId
        ? getCurrentPageIndexSafe(readerRuntime.totalPages)
        : null;

    return {
      mode: 'reader-current',
      documentId,
      contextPageIndex,
      sourceHighlights: state.currentHighlights,
    };
  }

  const selectedDocumentId = String(state.highlightsBookFilter ?? 'all');
  if (selectedDocumentId !== 'all') {
    const contextPageIndex =
      state.highlightsContextOnly &&
      state.currentDocument?.id &&
      state.currentDocument.id === selectedDocumentId
        ? getCurrentPageIndexSafe(readerRuntime.totalPages)
        : null;

    return {
      mode: 'single-book',
      documentId: selectedDocumentId,
      contextPageIndex,
      sourceHighlights: state.highlightsByDocument[selectedDocumentId] ?? [],
    };
  }

  return {
    mode: 'all-books',
    documentId: 'all',
    contextPageIndex: null,
    sourceHighlights: getAllKnownHighlights(),
  };
}

function getHighlightsSearchResults(scope = getHighlightsScope()) {
  const parsedQuery = parseHighlightsAdvancedQuery(state.highlightsQuery);
  const query = parsedQuery.freeText;
  const tagQuery = normalizeText(state.highlightsTagFilter).toLowerCase();
  const requestedTags = tagQuery
    ? tagQuery
        .split(/[,\s]+/)
        .map((item) => normalizeSearchTag(item))
        .filter(Boolean)
    : [];
  const excludedTags = parsedQuery.filters.tagNot;
  const operatorTags = parsedQuery.filters.tag;
  const allRequestedTags = [...new Set([...requestedTags, ...operatorTags])];
  const tokens = parsedQuery.freeTokens;
  const hasStructuredQuery = parsedQuery.hasOperatorFilters || parsedQuery.phrases.length > 0;
  const hasFreeTextQuery = query.length > 0;
  const hasAnyQuery = hasFreeTextQuery || hasStructuredQuery;
  const queryTokensForMarks = [
    ...tokens,
    ...parsedQuery.phrases.flatMap((phrase) => tokenizeQuery(phrase)),
  ];
  const contextPageIndex = Number.isInteger(scope.contextPageIndex)
    ? scope.contextPageIndex
    : null;
  const nowTs = Date.now();
  const dayStartDate = new Date();
  dayStartDate.setHours(0, 0, 0, 0);
  const dayStartTs = dayStartDate.valueOf();
  const dayEndTs = dayStartTs + 24 * 60 * 60 * 1000 - 1;

  const source = (scope.sourceHighlights ?? []).map((highlight) => {
    const tags = normalizeTags(highlight.tags);
    const tagsLower = tags.map((tag) => tag.toLowerCase());
    const richTextPlain = normalizeHighlightSelectedText(
      String(highlight.selectedRichText ?? '').replace(/<[^>]+>/g, ' '),
    );
    const nextReviewTs = parseHighlightDueTimestamp(highlight.nextReviewAt);
    const reviewCount = normalizePageIndex(highlight.reviewCount, 0);
    return {
      ...highlight,
      documentTitle: getDocumentTitleById(highlight.documentId),
      tags,
      tagsLower,
      tagsText: tags.join(' '),
      richTextPlain,
      nextReviewTs,
      reviewCount,
    };
  });

  const fuseMap = new Map();
  if (hasFreeTextQuery && source.length > 0) {
    const fuse = new Fuse(source, {
      includeScore: true,
      includeMatches: true,
      threshold: 0.35,
      ignoreLocation: true,
      minMatchCharLength: 2,
      keys: [
        { name: 'selectedText', weight: 0.64 },
        { name: 'note', weight: 0.26 },
        { name: 'documentTitle', weight: 0.08 },
        { name: 'tagsText', weight: 0.02 },
      ],
    });

    const fuseResults = fuse.search(query, {
      limit: Math.max(140, source.length),
    });

    for (const result of fuseResults) {
      const hit = result?.item;
      if (!hit?.id || !hit?.documentId) {
        continue;
      }

      const key = `${hit.documentId}:${hit.id}`;
      fuseMap.set(key, {
        score: Number(result.score ?? 1),
        matches: Array.isArray(result.matches) ? result.matches : [],
      });
    }
  }

  const items = source.map((highlight) => {
    const text = normalizeText(highlight.selectedText);
    const note = normalizeText(highlight.note);
    const documentTitle = normalizeText(highlight.documentTitle);
    const textLower = text.toLowerCase();
    const noteLower = note.toLowerCase();
    const titleLower = documentTitle.toLowerCase();
    const combinedLower = `${textLower} ${noteLower} ${titleLower}`.trim();
    const tagsLower = highlight.tagsLower;
    const hasNote = noteLower.length > 0;
    const hasTags = tagsLower.length > 0;
    const rawCreatedAtTs = new Date(highlight.createdAt).valueOf();
    const createdAtTs = Number.isFinite(rawCreatedAtTs) ? rawCreatedAtTs : 0;
    const nextReviewTs = highlight.nextReviewTs;
    const reviewCount = highlight.reviewCount;
    const hasReviewSchedule = nextReviewTs !== null;
    const dueForReview = !hasReviewSchedule || nextReviewTs <= nowTs;
    const overdueForReview = hasReviewSchedule && nextReviewTs < dayStartTs;
    const dueTodayForReview = hasReviewSchedule ? nextReviewTs <= dayEndTs : true;
    const scheduledForFuture = hasReviewSchedule && nextReviewTs > nowTs;
    const isNewForReview = !hasReviewSchedule || reviewCount === 0;

    let score = hasFreeTextQuery ? 0 : 1;
    let matchedField = '';
    let structuredPassed = true;
    const pageNumber = highlight.pageIndex + 1;
    const richLower = highlight.richTextPlain.toLowerCase();

    if (hasFreeTextQuery) {
      const fuzzy = fuseMap.get(`${highlight.documentId}:${highlight.id}`);
      if (fuzzy) {
        const normalizedFuzzy = clamp(fuzzy.score, 0, 1);
        score += Math.round((1 - normalizedFuzzy) * 24);
        if (!matchedField) {
          const noteMatch = fuzzy.matches.some((match) => String(match.key) === 'note');
          const titleMatch = fuzzy.matches.some((match) => String(match.key) === 'documentTitle');
          if (noteMatch) {
            matchedField = 'note';
          } else if (titleMatch) {
            matchedField = 'book';
          } else {
            matchedField = 'text';
          }
        }
      }

      if (textLower.includes(query)) {
        score += 14;
        matchedField = 'text';
      }

      if (noteLower && noteLower.includes(query)) {
        score += 18;
        matchedField = 'note';
      }

      if (titleLower && titleLower.includes(query)) {
        score += 7;
        if (!matchedField) {
          matchedField = 'book';
        }
      }

      let tokenHits = 0;
      for (const token of tokens) {
        if (token.length < 2) {
          continue;
        }

        const inText = textLower.includes(token);
        const inNote = noteLower.includes(token);
        const inTitle = titleLower.includes(token);

        if (inText) {
          score += 4;
          tokenHits += 1;
          if (!matchedField) {
            matchedField = 'text';
          }
        }

        if (inNote) {
          score += 6;
          tokenHits += 1;
          matchedField = 'note';
        }

        if (inTitle) {
          score += 2;
          tokenHits += 1;
          if (!matchedField) {
            matchedField = 'book';
          }
        }
      }

      if (tokens.length > 1 && tokens.every((token) => combinedLower.includes(token))) {
        score += 8;
      }

      if (tokenHits > 2) {
        score += 2;
      }

      if (!matchedField && combinedLower.includes(query)) {
        matchedField = noteLower.includes(query)
          ? 'note'
          : titleLower.includes(query)
            ? 'book'
            : 'text';
      }
    }

    if (parsedQuery.filters.book.length > 0) {
      structuredPassed =
        structuredPassed &&
        parsedQuery.filters.book.every((term) => titleLower.includes(term));
      if (structuredPassed) {
        score += 5;
      }
    }

    if (parsedQuery.filters.bookNot.length > 0) {
      structuredPassed =
        structuredPassed &&
        parsedQuery.filters.bookNot.every((term) => !titleLower.includes(term));
    }

    if (parsedQuery.filters.note.length > 0) {
      structuredPassed =
        structuredPassed &&
        parsedQuery.filters.note.every((term) => noteLower.includes(term));
      if (structuredPassed) {
        matchedField = 'note';
        score += 6;
      }
    }

    if (parsedQuery.filters.noteNot.length > 0) {
      structuredPassed =
        structuredPassed &&
        parsedQuery.filters.noteNot.every((term) => !noteLower.includes(term));
    }

    if (parsedQuery.filters.text.length > 0) {
      structuredPassed =
        structuredPassed &&
        parsedQuery.filters.text.every((term) => textLower.includes(term) || richLower.includes(term));
      if (structuredPassed) {
        matchedField = 'text';
        score += 6;
      }
    }

    if (parsedQuery.filters.textNot.length > 0) {
      structuredPassed =
        structuredPassed &&
        parsedQuery.filters.textNot.every(
          (term) => !textLower.includes(term) && !richLower.includes(term),
        );
    }

    if (parsedQuery.filters.color.length > 0) {
      structuredPassed =
        structuredPassed &&
        parsedQuery.filters.color.includes(highlight.color);
      if (structuredPassed) {
        score += 3;
      }
    }

    if (parsedQuery.filters.colorNot.length > 0) {
      structuredPassed =
        structuredPassed &&
        !parsedQuery.filters.colorNot.includes(highlight.color);
    }

    if (parsedQuery.filters.page.length > 0) {
      structuredPassed =
        structuredPassed &&
        matchesPageFilters(pageNumber, parsedQuery.filters.page);
      if (structuredPassed) {
        score += 4;
      }
    }

    if (parsedQuery.filters.has.note) {
      structuredPassed = structuredPassed && hasNote;
      if (structuredPassed) {
        score += 2;
      }
    }

    if (parsedQuery.filters.has.tags) {
      structuredPassed = structuredPassed && hasTags;
      if (structuredPassed) {
        score += 2;
      }
    }

    if (parsedQuery.filters.dueMode) {
      const dueMode = parsedQuery.filters.dueMode;
      const duePassed =
        dueMode === 'due'
          ? dueForReview
          : dueMode === 'overdue'
            ? overdueForReview
            : dueMode === 'today'
              ? dueTodayForReview
              : dueMode === 'scheduled'
                ? scheduledForFuture
                : dueMode === 'new'
                  ? isNewForReview
                  : true;
      structuredPassed = structuredPassed && duePassed;
      if (structuredPassed && duePassed) {
        score += 3;
      }
    }

    if (parsedQuery.filters.afterTs !== null) {
      structuredPassed = structuredPassed && createdAtTs >= parsedQuery.filters.afterTs;
    }

    if (parsedQuery.filters.beforeTs !== null) {
      structuredPassed = structuredPassed && createdAtTs <= parsedQuery.filters.beforeTs;
    }

    if (parsedQuery.phrases.length > 0) {
      const phraseSource = `${textLower} ${noteLower} ${titleLower} ${richLower}`.trim();
      structuredPassed =
        structuredPassed &&
        parsedQuery.phrases.every((phrase) => phraseSource.includes(phrase));
      if (structuredPassed) {
        score += 8;
      }
    }

    const pageDistance =
      contextPageIndex === null ? null : Math.abs(highlight.pageIndex - contextPageIndex);

    if (pageDistance !== null) {
      if (pageDistance === 0) {
        score += 6;
      } else if (pageDistance === 1) {
        score += 4;
      } else if (pageDistance <= 3) {
        score += 2;
      }
    }

    const snippetSource =
      matchedField === 'note'
        ? note || text
        : text || note;

    return {
      highlight,
      documentTitle,
      score,
      matchedField: matchedField || (note ? 'note' : 'text'),
      pageDistance,
      snippet: buildSearchSnippet(snippetSource, query || parsedQuery.phrases[0] || '', queryTokensForMarks),
      structuredPassed,
      dueForReview,
      overdueForReview,
      isNewForReview,
      nextReviewTs,
    };
  });

  let filtered = hasAnyQuery ? items.filter((item) => item.score > 0) : items;

  if (hasStructuredQuery) {
    filtered = filtered.filter((item) => item.structuredPassed);
  }

  if (allRequestedTags.length > 0) {
    filtered = filtered.filter((item) =>
      allRequestedTags.every((tag) => item.highlight.tagsLower.includes(tag)),
    );
  }

  if (excludedTags.length > 0) {
    filtered = filtered.filter((item) =>
      excludedTags.every((tag) => !item.highlight.tagsLower.includes(tag)),
    );
  }

  const contextApplied = state.highlightsContextOnly && contextPageIndex !== null;
  if (contextApplied) {
    filtered = filtered.filter((item) => item.pageDistance !== null && item.pageDistance <= 3);
  }

  const explicitSortMode = parsedQuery.filters.sortMode || '';
  if (explicitSortMode === 'recent') {
    filtered.sort((a, b) => {
      const aCreated = new Date(a.highlight.createdAt).valueOf();
      const bCreated = new Date(b.highlight.createdAt).valueOf();
      if (bCreated !== aCreated) {
        return bCreated - aCreated;
      }

      if (scope.mode === 'all-books' && a.highlight.documentId !== b.highlight.documentId) {
        return getDocumentTitleById(a.highlight.documentId).localeCompare(
          getDocumentTitleById(b.highlight.documentId),
          'ru',
        );
      }
      return a.highlight.pageIndex - b.highlight.pageIndex;
    });
  } else if (explicitSortMode === 'page') {
    filtered.sort((a, b) => {
      if (scope.mode === 'all-books' && a.highlight.documentId !== b.highlight.documentId) {
        return getDocumentTitleById(a.highlight.documentId).localeCompare(
          getDocumentTitleById(b.highlight.documentId),
          'ru',
        );
      }
      if (a.highlight.pageIndex !== b.highlight.pageIndex) {
        return a.highlight.pageIndex - b.highlight.pageIndex;
      }
      return new Date(a.highlight.createdAt).valueOf() - new Date(b.highlight.createdAt).valueOf();
    });
  } else if (!hasAnyQuery) {
    filtered.sort((a, b) => {
      if (scope.mode === 'all-books' && a.highlight.documentId !== b.highlight.documentId) {
        return getDocumentTitleById(a.highlight.documentId).localeCompare(
          getDocumentTitleById(b.highlight.documentId),
          'ru',
        );
      }

      if (a.highlight.pageIndex === b.highlight.pageIndex) {
        return new Date(a.highlight.createdAt).valueOf() - new Date(b.highlight.createdAt).valueOf();
      }
      return a.highlight.pageIndex - b.highlight.pageIndex;
    });
  } else {
    filtered.sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      const aDistance = a.pageDistance ?? 999;
      const bDistance = b.pageDistance ?? 999;
      if (aDistance !== bDistance) {
        return aDistance - bDistance;
      }

      if (scope.mode === 'all-books' && a.highlight.documentId !== b.highlight.documentId) {
        return getDocumentTitleById(a.highlight.documentId).localeCompare(
          getDocumentTitleById(b.highlight.documentId),
          'ru',
        );
      }

      if (a.highlight.pageIndex !== b.highlight.pageIndex) {
        return a.highlight.pageIndex - b.highlight.pageIndex;
      }

      return new Date(b.highlight.createdAt).valueOf() - new Date(a.highlight.createdAt).valueOf();
    });
  }

  return {
    items: filtered,
    query,
    tokens: queryTokensForMarks,
    contextPageIndex,
    contextApplied,
    scope,
    parsedQuery,
    requestedTags: allRequestedTags,
  };
}

function formatSearchDateChip(timestamp) {
  if (!Number.isFinite(Number(timestamp))) {
    return '';
  }

  const date = new Date(Number(timestamp));
  if (Number.isNaN(date.valueOf())) {
    return '';
  }

  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

function renderHighlightsFilterChips(parsedQuery, requestedTags = []) {
  if (!parsedQuery) {
    return '';
  }

  const chips = [];
  const { filters } = parsedQuery;

  for (const book of filters.book) {
    chips.push(`книга: ${book}`);
  }
  for (const book of filters.bookNot) {
    chips.push(`искл. книга: ${book}`);
  }
  for (const color of filters.color) {
    chips.push(`цвет: ${COLOR_LABELS[color] || color}`);
  }
  for (const color of filters.colorNot) {
    chips.push(`искл. цвет: ${COLOR_LABELS[color] || color}`);
  }
  if (filters.page.length > 0) {
    chips.push('фильтр: страницы');
  }
  if (filters.has.note) {
    chips.push('есть: заметка');
  }
  if (filters.has.tags) {
    chips.push('есть: теги');
  }
  if (filters.afterTs !== null) {
    chips.push(`после: ${formatSearchDateChip(filters.afterTs)}`);
  }
  if (filters.beforeTs !== null) {
    chips.push(`до: ${formatSearchDateChip(filters.beforeTs)}`);
  }
  if (filters.sortMode) {
    const sortLabels = {
      relevance: 'сорт: релевантность',
      recent: 'сорт: новые',
      page: 'сорт: страницы',
    };
    chips.push(sortLabels[filters.sortMode] || `сорт: ${filters.sortMode}`);
  }
  if (filters.dueMode) {
    const dueLabels = {
      due: 'повтор: к повторению',
      today: 'повтор: сегодня',
      overdue: 'повтор: просрочено',
      new: 'повтор: новое',
      scheduled: 'повтор: запланировано',
    };
    chips.push(dueLabels[filters.dueMode] || `повтор: ${filters.dueMode}`);
  }
  for (const phrase of parsedQuery.phrases) {
    chips.push(`фраза: "${phrase}"`);
  }
  for (const tag of requestedTags) {
    chips.push(`#${tag}`);
  }
  for (const tag of filters.tagNot) {
    chips.push(`искл. #${tag}`);
  }

  if (chips.length === 0) {
    return '';
  }

  return chips
    .slice(0, 12)
    .map((text) => `<span class="search-filter-chip">${escapeHtml(text)}</span>`)
    .join('');
}

function updateHighlightsFilterChips(parsedQuery, requestedTags = []) {
  const html = renderHighlightsFilterChips(parsedQuery, requestedTags);
  const chipNodes = Array.from(document.querySelectorAll('[data-highlights-filter-chips]'));
  for (const chipNode of chipNodes) {
    chipNode.innerHTML = html;
    chipNode.classList.toggle('hidden', !html);
  }
}

function getSavedHighlightQueryPresets() {
  return normalizeSavedHighlightQueries(state.settings?.savedHighlightQueries);
}

function renderHighlightsPresets() {
  const listNode = document.querySelector('#highlights-presets-list');
  if (!listNode) {
    return;
  }

  const presets = getSavedHighlightQueryPresets();
  if (presets.length === 0) {
    listNode.innerHTML = '<p class="highlights-presets-empty">Пока нет пресетов. Сохраните текущий запрос.</p>';
    return;
  }

  const currentQuery = normalizeText(state.highlightsQuery);
  listNode.innerHTML = presets
    .map((preset) => {
      const isActive = normalizeText(preset.query) === currentQuery;
      return `
        <article class="highlights-preset-item ${isActive ? 'is-active' : ''}">
          <button
            type="button"
            class="ghost-btn highlights-preset-apply"
            data-action="apply-highlights-preset"
            data-id="${preset.id}"
            title="${escapeHtml(preset.query)}"
          >
            ${escapeHtml(preset.name)}
          </button>
          <button
            type="button"
            class="ghost-btn highlights-preset-delete"
            data-action="delete-highlights-preset"
            data-id="${preset.id}"
            title="Удалить пресет"
          >
            ×
          </button>
        </article>
      `;
    })
    .join('');
}

async function persistSavedHighlightQueryPresets(nextPresets, successMessage) {
  const normalized = normalizeSavedHighlightQueries(nextPresets);
  applySettingsPatch({
    savedHighlightQueries: normalized,
  });

  try {
    const updated = await safeOptionalIpcCall(
      () =>
        window.recallApi.updateSettings({
          savedHighlightQueries: normalized,
        }),
      null,
      'settings:update',
    );

    if (updated) {
      applySettingsPatch(updated);
      if (successMessage) {
        setReaderMessage(successMessage);
      }
    } else {
      setReaderMessage(
        'Пресеты сохранены локально до перезапуска. Обновите main-процесс для постоянного хранения.',
      );
    }
  } catch (error) {
    setReaderMessage(
      `Не удалось сохранить пресеты: ${error?.message ?? 'неизвестная ошибка'}`,
      true,
    );
  }

  renderHighlightsPresets();
  refreshCommandPaletteItems();
  updateCommandPaletteUi();
}

async function saveCurrentHighlightsPreset(rawName = '') {
  const query = normalizeText(state.highlightsQuery);
  if (!query) {
    setReaderMessage('Введите запрос, затем сохраните его как пресет.');
    return;
  }

  const inputNode = document.querySelector('#highlights-preset-name');
  const preferredName = normalizeText(rawName || inputNode?.value);
  const presets = getSavedHighlightQueryPresets();
  const autoName = `Запрос ${presets.length + 1}`;
  const name = preferredName || autoName;
  const existing = presets.find((item) => item.name.toLowerCase() === name.toLowerCase());

  const next = existing
    ? presets.map((item) =>
        item.id === existing.id
          ? {
              ...item,
              query,
            }
          : item,
      )
    : [
        ...presets,
        {
          id: generateLocalId('query'),
          name,
          query,
          createdAt: new Date().toISOString(),
        },
      ];

  await persistSavedHighlightQueryPresets(next, `Пресет «${name}» сохранен.`);
  if (inputNode) {
    inputNode.value = '';
  }
}

function applyHighlightsPresetById(presetId) {
  const id = String(presetId ?? '');
  if (!id) {
    return;
  }

  const preset = getSavedHighlightQueryPresets().find((item) => item.id === id);
  if (!preset) {
    return;
  }

  state.highlightsQuery = preset.query;
  const searchInput = document.querySelector('#highlights-search');
  if (searchInput) {
    searchInput.value = preset.query;
    searchInput.focus();
    searchInput.select();
  }
  renderHighlightsPresets();
  renderHighlightsList();
}

async function deleteHighlightsPresetById(presetId) {
  const id = String(presetId ?? '');
  if (!id) {
    return;
  }

  const presets = getSavedHighlightQueryPresets();
  const target = presets.find((item) => item.id === id);
  if (!target) {
    return;
  }

  const next = presets.filter((item) => item.id !== id);
  await persistSavedHighlightQueryPresets(next, `Пресет «${target.name}» удален.`);
}

function getHighlightsScopeKey(scope) {
  if (!scope) {
    return 'none';
  }

  if (scope.mode === 'all-books') {
    return 'all-books';
  }
  if (scope.mode === 'single-book') {
    return `single:${scope.documentId || ''}`;
  }
  if (scope.mode === 'reader-current') {
    return `reader:${scope.documentId || ''}`;
  }
  return `${scope.mode || 'unknown'}:${scope.documentId || ''}`;
}

function parseHighlightDueTimestamp(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return null;
  }
  const ts = new Date(raw).valueOf();
  return Number.isFinite(ts) ? ts : null;
}

function isHighlightDueForReview(highlight, nowTs = Date.now()) {
  const nextReviewTs = parseHighlightDueTimestamp(highlight?.nextReviewAt);
  if (nextReviewTs === null) {
    return true;
  }
  return nextReviewTs <= nowTs;
}

function sortHighlightsForReviewQueue(highlights = []) {
  return [...highlights].sort((a, b) => {
    const aDue = parseHighlightDueTimestamp(a?.nextReviewAt);
    const bDue = parseHighlightDueTimestamp(b?.nextReviewAt);
    const aDueSort = aDue === null ? 0 : aDue;
    const bDueSort = bDue === null ? 0 : bDue;
    if (aDueSort !== bDueSort) {
      return aDueSort - bDueSort;
    }

    if (a.documentId !== b.documentId) {
      return getDocumentTitleById(a.documentId).localeCompare(getDocumentTitleById(b.documentId), 'ru');
    }
    if (a.pageIndex !== b.pageIndex) {
      return a.pageIndex - b.pageIndex;
    }
    return new Date(a.createdAt).valueOf() - new Date(b.createdAt).valueOf();
  });
}

function getDueHighlightsForScope(scope = getHighlightsScope()) {
  let source = [];
  if (scope.mode === 'all-books') {
    source = getAllKnownHighlights();
  } else if (scope.mode === 'single-book') {
    if (!scope.documentId) {
      return [];
    }
    source = state.highlightsByDocument[scope.documentId] ?? [];
  } else {
    if (!scope.documentId) {
      return [];
    }
    source = scope.sourceHighlights ?? state.currentHighlights;
  }

  const nowTs = Date.now();
  return sortHighlightsForReviewQueue(source.filter((item) => isHighlightDueForReview(item, nowTs)));
}

function resetHighlightsReviewSession(scopeKey = '') {
  state.highlightReviewActive = false;
  state.highlightReviewQueueIds = [];
  state.highlightReviewIndex = 0;
  state.highlightReviewCurrentId = '';
  state.highlightReviewCompleted = 0;
  state.highlightReviewScopeKey = scopeKey || '';
}

function startHighlightsReviewSession(scope = getHighlightsScope()) {
  const dueHighlights = getDueHighlightsForScope(scope);
  const scopeKey = getHighlightsScopeKey(scope);
  if (dueHighlights.length === 0) {
    setReaderMessage('Нет выделений для повторения в этом контексте.');
    resetHighlightsReviewSession(scopeKey);
    renderHighlightsReviewPanel(scope);
    return;
  }

  state.highlightReviewActive = true;
  state.highlightReviewScopeKey = scopeKey;
  state.highlightReviewQueueIds = dueHighlights.map((item) => item.id);
  state.highlightReviewIndex = 0;
  state.highlightReviewCurrentId = state.highlightReviewQueueIds[0] || '';
  state.highlightReviewCompleted = 0;
  renderHighlightsReviewPanel(scope);
}

function stopHighlightsReviewSession(scope = getHighlightsScope()) {
  resetHighlightsReviewSession(getHighlightsScopeKey(scope));
  renderHighlightsReviewPanel(scope);
}

function moveHighlightsReviewPointer(step = 1) {
  const queue = state.highlightReviewQueueIds;
  if (queue.length === 0) {
    state.highlightReviewCurrentId = '';
    state.highlightReviewIndex = 0;
    return;
  }

  const currentIndexRaw = queue.indexOf(state.highlightReviewCurrentId);
  const currentIndex = currentIndexRaw >= 0 ? currentIndexRaw : 0;
  const nextIndex = (currentIndex + Number(step || 0) + queue.length) % queue.length;
  state.highlightReviewIndex = nextIndex;
  state.highlightReviewCurrentId = queue[nextIndex] || '';
}

function formatReviewDueLabel(nextReviewAt) {
  const nextTs = parseHighlightDueTimestamp(nextReviewAt);
  if (nextTs === null) {
    return 'Новый';
  }

  const nowTs = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const deltaDays = Math.round((nextTs - nowTs) / dayMs);
  if (deltaDays <= 0) {
    return 'К повторению';
  }
  if (deltaDays === 1) {
    return 'через 1 день';
  }
  return `через ${deltaDays} дн.`;
}

function renderHighlightsReviewPanel(scope = getHighlightsScope()) {
  const panel = document.querySelector('#highlights-review-panel');
  if (!panel) {
    return;
  }

  const dueHighlights = getDueHighlightsForScope(scope);
  const dueIds = dueHighlights.map((item) => item.id);
  const scopeKey = getHighlightsScopeKey(scope);

  if (scopeKey !== state.highlightReviewScopeKey) {
    resetHighlightsReviewSession(scopeKey);
    state.highlightReviewQueueIds = dueIds;
    state.highlightReviewCurrentId = dueIds[0] || '';
  } else {
    state.highlightReviewQueueIds = dueIds;
    if (dueIds.includes(state.highlightReviewCurrentId)) {
      state.highlightReviewIndex = Math.max(0, dueIds.indexOf(state.highlightReviewCurrentId));
    } else {
      state.highlightReviewCurrentId = dueIds[0] || '';
      state.highlightReviewIndex = 0;
    }
  }

  if (!state.highlightReviewActive) {
    panel.innerHTML = `
      <article class="review-panel-card">
        <div>
          <h3>Повторение выделений</h3>
          <p>${dueHighlights.length} к повторению в текущем контексте</p>
        </div>
        <div class="review-panel-actions">
          <button
            type="button"
            class="secondary-btn"
            data-action="start-highlights-review"
            ${dueHighlights.length === 0 ? 'disabled' : ''}
          >
            Начать сессию
          </button>
        </div>
      </article>
    `;
    panel.querySelector('[data-action="start-highlights-review"]')?.addEventListener('click', () => {
      startHighlightsReviewSession(scope);
    });
    return;
  }

  if (dueHighlights.length === 0) {
    panel.innerHTML = `
      <article class="review-panel-card is-done">
        <div>
          <h3>Сессия завершена</h3>
          <p>Повторено: ${state.highlightReviewCompleted}</p>
        </div>
        <div class="review-panel-actions">
          <button type="button" class="secondary-btn" data-action="stop-highlights-review">Закрыть</button>
        </div>
      </article>
    `;
    panel.querySelector('[data-action="stop-highlights-review"]')?.addEventListener('click', () => {
      stopHighlightsReviewSession(scope);
    });
    return;
  }

  const currentHighlight =
    dueHighlights.find((item) => item.id === state.highlightReviewCurrentId) ?? dueHighlights[0];
  state.highlightReviewCurrentId = currentHighlight.id;
  state.highlightReviewIndex = Math.max(0, dueIds.indexOf(currentHighlight.id));
  const title = getDocumentTitleById(currentHighlight.documentId);
  const reviewCount = normalizePageIndex(currentHighlight.reviewCount, 0);
  const interval = normalizePageIndex(currentHighlight.reviewIntervalDays, 0);
  const richText = String(currentHighlight.selectedRichText ?? '').trim();
  const textHtml = richText
    ? `<div class="review-highlight-text highlight-text-rich">${richText}</div>`
    : `<p class="review-highlight-text">${escapeHtml(truncate(currentHighlight.selectedText, 380))}</p>`;
  const noteHtml = currentHighlight.note
    ? `<p class="review-highlight-note">Заметка: ${escapeHtml(truncate(currentHighlight.note, 220))}</p>`
    : '';

  panel.innerHTML = `
    <article class="review-panel-card is-active">
      <header class="review-panel-head">
        <div>
          <h3>Повторение: ${state.highlightReviewIndex + 1}/${dueHighlights.length}</h3>
          <p>${escapeHtml(title)} · стр. ${currentHighlight.pageIndex + 1}</p>
        </div>
        <button type="button" class="ghost-btn" data-action="stop-highlights-review">Остановить</button>
      </header>
      ${textHtml}
      ${noteHtml}
      <p class="review-highlight-meta">
        Повторов: ${reviewCount} · Интервал: ${interval || 0} дн. · Статус: ${formatReviewDueLabel(
          currentHighlight.nextReviewAt,
        )}
      </p>
      <div class="review-panel-actions">
        <button type="button" class="secondary-btn" data-action="review-rate" data-grade="hard">Сложно</button>
        <button type="button" class="secondary-btn" data-action="review-rate" data-grade="good">Нормально</button>
        <button type="button" class="primary-btn" data-action="review-rate" data-grade="easy">Легко</button>
        <button type="button" class="ghost-btn" data-action="review-skip">Пропустить</button>
      </div>
    </article>
  `;

  panel.querySelector('[data-action="stop-highlights-review"]')?.addEventListener('click', () => {
    stopHighlightsReviewSession(scope);
  });
  panel.querySelector('[data-action="review-skip"]')?.addEventListener('click', () => {
    moveHighlightsReviewPointer(1);
    renderHighlightsReviewPanel(scope);
  });
  panel.querySelectorAll('[data-action="review-rate"]').forEach((button) => {
    button.addEventListener('click', () => {
      const grade = button.getAttribute('data-grade');
      void rateCurrentReviewHighlight(grade, scope);
    });
  });
}

async function rateCurrentReviewHighlight(grade, scope = getHighlightsScope()) {
  const safeGrade = grade === 'hard' || grade === 'good' || grade === 'easy' ? grade : '';
  if (!safeGrade || !state.highlightReviewCurrentId) {
    return;
  }

  const found = findHighlightById(state.highlightReviewCurrentId);
  if (!found?.highlight) {
    moveHighlightsReviewPointer(1);
    renderHighlightsReviewPanel(scope);
    return;
  }

  const current = found.highlight;
  const previousInterval = Math.max(0, normalizePageIndex(current.reviewIntervalDays, 0));
  let nextIntervalDays = 1;
  if (safeGrade === 'hard') {
    nextIntervalDays = previousInterval > 0 ? Math.max(1, Math.round(previousInterval * 1.25)) : 1;
  } else if (safeGrade === 'good') {
    nextIntervalDays = previousInterval > 0 ? Math.max(2, Math.round(previousInterval * 2.1)) : 3;
  } else if (safeGrade === 'easy') {
    nextIntervalDays = previousInterval > 0 ? Math.max(4, Math.round(previousInterval * 3.1)) : 7;
  }

  const now = new Date();
  const nextReviewDate = new Date(now);
  nextReviewDate.setDate(nextReviewDate.getDate() + nextIntervalDays);

  try {
    const updated = await window.recallApi.updateHighlight({
      id: current.id,
      reviewCount: normalizePageIndex(current.reviewCount, 0) + 1,
      reviewIntervalDays: nextIntervalDays,
      reviewLastGrade: safeGrade,
      lastReviewedAt: now.toISOString(),
      nextReviewAt: nextReviewDate.toISOString(),
    });
    upsertCurrentHighlight(updated);
    state.highlightReviewCompleted += 1;
    state.highlightReviewCurrentId = '';
    setReaderMessage(`Интервал обновлен: ${nextIntervalDays} дн.`);
    renderHighlightsList();
  } catch (error) {
    setReaderMessage(
      `Не удалось сохранить результат повторения: ${error?.message ?? 'неизвестная ошибка'}`,
      true,
    );
  }
}

function extractPlainTextFromRichText(value) {
  const rich = String(value ?? '').trim();
  if (!rich) {
    return '';
  }

  const plain = rich
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<p[^>]*>/gi, '')
    .replace(/<\/div\s*>/gi, '\n')
    .replace(/<div[^>]*>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");

  return normalizeHighlightSelectedText(plain);
}

function composeHighlightClipboardText(highlight, options = {}) {
  const mode = options.mode === 'markdown' ? 'markdown' : 'plain';
  const title = getDocumentTitleById(highlight.documentId);
  const pageNumber = highlight.pageIndex + 1;
  const selectedText =
    normalizeHighlightSelectedText(highlight.selectedText) ||
    extractPlainTextFromRichText(highlight.selectedRichText);
  const note = normalizeText(highlight.note);

  if (mode === 'markdown') {
    const quote = selectedText
      .split('\n')
      .filter(Boolean)
      .map((line) => `> ${line}`)
      .join('\n');
    const noteLine = note ? `\n\nЗаметка: ${note}` : '';
    return `${quote}\n\n— ${title}, стр. ${pageNumber}${noteLine}`;
  }

  const noteLine = note ? `\nЗаметка: ${note}` : '';
  return `${selectedText}\n\n— ${title}, стр. ${pageNumber}${noteLine}`;
}

async function copyTextToClipboard(text) {
  const value = String(text ?? '');
  if (!value) {
    return false;
  }

  if (navigator?.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {
      // fall back below
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', 'readonly');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  textarea.style.pointerEvents = 'none';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
    return true;
  } catch {
    return false;
  } finally {
    textarea.remove();
  }
}

function highlightChip(color) {
  const className = highlightColorClass(color);
  const label = COLOR_LABELS[color] || 'Желтый';
  return `<span class="color-chip ${className}">${label}</span>`;
}

function updateHighlightsSummary() {
  const safePageNumber = getCurrentPageNumberSafe(readerRuntime.totalPages);

  const readerSummaryNode = document.querySelector('#reader-highlights-summary');
  if (readerSummaryNode) {
    readerSummaryNode.textContent = `${state.currentHighlights.length} всего · текущая стр. ${safePageNumber}`;
  }

  const fullSummaryNode = document.querySelector('#highlights-summary');
  if (!fullSummaryNode) {
    return;
  }

  const scope = getHighlightsScope();
  if (scope.mode === 'all-books') {
    fullSummaryNode.textContent = `Все книги · ${scope.sourceHighlights.length} выделений`;
    return;
  }

  const documentId = scope.documentId || state.currentDocument?.id || '';
  const title = documentId ? getDocumentTitleById(documentId) : 'Книга';
  let summary = `${title} · ${scope.sourceHighlights.length} выделений`;
  if (scope.contextPageIndex !== null) {
    summary += ` · текущая стр. ${safePageNumber}`;
  }
  fullSummaryNode.textContent = summary;
}

async function navigateHighlightInReader(highlightId, options = {}) {
  const navigationRequestToken = readerRuntime.highlightNavigationRequestToken + 1;
  readerRuntime.highlightNavigationRequestToken = navigationRequestToken;

  const found = findHighlightById(highlightId, options.documentId);
  if (!highlightId || !found) {
    return false;
  }

  const { highlight, documentId } = found;
  state.focusHighlightId = highlight.id;
  const rawTargetPageIndex = normalizePageIndex(
    options.pageIndex ?? highlight.pageIndex,
    highlight.pageIndex,
  );

  if (state.currentDocument?.id !== documentId || state.view !== 'reader') {
    await openReaderView(documentId, {
      focusHighlightId: highlight.id,
      focusPageIndex: rawTargetPageIndex,
    });

    const ready = await waitForReaderReady(documentId, options.timeoutMs ?? 3200);
    if (!ready || navigationRequestToken !== readerRuntime.highlightNavigationRequestToken) {
      return false;
    }
  }

  if (
    navigationRequestToken !== readerRuntime.highlightNavigationRequestToken ||
    state.currentDocument?.id !== documentId
  ) {
    return false;
  }

  const refreshedFound = findHighlightById(highlight.id, documentId);
  if (!refreshedFound?.highlight) {
    return false;
  }
  const targetHighlight = refreshedFound.highlight;

  const targetPageIndex = clampPageIndex(rawTargetPageIndex, readerRuntime.totalPages);

  if (READER_ENGINE === 'webviewer') {
    const timeoutPlan = [
      Math.max(900, Number(options.timeoutMs ?? 2200)),
      2800,
      3400,
    ];

    for (const timeoutMs of timeoutPlan) {
      if (navigationRequestToken !== readerRuntime.highlightNavigationRequestToken) {
        return false;
      }

      const navigated = await navigateWebViewerToHighlight(targetHighlight.id, {
        doScroll: true,
        behavior: options.behavior ?? 'smooth',
        timeoutMs,
        pageIndex: targetPageIndex,
      });
      if (navigated) {
        return true;
      }
      await waitMs(55);
    }

    scrollToPage(targetPageIndex, 'smooth', {
      userInitiated: true,
    });
    focusHighlight(targetHighlight.id, false);
    return true;
  }

  focusHighlight(targetHighlight.id, true);
  return true;
}

async function goToHighlight(highlightId, options = {}) {
  return navigateHighlightInReader(highlightId, {
    behavior: 'smooth',
    timeoutMs: 2200,
    ...options,
  });
}

function renderHighlightsList() {
  const listNodes = Array.from(document.querySelectorAll('[data-highlights-list]'));
  if (listNodes.length === 0) {
    return;
  }

  const scope = getHighlightsScope();
  const { items, query, tokens, contextApplied, parsedQuery, requestedTags } =
    getHighlightsSearchResults(scope);
  const selectedSet = new Set(
    (Array.isArray(state.selectedHighlightIds) ? state.selectedHighlightIds : [])
      .map((item) => String(item))
      .filter(Boolean),
  );
  const searchActive = query.length > 0 || parsedQuery.hasOperatorFilters || parsedQuery.phrases.length > 0;
  const emptyMessage = contextApplied
    ? 'Нет результатов рядом с текущей страницей (±3).'
    : 'По запросу ничего не найдено.';

  const renderItemHtml = (item) => {
    const highlight = item.highlight;
    const isSelected = selectedSet.has(String(highlight.id));
    const safeRichText = String(highlight.selectedRichText ?? '').trim();
    const highlightTextHtml = safeRichText
      ? `<div class="highlight-text highlight-text-rich">${safeRichText}</div>`
      : `<p class="highlight-text">${escapeHtml(truncate(highlight.selectedText, 320))}</p>`;
    const noteHtml = highlight.note
      ? `<p class="highlight-note">Заметка: ${escapeHtml(truncate(highlight.note, 200))}</p>`
      : '';
    const tags = normalizeTags(highlight.tags);
    const tagsHtml =
      tags.length > 0
        ? `<div class="highlight-tags">${tags
            .map((tag) => `<span class="tag-chip">#${escapeHtml(tag)}</span>`)
            .join('')}</div>`
        : '';

    const contextBits = [];
    if (searchActive) {
      if (item.matchedField === 'note') {
        contextBits.push('Совпадение в заметке');
      } else if (item.matchedField === 'book') {
        contextBits.push('Совпадение в названии книги');
      } else {
        contextBits.push('Совпадение в тексте');
      }
    }

    if (item.pageDistance !== null) {
      if (item.pageDistance === 0) {
        contextBits.push('Текущая страница');
      } else {
        contextBits.push(`Контекст: ±${item.pageDistance} стр.`);
      }
    }
    contextBits.push(`Повтор: ${formatReviewDueLabel(highlight.nextReviewAt)}`);

    const metaHtml = contextBits.length
      ? `<p class="highlight-meta">${escapeHtml(contextBits.join(' · '))}</p>`
      : '';
    const snippetHtml = item.snippet
      ? `<p class="highlight-context">${renderSnippetWithMarks(item.snippet, tokens)}</p>`
      : '';

    return `
      <article class="highlight-item">
        <div class="highlight-item-head">
          <label class="highlight-select">
            <input
              type="checkbox"
              data-action="select-highlight"
              data-id="${highlight.id}"
              ${isSelected ? 'checked' : ''}
            />
          </label>
          <span class="page-badge">стр. ${highlight.pageIndex + 1}</span>
          ${highlightChip(highlight.color)}
          <span class="highlight-date">${escapeHtml(formatDate(highlight.createdAt))}</span>
        </div>

        ${highlightTextHtml}
        ${noteHtml}
        ${tagsHtml}
        ${snippetHtml}
        ${metaHtml}

        <div class="highlight-actions">
          <button
            class="ghost-btn"
            data-action="go-to-highlight"
            data-id="${highlight.id}"
            data-document-id="${highlight.documentId}"
            data-page-index="${highlight.pageIndex}"
          >
            ${renderIcon('arrow-right')}
            Перейти
          </button>
          <button
            class="ghost-btn"
            data-action="copy-highlight-plain"
            data-id="${highlight.id}"
            data-document-id="${highlight.documentId}"
          >
            Копия
          </button>
          <button
            class="ghost-btn"
            data-action="copy-highlight-markdown"
            data-id="${highlight.id}"
            data-document-id="${highlight.documentId}"
          >
            MD
          </button>
          <button
            class="danger-btn"
            data-action="delete-highlight"
            data-id="${highlight.id}"
            data-document-id="${highlight.documentId}"
          >
            ${renderIcon('trash-2')}
            Удалить
          </button>
          <button
            class="secondary-btn"
            data-action="edit-highlight-tags"
            data-id="${highlight.id}"
            data-document-id="${highlight.documentId}"
          >
            Теги
          </button>
        </div>
      </article>
    `;
  };

  const listHtml = items.length
    ? state.view === 'highlights'
      ? state.documents
          .map((doc) => {
            const groupItems = items.filter((item) => item.highlight.documentId === doc.id);
            if (groupItems.length === 0) {
              return '';
            }

            return `
              <section class="highlight-book-group">
                <header class="highlight-book-head">
                  <div>
                    <h3>${escapeHtml(doc.title)}</h3>
                    <p>${groupItems.length} выделений</p>
                  </div>
                  <button
                    class="ghost-btn"
                    data-action="open-book-reader"
                    data-document-id="${doc.id}"
                  >
                    ${renderIcon('book-open')}
                    Открыть книгу
                  </button>
                </header>
                <div class="highlight-book-list">
                  ${groupItems.map((item) => renderItemHtml(item)).join('')}
                </div>
              </section>
            `;
          })
          .join('')
      : items.map((item) => renderItemHtml(item)).join('')
    : `<div class="empty-list">${emptyMessage}</div>`;

  for (const listNode of listNodes) {
    listNode.innerHTML = listHtml;

    listNode.querySelectorAll('[data-action="go-to-highlight"]').forEach((button) => {
      button.addEventListener('click', async () => {
        if (button.dataset.busy === '1') {
          return;
        }
        button.dataset.busy = '1';
        button.disabled = true;
        const highlightId = button.getAttribute('data-id');
        const documentId = button.getAttribute('data-document-id');
        const pageIndex = normalizePageIndex(
          button.getAttribute('data-page-index'),
          getCurrentPageIndexSafe(readerRuntime.totalPages),
        );
        const navigated = await goToHighlight(highlightId, {
          documentId,
          pageIndex,
        });
        if (!navigated) {
          setReaderMessage('Не удалось перейти к выделению. Повторите попытку.', true);
        }
        button.disabled = false;
        button.dataset.busy = '0';
      });
    });

    listNode.querySelectorAll('[data-action="delete-highlight"]').forEach((button) => {
      button.addEventListener('click', async () => {
        const highlightId = button.getAttribute('data-id');
        const documentId = button.getAttribute('data-document-id');
        if (!highlightId) {
          return;
        }

        button.disabled = true;
        const result = await deleteHighlightById(highlightId, {
          documentId,
        });
        if (!result.deleted) {
          setReaderMessage(
            `Не удалось удалить выделение: ${result.error?.message ?? 'неизвестная ошибка'}`,
            true,
          );
          button.disabled = false;
        } else {
          state.selectedHighlightIds = state.selectedHighlightIds.filter((id) => id !== highlightId);
        }
      });
    });

    listNode.querySelectorAll('[data-action="copy-highlight-plain"]').forEach((button) => {
      button.addEventListener('click', async () => {
        const highlightId = button.getAttribute('data-id');
        const found = findHighlightById(highlightId, button.getAttribute('data-document-id'));
        if (!found?.highlight) {
          return;
        }

        const text = composeHighlightClipboardText(found.highlight, { mode: 'plain' });
        const copied = await copyTextToClipboard(text);
        if (copied) {
          setReaderMessage('Цитата скопирована в буфер.');
        } else {
          setReaderMessage('Не удалось скопировать цитату.', true);
        }
      });
    });

    listNode.querySelectorAll('[data-action="copy-highlight-markdown"]').forEach((button) => {
      button.addEventListener('click', async () => {
        const highlightId = button.getAttribute('data-id');
        const found = findHighlightById(highlightId, button.getAttribute('data-document-id'));
        if (!found?.highlight) {
          return;
        }

        const text = composeHighlightClipboardText(found.highlight, { mode: 'markdown' });
        const copied = await copyTextToClipboard(text);
        if (copied) {
          setReaderMessage('Markdown-цитата скопирована.');
        } else {
          setReaderMessage('Не удалось скопировать Markdown-цитату.', true);
        }
      });
    });

    listNode.querySelectorAll('[data-action="select-highlight"]').forEach((checkbox) => {
      checkbox.addEventListener('change', (event) => {
        const highlightId = event.currentTarget.getAttribute('data-id');
        if (!highlightId) {
          return;
        }

        const checked = Boolean(event.currentTarget.checked);
        const current = new Set(state.selectedHighlightIds.map((id) => String(id)));
        if (checked) {
          current.add(highlightId);
        } else {
          current.delete(highlightId);
        }
        state.selectedHighlightIds = [...current];
        updateBulkHighlightsActionsState();
      });
    });

    listNode.querySelectorAll('[data-action="edit-highlight-tags"]').forEach((button) => {
      button.addEventListener('click', async () => {
        const highlightId = button.getAttribute('data-id');
        const found = findHighlightById(highlightId, button.getAttribute('data-document-id'));
        if (!found?.highlight) {
          return;
        }

        const currentTags = normalizeTags(found.highlight.tags).join(', ');
        const rawTags = window.prompt('Теги через запятую:', currentTags);
        if (rawTags === null) {
          return;
        }

        const tags = normalizeTags(rawTags.split(','));
        try {
          const updated = await window.recallApi.updateHighlight({
            id: found.highlight.id,
            tags,
          });
          upsertCurrentHighlight(updated);
          renderHighlightsList();
        } catch (error) {
          setReaderMessage(
            `Не удалось обновить теги: ${error?.message ?? 'неизвестная ошибка'}`,
            true,
          );
        }
      });
    });

    listNode.querySelectorAll('[data-action="open-book-reader"]').forEach((button) => {
      button.addEventListener('click', () => {
        const documentId = button.getAttribute('data-document-id');
        if (!documentId) {
          return;
        }

        openReaderView(documentId, getDocumentResumeOptions(documentId));
      });
    });
  }

  updateHighlightsFilterChips(parsedQuery, requestedTags);
  renderHighlightsPresets();
  renderHighlightsReviewPanel(scope);
  updateHighlightsSummary();
  updateBulkHighlightsActionsState();
  hydrateIcons();
}

function updateBulkHighlightsActionsState() {
  const selectedCount = state.selectedHighlightIds.length;
  const counter = document.querySelector('#highlights-selected-count');
  if (counter) {
    counter.textContent = `${selectedCount}`;
  }

  const disable = selectedCount === 0;
  const deleteBtn = document.querySelector('#highlights-delete-selected');
  const exportBtn = document.querySelector('#highlights-export-selected');
  if (deleteBtn) {
    deleteBtn.disabled = disable;
  }
  if (exportBtn) {
    exportBtn.disabled = disable;
  }
}

async function exportSelectedHighlights() {
  if (state.selectedHighlightIds.length === 0) {
    return;
  }

  const targetDocumentId =
    state.highlightsBookFilter !== 'all'
      ? state.highlightsBookFilter
      : state.currentDocument?.id;

  if (!targetDocumentId) {
    return;
  }

  if (state.highlightsBookFilter === 'all') {
    setReaderMessage('Для экспорта выбранных выделений выберите конкретную книгу.');
    return;
  }

  try {
    const result = await window.recallApi.exportMarkdownCustom({
      documentId: targetDocumentId,
      highlightIds: state.selectedHighlightIds,
      suffix: 'selected',
    });
    if (!result?.canceled) {
      setReaderMessage(`Экспортировано выделений: ${result.exportedCount ?? state.selectedHighlightIds.length}`);
    }
  } catch (error) {
    setReaderMessage(
      `Не удалось экспортировать выборку: ${error?.message ?? 'неизвестная ошибка'}`,
      true,
    );
  }
}

async function exportHighlightsSinceDate() {
  const targetDocumentId =
    state.highlightsBookFilter !== 'all'
      ? state.highlightsBookFilter
      : state.currentDocument?.id;

  if (!targetDocumentId) {
    return;
  }

  if (state.highlightsBookFilter === 'all') {
    setReaderMessage('Для экспорта новых выделений выберите книгу.');
    return;
  }

  const since = normalizeText(state.highlightsSinceDate);
  if (!since) {
    setReaderMessage('Укажите дату для экспорта новых выделений.');
    return;
  }

  try {
    const result = await window.recallApi.exportMarkdownCustom({
      documentId: targetDocumentId,
      since: `${since}T00:00:00.000Z`,
      suffix: `since-${since}`,
    });
    if (!result?.canceled) {
      setReaderMessage(`Экспортировано новых выделений: ${result.exportedCount ?? 0}`);
    }
  } catch (error) {
    setReaderMessage(
      `Не удалось экспортировать новые выделения: ${error?.message ?? 'неизвестная ошибка'}`,
      true,
    );
  }
}

async function deleteSelectedHighlights() {
  const ids = [...new Set(state.selectedHighlightIds.map((id) => String(id)).filter(Boolean))];
  if (ids.length === 0) {
    return;
  }

  const confirmed = window.confirm(`Удалить выбранные выделения (${ids.length})?`);
  if (!confirmed) {
    return;
  }

  const snapshot = [...state.selectedHighlightIds];
  state.selectedHighlightIds = [];
  renderHighlightsList();

  try {
    const result = await window.recallApi.deleteHighlightsMany(ids);
    if (result?.deletedCount) {
      for (const id of ids) {
        const removed = removeCurrentHighlight(id);
        if (removed?.documentId) {
          decrementDocumentHighlightCount(removed.documentId);
        }
      }
      renderHighlightsList();
      updateReaderHeader();
      return;
    }
  } catch (error) {
    state.selectedHighlightIds = snapshot;
    renderHighlightsList();
    setReaderMessage(
      `Не удалось удалить выбранные выделения: ${error?.message ?? 'неизвестная ошибка'}`,
      true,
    );
    return;
  }
}

async function renderHighlightsView() {
  if (state.view === 'reader') {
    await flushReaderProgressPersist();
  }

  if (state.documents.length === 0) {
    showLibraryView();
    return;
  }

  teardownReaderLayout();
  state.view = 'highlights';

  try {
    await refreshHighlightsIndex(true);
  } catch (error) {
    setLibraryError(`Не удалось загрузить хайлайты: ${error?.message ?? 'неизвестная ошибка'}`);
  }

  const validHighlightIds = new Set(getAllKnownHighlights().map((item) => String(item.id)));
  state.selectedHighlightIds = state.selectedHighlightIds.filter((id) => validHighlightIds.has(id));

  if (!state.currentDocument && state.documents.length > 0) {
    state.currentDocument = state.documents[0];
    state.currentHighlights = [...(state.highlightsByDocument[state.currentDocument.id] ?? [])];
  }

  const hasSelectedBook =
    state.highlightsBookFilter !== 'all' &&
    state.documents.some((doc) => doc.id === state.highlightsBookFilter);
  if (!hasSelectedBook) {
    state.highlightsBookFilter = 'all';
  }

  const contextAvailable =
    state.highlightsBookFilter !== 'all' &&
    Boolean(state.currentDocument?.id) &&
    state.highlightsBookFilter === state.currentDocument.id;
  if (!contextAvailable) {
    state.highlightsContextOnly = false;
  }

  const totalHighlights = getAllKnownHighlights().length;
  const bookOptions = [
    `<option value="all">Все книги (${totalHighlights})</option>`,
    ...state.documents.map((doc) => {
      const count = (state.highlightsByDocument[doc.id] ?? []).length;
      const selected = state.highlightsBookFilter === doc.id ? 'selected' : '';
      return `<option value="${doc.id}" ${selected}>${escapeHtml(doc.title)} (${count})</option>`;
    }),
  ].join('');

  appNode.innerHTML = `
    <main class="highlights-screen">
      ${getTabsMarkup('highlights')}

      <header class="highlights-header">
        <div>
          <h2>Хайлайты</h2>
          <p id="highlights-summary">Загрузка…</p>
        </div>
        <div class="header-actions">
          <button class="ghost-btn" data-action="open-command-palette">
            ${renderIcon('list')}
            Команды
          </button>
          <span class="reader-badge">Выбрано: <strong id="highlights-selected-count">0</strong></span>
          <button id="highlights-export-selected" class="secondary-btn" disabled>
            ${renderIcon('file-text')}
            Экспорт выбранного
          </button>
          <button id="highlights-delete-selected" class="danger-btn" disabled>
            ${renderIcon('trash-2')}
            Удалить выбранное
          </button>
          <button id="highlights-open-reader" class="secondary-btn">
            ${renderIcon('book-open')}
            Открыть читалку
          </button>
        </div>
      </header>

      <section class="highlights-search-wrap">
        <div class="highlights-search-line">
          <label class="highlights-book-filter" for="highlights-book-filter">
            <span>Книга</span>
            <select id="highlights-book-filter">
              ${bookOptions}
            </select>
          </label>

          <input
            id="highlights-search"
            data-highlights-search
            type="search"
            placeholder='Поиск: book:, tag:, -tag:, color:, page:, has:, due:, before:, after:, sort:, "фраза"'
            value="${escapeHtml(state.highlightsQuery)}"
          />
          <input
            id="highlights-tag-filter"
            type="search"
            placeholder="Фильтр по тегам: #важно, идея"
            value="${escapeHtml(state.highlightsTagFilter)}"
          />
          <div class="highlights-export-row">
            <label>Новые с даты
              <input
                id="highlights-since-date"
                type="date"
                value="${escapeHtml(state.highlightsSinceDate)}"
              />
            </label>
            <button id="highlights-export-since" class="secondary-btn">
              ${renderIcon('file-text')}
              Экспорт новых
            </button>
          </div>
          <label class="context-toggle" for="context-only-toggle">
            <input
              id="context-only-toggle"
              data-highlights-context-toggle
              type="checkbox"
              ${state.highlightsContextOnly ? 'checked' : ''}
              ${contextAvailable ? '' : 'disabled'}
            />
            <span>${
              contextAvailable
                ? 'Только рядом с текущей страницей (±3)'
                : 'Контекст доступен для открытой в читалке книги'
            }</span>
          </label>
          <div class="search-filter-chips hidden" data-highlights-filter-chips></div>
          <section class="highlights-presets">
            <div class="highlights-presets-head">
              <h4>Сохраненные запросы</h4>
              <div class="highlights-presets-actions">
                <input
                  id="highlights-preset-name"
                  type="text"
                  placeholder="Название пресета (опционально)"
                />
                <button id="highlights-save-preset" class="secondary-btn" type="button">
                  Сохранить запрос
                </button>
              </div>
            </div>
            <div id="highlights-presets-list" class="highlights-presets-list"></div>
          </section>
        </div>
      </section>

      <section id="highlights-review-panel" class="highlights-review-panel"></section>
      <section id="highlights-list" class="highlights-list" data-highlights-list></section>
    </main>
    ${getCommandPaletteMarkup()}
  `;

  bindGlobalTabs();
  refreshCommandPaletteItems();
  bindCommandPaletteEvents();
  bindCommandPaletteTriggers();
  updateCommandPaletteUi();

  document
    .querySelector('#highlights-open-reader')
    ?.addEventListener('click', () => {
      const targetDocumentId =
        state.highlightsBookFilter !== 'all'
          ? state.highlightsBookFilter
          : state.currentDocument?.id || state.documents[0]?.id;

      if (!targetDocumentId) {
        return;
      }

      openReaderView(targetDocumentId, getDocumentResumeOptions(targetDocumentId));
    });

  document.querySelector('#highlights-book-filter')?.addEventListener('change', (event) => {
    const nextDocumentId = String(event.currentTarget.value || 'all');
    state.highlightsBookFilter = nextDocumentId;

    const canUseContext =
      nextDocumentId !== 'all' &&
      Boolean(state.currentDocument?.id) &&
      nextDocumentId === state.currentDocument.id;
    const contextToggle = document.querySelector('#context-only-toggle');
    const contextLabel = contextToggle?.closest('label')?.querySelector('span');
    if (contextToggle) {
      contextToggle.disabled = !canUseContext;
      if (!canUseContext) {
        contextToggle.checked = false;
      }
    }
    if (contextLabel) {
      contextLabel.textContent = canUseContext
        ? 'Только рядом с текущей страницей (±3)'
        : 'Контекст доступен для открытой в читалке книги';
    }
    if (!canUseContext) {
      state.highlightsContextOnly = false;
    }

    renderHighlightsList();
  });

  document.querySelector('#highlights-search')?.addEventListener('input', (event) => {
    state.highlightsQuery = event.currentTarget.value;
    renderHighlightsPresets();
    renderHighlightsList();
  });

  document.querySelector('#highlights-tag-filter')?.addEventListener('input', (event) => {
    state.highlightsTagFilter = event.currentTarget.value;
    renderHighlightsList();
  });

  document.querySelector('#highlights-since-date')?.addEventListener('change', (event) => {
    state.highlightsSinceDate = String(event.currentTarget.value || '');
  });

  document.querySelector('#highlights-export-since')?.addEventListener('click', () => {
    void exportHighlightsSinceDate();
  });

  document.querySelector('#highlights-export-selected')?.addEventListener('click', () => {
    void exportSelectedHighlights();
  });

  document.querySelector('#highlights-delete-selected')?.addEventListener('click', () => {
    void deleteSelectedHighlights();
  });

  document.querySelector('#context-only-toggle')?.addEventListener('change', (event) => {
    state.highlightsContextOnly = Boolean(event.currentTarget.checked);
    renderHighlightsList();
  });

  document.querySelector('#highlights-save-preset')?.addEventListener('click', () => {
    void saveCurrentHighlightsPreset();
  });

  document.querySelector('#highlights-preset-name')?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') {
      return;
    }
    event.preventDefault();
    void saveCurrentHighlightsPreset(event.currentTarget.value);
  });

  document.querySelector('#highlights-presets-list')?.addEventListener('click', (event) => {
    const applyButton = event.target.closest('[data-action="apply-highlights-preset"]');
    if (applyButton) {
      const presetId = applyButton.getAttribute('data-id');
      applyHighlightsPresetById(presetId);
      return;
    }

    const deleteButton = event.target.closest('[data-action="delete-highlights-preset"]');
    if (deleteButton) {
      const presetId = deleteButton.getAttribute('data-id');
      void deleteHighlightsPresetById(presetId);
    }
  });

  renderHighlightsList();
  renderHighlightsPresets();
  updateBulkHighlightsActionsState();
  hydrateIcons();
}

function isTypingContext() {
  const active = document.activeElement;
  if (!active) {
    return false;
  }

  const tag = active.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || active.isContentEditable;
}

function clearNativeSelection() {
  const selection = window.getSelection();
  if (selection) {
    selection.removeAllRanges();
  }
}

function onGlobalKeyDown(event) {
  const hasMod = event.ctrlKey || event.metaKey;
  const key = String(event.key || '');
  const lowerKey = key.toLowerCase();

  if (hasMod && lowerKey === 'k') {
    event.preventDefault();
    if (state.commandPaletteOpen) {
      closeCommandPalette();
    } else {
      openCommandPalette();
    }
    return;
  }

  if (handleCommandPaletteKeyDown(event)) {
    return;
  }

  if (state.view !== 'reader') {
    if (state.view === 'highlights' && !isTypingContext()) {
      if (key === '/' || lowerKey === 'h') {
        event.preventDefault();
        const input = document.querySelector('#highlights-search');
        if (input) {
          input.focus();
          input.select();
        }
      }
    }
    return;
  }

  if (key === 'Escape') {
    closeNoteModal();
    clearSelectionState();
    clearNativeSelection();
    updateSelectionActions();
    return;
  }

  if (isTypingContext()) {
    return;
  }

  if (event.altKey && key === 'ArrowLeft') {
    event.preventDefault();
    void goReaderHistory(-1);
    return;
  }

  if (event.altKey && key === 'ArrowRight') {
    event.preventDefault();
    void goReaderHistory(1);
    return;
  }

  if (hasMod && (key === '+' || key === '=')) {
    event.preventDefault();
    changeScale(0.15);
    return;
  }

  if (hasMod && key === '-') {
    event.preventDefault();
    changeScale(-0.15);
    return;
  }

  if (hasMod && key === '0') {
    event.preventDefault();
    setScale(1);
    return;
  }

  if (key === 'PageDown') {
    event.preventDefault();
    scrollToPage(readerRuntime.currentPageIndex + 1, 'smooth', {
      userInitiated: true,
    });
    return;
  }

  if (key === 'PageUp') {
    event.preventDefault();
    scrollToPage(readerRuntime.currentPageIndex - 1, 'smooth', {
      userInitiated: true,
    });
    return;
  }

  if (lowerKey === 'h') {
    event.preventDefault();
    const searchInput =
      document.querySelector('#reader-highlights-search') ||
      document.querySelector('#highlights-search');
    if (searchInput) {
      searchInput.focus();
      searchInput.select();
      return;
    }
    void renderHighlightsView();
    return;
  }

  if (key === '/') {
    event.preventDefault();
    const searchInput =
      document.querySelector('#reader-highlights-search') ||
      document.querySelector('#highlights-search');
    if (searchInput) {
      searchInput.focus();
      searchInput.select();
    }
    return;
  }

  if (lowerKey === 'g') {
    event.preventDefault();
    const requestedRaw = window.prompt('Номер страницы:');
    if (requestedRaw === null) {
      return;
    }
    const requestedPage = normalizePageIndex(requestedRaw, getCurrentPageNumberSafe(readerRuntime.totalPages));
    scrollToPage(requestedPage - 1, 'smooth', {
      userInitiated: true,
    });
    return;
  }

  if (lowerKey === 'j' && !event.shiftKey) {
    event.preventDefault();
    void jumpToAdjacentHighlight(1);
    return;
  }

  if (lowerKey === 'j' && event.shiftKey) {
    event.preventDefault();
    void jumpToAdjacentHighlight(-1);
    return;
  }

  if (READER_ENGINE === 'webviewer') {
    if (key === '1') {
      event.preventDefault();
      setReaderInteractionMode('highlight', 'yellow');
      return;
    }

    if (key === '2') {
      event.preventDefault();
      setReaderInteractionMode('highlight', 'green');
      return;
    }

    if (key === '3') {
      event.preventDefault();
      setReaderInteractionMode('highlight', 'pink');
      return;
    }

    if (lowerKey === 'v') {
      event.preventDefault();
      setReaderInteractionMode('text-select');
      return;
    }

    if (lowerKey === 'n') {
      event.preventDefault();
      toggleWebViewerNotesPanel();
      return;
    }
  }

  if (state.pendingSelection) {
    if (key === '1') {
      event.preventDefault();
      createHighlight('yellow');
      return;
    }

    if (key === '2') {
      event.preventDefault();
      createHighlight('green');
      return;
    }

    if (key === '3') {
      event.preventDefault();
      createHighlight('pink');
    }
  }
}

async function bootstrap() {
  if (!window.recallApi) {
    appNode.innerHTML = '<p class="error-box">Preload API недоступен.</p>';
    return;
  }

  if (typeof window.recallApi.onUpdateStateChanged === 'function') {
    if (typeof unsubscribeUpdateState === 'function') {
      unsubscribeUpdateState();
    }
    unsubscribeUpdateState = window.recallApi.onUpdateStateChanged((payload) => {
      state.updateState = normalizeUpdateState(payload);
      if (state.view === 'library') {
        renderLibraryView();
      }
    });
  }

  window.addEventListener('keydown', onGlobalKeyDown);
  window.addEventListener('beforeunload', () => {
    void flushReaderProgressPersist();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      void flushReaderProgressPersist();
    }
  });
  await showLibraryView();
}

bootstrap();
