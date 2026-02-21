import { describe, expect, it } from 'vitest';
import {
  buildQuadSignature,
  highlightToWebViewerColor,
  isWebViewerHighlightAnnotation,
  mergeNormalizedRects,
  normalizedRectToWebViewerQuad,
  selectionObjectToPlainText,
  webViewerColorToHighlight,
  webViewerQuadToNormalizedRect,
} from '../app/renderer/src/app/lib/highlight';

class QuadStub {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  x3: number;
  y3: number;
  x4: number;
  y4: number;

  constructor(x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, x4: number, y4: number) {
    this.x1 = x1;
    this.y1 = y1;
    this.x2 = x2;
    this.y2 = y2;
    this.x3 = x3;
    this.y3 = y3;
    this.x4 = x4;
    this.y4 = y4;
  }
}

describe('highlight helpers', () => {
  it('merges neighboring rects on the same text line', () => {
    const merged = mergeNormalizedRects([
      { x: 0.1, y: 0.1, w: 0.2, h: 0.04 },
      { x: 0.31, y: 0.102, w: 0.18, h: 0.04 },
      { x: 0.1, y: 0.3, w: 0.1, h: 0.04 },
    ]);

    expect(merged).toHaveLength(2);
    expect(merged[0].x).toBeCloseTo(0.1, 4);
    expect(merged[0].w).toBeGreaterThan(0.35);
  });

  it('converts rect -> quad -> rect with minimal drift', () => {
    const pageInfo = { width: 1200, height: 1800 };
    const sourceRect = { x: 0.2, y: 0.35, w: 0.15, h: 0.07 };

    const quad = normalizedRectToWebViewerQuad(sourceRect, pageInfo, { Quad: QuadStub as any });
    const backRect = webViewerQuadToNormalizedRect(quad, pageInfo);

    expect(backRect).not.toBeNull();
    expect(backRect!.x).toBeCloseTo(sourceRect.x, 4);
    expect(backRect!.y).toBeCloseTo(sourceRect.y, 4);
    expect(backRect!.w).toBeCloseTo(sourceRect.w, 4);
    expect(backRect!.h).toBeCloseTo(sourceRect.h, 4);
  });

  it('maps colors and annotation type checks correctly', () => {
    const Annotations = {
      Color: class {
        R: number;
        G: number;
        B: number;
        A: number;

        constructor(R: number, G: number, B: number, A: number) {
          this.R = R;
          this.G = G;
          this.B = B;
          this.A = A;
        }
      },
      TextHighlightAnnotation: class {},
    };

    const color = highlightToWebViewerColor('green', Annotations);
    expect(color).toMatchObject({ R: 98, G: 214, B: 130 });
    expect(highlightToWebViewerColor('blue', Annotations)).toMatchObject({ R: 92, G: 156, B: 255 });
    expect(highlightToWebViewerColor('orange', Annotations)).toMatchObject({ R: 245, G: 166, B: 85 });
    expect(highlightToWebViewerColor('purple', Annotations)).toMatchObject({ R: 173, G: 125, B: 255 });

    expect(webViewerColorToHighlight({ R: 97, G: 210, B: 129 })).toBe('green');
    expect(webViewerColorToHighlight({ r: 97, g: 210, b: 129 })).toBe('green');
    expect(webViewerColorToHighlight([97, 210, 129])).toBe('green');
    expect(webViewerColorToHighlight('#61d281')).toBe('green');
    expect(webViewerColorToHighlight('rgb(97, 210, 129)')).toBe('green');
    expect(webViewerColorToHighlight({ R: 240, G: 130, B: 176 })).toBe('pink');
    expect(webViewerColorToHighlight({ R: 94, G: 160, B: 252 })).toBe('blue');
    expect(webViewerColorToHighlight({ R: 240, G: 164, B: 90 })).toBe('orange');
    expect(webViewerColorToHighlight({ R: 170, G: 126, B: 248 })).toBe('purple');

    const annotation = new Annotations.TextHighlightAnnotation();
    expect(isWebViewerHighlightAnnotation(annotation, Annotations)).toBe(true);
    expect(isWebViewerHighlightAnnotation({}, Annotations)).toBe(false);
  });

  it('builds quad signatures and normalizes selected text output', () => {
    const signature = buildQuadSignature([
      { x1: 1, y1: 2, x2: 3, y2: 4, x3: 5, y3: 6, x4: 7, y4: 8 },
    ]);
    expect(signature).toContain('1.0000:2.0000:3.0000:4.0000');

    const normalized = selectionObjectToPlainText({
      toString() {
        return '  A\u200b  B\n\nC   '; 
      },
    } as any);

    expect(normalized).toBe('A B\n\nC');
  });

  it('supports alternative quad formats (p1..p4 and getPoints)', () => {
    const pageInfo = { width: 200, height: 100 };
    const fromPoints = webViewerQuadToNormalizedRect(
      {
        p1: { x: 20, y: 90 },
        p2: { x: 120, y: 90 },
        p3: { x: 120, y: 80 },
        p4: { x: 20, y: 80 },
      },
      pageInfo,
    );
    expect(fromPoints).toEqual({
      x: 0.1,
      y: 0.1,
      w: 0.5,
      h: 0.1,
    });

    const signature = buildQuadSignature([
      {
        getPoints() {
          return [
            { x: 1, y: 2 },
            { x: 3, y: 4 },
            { x: 5, y: 6 },
            { x: 7, y: 8 },
          ];
        },
      },
    ]);
    expect(signature).toContain('1.0000:2.0000:3.0000:4.0000:5.0000:6.0000:7.0000:8.0000');
  });
});
