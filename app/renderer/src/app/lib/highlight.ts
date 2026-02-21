import type { HighlightColor, RectNorm } from '../types';
import { clamp, normalizeSelectionText } from './format';

export const WEBVIEWER_CUSTOM_ID_KEY = 'recallHighlightId';
export const WEBVIEWER_CUSTOM_TEXT_KEY = 'recallSelectedText';
export const WEBVIEWER_CUSTOM_RICH_TEXT_KEY = 'recallSelectedRichText';
export const WEBVIEWER_CUSTOM_COLOR_KEY = 'recallHighlightColor';

type QuadPoint = {
  x: number;
  y: number;
};

function toFiniteNumber(value: any): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toPoint(point: any): QuadPoint | null {
  const x =
    toFiniteNumber(point?.x) ??
    toFiniteNumber(point?.X) ??
    (Array.isArray(point) ? toFiniteNumber(point[0]) : null);
  const y =
    toFiniteNumber(point?.y) ??
    toFiniteNumber(point?.Y) ??
    (Array.isArray(point) ? toFiniteNumber(point[1]) : null);

  if (x === null || y === null) {
    return null;
  }

  return { x, y };
}

function getQuadPoints(rawQuad: any): QuadPoint[] {
  if (!rawQuad) {
    return [];
  }

  if (Array.isArray(rawQuad)) {
    return rawQuad.map(toPoint).filter(Boolean) as QuadPoint[];
  }

  if (typeof rawQuad.getPoints === 'function') {
    try {
      const extracted = rawQuad.getPoints();
      return getQuadPoints(extracted);
    } catch {
      return [];
    }
  }

  const p1 = toPoint(rawQuad?.p1);
  const p2 = toPoint(rawQuad?.p2);
  const p3 = toPoint(rawQuad?.p3);
  const p4 = toPoint(rawQuad?.p4);
  if (p1 && p2 && p3 && p4) {
    return [p1, p2, p3, p4];
  }

  const x1 = toFiniteNumber(rawQuad?.x1 ?? rawQuad?.X1);
  const y1 = toFiniteNumber(rawQuad?.y1 ?? rawQuad?.Y1);
  const x2 = toFiniteNumber(rawQuad?.x2 ?? rawQuad?.X2);
  const y2 = toFiniteNumber(rawQuad?.y2 ?? rawQuad?.Y2);
  const x3 = toFiniteNumber(rawQuad?.x3 ?? rawQuad?.X3);
  const y3 = toFiniteNumber(rawQuad?.y3 ?? rawQuad?.Y3);
  const x4 = toFiniteNumber(rawQuad?.x4 ?? rawQuad?.X4);
  const y4 = toFiniteNumber(rawQuad?.y4 ?? rawQuad?.Y4);

  if (
    x1 === null ||
    y1 === null ||
    x2 === null ||
    y2 === null ||
    x3 === null ||
    y3 === null ||
    x4 === null ||
    y4 === null
  ) {
    return [];
  }

  return [
    { x: x1, y: y1 },
    { x: x2, y: y2 },
    { x: x3, y: y3 },
    { x: x4, y: y4 },
  ];
}

function toByte(value: any): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.max(0, Math.min(255, Math.round(parsed)));
}

function parseHexColor(value: string): { r: number; g: number; b: number } | null {
  const hex = value.trim().toLowerCase();
  const short = /^#([0-9a-f]{3})$/i.exec(hex);
  if (short) {
    const [r, g, b] = short[1].split('');
    return {
      r: parseInt(`${r}${r}`, 16),
      g: parseInt(`${g}${g}`, 16),
      b: parseInt(`${b}${b}`, 16),
    };
  }

  const full = /^#([0-9a-f]{6})$/i.exec(hex);
  if (full) {
    return {
      r: parseInt(full[1].slice(0, 2), 16),
      g: parseInt(full[1].slice(2, 4), 16),
      b: parseInt(full[1].slice(4, 6), 16),
    };
  }

  return null;
}

function parseRgbColor(value: string): { r: number; g: number; b: number } | null {
  const match = /^rgba?\(([^)]+)\)$/i.exec(value.trim());
  if (!match || !match[1]) {
    return null;
  }

  const parts = match[1]
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 3) {
    return null;
  }

  const r = toByte(parts[0]);
  const g = toByte(parts[1]);
  const b = toByte(parts[2]);
  if (r === null || g === null || b === null) {
    return null;
  }

  return { r, g, b };
}

function parseAnyColor(color: any): { r: number; g: number; b: number } | null {
  if (!color) {
    return null;
  }

  if (typeof color === 'string') {
    return parseHexColor(color) || parseRgbColor(color);
  }

  if (Array.isArray(color) && color.length >= 3) {
    const r = toByte(color[0]);
    const g = toByte(color[1]);
    const b = toByte(color[2]);
    if (r === null || g === null || b === null) {
      return null;
    }
    return { r, g, b };
  }

  const r =
    toByte(color?.R) ??
    toByte(color?.r) ??
    toByte(color?.red) ??
    toByte(color?.Red) ??
    (typeof color?.getR === 'function' ? toByte(color.getR()) : null);
  const g =
    toByte(color?.G) ??
    toByte(color?.g) ??
    toByte(color?.green) ??
    toByte(color?.Green) ??
    (typeof color?.getG === 'function' ? toByte(color.getG()) : null);
  const b =
    toByte(color?.B) ??
    toByte(color?.b) ??
    toByte(color?.blue) ??
    toByte(color?.Blue) ??
    (typeof color?.getB === 'function' ? toByte(color.getB()) : null);

  if (r === null || g === null || b === null) {
    return null;
  }
  return { r, g, b };
}

export function highlightToWebViewerColor(color: HighlightColor, Annotations: any) {
  if (color === 'green') {
    return new Annotations.Color(98, 214, 130);
  }

  if (color === 'pink') {
    return new Annotations.Color(241, 130, 176);
  }

  if (color === 'blue') {
    return new Annotations.Color(92, 156, 255);
  }

  if (color === 'orange') {
    return new Annotations.Color(245, 166, 85);
  }

  if (color === 'purple') {
    return new Annotations.Color(173, 125, 255);
  }

  return new Annotations.Color(245, 210, 85);
}

export function webViewerColorToHighlight(color: any): HighlightColor {
  const parsed = parseAnyColor(color) || { r: 245, g: 210, b: 85 };
  const { r, g, b } = parsed;

  const distance = (targetR: number, targetG: number, targetB: number) =>
    Math.abs(r - targetR) + Math.abs(g - targetG) + Math.abs(b - targetB);

  const candidates: Array<{ color: HighlightColor; score: number }> = [
    { color: 'yellow', score: distance(245, 210, 85) },
    { color: 'green', score: distance(98, 214, 130) },
    { color: 'pink', score: distance(241, 130, 176) },
    { color: 'blue', score: distance(92, 156, 255) },
    { color: 'orange', score: distance(245, 166, 85) },
    { color: 'purple', score: distance(173, 125, 255) },
  ];

  candidates.sort((a, b) => a.score - b.score);
  return candidates[0]?.color ?? 'yellow';
}

export function mergeNormalizedRects(rects: RectNorm[]): RectNorm[] {
  const prepared = (rects ?? [])
    .map((rect) => ({
      x: clamp(Number(rect?.x ?? 0), 0, 1),
      y: clamp(Number(rect?.y ?? 0), 0, 1),
      w: clamp(Number(rect?.w ?? 0), 0, 1),
      h: clamp(Number(rect?.h ?? 0), 0, 1),
    }))
    .filter((rect) => rect.w > 0.001 && rect.h > 0.001)
    .sort((a, b) => {
      if (Math.abs(a.y - b.y) > 0.01) {
        return a.y - b.y;
      }
      return a.x - b.x;
    });

  if (prepared.length < 2) {
    return prepared;
  }

  const merged: RectNorm[] = [prepared[0]];
  for (let index = 1; index < prepared.length; index += 1) {
    const current = prepared[index];
    const previous = merged[merged.length - 1];

    const sameLine = Math.abs(previous.y - current.y) <= Math.max(previous.h, current.h) * 0.55;
    const overlapHorizontally = current.x <= previous.x + previous.w + Math.max(previous.h, current.h) * 0.65;

    if (sameLine && overlapHorizontally) {
      const left = Math.min(previous.x, current.x);
      const right = Math.max(previous.x + previous.w, current.x + current.w);
      const top = Math.min(previous.y, current.y);
      const bottom = Math.max(previous.y + previous.h, current.y + current.h);
      previous.x = left;
      previous.y = top;
      previous.w = right - left;
      previous.h = bottom - top;
      continue;
    }

    merged.push(current);
  }

  return merged;
}

export function normalizedRectToWebViewerQuad(rect: RectNorm, pageInfo: any, MathCore: any) {
  const pageWidth = Math.max(1, Number(pageInfo?.width ?? 1));
  const pageHeight = Math.max(1, Number(pageInfo?.height ?? 1));

  const left = clamp(Number(rect?.x ?? 0), 0, 1) * pageWidth;
  const right = clamp(Number(rect?.x ?? 0) + Number(rect?.w ?? 0), 0, 1) * pageWidth;
  const top = pageHeight - clamp(Number(rect?.y ?? 0), 0, 1) * pageHeight;
  const bottom = pageHeight - clamp(Number(rect?.y ?? 0) + Number(rect?.h ?? 0), 0, 1) * pageHeight;

  return new MathCore.Quad(left, bottom, right, bottom, right, top, left, top);
}

export function webViewerQuadToNormalizedRect(quad: any, pageInfo: any): RectNorm | null {
  const pageWidth = Math.max(1, Number(pageInfo?.width ?? 1));
  const pageHeight = Math.max(1, Number(pageInfo?.height ?? 1));

  const points = getQuadPoints(quad);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);

  if (xs.length === 0 || ys.length === 0) {
    return null;
  }

  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const lower = Math.min(...ys);
  const upper = Math.max(...ys);

  const x = clamp(left / pageWidth, 0, 1);
  const y = clamp((pageHeight - upper) / pageHeight, 0, 1);
  const w = clamp((right - left) / pageWidth, 0, 1);
  const h = clamp((upper - lower) / pageHeight, 0, 1);

  if (w <= 0.001 || h <= 0.001) {
    return null;
  }

  return { x, y, w, h };
}

export function buildQuadSignature(quads: any[]): string {
  return (quads ?? [])
    .map((quad) => {
      const points = getQuadPoints(quad);
      if (points.length === 0) {
        return '';
      }
      const values = points
        .slice(0, 4)
        .flatMap((point) => [point.x, point.y])
        .map((value) => value.toFixed(4));
      return values.join(':');
    })
    .filter(Boolean)
    .join('|');
}

export function isWebViewerHighlightAnnotation(annotation: any, Annotations: any): boolean {
  const Highlight = Annotations?.TextHighlightAnnotation;
  return Boolean(Highlight && annotation instanceof Highlight);
}

export function selectionObjectToPlainText(selection: Selection | null | undefined): string {
  if (!selection) {
    return '';
  }
  return normalizeSelectionText(selection.toString() || '');
}
