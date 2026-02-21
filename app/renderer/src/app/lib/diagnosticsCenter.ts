import type { DebugEvent, DebugSnapshot } from './debugTrace';
import {
  addDebugEvent,
  getDebugEnabled,
  getDebugSnapshot,
  setDebugEnabled,
  subscribeDebugTrace,
  summarizeForDebug,
} from './debugTrace';
import type { StatusSnapshot } from './statusCenter';
import { getStatusSnapshot, subscribeStatusCenter } from './statusCenter';

export interface DiagnosticsTrayEvent {
  id: string;
  ts: string;
  scope: string;
  level: 'info' | 'warn' | 'error';
  type: 'event' | 'metric';
  name: string;
  actionId?: string;
  documentId?: string;
  highlightId?: string;
  durationMs?: number;
  details?: string;
  data?: unknown;
}

export interface DiagnosticsSnapshot {
  enabled: boolean;
  trayCaptureEnabled: boolean;
  overlayVisible: boolean;
  lastTraySyncAt?: string;
  traySyncErrorCount: number;
  debug: DebugSnapshot;
  status: StatusSnapshot;
}

const TRAY_CAPTURE_KEY = 'recall.diagnostics.tray-capture';
const OVERLAY_VISIBLE_KEY = 'recall.diagnostics.overlay-visible';
const UI_CAPTURE_KEY = 'recall.diagnostics.ui-capture';
const MAX_FORWARD_BATCH = 180;
const DEBUG_EVENT_SCAN_LIMIT = 1800;

const listeners = new Set<() => void>();

let trayCaptureEnabled = readBooleanFlag(TRAY_CAPTURE_KEY, false);
let overlayVisible = readBooleanFlag(OVERLAY_VISIBLE_KEY, false);
let uiCaptureEnabled = readBooleanFlag(UI_CAPTURE_KEY, true);

let traySyncErrorCount = 0;
let lastTraySyncAt = '';
let lastForwardedEventId = '';
let bridgeInitialized = false;
let forwardInFlight = false;
let forwardQueued = false;
let uiCaptureBound = false;

function nowIso() {
  return new Date().toISOString();
}

function readBooleanFlag(key: string, fallback = false) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return fallback;
    }
    return window.localStorage.getItem(key) === '1';
  } catch {
    return fallback;
  }
}

function writeBooleanFlag(key: string, value: boolean) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    window.localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // ignore persistence errors
  }
}

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function resolveRecallApiMethod(name: 'setDiagnosticsTrayCapture' | 'pushDiagnosticsEvents') {
  if (typeof window === 'undefined' || !window.recallApi) {
    return null;
  }
  const method = (window.recallApi as any)[name];
  if (typeof method !== 'function') {
    return null;
  }
  return method as (payload: unknown) => Promise<unknown>;
}

function normalizeEventForTray(event: DebugEvent): DiagnosticsTrayEvent {
  return {
    id: event.id,
    ts: event.ts,
    scope: event.scope,
    level: event.level,
    type: event.type,
    name: event.name,
    actionId: event.actionId,
    documentId: event.documentId,
    highlightId: event.highlightId,
    durationMs: Number.isFinite(Number(event.durationMs)) ? Number(event.durationMs) : undefined,
    details: event.details,
    data: summarizeForDebug(event.data, 2),
  };
}

function findFreshEvents(): {
  events: DiagnosticsTrayEvent[];
  lastId: string;
} {
  const snapshot = getDebugSnapshot(DEBUG_EVENT_SCAN_LIMIT);
  const ordered = [...snapshot.events].reverse();
  if (ordered.length === 0) {
    return {
      events: [],
      lastId: '',
    };
  }

  let startIndex = 0;
  if (lastForwardedEventId) {
    const seenIndex = ordered.findIndex((item) => item.id === lastForwardedEventId);
    if (seenIndex >= 0) {
      startIndex = seenIndex + 1;
    } else {
      startIndex = Math.max(0, ordered.length - MAX_FORWARD_BATCH);
    }
  }

  const fresh = ordered.slice(startIndex).slice(-MAX_FORWARD_BATCH);
  const events = fresh.map(normalizeEventForTray);
  const lastId = fresh.length > 0 ? fresh[fresh.length - 1].id : '';
  return {
    events,
    lastId,
  };
}

async function syncTrayCaptureFlag() {
  const setCapture = resolveRecallApiMethod('setDiagnosticsTrayCapture');
  if (!setCapture) {
    return;
  }

  try {
    await setCapture({ enabled: Boolean(getDebugEnabled() && trayCaptureEnabled) });
    lastTraySyncAt = nowIso();
  } catch (error) {
    traySyncErrorCount += 1;
    addDebugEvent(
      'system',
      'diagnostics.tray.capture-sync.error',
      {
        details: String((error as any)?.message || 'Не удалось переключить режим лога в трее'),
        data: summarizeForDebug(error),
      },
      'error',
    );
  }
  emit();
}

async function flushEventsToTray() {
  if (!trayCaptureEnabled || !getDebugEnabled()) {
    return;
  }

  const pushEvents = resolveRecallApiMethod('pushDiagnosticsEvents');
  if (!pushEvents) {
    return;
  }

  if (forwardInFlight) {
    forwardQueued = true;
    return;
  }

  forwardInFlight = true;
  do {
    forwardQueued = false;
    const fresh = findFreshEvents();
    const events = fresh.events;
    if (events.length === 0) {
      continue;
    }

    try {
      await pushEvents({ events });
      if (fresh.lastId) {
        lastForwardedEventId = fresh.lastId;
      }
      lastTraySyncAt = nowIso();
    } catch (error) {
      traySyncErrorCount += 1;
      addDebugEvent(
        'system',
        'diagnostics.tray.events-sync.error',
        {
          details: String((error as any)?.message || 'Не удалось отправить события в трей'),
          data: summarizeForDebug(error),
        },
        'error',
      );
    }
  } while (forwardQueued);

  forwardInFlight = false;
  emit();
}

function bindUiCapture() {
  if (uiCaptureBound || typeof window === 'undefined') {
    return;
  }

  const describeTarget = (target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) {
      return { tag: 'unknown' };
    }

    const classes = String(target.className || '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 4)
      .join('.');

    const role = target.getAttribute('role') || undefined;
    const nameAttr =
      target.getAttribute('aria-label') ||
      target.getAttribute('name') ||
      target.getAttribute('data-action') ||
      undefined;
    const text = String(target.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);

    return {
      tag: target.tagName.toLowerCase(),
      id: target.id || undefined,
      classes: classes || undefined,
      role,
      name: nameAttr,
      text: text || undefined,
    };
  };

  const onClick = (event: MouseEvent) => {
    if (!uiCaptureEnabled || !getDebugEnabled()) {
      return;
    }
    addDebugEvent('ui', 'ui.click', {
      details: `button=${event.button}`,
      data: {
        pointerType: (event as any).pointerType || 'mouse',
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        target: describeTarget(event.target),
      },
    });
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!uiCaptureEnabled || !getDebugEnabled()) {
      return;
    }

    if ((event.target as HTMLElement | null)?.tagName?.toLowerCase() === 'input') {
      return;
    }

    addDebugEvent('ui', 'ui.keydown', {
      details: event.key,
      data: {
        code: event.code,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        repeat: event.repeat,
        target: describeTarget(event.target),
      },
    });
  };

  window.addEventListener('click', onClick, true);
  window.addEventListener('keydown', onKeyDown, true);
  uiCaptureBound = true;

  addDebugEvent('system', 'diagnostics.ui-capture.bound', {
    details: 'click/keydown capture ready',
    data: {
      uiCaptureEnabled,
    },
  });
}

function ensureBridge() {
  if (bridgeInitialized) {
    return;
  }

  bridgeInitialized = true;
  subscribeDebugTrace(() => {
    if (trayCaptureEnabled && getDebugEnabled()) {
      void flushEventsToTray();
    }
    emit();
  });

  subscribeStatusCenter(() => {
    const status = getStatusSnapshot(120);
    addDebugEvent('ui', 'status.snapshot', {
      details: `pending=${status.pending} errors=${status.errors} retry=${status.retryQueue}`,
      data: {
        total: status.total,
        pending: status.pending,
        errors: status.errors,
        retryQueue: status.retryQueue,
      },
    });
    emit();
  });

  bindUiCapture();
  void syncTrayCaptureFlag();
  if (trayCaptureEnabled && getDebugEnabled()) {
    void flushEventsToTray();
  }
}

export function getDiagnosticsEnabled() {
  return getDebugEnabled();
}

export function getDiagnosticsOverlayVisible() {
  return overlayVisible;
}

export function setDiagnosticsOverlayVisible(value: boolean) {
  ensureBridge();
  const next = Boolean(value);
  if (overlayVisible === next) {
    return;
  }

  overlayVisible = next;
  writeBooleanFlag(OVERLAY_VISIBLE_KEY, next);
  addDebugEvent('system', 'diagnostics.overlay.visibility-changed', {
    details: next ? 'open' : 'closed',
  });
  emit();
}

export function getDiagnosticsTrayCaptureEnabled() {
  return trayCaptureEnabled;
}

export function setDiagnosticsTrayCaptureEnabled(value: boolean) {
  ensureBridge();
  const next = Boolean(value);
  if (trayCaptureEnabled === next) {
    return;
  }

  trayCaptureEnabled = next;
  writeBooleanFlag(TRAY_CAPTURE_KEY, next);
  addDebugEvent('system', 'diagnostics.tray.capture-changed', {
    details: next ? 'on' : 'off',
  });
  void syncTrayCaptureFlag();
  if (next && getDebugEnabled()) {
    void flushEventsToTray();
  }
  emit();
}

export function setDiagnosticsUiCaptureEnabled(value: boolean) {
  ensureBridge();
  const next = Boolean(value);
  if (uiCaptureEnabled === next) {
    return;
  }

  uiCaptureEnabled = next;
  writeBooleanFlag(UI_CAPTURE_KEY, next);
  addDebugEvent('system', 'diagnostics.ui-capture.changed', {
    details: next ? 'on' : 'off',
  });
  emit();
}

export function getDiagnosticsUiCaptureEnabled() {
  return uiCaptureEnabled;
}

export function setDiagnosticsEnabled(
  value: boolean,
  options: {
    trayCapture?: boolean;
    overlayVisible?: boolean;
  } = {},
) {
  ensureBridge();
  const next = Boolean(value);
  const wasEnabled = getDebugEnabled();
  setDebugEnabled(next);

  if (typeof options.overlayVisible === 'boolean') {
    setDiagnosticsOverlayVisible(options.overlayVisible);
  } else if (!next) {
    setDiagnosticsOverlayVisible(false);
  }

  if (typeof options.trayCapture === 'boolean') {
    setDiagnosticsTrayCaptureEnabled(options.trayCapture);
  }

  if (wasEnabled !== next) {
    void syncTrayCaptureFlag();
    if (next && trayCaptureEnabled) {
      void flushEventsToTray();
    }
  }

  emit();
}

export function toggleDiagnosticsTrayMode() {
  const enabled = getDebugEnabled();
  if (!enabled) {
    setDiagnosticsEnabled(true, {
      trayCapture: true,
      overlayVisible: false,
    });
    return true;
  }

  setDiagnosticsEnabled(false, {
    trayCapture: false,
    overlayVisible: false,
  });
  return false;
}

export function getDiagnosticsSnapshot(eventLimit = 260, statusLimit = 180): DiagnosticsSnapshot {
  ensureBridge();
  return {
    enabled: getDebugEnabled(),
    trayCaptureEnabled,
    overlayVisible,
    lastTraySyncAt: lastTraySyncAt || undefined,
    traySyncErrorCount,
    debug: getDebugSnapshot(eventLimit),
    status: getStatusSnapshot(statusLimit),
  };
}

export function subscribeDiagnostics(listener: () => void) {
  ensureBridge();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function ensureDiagnosticsRuntime() {
  ensureBridge();
}
