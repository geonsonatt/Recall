import type { AppView } from '../types';

export interface DeepLinkPayload {
  view?: AppView;
  documentId?: string;
  pageIndex?: number;
  highlightId?: string;
  search?: string;
  smartViewId?: string;
}

const EXTERNAL_DEEP_LINK_PROTOCOL = 'recall:';
const EXTERNAL_DEEP_LINK_HOST = 'open';

function cleanString(value: unknown): string | undefined {
  const normalized = String(value ?? '').trim();
  return normalized || undefined;
}

function cleanView(value: unknown): AppView | undefined {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (
    normalized === 'library' ||
    normalized === 'reader' ||
    normalized === 'highlights' ||
    normalized === 'insights'
  ) {
    return normalized as AppView;
  }
  return undefined;
}

function cleanPageIndex(value: unknown): number | undefined {
  if (value === null || value === undefined || String(value).trim() === '') {
    return undefined;
  }
  const raw = Number(value);
  if (!Number.isFinite(raw)) {
    return undefined;
  }
  return Math.max(0, Math.trunc(raw));
}

function parseFromSearchParams(
  params: URLSearchParams,
  view?: AppView,
): DeepLinkPayload {
  return {
    view,
    documentId: cleanString(params.get('documentId')),
    pageIndex: cleanPageIndex(params.get('page')),
    highlightId: cleanString(params.get('highlightId')),
    search: cleanString(params.get('search')),
    smartViewId: cleanString(params.get('smartViewId')),
  };
}

function parseExternalDeepLink(raw: string): DeepLinkPayload | null {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== EXTERNAL_DEEP_LINK_PROTOCOL) {
      return null;
    }

    const viewFromParams = cleanView(parsed.searchParams.get('view'));
    const viewFromHost = cleanView(parsed.hostname);
    const pathSegment = parsed.pathname.replace(/^\/+/, '').split('/')[0];
    const viewFromPath = cleanView(pathSegment);
    const view = viewFromParams || viewFromHost || viewFromPath;
    if (!view && parsed.hash) {
      return parseDeepLink(parsed.hash);
    }

    return parseFromSearchParams(parsed.searchParams, view);
  } catch {
    return null;
  }
}

export function parseDeepLink(input: string): DeepLinkPayload | null {
  const raw = String(input || '').trim();
  if (!raw) {
    return null;
  }

  if (raw.startsWith('recall://')) {
    return parseExternalDeepLink(raw);
  }

  try {
    const parsed = new URL(raw);
    if (parsed.hash) {
      return parseDeepLink(parsed.hash);
    }
  } catch {
    // noop, fallback to hash parsing
  }

  let hash = raw;
  const hashIndex = hash.indexOf('#');
  if (hashIndex >= 0) {
    hash = hash.slice(hashIndex + 1);
  }
  if (!hash) {
    return null;
  }

  const normalized = hash.startsWith('/') ? hash : `/${hash}`;
  const [pathPart, queryPart = ''] = normalized.split('?');
  const view = cleanView(pathPart.replace(/^\//, '').trim());
  const params = new URLSearchParams(queryPart);

  return parseFromSearchParams(params, view);
}

export function buildDeepLink(payload: DeepLinkPayload): string {
  const view = payload.view || 'library';
  const params = new URLSearchParams();
  if (payload.documentId) {
    params.set('documentId', payload.documentId);
  }
  if (Number.isFinite(Number(payload.pageIndex))) {
    params.set('page', String(Math.max(0, Math.trunc(Number(payload.pageIndex)))));
  }
  if (payload.highlightId) {
    params.set('highlightId', payload.highlightId);
  }
  if (payload.search) {
    params.set('search', payload.search);
  }
  if (payload.smartViewId) {
    params.set('smartViewId', payload.smartViewId);
  }

  const query = params.toString();
  return `#/${view}${query ? `?${query}` : ''}`;
}

export function buildExternalDeepLink(payload: DeepLinkPayload): string {
  const view = payload.view || 'library';
  const params = new URLSearchParams();
  params.set('view', view);
  if (payload.documentId) {
    params.set('documentId', payload.documentId);
  }
  if (Number.isFinite(Number(payload.pageIndex))) {
    params.set('page', String(Math.max(0, Math.trunc(Number(payload.pageIndex)))));
  }
  if (payload.highlightId) {
    params.set('highlightId', payload.highlightId);
  }
  if (payload.search) {
    params.set('search', payload.search);
  }
  if (payload.smartViewId) {
    params.set('smartViewId', payload.smartViewId);
  }
  return `${EXTERNAL_DEEP_LINK_PROTOCOL}//${EXTERNAL_DEEP_LINK_HOST}?${params.toString()}`;
}

export function getCurrentDeepLinkOrigin(): string {
  if (typeof window === 'undefined' || !window.location) {
    return '';
  }
  const protocol = window.location.protocol || '';
  const origin = window.location.origin || '';
  if (protocol !== 'http:' && protocol !== 'https:') {
    return '';
  }
  if (!origin || origin === 'null') {
    return '';
  }
  const pathname = window.location.pathname || '/';
  return `${origin}${pathname}`.replace(/\/$/, '');
}

export function buildAbsoluteDeepLink(payload: DeepLinkPayload): string {
  const base = getCurrentDeepLinkOrigin();
  if (!base) {
    return buildExternalDeepLink(payload);
  }
  return `${base}${buildDeepLink(payload)}`;
}
