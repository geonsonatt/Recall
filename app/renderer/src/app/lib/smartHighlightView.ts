import type { HighlightColor, SavedHighlightView, SmartHighlightFilter } from '../types';

const SMART_PREFIX = 'smart:';

function sanitizeColor(value: unknown): SmartHighlightFilter['colorFilter'] {
  const normalized = String(value ?? '').trim();
  if (
    normalized === 'yellow' ||
    normalized === 'green' ||
    normalized === 'pink' ||
    normalized === 'blue' ||
    normalized === 'orange' ||
    normalized === 'purple'
  ) {
    return normalized as HighlightColor;
  }
  return 'all';
}

function sanitizeGroupMode(value: unknown): SmartHighlightFilter['groupMode'] {
  return String(value ?? '').trim() === 'timeline' ? 'timeline' : 'document';
}

export function createDefaultSmartHighlightFilter(): SmartHighlightFilter {
  return {
    search: '',
    documentFilter: 'all',
    contextOnly: false,
    colorFilter: 'all',
    notesOnly: false,
    inboxOnly: false,
    groupMode: 'document',
  };
}

export function normalizeSmartHighlightFilter(
  value: Partial<SmartHighlightFilter> | null | undefined,
): SmartHighlightFilter {
  const raw = value || {};
  return {
    search: String(raw.search || ''),
    documentFilter: String(raw.documentFilter || 'all') || 'all',
    contextOnly: Boolean(raw.contextOnly),
    colorFilter: sanitizeColor(raw.colorFilter),
    notesOnly: Boolean(raw.notesOnly),
    inboxOnly: Boolean(raw.inboxOnly),
    groupMode: sanitizeGroupMode(raw.groupMode),
  };
}

export function serializeSmartHighlightFilter(filter: SmartHighlightFilter): string {
  return `${SMART_PREFIX}${JSON.stringify(normalizeSmartHighlightFilter(filter))}`;
}

export function parseSmartHighlightFilter(rawValue: string): SmartHighlightFilter | null {
  const raw = String(rawValue || '').trim();
  if (!raw.startsWith(SMART_PREFIX)) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw.slice(SMART_PREFIX.length));
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return normalizeSmartHighlightFilter(parsed as Partial<SmartHighlightFilter>);
  } catch {
    return null;
  }
}

export function createSavedHighlightView(
  name: string,
  filter: SmartHighlightFilter,
  patch: Partial<SavedHighlightView> = {},
): SavedHighlightView {
  const now = new Date().toISOString();
  return {
    id: patch.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: String(name || '').trim() || 'Представление',
    createdAt: patch.createdAt || now,
    updatedAt: patch.updatedAt || now,
    isPinned: Boolean(patch.isPinned),
    lastUsedAt: patch.lastUsedAt,
    filter: normalizeSmartHighlightFilter(filter),
  };
}

export function filterToLegacyQuery(filter: SmartHighlightFilter): string {
  return serializeSmartHighlightFilter(filter);
}

