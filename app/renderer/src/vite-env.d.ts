/// <reference types="vite/client" />

import type {
  AiAssistantResult,
  AppSettings,
  AskLibraryResult,
  CollectionRecord,
  DigestResult,
  DocumentRecord,
  ExportBundleResult,
  HighlightRecord,
  HighlightSummaryResult,
  KnowledgeGraphResult,
  ReadingOverview,
  SrsDeckResult,
  StoragePaths,
} from './app/types';

declare global {
  type NodeBufferLike = {
    type?: string;
    data?: number[];
  };

  interface Window {
    recallApi: {
      listDocuments: () => Promise<DocumentRecord[]>;
      importPdf: () => Promise<{ canceled: boolean; document?: DocumentRecord; alreadyExists?: boolean }>;
      importPdfPaths: (paths: string[]) => Promise<{
        imported: DocumentRecord[];
        duplicates: DocumentRecord[];
        errors: Array<{ filePath: string; message: string }>;
      }>;
      updateDocumentMeta: (payload: {
        documentId: string;
        isPinned?: boolean;
        collectionId?: string;
      }) => Promise<DocumentRecord>;
      deleteDocument: (documentId: string) => Promise<{
        deleted: boolean;
        documentId?: string;
        removedHighlightsCount?: number;
      }>;
      resetDocumentReadingState: (documentId: string) => Promise<DocumentRecord>;

      getDocument: (documentId: string) => Promise<DocumentRecord | null>;
      updateDocumentReadingState: (payload: {
        documentId: string;
        pageIndex?: number;
        totalPages?: number;
        scale?: number;
        lastOpenedAt?: string;
        readingSeconds?: number;
        pagesDelta?: number;
        allowFirstPage?: boolean;
      }) => Promise<DocumentRecord>;
      readDocumentPdfBytes: (documentId: string) => Promise<ArrayBuffer | Uint8Array | NodeBufferLike>;

      listHighlights: (payload: { documentId: string; since?: string; tags?: string[]; ids?: string[] }) => Promise<HighlightRecord[]>;
      listAllHighlights: (payload?: { documentId?: string; since?: string; tags?: string[]; ids?: string[] }) => Promise<HighlightRecord[]>;
      addHighlight: (payload: Omit<HighlightRecord, 'id' | 'createdAt'>) => Promise<HighlightRecord>;
      updateHighlight: (payload: Partial<HighlightRecord> & { id: string }) => Promise<HighlightRecord>;
      deleteHighlight: (highlightId: string) => Promise<{ deleted: boolean; deletedCount?: number }>;
      deleteHighlightsMany: (ids: string[]) => Promise<{ deleted: boolean; deletedCount: number }>;

      listCollections: () => Promise<CollectionRecord[]>;
      createCollection: (payload: { id?: string; name: string }) => Promise<CollectionRecord>;
      updateCollection: (payload: { id: string; name: string }) => Promise<CollectionRecord>;
      deleteCollection: (collectionId: string) => Promise<{ deleted: boolean }>;

      getSettings: () => Promise<AppSettings>;
      updateSettings: (payload: Partial<AppSettings>) => Promise<AppSettings>;
      getReadingOverview: () => Promise<ReadingOverview>;

      exportMarkdown: (documentId: string) => Promise<{ canceled: boolean; filePath?: string }>;
      exportMarkdownCustom: (payload: {
        documentId: string;
        highlightIds?: string[];
        since?: string;
        tags?: string[];
        title?: string;
        suffix?: string;
      }) => Promise<{ canceled: boolean; filePath?: string; exportedCount?: number }>;
      exportAnnotatedPdf: (documentId: string) => Promise<{ canceled: boolean; filePath?: string }>;
      exportObsidianBundle: (payload?: { documentIds?: string[] }) => Promise<ExportBundleResult>;
      exportNotionBundle: (payload?: { documentIds?: string[] }) => Promise<ExportBundleResult>;

      generateSrsDeck: (payload?: {
        documentId?: string;
        documentIds?: string[];
        highlightIds?: string[];
        dueOnly?: boolean;
        limit?: number;
      }) => Promise<SrsDeckResult>;
      buildReadingDigest: (payload?: {
        period?: 'daily' | 'weekly';
        anchorDate?: string;
        documentIds?: string[];
      }) => Promise<DigestResult>;
      buildKnowledgeGraph: (payload?: {
        documentIds?: string[];
        topConcepts?: number;
        minEdgeWeight?: number;
      }) => Promise<KnowledgeGraphResult>;
      askLibrary: (payload: {
        query: string;
        documentIds?: string[];
        limit?: number;
      }) => Promise<AskLibraryResult>;
      summarizeHighlights: (payload?: {
        documentId?: string;
        highlightIds?: string[];
        pageStart?: number;
        pageEnd?: number;
        maxSentences?: number;
      }) => Promise<HighlightSummaryResult>;
      reviewHighlightSrs: (payload: {
        highlightId: string;
        grade: 'hard' | 'good' | 'easy';
        nowIso?: string;
      }) => Promise<HighlightRecord>;
      generateAiAssistantBrief: (payload?: {
        documentId?: string;
        documentIds?: string[];
        question?: string;
        mode?: 'focus' | 'research' | 'review';
        provider?: 'auto' | 'local' | 'ollama' | 'openai';
        maxActions?: number;
      }) => Promise<AiAssistantResult>;

      getStoragePaths: () => Promise<StoragePaths>;
      backupData: () => Promise<{ canceled: boolean; backupPath?: string }>;
      restoreData: () => Promise<{ canceled: boolean; backupPath?: string; autoBackupPath?: string }>;
      revealUserData: () => Promise<{ ok: boolean }>;
      setDiagnosticsTrayCapture: (payload: { enabled: boolean }) => Promise<{
        enabled: boolean;
        buffered: number;
        total: number;
      }>;
      pushDiagnosticsEvents: (payload: {
        events: Array<{
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
        }>;
      }) => Promise<{
        accepted: number;
        buffered: number;
        total: number;
      }>;
      onDeepLink: (listener: (rawLink: string) => void) => () => void;
    };
  }
}

export {};
