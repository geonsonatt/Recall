const { PDFDocument, rgb } = require('pdf-lib');

const COLOR_MAP = {
  yellow: rgb(0.98, 0.9, 0.2),
  green: rgb(0.48, 0.86, 0.45),
  pink: rgb(0.98, 0.52, 0.75),
  blue: rgb(0.42, 0.64, 0.98),
  orange: rgb(0.96, 0.66, 0.28),
  purple: rgb(0.68, 0.54, 0.98),
};

function clamp01(number) {
  if (Number.isNaN(number) || !Number.isFinite(number)) {
    return 0;
  }
  return Math.min(1, Math.max(0, number));
}

function toPdfRect(normalizedRect, pageWidth, pageHeight) {
  const xNorm = clamp01(Number(normalizedRect?.x ?? 0));
  const yNorm = clamp01(Number(normalizedRect?.y ?? 0));
  const wNorm = clamp01(Number(normalizedRect?.w ?? 0));
  const hNorm = clamp01(Number(normalizedRect?.h ?? 0));

  const x = xNorm * pageWidth;
  const y = pageHeight - (yNorm + hNorm) * pageHeight;
  const width = wNorm * pageWidth;
  const height = hNorm * pageHeight;

  return {
    x,
    y,
    width,
    height,
  };
}

async function buildAnnotatedPdf(sourcePdfBytes, highlights) {
  const pdfDocument = await PDFDocument.load(sourcePdfBytes);
  const pages = pdfDocument.getPages();

  for (const highlight of highlights ?? []) {
    const page = pages[Number(highlight.pageIndex ?? -1)];
    if (!page) {
      continue;
    }

    const { width: pageWidth, height: pageHeight } = page.getSize();
    const color = COLOR_MAP[highlight.color] ?? COLOR_MAP.yellow;

    for (const rect of highlight.rects ?? []) {
      const converted = toPdfRect(rect, pageWidth, pageHeight);
      if (converted.width <= 0 || converted.height <= 0) {
        continue;
      }

      page.drawRectangle({
        x: converted.x,
        y: converted.y,
        width: converted.width,
        height: converted.height,
        color,
        opacity: 0.34,
        borderWidth: 0,
      });
    }
  }

  return pdfDocument.save();
}

module.exports = {
  buildAnnotatedPdf,
};
