import type {
  AiAssistantResult,
  AppSettings,
  AskLibraryResult,
  CollectionRecord,
  DigestResult,
  ExportBundleResult,
  DocumentRecord,
  HighlightRecord,
  HighlightSummaryResult,
  KnowledgeGraphResult,
  ReadingOverview,
  SrsDeckResult,
  StoragePaths,
} from './types';
import {
  addDebugEvent,
  incrementDebugCounter,
  recordDebugTiming,
  setDebugGauge,
  startDebugAction,
  summarizeForDebug,
} from './lib/debugTrace';
import { toUiErrorInfo } from './lib/errors';
import {
  completeStatusOperationError,
  completeStatusOperationSuccess,
  createStatusOperation,
  markStatusOperationPending,
  setStatusOperationRetry,
} from './lib/statusCenter';

type RecallApi = Window['recallApi'];

function api() {
  if (!window.recallApi) {
    throw new Error('Preload API недоступен.');
  }
  return window.recallApi;
}

let inflightIpcCalls = 0;

function nowMs() {
  if (typeof performance !== 'undefined' && Number.isFinite(performance.now())) {
    return performance.now();
  }
  return Date.now();
}

function estimatePayloadSize(payload: unknown): number {
  try {
    if (typeof Blob === 'undefined') {
      return JSON.stringify(payload ?? null).length;
    }
    return new Blob([JSON.stringify(payload ?? null)]).size;
  } catch {
    return 0;
  }
}

async function invokeRecallApi<T>(
  method: keyof RecallApi,
  args: unknown[] = [],
  context: {
    documentId?: string;
    highlightId?: string;
  } = {},
  statusOperationId?: string,
): Promise<T> {
  const methodName = String(method);
  const operationId = statusOperationId || createStatusOperation({
    scope: 'ipc',
    name: methodName,
    documentId: context.documentId,
    highlightId: context.highlightId,
    details: 'Выполняется IPC-вызов…',
  });
  if (!statusOperationId) {
    setStatusOperationRetry(operationId, () => invokeRecallApi(method, args, context, operationId));
  }

  if (statusOperationId) {
    markStatusOperationPending(statusOperationId, 'Повтор запроса…');
  }

  const action = startDebugAction({
    scope: 'ipc',
    name: methodName,
    documentId: context.documentId,
    highlightId: context.highlightId,
    data: {
      args: summarizeForDebug(args),
    },
  });

  incrementDebugCounter('ipc.calls.total', 1, 'ipc', { actionId: action.actionId }, { method: methodName });

  inflightIpcCalls += 1;
  setDebugGauge('ipc.calls.inflight', inflightIpcCalls, 'ipc', {
    actionId: action.actionId,
  });

  const startedAt = nowMs();
  const requestBytes = estimatePayloadSize(args);
  if (requestBytes > 0) {
    setDebugGauge('ipc.payload.request.bytes', requestBytes, 'ipc', {
      actionId: action.actionId,
      documentId: context.documentId,
      highlightId: context.highlightId,
    }, {
      method: methodName,
    });
  }

  try {
    const result = await (api()[method] as any)(...args);
    const durationMs = Math.max(0, nowMs() - startedAt);
    const responseBytes = estimatePayloadSize(result);

    action.finish(true, {
      details: `ok · ${durationMs.toFixed(1)}ms`,
      documentId: context.documentId,
      highlightId: context.highlightId,
      data: {
        result: summarizeForDebug(result),
      },
    });
    recordDebugTiming(
      'ipc.latency.ms',
      durationMs,
      'ipc',
      {
        actionId: action.actionId,
        documentId: context.documentId,
        highlightId: context.highlightId,
      },
      { method: methodName },
    );
    if (responseBytes > 0) {
      setDebugGauge(
        'ipc.payload.response.bytes',
        responseBytes,
        'ipc',
        {
          actionId: action.actionId,
          documentId: context.documentId,
          highlightId: context.highlightId,
        },
        { method: methodName },
      );
    }
    incrementDebugCounter('ipc.calls.ok', 1, 'ipc', { actionId: action.actionId }, { method: methodName });
    completeStatusOperationSuccess(operationId, {
      durationMs,
      details: `OK · ${durationMs.toFixed(1)}ms`,
      documentId: context.documentId,
      highlightId: context.highlightId,
    });
    return result as T;
  } catch (error) {
    const durationMs = Math.max(0, nowMs() - startedAt);
    const parsed = toUiErrorInfo(error, `E_IPC_${methodName.toUpperCase()}`);
    action.finish(
      false,
      {
        details: `${parsed.text} · ${durationMs.toFixed(1)}ms`,
        documentId: context.documentId,
        highlightId: context.highlightId,
        data: summarizeForDebug(error),
      },
      'error',
    );
    incrementDebugCounter('ipc.calls.error', 1, 'ipc', { actionId: action.actionId }, { method: methodName });
    recordDebugTiming(
      'ipc.latency.ms',
      durationMs,
      'ipc',
      {
        actionId: action.actionId,
        documentId: context.documentId,
        highlightId: context.highlightId,
      },
      { method: methodName, status: 'error' },
    );
    addDebugEvent(
      'ipc',
      'ipc.error',
      {
        actionId: action.actionId,
        documentId: context.documentId,
        highlightId: context.highlightId,
        details: parsed.text,
        data: summarizeForDebug(error),
      },
      'error',
    );
    completeStatusOperationError(operationId, {
      durationMs,
      details: parsed.text,
      documentId: context.documentId,
      highlightId: context.highlightId,
      errorCode: parsed.code,
      errorMessage: parsed.message,
    });
    throw error;
  } finally {
    inflightIpcCalls = Math.max(0, inflightIpcCalls - 1);
    setDebugGauge('ipc.calls.inflight', inflightIpcCalls, 'ipc', {
      actionId: action.actionId,
      documentId: context.documentId,
      highlightId: context.highlightId,
    });
  }
}

export async function listDocuments(): Promise<DocumentRecord[]> {
  return invokeRecallApi('listDocuments');
}

export async function importPdf() {
  return invokeRecallApi('importPdf');
}

export async function importPdfPaths(paths: string[]) {
  return invokeRecallApi('importPdfPaths', [paths]);
}

export async function deleteDocument(documentId: string) {
  return invokeRecallApi('deleteDocument', [documentId], { documentId });
}

export async function getDocument(documentId: string) {
  return invokeRecallApi('getDocument', [documentId], { documentId });
}

export async function readDocumentPdfBytes(documentId: string) {
  return invokeRecallApi('readDocumentPdfBytes', [documentId], { documentId });
}

export async function updateReadingState(payload: {
  documentId: string;
  pageIndex?: number;
  totalPages?: number;
  scale?: number;
  lastOpenedAt?: string;
  readingSeconds?: number;
  pagesDelta?: number;
  allowFirstPage?: boolean;
}) {
  return invokeRecallApi('updateDocumentReadingState', [payload], {
    documentId: payload.documentId,
  });
}

export async function listHighlights(documentId: string) {
  return invokeRecallApi('listHighlights', [{ documentId }], { documentId });
}

export async function listAllHighlights(payload?: {
  documentId?: string;
  since?: string;
  tags?: string[];
  ids?: string[];
}) {
  return invokeRecallApi('listAllHighlights', [payload ?? {}], {
    documentId: payload?.documentId,
  });
}

export async function addHighlight(payload: Omit<HighlightRecord, 'id' | 'createdAt'>) {
  return invokeRecallApi('addHighlight', [payload], {
    documentId: payload.documentId,
  });
}

export async function updateHighlight(payload: Partial<HighlightRecord> & { id: string }) {
  return invokeRecallApi('updateHighlight', [payload], {
    documentId: payload.documentId,
    highlightId: payload.id,
  });
}

export async function deleteHighlight(highlightId: string) {
  return invokeRecallApi('deleteHighlight', [highlightId], {
    highlightId,
  });
}

export async function exportAnnotatedPdf(documentId: string) {
  return invokeRecallApi('exportAnnotatedPdf', [documentId], { documentId });
}

export async function exportMarkdown(documentId: string) {
  return invokeRecallApi('exportMarkdown', [documentId], { documentId });
}

export async function exportObsidianBundle(payload: {
  documentIds?: string[];
} = {}): Promise<ExportBundleResult> {
  return invokeRecallApi('exportObsidianBundle', [payload], {
    documentId: payload.documentIds?.[0],
  });
}

export async function exportNotionBundle(payload: {
  documentIds?: string[];
} = {}): Promise<ExportBundleResult> {
  return invokeRecallApi('exportNotionBundle', [payload], {
    documentId: payload.documentIds?.[0],
  });
}

export async function generateSrsDeck(payload: {
  documentId?: string;
  documentIds?: string[];
  highlightIds?: string[];
  dueOnly?: boolean;
  limit?: number;
} = {}): Promise<SrsDeckResult> {
  return invokeRecallApi('generateSrsDeck', [payload], {
    documentId: payload.documentId || payload.documentIds?.[0],
    highlightId: payload.highlightIds?.[0],
  });
}

export async function buildReadingDigest(payload: {
  period?: 'daily' | 'weekly';
  anchorDate?: string;
  documentIds?: string[];
} = {}): Promise<DigestResult> {
  return invokeRecallApi('buildReadingDigest', [payload], {
    documentId: payload.documentIds?.[0],
  });
}

export async function buildKnowledgeGraph(payload: {
  documentIds?: string[];
  topConcepts?: number;
  minEdgeWeight?: number;
} = {}): Promise<KnowledgeGraphResult> {
  return invokeRecallApi('buildKnowledgeGraph', [payload], {
    documentId: payload.documentIds?.[0],
  });
}

export async function askLibrary(payload: {
  query: string;
  documentIds?: string[];
  limit?: number;
}): Promise<AskLibraryResult> {
  return invokeRecallApi('askLibrary', [payload], {
    documentId: payload.documentIds?.[0],
  });
}

export async function summarizeHighlights(payload: {
  documentId?: string;
  highlightIds?: string[];
  pageStart?: number;
  pageEnd?: number;
  maxSentences?: number;
} = {}): Promise<HighlightSummaryResult> {
  return invokeRecallApi('summarizeHighlights', [payload], {
    documentId: payload.documentId,
    highlightId: payload.highlightIds?.[0],
  });
}

export async function reviewHighlightSrs(payload: {
  highlightId: string;
  grade: 'hard' | 'good' | 'easy';
  nowIso?: string;
}) {
  return invokeRecallApi('reviewHighlightSrs', [payload], {
    highlightId: payload.highlightId,
  });
}

export async function generateAiAssistantBrief(payload: {
  documentId?: string;
  documentIds?: string[];
  question?: string;
  mode?: 'focus' | 'research' | 'review';
  provider?: 'auto' | 'local' | 'ollama' | 'openai';
  maxActions?: number;
} = {}): Promise<AiAssistantResult> {
  return invokeRecallApi('generateAiAssistantBrief', [payload], {
    documentId: payload.documentId || payload.documentIds?.[0],
  });
}

export async function listCollections(): Promise<CollectionRecord[]> {
  return invokeRecallApi('listCollections');
}

export async function createCollection(name: string): Promise<CollectionRecord> {
  return invokeRecallApi('createCollection', [{ name }]);
}

export async function updateDocumentMeta(payload: {
  documentId: string;
  isPinned?: boolean;
  collectionId?: string;
}) {
  return invokeRecallApi('updateDocumentMeta', [payload], {
    documentId: payload.documentId,
  });
}

export async function resetDocumentReadingState(documentId: string) {
  return invokeRecallApi('resetDocumentReadingState', [documentId], { documentId });
}

export async function getSettings(): Promise<AppSettings> {
  return invokeRecallApi('getSettings');
}

export async function updateSettings(payload: Partial<AppSettings>) {
  return invokeRecallApi('updateSettings', [payload]);
}

export async function getReadingOverview(): Promise<ReadingOverview> {
  return invokeRecallApi('getReadingOverview');
}

export async function getStoragePaths(): Promise<StoragePaths> {
  return invokeRecallApi('getStoragePaths');
}

export async function revealUserData() {
  return invokeRecallApi('revealUserData');
}

export async function backupData() {
  return invokeRecallApi('backupData');
}

export async function restoreData() {
  return invokeRecallApi('restoreData');
}
