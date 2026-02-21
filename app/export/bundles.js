const fs = require('node:fs/promises');
const path = require('node:path');

function normalizeInlineText(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeMultilineText(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sanitizePathSegment(value) {
  return String(value ?? '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function toSlug(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function quoteCsv(value) {
  const text = String(value ?? '').replace(/\r\n?/g, '\n');
  if (!/[",\n]/.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, '""')}"`;
}

function renderHighlightLine(highlight) {
  const page = Number(highlight.pageIndex ?? 0) + 1;
  const text = normalizeInlineText(highlight.selectedText || '').replace(/\"/g, "'");
  const note = normalizeInlineText(highlight.note || '');
  const tags = Array.isArray(highlight.tags) && highlight.tags.length > 0
    ? highlight.tags.map((tag) => `#${toSlug(tag) || tag}`).join(' ')
    : '';
  const lines = [`- [стр. ${page}] ${text}`];
  if (note) {
    lines.push(`  - note:: ${note}`);
  }
  if (tags) {
    lines.push(`  - tags:: ${tags}`);
  }
  lines.push(`  - highlightId:: ${highlight.id}`);
  lines.push(`  ^hl-${highlight.id.slice(0, 16)}`);
  return lines.join('\n');
}

function sortHighlights(highlights) {
  return [...highlights].sort((left, right) => {
    if (left.pageIndex === right.pageIndex) {
      return new Date(left.createdAt || 0).valueOf() - new Date(right.createdAt || 0).valueOf();
    }
    return Number(left.pageIndex || 0) - Number(right.pageIndex || 0);
  });
}

function buildDocumentMarkdown(document, highlights) {
  const safeTitle = normalizeInlineText(document.title) || `document-${document.id}`;
  const sorted = sortHighlights(highlights);
  const lines = [
    '---',
    'type: book',
    `documentId: ${document.id}`,
    `highlightsCount: ${sorted.length}`,
    '---',
    '',
    `# ${safeTitle}`,
    '',
    '## Highlights',
  ];

  if (sorted.length === 0) {
    lines.push('- Пока нет выделений.');
  } else {
    for (const highlight of sorted) {
      lines.push(renderHighlightLine(highlight));
      lines.push('');
    }
  }

  return `${lines.join('\n').trim()}\n`;
}

function buildHighlightsCsv(documents, highlights) {
  const documentMap = new Map(documents.map((document) => [document.id, document]));
  const header = [
    'HighlightId',
    'DocumentId',
    'DocumentTitle',
    'Page',
    'Text',
    'Note',
    'Tags',
    'CreatedAt',
  ];

  const rows = [header.join(',')];
  for (const highlight of sortHighlights(highlights)) {
    const document = documentMap.get(String(highlight.documentId));
    const values = [
      highlight.id,
      highlight.documentId,
      normalizeInlineText(document?.title || highlight.documentId),
      String(Number(highlight.pageIndex ?? 0) + 1),
      normalizeMultilineText(highlight.selectedText || ''),
      normalizeMultilineText(highlight.note || ''),
      Array.isArray(highlight.tags) ? highlight.tags.join('|') : '',
      String(highlight.createdAt || ''),
    ];
    rows.push(values.map(quoteCsv).join(','));
  }

  return `${rows.join('\n')}\n`;
}

function buildObsidianBundleFiles({
  documents,
  highlights,
  srsDeck,
  dailyDigest,
  weeklyDigest,
  graph,
}) {
  const files = [];
  const highlightsByDocument = new Map();
  for (const highlight of highlights) {
    const documentId = String(highlight.documentId);
    if (!highlightsByDocument.has(documentId)) {
      highlightsByDocument.set(documentId, []);
    }
    highlightsByDocument.get(documentId).push(highlight);
  }

  const readme = [
    '# Recall Obsidian Bundle',
    '',
    '- Папка `Books/` содержит заметки по книгам.',
    '- Папка `SRS/` содержит карточки для интервального повторения.',
    '- Папка `Insights/` содержит digest и граф знаний.',
    '',
  ].join('\n');

  files.push({
    relativePath: 'README.md',
    content: readme,
  });

  for (const document of documents) {
    const safeName = sanitizePathSegment(document.title) || `document-${document.id.slice(0, 8)}`;
    files.push({
      relativePath: `Books/${safeName}.md`,
      content: buildDocumentMarkdown(document, highlightsByDocument.get(document.id) || []),
    });
  }

  files.push({
    relativePath: 'SRS/anki_cards.tsv',
    content: String(srsDeck?.ankiTsv || ''),
  });
  files.push({
    relativePath: 'SRS/cards.md',
    content: String(srsDeck?.markdown || '# SRS\n\nНет карточек.\n'),
  });

  files.push({
    relativePath: 'Insights/daily-digest.md',
    content: String(dailyDigest?.markdown || '# Daily Digest\n\nНет данных.\n'),
  });
  files.push({
    relativePath: 'Insights/weekly-digest.md',
    content: String(weeklyDigest?.markdown || '# Weekly Digest\n\nНет данных.\n'),
  });
  files.push({
    relativePath: 'Insights/knowledge-graph.mmd',
    content: String(graph?.mermaid || 'graph LR\n'),
  });

  files.push({
    relativePath: 'Data/highlights.csv',
    content: buildHighlightsCsv(documents, highlights),
  });

  return files;
}

function buildNotionBundleFiles({
  documents,
  highlights,
  srsDeck,
  dailyDigest,
  weeklyDigest,
  graph,
}) {
  const files = [];
  const readme = [
    '# Recall Notion Bundle',
    '',
    '- Импортируйте `notion/highlights.csv` как базу данных Notion.',
    '- В `notion/books/` лежат markdown-заметки по книгам.',
    '- В `notion/insights/` лежат digest, knowledge graph и SRS.',
    '',
  ].join('\n');

  files.push({ relativePath: 'README.md', content: readme });
  files.push({
    relativePath: 'notion/highlights.csv',
    content: buildHighlightsCsv(documents, highlights),
  });

  const highlightsByDocument = new Map();
  for (const highlight of highlights) {
    const documentId = String(highlight.documentId);
    if (!highlightsByDocument.has(documentId)) {
      highlightsByDocument.set(documentId, []);
    }
    highlightsByDocument.get(documentId).push(highlight);
  }

  for (const document of documents) {
    const safeName = sanitizePathSegment(document.title) || `document-${document.id.slice(0, 8)}`;
    files.push({
      relativePath: `notion/books/${safeName}.md`,
      content: buildDocumentMarkdown(document, highlightsByDocument.get(document.id) || []),
    });
  }

  files.push({
    relativePath: 'notion/insights/daily-digest.md',
    content: String(dailyDigest?.markdown || '# Daily Digest\n\nНет данных.\n'),
  });
  files.push({
    relativePath: 'notion/insights/weekly-digest.md',
    content: String(weeklyDigest?.markdown || '# Weekly Digest\n\nНет данных.\n'),
  });
  files.push({
    relativePath: 'notion/insights/knowledge-graph.mmd',
    content: String(graph?.mermaid || 'graph LR\n'),
  });
  files.push({
    relativePath: 'notion/insights/srs-cards.tsv',
    content: String(srsDeck?.ankiTsv || ''),
  });

  return files;
}

async function writeBundleFiles(targetRootDir, bundleName, files) {
  const safeBundleName = sanitizePathSegment(bundleName) || `bundle-${Date.now()}`;
  const bundlePath = path.join(targetRootDir, safeBundleName);
  await fs.mkdir(bundlePath, { recursive: true });

  let written = 0;
  for (const file of files) {
    const relativePath = normalizeInlineText(file?.relativePath).replace(/\\/g, '/');
    if (!relativePath) {
      continue;
    }

    const absolutePath = path.join(bundlePath, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, String(file?.content || ''), 'utf8');
    written += 1;
  }

  return {
    bundlePath,
    fileCount: written,
  };
}

module.exports = {
  buildObsidianBundleFiles,
  buildNotionBundleFiles,
  writeBundleFiles,
};
