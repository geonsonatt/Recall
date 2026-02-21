function normalizeInlineText(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function repairPdfTextArtifacts(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/([\p{L}\p{N}])\u00ad\s*([\p{L}\p{N}])/gu, '$1$2')
    .replace(/\u00ad/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/([\p{L}\p{N}])[-‐‑]\s+([\p{L}\p{N}])/gu, '$1$2')
    .replace(
      /(^|[\s([{«"'])((?:[А-ЯЁ][ \t]){2,}[А-ЯЁ])(?=$|[\s,.;:!?»)\]}\u2026])/gu,
      (_match, prefix, word) => `${prefix}${word.replace(/[ \t]/g, '')}`,
    )
    .replace(/(^|[\s([{«"'])([А-ЯЁA-Z])\s+([А-ЯЁA-Z][А-ЯЁа-яёA-Za-z]{1,})/gu, '$1$2$3')
    .replace(/\s+([,.;:!?»)\]}\u2026])/g, '$1')
    .replace(/([«([{])\s+/g, '$1');
}

function decodeHtmlEntities(value) {
  return String(value ?? '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function richTextToMarkdown(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return '';
  }

  let markdown = raw;
  markdown = markdown.replace(/<br\s*\/?>/gi, '\n');
  markdown = markdown.replace(/<\/p\s*>/gi, '\n\n').replace(/<p[^>]*>/gi, '');
  markdown = markdown.replace(/<\/div\s*>/gi, '\n\n').replace(/<div[^>]*>/gi, '');
  markdown = markdown
    .replace(/<(strong|b)[^>]*>/gi, '**')
    .replace(/<\/(strong|b)\s*>/gi, '**')
    .replace(/<(em|i)[^>]*>/gi, '*')
    .replace(/<\/(em|i)\s*>/gi, '*');
  markdown = markdown
    .replace(/<(u|sup|sub)[^>]*>/gi, '<$1>')
    .replace(/<\/(u|sup|sub)\s*>/gi, '</$1>');
  markdown = markdown.replace(/<(?!\/?(?:u|sup|sub)\b)[^>]+>/gi, '');
  markdown = repairPdfTextArtifacts(decodeHtmlEntities(markdown));
  markdown = markdown
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return markdown;
}

function buildHighlightsMarkdown(documentTitle, highlights) {
  const safeTitle = normalizeInlineText(documentTitle) || 'Без названия';

  const sorted = [...(highlights ?? [])].sort((a, b) => {
    if (a.pageIndex === b.pageIndex) {
      return new Date(a.createdAt).valueOf() - new Date(b.createdAt).valueOf();
    }
    return a.pageIndex - b.pageIndex;
  });

  const lines = [`# ${safeTitle}`, ''];

  for (const highlight of sorted) {
    const richTextMarkdown = richTextToMarkdown(highlight.selectedRichText);
    const plainText = normalizeInlineText(repairPdfTextArtifacts(highlight.selectedText)).replace(
      /"/g,
      '\\"',
    );
    const linesText = richTextMarkdown
      ? richTextMarkdown.split('\n').map((line) => line.trim()).filter(Boolean)
      : [];
    const page = Number(highlight.pageIndex ?? 0) + 1;

    if (linesText.length > 1) {
      lines.push(`- p.${page} —`);
      for (const line of linesText) {
        lines.push(`  ${line}`);
      }
    } else if (linesText.length === 1) {
      lines.push(`- p.${page} — ${linesText[0]}`);
    } else {
      lines.push(`- p.${page} — "${plainText}"`);
    }

    const note = normalizeInlineText(highlight.note);
    if (note) {
      lines.push(`  Заметка: ${note}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

module.exports = {
  buildHighlightsMarkdown,
};
