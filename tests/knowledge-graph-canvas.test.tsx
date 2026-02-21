// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  KnowledgeGraphCanvas,
  buildKnowledgeGraphLayout,
} from '../app/renderer/src/app/features/insights/components/KnowledgeGraphCanvas';
import type { KnowledgeGraphResult } from '../app/renderer/src/app/types';

const graph: KnowledgeGraphResult = {
  generatedAt: '2026-02-21T10:00:00.000Z',
  stats: {
    highlights: 3,
    documents: 1,
    concepts: 2,
    edges: 2,
  },
  nodes: [
    { id: 'doc_1', key: 'doc:doc-1', kind: 'document', label: 'Doc', weight: 3, documentId: 'doc-1' },
    { id: 'c_1', key: 'concept:sim', kind: 'concept', label: 'симуляция', weight: 4 },
    { id: 'c_2', key: 'concept:real', kind: 'concept', label: 'реальность', weight: 2 },
  ],
  edges: [
    { id: 'e1', fromId: 'doc_1', toId: 'c_1', kind: 'document-concept', weight: 3 },
    { id: 'e2', fromId: 'doc_1', toId: 'c_2', kind: 'document-concept', weight: 1 },
  ],
  mermaid: 'graph LR',
};

describe('KnowledgeGraphCanvas', () => {
  it('builds deterministic layout for nodes and edges', () => {
    const layout = buildKnowledgeGraphLayout(graph, 800, 420);
    expect(layout.nodes.length).toBe(3);
    expect(layout.edges.length).toBe(2);

    const docNode = layout.nodes.find((item) => item.node.kind === 'document');
    expect(docNode).toBeTruthy();
    expect(Math.round(docNode!.point.x)).toBe(400);
  });

  it('renders svg canvas', () => {
    render(<KnowledgeGraphCanvas graph={graph} width={800} height={420} />);
    expect(screen.getByRole('img', { name: 'Knowledge graph' })).toBeInTheDocument();
  });
});
