import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import annotatedPdfModule from '../app/export/annotatedPdf.js';

const { buildAnnotatedPdf } = annotatedPdfModule;

async function createSourcePdf() {
  const pdf = await PDFDocument.create();
  pdf.addPage([200, 300]);
  return pdf.save();
}

describe('buildAnnotatedPdf', () => {
  it('creates a valid annotated PDF with flattened highlight rectangles', async () => {
    const sourcePdfBytes = await createSourcePdf();

    const annotated = await buildAnnotatedPdf(sourcePdfBytes, [
      {
        pageIndex: 0,
        color: 'pink',
        rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.12 }],
      },
    ]);

    expect(annotated).toBeInstanceOf(Uint8Array);
    expect(annotated.length).toBeGreaterThan(sourcePdfBytes.length);

    const parsed = await PDFDocument.load(annotated);
    expect(parsed.getPageCount()).toBe(1);
    const page = parsed.getPage(0);
    expect(page.getSize()).toEqual({ width: 200, height: 300 });
  });

  it('ignores invalid pages/rectangles and still returns a valid PDF', async () => {
    const sourcePdfBytes = await createSourcePdf();

    const annotated = await buildAnnotatedPdf(sourcePdfBytes, [
      {
        pageIndex: 999,
        color: 'yellow',
        rects: [{ x: 0.2, y: 0.2, w: 0.2, h: 0.2 }],
      },
      {
        pageIndex: 0,
        color: 'unknown-color',
        rects: [
          { x: -1, y: -1, w: 0, h: 0 },
          { x: 0.9, y: 0.9, w: 0.3, h: 0.3 },
        ],
      },
    ]);

    const parsed = await PDFDocument.load(annotated);
    expect(parsed.getPageCount()).toBe(1);
  });
});
