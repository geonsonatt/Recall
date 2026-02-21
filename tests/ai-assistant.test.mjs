import { describe, expect, it } from 'vitest';
import aiAssistant from '../app/intelligence/aiAssistant.js';

const { generateAiAssistantBrief } = aiAssistant;

function makeDb() {
  return {
    documents: [
      { id: 'doc-1', title: 'Симулякры и симуляции' },
      { id: 'doc-2', title: 'Апокалипсис сегодня' },
    ],
    highlights: [
      {
        id: 'hl-1',
        documentId: 'doc-1',
        pageIndex: 5,
        selectedText: 'Симуляция вытесняет реальность на уровне моделей.',
        tags: ['симуляция', 'реальность'],
        createdAt: '2026-02-20T10:00:00.000Z',
      },
      {
        id: 'hl-2',
        documentId: 'doc-1',
        pageIndex: 7,
        selectedText: 'Карта подменяет территорию и становится главным медиатором.',
        note: 'Ключевой тезис',
        tags: ['карта'],
        createdAt: '2026-02-20T12:00:00.000Z',
      },
    ],
    readingLog: {
      '2026-02-20': { pages: 24, seconds: 1800 },
    },
  };
}

describe('ai assistant', () => {
  it('builds local assistant brief with recommendations and metrics', async () => {
    const result = await generateAiAssistantBrief(makeDb(), {
      provider: 'local',
      mode: 'review',
      analysisDepth: 'deep',
      model: 'qwen2.5:7b',
      question: 'Что повторять сначала?',
      documentId: 'doc-1',
    });

    expect(result.provider).toBe('local');
    expect(result.mode).toBe('review');
    expect(result.text).toContain('Executive Summary');
    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.metrics.dueCount).toBeGreaterThanOrEqual(0);
    expect(result.engine?.runtime).toBe('local');
    expect(result.engine?.depth).toBe('deep');
  });
});
