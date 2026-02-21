// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InsightsView } from '../app/renderer/src/app/features/insights/InsightsView';

const apiMocks = vi.hoisted(() => ({
  generateSrsDeck: vi.fn(),
  buildReadingDigest: vi.fn(),
  buildKnowledgeGraph: vi.fn(),
  generateAiAssistantBrief: vi.fn(),
  askLibrary: vi.fn(),
  summarizeHighlights: vi.fn(),
}));

vi.mock('../app/renderer/src/app/api', () => apiMocks);

describe('InsightsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.generateSrsDeck.mockResolvedValue({
      generatedAt: '2026-02-21T10:00:00.000Z',
      dueOnly: true,
      totalCandidates: 1,
      dueCount: 1,
      newCount: 1,
      deckName: 'SRS',
      cards: [
        {
          id: 'card-hl-1',
          highlightId: 'hl-1',
          documentId: 'doc-1',
          documentTitle: 'Симулякры',
          page: 7,
          front: 'Q',
          back: 'A',
          tags: ['x'],
          createdAt: '2026-02-21T10:00:00.000Z',
        },
      ],
      markdown: '# SRS',
      ankiTsv: 'q\ta',
    });
    apiMocks.buildReadingDigest.mockResolvedValue({
      generatedAt: '2026-02-21T10:00:00.000Z',
      period: 'daily',
      range: { start: '', end: '', label: '2026-02-21' },
      stats: { pages: 10, seconds: 600, highlights: 1, activeDocuments: 1 },
      topDocuments: [],
      topTags: [],
      inbox: [],
      markdown: '# Daily Digest',
    });
    apiMocks.buildKnowledgeGraph.mockResolvedValue({
      generatedAt: '2026-02-21T10:00:00.000Z',
      stats: { highlights: 1, documents: 1, concepts: 1, edges: 1 },
      nodes: [],
      edges: [],
      mermaid: 'graph LR',
    });
    apiMocks.askLibrary.mockResolvedValue({
      generatedAt: '2026-02-21T10:00:00.000Z',
      query: 'q',
      answer: 'answer',
      citations: [],
      confidence: 0.5,
    });
    apiMocks.generateAiAssistantBrief.mockResolvedValue({
      generatedAt: '2026-02-21T10:00:00.000Z',
      mode: 'research',
      provider: 'local',
      text: 'AI answer',
      recommendations: ['do 1'],
      metrics: { dueCount: 1, digestPages: 10, digestHighlights: 1, summaryHighlights: 1 },
      topConcepts: [],
    });
    apiMocks.summarizeHighlights.mockResolvedValue({
      generatedAt: '2026-02-21T10:00:00.000Z',
      documentId: 'doc-1',
      documentTitle: 'Doc',
      usedHighlightsCount: 1,
      keyPoints: [],
      summary: '1. summary',
      sourceHighlightIds: ['hl-1'],
    });
  });

  it('renders SRS card and applies review grade', async () => {
    const onNotify = vi.fn();
    const onOpenReaderHighlight = vi.fn();
    const onReviewSrsCard = vi.fn().mockResolvedValue({ id: 'hl-1', documentId: 'doc-1' });

    render(
      <InsightsView
        workspacePreset="research"
        documents={[
          {
            id: 'doc-1',
            title: 'Симулякры',
            filePath: '/tmp/doc.pdf',
            createdAt: '2026-02-20T10:00:00.000Z',
            highlightsCount: 1,
          },
        ]}
        activeDocumentId="doc-1"
        onNotify={onNotify}
        onOpenReaderHighlight={onOpenReaderHighlight}
        onReviewSrsCard={onReviewSrsCard}
      />,
    );

    await waitFor(() => {
      expect(apiMocks.generateSrsDeck).toHaveBeenCalled();
    });

    expect(screen.getByText('SRS Review')).toBeInTheDocument();
    expect(screen.getByText('Q')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Показать ответ' }));
    expect(screen.getByText('A')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Good' }));
    await waitFor(() => {
      expect(onReviewSrsCard).toHaveBeenCalledWith('hl-1', 'good');
    });
  });
});
