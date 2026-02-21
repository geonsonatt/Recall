import { useMemo, useState } from 'react';
import type { KnowledgeGraphEdge, KnowledgeGraphNode, KnowledgeGraphResult } from '../../../types';

type Point = { x: number; y: number };

export interface GraphLayoutNode {
  id: string;
  point: Point;
  radius: number;
  node: KnowledgeGraphNode;
}

export interface GraphLayoutEdge {
  id: string;
  from: Point;
  to: Point;
  weight: number;
  edge: KnowledgeGraphEdge;
}

export interface GraphLayoutResult {
  nodes: GraphLayoutNode[];
  edges: GraphLayoutEdge[];
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function nodeRadius(weight: number, kind: KnowledgeGraphNode['kind']) {
  const base = kind === 'document' ? 13 : 9;
  const bonus = clamp(Math.log10(Math.max(1, weight)) * 5.5, 0, 9);
  return base + bonus;
}

function angleAt(index: number, total: number) {
  if (total <= 0) {
    return 0;
  }
  return (Math.PI * 2 * index) / total - Math.PI / 2;
}

function placeRing(
  nodes: KnowledgeGraphNode[],
  center: Point,
  radiusX: number,
  radiusY: number,
): Array<{ node: KnowledgeGraphNode; point: Point; radius: number }> {
  return nodes.map((node, index) => {
    const angle = angleAt(index, nodes.length);
    return {
      node,
      point: {
        x: center.x + Math.cos(angle) * radiusX,
        y: center.y + Math.sin(angle) * radiusY,
      },
      radius: nodeRadius(Number(node.weight || 0), node.kind),
    };
  });
}

export function buildKnowledgeGraphLayout(
  graph: KnowledgeGraphResult,
  width: number,
  height: number,
): GraphLayoutResult {
  const w = Math.max(420, Number(width || 0));
  const h = Math.max(280, Number(height || 0));
  const center = { x: w / 2, y: h / 2 };

  const documentNodes = graph.nodes
    .filter((node) => node.kind === 'document')
    .sort((left, right) => Number(right.weight || 0) - Number(left.weight || 0));
  const conceptNodes = graph.nodes
    .filter((node) => node.kind === 'concept')
    .sort((left, right) => Number(right.weight || 0) - Number(left.weight || 0));

  const placed: Array<{ node: KnowledgeGraphNode; point: Point; radius: number }> = [];

  if (documentNodes.length <= 1) {
    if (documentNodes[0]) {
      placed.push({
        node: documentNodes[0],
        point: center,
        radius: nodeRadius(Number(documentNodes[0].weight || 0), 'document') + 2,
      });
    }

    const conceptRing = placeRing(
      conceptNodes,
      center,
      w * 0.34,
      h * 0.34,
    );
    placed.push(...conceptRing);
  } else {
    const docRing = placeRing(documentNodes, center, w * 0.19, h * 0.2);
    const conceptRing = placeRing(conceptNodes, center, w * 0.39, h * 0.39);
    placed.push(...docRing, ...conceptRing);
  }

  const byId = new Map(placed.map((item) => [item.node.id, item]));

  const nodes: GraphLayoutNode[] = placed.map((item) => ({
    id: item.node.id,
    point: item.point,
    radius: item.radius,
    node: item.node,
  }));

  const edges: GraphLayoutEdge[] = graph.edges
    .map((edge) => {
      const fromNode = byId.get(edge.fromId);
      const toNode = byId.get(edge.toId);
      if (!fromNode || !toNode) {
        return null;
      }
      return {
        id: edge.id,
        from: fromNode.point,
        to: toNode.point,
        weight: Number(edge.weight || 0),
        edge,
      };
    })
    .filter(Boolean) as GraphLayoutEdge[];

  return {
    nodes,
    edges,
  };
}

interface KnowledgeGraphCanvasProps {
  graph: KnowledgeGraphResult;
  width?: number;
  height?: number;
  onOpenDocument?: (documentId: string) => void;
}

export function KnowledgeGraphCanvas({
  graph,
  width = 1040,
  height = 420,
  onOpenDocument,
}: KnowledgeGraphCanvasProps) {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  const layout = useMemo(
    () => buildKnowledgeGraphLayout(graph, width, height),
    [graph, height, width],
  );

  const hoveredNode = layout.nodes.find((node) => node.id === hoveredNodeId) || null;

  return (
    <div className="knowledge-graph-shell">
      <svg
        className="knowledge-graph-canvas"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Knowledge graph"
      >
        <defs>
          <linearGradient id="graph-edge-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#9bb8e6" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#4d7fd8" stopOpacity="0.48" />
          </linearGradient>
        </defs>

        {layout.edges.map((edge) => {
          const strokeWidth = clamp(0.8 + Math.log2(Math.max(1, edge.weight)), 0.8, 4.2);
          return (
            <line
              key={edge.id}
              x1={edge.from.x}
              y1={edge.from.y}
              x2={edge.to.x}
              y2={edge.to.y}
              stroke="url(#graph-edge-gradient)"
              strokeWidth={strokeWidth}
              strokeLinecap="round"
            />
          );
        })}

        {layout.nodes.map((entry) => {
          const isDocument = entry.node.kind === 'document';
          const isHovered = hoveredNodeId === entry.id;
          const fill = isDocument ? '#2d75e5' : '#5f8ddf';
          return (
            <g
              key={entry.id}
              transform={`translate(${entry.point.x}, ${entry.point.y})`}
              onMouseEnter={() => setHoveredNodeId(entry.id)}
              onMouseLeave={() => setHoveredNodeId((current) => (current === entry.id ? null : current))}
              onClick={() => {
                if (isDocument && entry.node.documentId && onOpenDocument) {
                  onOpenDocument(entry.node.documentId);
                }
              }}
              className={`knowledge-graph-node ${isDocument ? 'document' : 'concept'} ${
                isHovered ? 'hovered' : ''
              }`}
            >
              <circle
                r={entry.radius}
                fill={fill}
                fillOpacity={isHovered ? 0.98 : 0.84}
                stroke="#ffffff"
                strokeOpacity={isHovered ? 0.95 : 0.72}
                strokeWidth={isHovered ? 2.4 : 1.2}
              />
              <text
                textAnchor="middle"
                y={entry.radius + 12}
                fontSize={Math.max(10, Math.min(12, 9 + (entry.radius - 8) * 0.3))}
              >
                {String(entry.node.label || '').slice(0, 24)}
              </text>
              <title>
                {entry.node.label} · weight {entry.node.weight}
              </title>
            </g>
          );
        })}
      </svg>

      {hoveredNode ? (
        <div className="knowledge-graph-hover-panel">
          <strong>{hoveredNode.node.label}</strong>
          <span className="muted">{hoveredNode.node.kind === 'document' ? 'Книга' : 'Концепт'} · weight {hoveredNode.node.weight}</span>
        </div>
      ) : null}
    </div>
  );
}
