export type DebugScope = 'app' | 'ipc' | 'reader' | 'store' | 'ui' | 'system';
export type DebugLevel = 'info' | 'warn' | 'error';
export type DebugMetricKind = 'counter' | 'gauge' | 'timing';

export interface DebugContext {
  actionId?: string;
  documentId?: string;
  highlightId?: string;
  durationMs?: number;
  details?: string;
  data?: unknown;
}

export interface DebugEvent {
  id: string;
  ts: string;
  scope: DebugScope;
  level: DebugLevel;
  type: 'event' | 'metric';
  name: string;
  actionId?: string;
  documentId?: string;
  highlightId?: string;
  durationMs?: number;
  details?: string;
  data?: unknown;
}

export interface DebugMetricAggregate {
  key: string;
  name: string;
  kind: DebugMetricKind;
  tags: Record<string, string>;
  count: number;
  total: number;
  min: number;
  max: number;
  avg: number;
  last: number;
  updatedAt: string;
}

export interface DebugSnapshot {
  enabled: boolean;
  consoleEnabled: boolean;
  droppedEvents: number;
  totalEvents: number;
  events: DebugEvent[];
  metrics: DebugMetricAggregate[];
}

interface DebugMetricInput {
  scope?: DebugScope;
  name: string;
  kind: DebugMetricKind;
  value: number;
  tags?: Record<string, string | number | boolean>;
  context?: DebugContext;
}

interface StartDebugActionInput extends DebugContext {
  scope: DebugScope;
  name: string;
}

const TRACE_LIMIT = 5000;
const DEBUG_CONSOLE_KEY = 'recall.debug.console';

const events: DebugEvent[] = [];
const metrics = new Map<string, DebugMetricAggregate>();
const listeners = new Set<() => void>();

let droppedEvents = 0;
let eventSeq = 0;

let debugEnabled = false;
let debugConsoleEnabled = readBooleanFlag(DEBUG_CONSOLE_KEY, false);

function nowIso() {
  return new Date().toISOString();
}

function nowMs() {
  if (typeof performance !== 'undefined' && Number.isFinite(performance.now())) {
    return performance.now();
  }
  return Date.now();
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

function normalizeTags(
  tags: Record<string, string | number | boolean> | undefined,
): Record<string, string> {
  if (!tags || typeof tags !== 'object') {
    return {};
  }

  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(tags)) {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) {
      continue;
    }
    result[normalizedKey] = String(value);
  }
  return result;
}

function metricKey(name: string, kind: DebugMetricKind, tags: Record<string, string>) {
  const suffix = Object.entries(tags)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join(',');
  return suffix ? `${kind}:${name}:${suffix}` : `${kind}:${name}`;
}

function createEventId() {
  eventSeq += 1;
  return `${Date.now()}-${eventSeq}`;
}

function summarizeValueInner(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  const primitiveType = typeof value;
  if (primitiveType === 'string') {
    const text = value as string;
    return text.length > 220 ? `${text.slice(0, 220)}…` : text;
  }
  if (primitiveType === 'number' || primitiveType === 'boolean') {
    return value;
  }
  if (primitiveType === 'bigint') {
    return `${String(value)}n`;
  }
  if (primitiveType === 'function') {
    return '[Function]';
  }
  if (primitiveType === 'symbol') {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack ? value.stack.split('\n').slice(0, 3).join('\n') : undefined,
    };
  }
  if (Array.isArray(value)) {
    if (depth <= 0) {
      return `[Array(${value.length})]`;
    }

    return value.slice(0, 16).map((item) => summarizeValueInner(item, depth - 1));
  }

  if (typeof value === 'object') {
    if (depth <= 0) {
      return '[Object]';
    }

    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 18)) {
      result[key] = summarizeValueInner(item, depth - 1);
    }
    return result;
  }

  return String(value);
}

export function summarizeForDebug(value: unknown, depth = 2) {
  return summarizeValueInner(value, Math.max(0, Math.trunc(Number(depth || 0))));
}

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function shouldStoreEvent(event: Omit<DebugEvent, 'id' | 'ts'>) {
  if (debugEnabled) {
    return true;
  }

  if (
    event.scope === 'system' &&
    (event.name === 'debug.enabled-changed' || event.name === 'debug.console-changed')
  ) {
    return true;
  }

  return false;
}

function pushEvent(event: Omit<DebugEvent, 'id' | 'ts'>) {
  const entry: DebugEvent = {
    id: createEventId(),
    ts: nowIso(),
    ...event,
  };

  if (!shouldStoreEvent(event)) {
    return entry;
  }

  events.push(entry);
  if (events.length > TRACE_LIMIT) {
    events.shift();
    droppedEvents += 1;
  }

  if (debugConsoleEnabled) {
    const level = entry.level === 'error' ? 'error' : entry.level === 'warn' ? 'warn' : 'info';
    const consoleMethod =
      level === 'error' ? console.error : level === 'warn' ? console.warn : console.info;
    consoleMethod('[debug-trace]', entry);
  }

  emit();
  return entry;
}

export function addDebugEvent(
  scope: DebugScope,
  name: string,
  context: DebugContext = {},
  level: DebugLevel = 'info',
) {
  return pushEvent({
    scope,
    name,
    level,
    type: 'event',
    actionId: context.actionId,
    documentId: context.documentId,
    highlightId: context.highlightId,
    durationMs:
      context && Object.prototype.hasOwnProperty.call(context, 'durationMs')
        ? Number((context as any).durationMs)
        : undefined,
    details: context.details,
    data: summarizeForDebug(context.data),
  });
}

export function addDebugMetric(input: DebugMetricInput) {
  if (!debugEnabled) {
    return;
  }

  const scope = input.scope || 'system';
  const tags = normalizeTags(input.tags);
  const key = metricKey(input.name, input.kind, tags);
  const value = Number(input.value);
  const numericValue = Number.isFinite(value) ? value : 0;
  const updatedAt = nowIso();

  const current = metrics.get(key);
  if (!current) {
    metrics.set(key, {
      key,
      name: input.name,
      kind: input.kind,
      tags,
      count: 1,
      total: numericValue,
      min: numericValue,
      max: numericValue,
      avg: numericValue,
      last: numericValue,
      updatedAt,
    });
  } else {
    current.count += 1;
    current.total += numericValue;
    current.last = numericValue;
    current.min = Math.min(current.min, numericValue);
    current.max = Math.max(current.max, numericValue);
    current.avg = current.count > 0 ? current.total / current.count : current.last;
    current.updatedAt = updatedAt;
  }

  pushEvent({
    scope,
    name: input.name,
    level: 'info',
    type: 'metric',
    actionId: input.context?.actionId,
    documentId: input.context?.documentId,
    highlightId: input.context?.highlightId,
    details: input.context?.details || `${input.kind}=${numericValue}`,
    data: summarizeForDebug({
      kind: input.kind,
      value: numericValue,
      tags,
    }),
  });
}

export function incrementDebugCounter(
  name: string,
  delta = 1,
  scope: DebugScope = 'system',
  context: DebugContext = {},
  tags?: Record<string, string | number | boolean>,
) {
  addDebugMetric({
    scope,
    name,
    kind: 'counter',
    value: Number.isFinite(Number(delta)) ? Number(delta) : 1,
    tags,
    context,
  });
}

export function setDebugGauge(
  name: string,
  value: number,
  scope: DebugScope = 'system',
  context: DebugContext = {},
  tags?: Record<string, string | number | boolean>,
) {
  addDebugMetric({
    scope,
    name,
    kind: 'gauge',
    value,
    tags,
    context,
  });
}

export function recordDebugTiming(
  name: string,
  durationMs: number,
  scope: DebugScope = 'system',
  context: DebugContext = {},
  tags?: Record<string, string | number | boolean>,
) {
  addDebugMetric({
    scope,
    name,
    kind: 'timing',
    value: Number.isFinite(Number(durationMs)) ? Number(durationMs) : 0,
    tags,
    context,
  });
}

export function startDebugAction(input: StartDebugActionInput) {
  const actionId = input.actionId || `${input.scope}:${createEventId()}`;
  const startedAt = nowMs();
  addDebugEvent(
    input.scope,
    `${input.name}:start`,
    {
      ...input,
      actionId,
    },
    'info',
  );

  return {
    actionId,
    finish: (
      ok: boolean,
      context: Omit<DebugContext, 'actionId'> = {},
      level: DebugLevel = ok ? 'info' : 'error',
    ) => {
      const durationMs = Math.max(0, nowMs() - startedAt);
      addDebugEvent(
        input.scope,
        `${input.name}:${ok ? 'success' : 'error'}`,
        {
          ...context,
          actionId,
          documentId: context.documentId || input.documentId,
          highlightId: context.highlightId || input.highlightId,
          durationMs,
        },
        level,
      );
      recordDebugTiming(
        `${input.scope}.${input.name}.duration`,
        durationMs,
        input.scope,
        {
          actionId,
          documentId: context.documentId || input.documentId,
          highlightId: context.highlightId || input.highlightId,
        },
      );
      incrementDebugCounter(
        `${input.scope}.${input.name}.${ok ? 'ok' : 'error'}`,
        1,
        input.scope,
        {
          actionId,
          documentId: context.documentId || input.documentId,
          highlightId: context.highlightId || input.highlightId,
        },
      );
    },
  };
}

export function clearDebugTrace() {
  events.splice(0, events.length);
  metrics.clear();
  droppedEvents = 0;
  emit();
}

export function subscribeDebugTrace(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getDebugSnapshot(limit = 300): DebugSnapshot {
  const safeLimit = Math.max(1, Math.min(2000, Math.trunc(Number(limit || 0))));
  const latestEvents = events.slice(-safeLimit).reverse();
  const metricsList = [...metrics.values()].sort(
    (left, right) => new Date(right.updatedAt).valueOf() - new Date(left.updatedAt).valueOf(),
  );

  return {
    enabled: debugEnabled,
    consoleEnabled: debugConsoleEnabled,
    droppedEvents,
    totalEvents: events.length + droppedEvents,
    events: latestEvents,
    metrics: metricsList,
  };
}

export function getDebugEnabled() {
  return debugEnabled;
}

export function setDebugEnabled(value: boolean) {
  const next = Boolean(value);
  if (next === debugEnabled) {
    return;
  }

  debugEnabled = next;
  addDebugEvent('system', 'debug.enabled-changed', {
    details: next ? 'on' : 'off',
    data: { enabled: next },
  });
}

export function getDebugConsoleEnabled() {
  return debugConsoleEnabled;
}

export function setDebugConsoleEnabled(value: boolean) {
  const next = Boolean(value);
  if (next === debugConsoleEnabled) {
    return;
  }
  debugConsoleEnabled = next;
  writeBooleanFlag(DEBUG_CONSOLE_KEY, next);
  addDebugEvent('system', 'debug.console-changed', {
    details: next ? 'on' : 'off',
    data: { consoleEnabled: next },
  });
}

export function exportDebugDump() {
  return {
    generatedAt: nowIso(),
    runtime: {
      enabled: debugEnabled,
      consoleEnabled: debugConsoleEnabled,
      droppedEvents,
      totalEvents: events.length + droppedEvents,
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
    },
    events: [...events],
    metrics: [...metrics.values()],
  };
}
