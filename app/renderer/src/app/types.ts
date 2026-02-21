export type AppView = 'library' | 'reader' | 'highlights' | 'insights';
export type WorkspacePreset = 'focus' | 'research' | 'review';
export type HighlightGroupMode = 'document' | 'timeline';

export type HighlightColor = 'yellow' | 'green' | 'pink' | 'blue' | 'orange' | 'purple';

export interface RectNorm {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DocumentRecord {
  id: string;
  title: string;
  filePath: string;
  createdAt: string;
  highlightsCount: number;
  bookmarksCount?: number;
  lastReadPageIndex?: number;
  maxReadPageIndex?: number;
  lastReadTotalPages?: number;
  lastReadScale?: number;
  lastOpenedAt?: string;
  totalReadingSeconds?: number;
  collectionId?: string;
  isPinned?: boolean;
}

export interface HighlightRecord {
  id: string;
  documentId: string;
  pageIndex: number;
  rects: RectNorm[];
  selectedText: string;
  selectedRichText?: string;
  color: HighlightColor;
  note?: string;
  tags?: string[];
  reviewCount?: number;
  reviewIntervalDays?: number;
  lastReviewedAt?: string;
  nextReviewAt?: string;
  reviewLastGrade?: 'hard' | 'good' | 'easy';
  createdAt: string;
}

export interface CollectionRecord {
  id: string;
  name: string;
  createdAt: string;
}

export interface ReadingLogEntry {
  pages: number;
  seconds: number;
}

export interface AppSettings {
  theme: 'white';
  focusMode: boolean;
  goals: {
    pagesPerDay: number;
    pagesPerWeek: number;
  };
  savedHighlightViews?: SavedHighlightView[];
  savedHighlightQueries?: Array<{
    id: string;
    name: string;
    query: string;
    createdAt: string;
  }>;
}

export interface SmartHighlightFilter {
  search: string;
  documentFilter: string;
  contextOnly: boolean;
  colorFilter: 'all' | HighlightColor;
  notesOnly: boolean;
  inboxOnly: boolean;
  groupMode: HighlightGroupMode;
}

export interface SavedHighlightView {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  isPinned: boolean;
  lastUsedAt?: string;
  filter: SmartHighlightFilter;
}

export interface ReadingOverview {
  readingLog: Record<string, ReadingLogEntry>;
  settings: AppSettings;
}

export interface StoragePaths {
  userDataPath: string;
  documentsDir: string;
  exportsDir: string;
  backupDir: string;
  dbPath: string;
}

export interface NavigateToHighlight {
  documentId: string;
  pageIndex: number;
  highlightId?: string;
}

export interface SrsCard {
  id: string;
  highlightId: string;
  documentId: string;
  documentTitle: string;
  page: number;
  front: string;
  back: string;
  clozeToken?: string;
  note?: string;
  tags: string[];
  reviewCount?: number;
  reviewIntervalDays?: number;
  lastReviewedAt?: string | null;
  nextReviewAt?: string | null;
  createdAt: string;
}

export interface SrsDeckResult {
  generatedAt: string;
  dueOnly: boolean;
  totalCandidates: number;
  dueCount: number;
  newCount: number;
  deckName: string;
  cards: SrsCard[];
  markdown: string;
  ankiTsv: string;
}

export interface DigestResult {
  generatedAt: string;
  period: 'daily' | 'weekly';
  range: {
    start: string;
    end: string;
    label: string;
  };
  stats: {
    pages: number;
    seconds: number;
    highlights: number;
    activeDocuments: number;
  };
  topDocuments: Array<{ title: string; count: number }>;
  topTags: Array<{ tag: string; count: number }>;
  inbox: Array<{
    highlightId: string;
    documentId: string;
    documentTitle: string;
    page: number;
    text: string;
  }>;
  markdown: string;
}

export interface KnowledgeGraphNode {
  id: string;
  key: string;
  kind: 'document' | 'concept';
  label: string;
  weight: number;
  documentId?: string;
}

export interface KnowledgeGraphEdge {
  id: string;
  fromId: string;
  toId: string;
  kind: 'document-concept' | 'concept-concept';
  weight: number;
}

export interface KnowledgeGraphResult {
  generatedAt: string;
  stats: {
    highlights: number;
    documents: number;
    concepts: number;
    edges: number;
  };
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  mermaid: string;
}

export interface AskLibraryCitation {
  index: number;
  highlightId: string;
  documentId: string;
  documentTitle: string;
  pageIndex: number;
  page: number;
  score: number;
  snippet: string;
  note?: string;
  tags: string[];
  createdAt: string;
}

export interface AskLibraryResult {
  generatedAt: string;
  query: string;
  answer: string;
  citations: AskLibraryCitation[];
  confidence: number;
}

export interface HighlightSummaryResult {
  generatedAt: string;
  documentId: string | null;
  documentTitle: string | null;
  usedHighlightsCount: number;
  keyPoints: string[];
  summary: string;
  sourceHighlightIds: string[];
}

export interface ExportBundleResult {
  canceled: boolean;
  bundlePath?: string;
  fileCount?: number;
  documentCount?: number;
}

export interface AiAssistantResult {
  generatedAt: string;
  mode: 'focus' | 'research' | 'review';
  provider: string;
  question?: string;
  text: string;
  recommendations: string[];
  metrics: {
    dueCount: number;
    digestPages: number;
    digestHighlights: number;
    summaryHighlights: number;
  };
  topConcepts: Array<{
    concept: string;
    weight: number;
  }>;
  ragAnswer?: AskLibraryResult | null;
  contextStats?: {
    documents: number;
    highlights: number;
    highlightsWithNotes: number;
    highlightsWithTags: number;
    inboxHighlights: number;
  };
  evidence?: Array<{
    index: number;
    highlightId: string;
    documentId: string;
    documentTitle: string;
    pageIndex: number;
    page: number;
    score: number;
    text: string;
    note?: string;
    tags: string[];
    createdAt?: string;
  }>;
}
