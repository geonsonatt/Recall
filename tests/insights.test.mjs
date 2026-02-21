import { describe, expect, it } from 'vitest';
import insights from '../app/intelligence/insights.js';

const {
  generateSrsDeck,
  applySrsReviewGrade,
  buildReadingDigest,
  buildKnowledgeGraph,
  askLibrary,
  summarizeHighlights,
} = insights;

function makeDb() {
  return {
    documents: [
      {
        id: 'doc-1',
        title: 'Симулякры и симуляции',
      },
      {
        id: 'doc-2',
        title: 'Апокалипсис сегодня',
      },
    ],
    highlights: [
      {
        id: 'hl-1',
        documentId: 'doc-1',
        pageIndex: 6,
        selectedText: 'Современные симуляторы пытаются совместить реальное и воображаемое.',
        note: 'Контраст между реальным и имитацией.',
        tags: ['симуляция', 'реальность'],
        createdAt: '2026-02-20T10:00:00.000Z',
      },
      {
        id: 'hl-2',
        documentId: 'doc-1',
        pageIndex: 7,
        selectedText: 'Карта стала важнее территории, а изображение подменяет объект.',
        tags: ['карта', 'модель'],
        createdAt: '2026-02-20T11:00:00.000Z',
      },
      {
        id: 'hl-3',
        documentId: 'doc-2',
        pageIndex: 83,
        selectedText: 'Война как технологический спектакль подменяет реальный опыт.',
        tags: ['война', 'технология'],
        createdAt: '2026-02-21T08:00:00.000Z',
      },
    ],
    readingLog: {
      '2026-02-20': { pages: 20, seconds: 1800 },
      '2026-02-21': { pages: 14, seconds: 1200 },
    },
  };
}

describe('insights module', () => {
  it('generates SRS cards and markdown/tsv payloads', () => {
    const deck = generateSrsDeck(makeDb(), {
      documentId: 'doc-1',
      dueOnly: false,
      limit: 10,
    });

    expect(deck.cards.length).toBe(2);
    expect(deck.markdown).toContain('# SRS');
    expect(deck.ankiTsv).toContain('\t');
  });

  it('builds daily digest with stats and inbox list', () => {
    const digest = buildReadingDigest(makeDb(), {
      period: 'daily',
      anchorDate: '2026-02-20T18:00:00.000Z',
    });

    expect(digest.period).toBe('daily');
    expect(digest.stats.pages).toBe(20);
    expect(digest.markdown).toContain('Daily Digest');
  });

  it('builds graph and retrieves answers via local RAG', () => {
    const graph = buildKnowledgeGraph(makeDb(), {
      topConcepts: 30,
      minEdgeWeight: 1,
    });
    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(graph.mermaid).toContain('graph LR');

    const answer = askLibrary(makeDb(), {
      query: 'что происходит с реальностью в симуляции',
      limit: 5,
    });
    expect(answer.citations.length).toBeGreaterThan(0);
    expect(answer.answer).toContain('Ключевые тезисы');
  });

  it('creates extractive summary for selected document', () => {
    const summary = summarizeHighlights(makeDb(), {
      documentId: 'doc-1',
      maxSentences: 4,
    });

    expect(summary.usedHighlightsCount).toBe(2);
    expect(summary.summary).toContain('1.');
  });

  it('applies SRS review grade and schedules next review', () => {
    const patch = applySrsReviewGrade(
      {
        reviewCount: 2,
        reviewIntervalDays: 3,
      },
      {
        grade: 'easy',
        nowIso: '2026-02-21T10:00:00.000Z',
      },
    );

    expect(patch.reviewCount).toBe(3);
    expect(patch.reviewIntervalDays).toBeGreaterThanOrEqual(4);
    expect(patch.reviewLastGrade).toBe('easy');
    expect(patch.lastReviewedAt).toBe('2026-02-21T10:00:00.000Z');
  });
});
