import { addDebugEvent, incrementDebugCounter, setDebugGauge } from './debugTrace';

export type StatusOperationState = 'pending' | 'success' | 'error';
export type StatusOperationScope = 'ipc' | 'sync' | 'ui';

export interface StatusOperation {
  id: string;
  scope: StatusOperationScope;
  name: string;
  state: StatusOperationState;
  retryable: boolean;
  attempts: number;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  details?: string;
  documentId?: string;
  highlightId?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface StatusSnapshot {
  total: number;
  pending: number;
  errors: number;
  retryQueue: number;
  operations: StatusOperation[];
}

interface CreateStatusOperationInput {
  scope?: StatusOperationScope;
  name: string;
  details?: string;
  documentId?: string;
  highlightId?: string;
  retry?: () => Promise<unknown>;
}

interface CompleteStatusOperationInput {
  details?: string;
  documentId?: string;
  highlightId?: string;
  durationMs?: number;
  errorCode?: string;
  errorMessage?: string;
}

const MAX_STATUS_OPERATIONS = 220;

const operations: StatusOperation[] = [];
const listeners = new Set<() => void>();
const retryCallbacks = new Map<string, () => Promise<unknown>>();

let statusSeq = 0;

function nowIso() {
  return new Date().toISOString();
}

function createId() {
  statusSeq += 1;
  return `status-${Date.now()}-${statusSeq}`;
}

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function updateDebugMetrics() {
  const pending = operations.filter((item) => item.state === 'pending').length;
  const errors = operations.filter((item) => item.state === 'error').length;
  const retryQueue = operations.filter((item) => item.state === 'error' && item.retryable).length;
  setDebugGauge('status.center.total', operations.length, 'ui');
  setDebugGauge('status.center.pending', pending, 'ui');
  setDebugGauge('status.center.errors', errors, 'ui');
  setDebugGauge('status.center.retry-queue', retryQueue, 'ui');
}

function ensureCapacity() {
  if (operations.length <= MAX_STATUS_OPERATIONS) {
    return;
  }
  const overflow = operations.length - MAX_STATUS_OPERATIONS;
  const removed = operations.splice(0, overflow);
  for (const entry of removed) {
    retryCallbacks.delete(entry.id);
  }
}

function findOperation(id: string) {
  return operations.find((operation) => operation.id === id) || null;
}

export function createStatusOperation(input: CreateStatusOperationInput): string {
  const id = createId();
  const operation: StatusOperation = {
    id,
    scope: input.scope || 'ipc',
    name: String(input.name || 'operation'),
    state: 'pending',
    retryable: typeof input.retry === 'function',
    attempts: 1,
    startedAt: nowIso(),
    details: input.details,
    documentId: input.documentId,
    highlightId: input.highlightId,
  };

  operations.push(operation);
  if (input.retry) {
    retryCallbacks.set(id, input.retry);
  }
  ensureCapacity();
  addDebugEvent('ui', 'status.operation.create', {
    actionId: id,
    documentId: input.documentId,
    highlightId: input.highlightId,
    details: operation.name,
    data: { scope: operation.scope, retryable: operation.retryable },
  });
  incrementDebugCounter('status.operation.create', 1, 'ui', { actionId: id }, { scope: operation.scope });
  updateDebugMetrics();
  emit();
  return id;
}

export function setStatusOperationRetry(id: string, retry: (() => Promise<unknown>) | null) {
  if (!id) {
    return;
  }
  const operation = findOperation(id);
  if (!operation) {
    return;
  }

  if (retry) {
    retryCallbacks.set(id, retry);
    operation.retryable = true;
    addDebugEvent('ui', 'status.operation.retry-attached', {
      actionId: id,
      details: operation.name,
      data: { scope: operation.scope },
    });
  } else {
    retryCallbacks.delete(id);
    operation.retryable = false;
    addDebugEvent('ui', 'status.operation.retry-detached', {
      actionId: id,
      details: operation.name,
      data: { scope: operation.scope },
    });
  }
  updateDebugMetrics();
  emit();
}

export function markStatusOperationPending(id: string, details?: string) {
  const operation = findOperation(id);
  if (!operation) {
    return;
  }

  operation.state = 'pending';
  operation.startedAt = nowIso();
  operation.endedAt = undefined;
  operation.durationMs = undefined;
  operation.errorCode = undefined;
  operation.errorMessage = undefined;
  operation.details = details || operation.details;
  operation.attempts += 1;
  addDebugEvent('ui', 'status.operation.pending', {
    actionId: id,
    documentId: operation.documentId,
    highlightId: operation.highlightId,
    details: operation.details,
    data: {
      scope: operation.scope,
      attempts: operation.attempts,
    },
  });
  updateDebugMetrics();
  emit();
}

export function completeStatusOperationSuccess(id: string, input: CompleteStatusOperationInput = {}) {
  const operation = findOperation(id);
  if (!operation) {
    return;
  }

  operation.state = 'success';
  operation.endedAt = nowIso();
  operation.durationMs = Number.isFinite(Number(input.durationMs)) ? Number(input.durationMs) : operation.durationMs;
  operation.details = input.details || operation.details;
  operation.documentId = input.documentId || operation.documentId;
  operation.highlightId = input.highlightId || operation.highlightId;
  operation.errorCode = undefined;
  operation.errorMessage = undefined;
  addDebugEvent('ui', 'status.operation.success', {
    actionId: id,
    documentId: operation.documentId,
    highlightId: operation.highlightId,
    durationMs: operation.durationMs,
    details: operation.details,
    data: {
      scope: operation.scope,
      attempts: operation.attempts,
    },
  });
  updateDebugMetrics();
  emit();
}

export function completeStatusOperationError(id: string, input: CompleteStatusOperationInput = {}) {
  const operation = findOperation(id);
  if (!operation) {
    return;
  }

  operation.state = 'error';
  operation.endedAt = nowIso();
  operation.durationMs = Number.isFinite(Number(input.durationMs)) ? Number(input.durationMs) : operation.durationMs;
  operation.details = input.details || operation.details;
  operation.documentId = input.documentId || operation.documentId;
  operation.highlightId = input.highlightId || operation.highlightId;
  operation.errorCode = input.errorCode;
  operation.errorMessage = input.errorMessage;
  addDebugEvent(
    'ui',
    'status.operation.error',
    {
      actionId: id,
      documentId: operation.documentId,
      highlightId: operation.highlightId,
      durationMs: operation.durationMs,
      details: operation.details || operation.errorMessage,
      data: {
        scope: operation.scope,
        attempts: operation.attempts,
        code: operation.errorCode,
        message: operation.errorMessage,
      },
    },
    'error',
  );
  incrementDebugCounter('status.operation.error', 1, 'ui', { actionId: id }, { scope: operation.scope });
  updateDebugMetrics();
  emit();
}

export function retryStatusOperation(id: string) {
  const retry = retryCallbacks.get(id);
  const operation = findOperation(id);
  if (!retry || !operation) {
    return Promise.resolve(false);
  }

  markStatusOperationPending(id, 'Повтор запроса…');
  addDebugEvent('ui', 'status.operation.retry', {
    actionId: id,
    documentId: operation.documentId,
    highlightId: operation.highlightId,
    details: operation.name,
    data: { scope: operation.scope, attempts: operation.attempts },
  });
  return Promise.resolve(retry())
    .then(() => true)
    .catch((error) => {
      completeStatusOperationError(id, {
        details: String(error?.message || 'Ошибка повтора операции'),
      });
      return false;
    });
}

export function dismissStatusOperation(id: string) {
  const index = operations.findIndex((operation) => operation.id === id);
  if (index < 0) {
    return;
  }
  const operation = operations[index];
  operations.splice(index, 1);
  retryCallbacks.delete(id);
  addDebugEvent('ui', 'status.operation.dismiss', {
    actionId: id,
    documentId: operation.documentId,
    highlightId: operation.highlightId,
    details: operation.name,
    data: { scope: operation.scope, state: operation.state },
  });
  updateDebugMetrics();
  emit();
}

export function clearStatusCenter(mode: 'all' | 'completed' | 'errors' = 'completed') {
  if (mode === 'all') {
    const removed = operations.length;
    operations.splice(0, operations.length);
    retryCallbacks.clear();
    addDebugEvent('ui', 'status.center.clear', {
      details: 'all',
      data: { removed },
    });
    updateDebugMetrics();
    emit();
    return;
  }

  const toRemove = operations.filter((operation) => {
    if (mode === 'errors') {
      return operation.state === 'error';
    }
    return operation.state !== 'pending';
  });
  if (toRemove.length === 0) {
    return;
  }
  const removeIds = new Set(toRemove.map((item) => item.id));
  const next = operations.filter((item) => !removeIds.has(item.id));
  operations.splice(0, operations.length, ...next);
  for (const id of removeIds) {
    retryCallbacks.delete(id);
  }
  addDebugEvent('ui', 'status.center.clear', {
    details: mode,
    data: { removed: toRemove.length },
  });
  updateDebugMetrics();
  emit();
}

export function getStatusSnapshot(limit = 180): StatusSnapshot {
  const safeLimit = Math.max(10, Math.min(500, Math.trunc(Number(limit || 180))));
  const latest = operations.slice(-safeLimit).reverse();
  const pending = latest.filter((item) => item.state === 'pending').length;
  const errors = latest.filter((item) => item.state === 'error').length;
  const retryQueue = latest.filter((item) => item.state === 'error' && item.retryable).length;
  return {
    total: operations.length,
    pending,
    errors,
    retryQueue,
    operations: latest,
  };
}

export function subscribeStatusCenter(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
