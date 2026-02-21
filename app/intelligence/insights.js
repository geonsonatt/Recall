const STOP_WORDS = new Set([
  'и',
  'в',
  'во',
  'на',
  'по',
  'для',
  'как',
  'что',
  'это',
  'или',
  'но',
  'не',
  'ни',
  'от',
  'до',
  'из',
  'к',
  'у',
  'о',
  'об',
  'а',
  'the',
  'and',
  'for',
  'from',
  'that',
  'this',
  'with',
  'into',
  'onto',
  'are',
  'was',
  'were',
  'been',
  'have',
  'has',
  'had',
  'will',
  'would',
  'could',
  'should',
  'can',
  'about',
  'than',
  'then',
  'they',
  'them',
  'their',
  'you',
  'your',
  'our',
  'its',
]);

function normalizeInlineText(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeMultilineText(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v]+/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripHtml(value) {
  return String(value ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<\/div\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function cleanHighlightText(highlight) {
  const rich = normalizeMultilineText(stripHtml(highlight?.selectedRichText || ''));
  const selected = normalizeMultilineText(highlight?.selectedText || '');
  return selected || rich;
}

function truncateText(value, max = 180) {
  const normalized = normalizeInlineText(value);
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function clampInt(value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return Math.min(max, Math.max(min, Math.trunc(fallback || 0)));
  }
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function tokenize(value) {
  const tokens = String(value ?? '')
    .toLowerCase()
    .match(/[\p{L}\p{N}]{2,}/gu);

  if (!tokens) {
    return [];
  }

  return tokens.filter((token) => !STOP_WORDS.has(token));
}

function tokenizeSet(value) {
  return new Set(tokenize(value));
}

function toIsoOrNull(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return null;
  }

  const date = new Date(raw);
  if (Number.isNaN(date.valueOf())) {
    return null;
  }
  return date.toISOString();
}

function createDocumentMap(db) {
  const map = new Map();
  for (const document of Array.isArray(db?.documents) ? db.documents : []) {
    map.set(String(document.id), document);
  }
  return map;
}

function buildHighlightFilter(options = {}) {
  const documentId = normalizeInlineText(options.documentId);
  const documentIds = Array.isArray(options.documentIds)
    ? new Set(options.documentIds.map((id) => String(id)).filter(Boolean))
    : null;
  const highlightIds = Array.isArray(options.highlightIds)
    ? new Set(options.highlightIds.map((id) => String(id)).filter(Boolean))
    : null;
  const pageStart = clampInt(options.pageStart, 1, 1);
  const pageEnd = clampInt(options.pageEnd, Number.MAX_SAFE_INTEGER, 1);
  const hasPageWindow =
    Number.isFinite(Number(options.pageStart)) || Number.isFinite(Number(options.pageEnd));

  return (highlight) => {
    if (documentId && String(highlight.documentId) !== documentId) {
      return false;
    }

    if (documentIds && !documentIds.has(String(highlight.documentId))) {
      return false;
    }

    if (highlightIds && !highlightIds.has(String(highlight.id))) {
      return false;
    }

    if (hasPageWindow) {
      const pageNumber = clampInt(highlight.pageIndex, 0, 0) + 1;
      if (pageNumber < pageStart || pageNumber > pageEnd) {
        return false;
      }
    }

    return true;
  };
}

function filterHighlights(db, options = {}) {
  const highlights = Array.isArray(db?.highlights) ? db.highlights : [];
  const isAllowed = buildHighlightFilter(options);
  return highlights.filter(isAllowed);
}

function pickClozeToken(text) {
  const candidates = [...new Set(tokenize(text))]
    .filter((token) => token.length >= 5)
    .sort((left, right) => right.length - left.length);

  return candidates[0] || '';
}

function buildCloze(text) {
  const normalized = normalizeInlineText(text);
  if (!normalized) {
    return {
      front: 'Сформулируйте ключевую мысль из выделения.',
      back: '',
      clozeToken: '',
    };
  }

  const clozeToken = pickClozeToken(normalized);
  if (!clozeToken) {
    return {
      front: `Что означает тезис: "${truncateText(normalized, 220)}"?`,
      back: normalized,
      clozeToken: '',
    };
  }

  const haystack = normalized.toLowerCase();
  const needle = clozeToken.toLowerCase();
  const index = haystack.indexOf(needle);

  if (index < 0) {
    return {
      front: `Что означает тезис: "${truncateText(normalized, 220)}"?`,
      back: normalized,
      clozeToken: '',
    };
  }

  const masked = `${normalized.slice(0, index)}_____${normalized.slice(index + clozeToken.length)}`;
  return {
    front: `Заполните пропуск: ${truncateText(masked, 240)}`,
    back: normalized,
    clozeToken,
  };
}

function toTagSlug(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

function isDueForReview(highlight, nowTs) {
  const next = toIsoOrNull(highlight?.nextReviewAt);
  if (!next) {
    return true;
  }
  return new Date(next).valueOf() <= nowTs;
}

function buildSrsCardsMarkdown(deckName, cards) {
  const lines = [`# ${deckName}`, ''];
  for (const card of cards) {
    lines.push(`## ${card.documentTitle} · стр. ${card.page}`);
    lines.push(`**Q:** ${card.front}`);
    lines.push('');
    lines.push(`**A:** ${card.back}`);
    if (card.note) {
      lines.push('');
      lines.push(`_Заметка_: ${card.note}`);
    }
    lines.push('');
  }
  return lines.join('\n').trim();
}

function buildSrsCardsTsv(cards) {
  return cards
    .map((card) => {
      const front = String(card.front || '').replace(/[\t\n\r]+/g, ' ').trim();
      const back = String(card.back || '').replace(/[\t\n\r]+/g, ' ').trim();
      const tags = Array.isArray(card.tags) ? card.tags.join(' ') : '';
      return `${front}\t${back}\t${tags}`;
    })
    .join('\n');
}

function generateSrsDeck(db, options = {}) {
  const nowIso = toIsoOrNull(options.nowIso) || new Date().toISOString();
  const nowTs = new Date(nowIso).valueOf();
  const dueOnly = options.dueOnly !== false;
  const limit = clampInt(options.limit, 120, 1, 1000);
  const documentMap = createDocumentMap(db);

  const candidates = filterHighlights(db, options).filter((highlight) => {
    const text = cleanHighlightText(highlight);
    if (!text) {
      return false;
    }
    if (!dueOnly) {
      return true;
    }
    return isDueForReview(highlight, nowTs);
  });

  const sorted = [...candidates].sort((left, right) => {
    const leftDue = isDueForReview(left, nowTs) ? 0 : 1;
    const rightDue = isDueForReview(right, nowTs) ? 0 : 1;
    if (leftDue !== rightDue) {
      return leftDue - rightDue;
    }

    const leftReviewCount = clampInt(left.reviewCount, 0);
    const rightReviewCount = clampInt(right.reviewCount, 0);
    if (leftReviewCount !== rightReviewCount) {
      return leftReviewCount - rightReviewCount;
    }

    const leftCreated = new Date(left.createdAt || 0).valueOf();
    const rightCreated = new Date(right.createdAt || 0).valueOf();
    return leftCreated - rightCreated;
  });

  const cards = sorted.slice(0, limit).map((highlight) => {
    const document = documentMap.get(String(highlight.documentId));
    const documentTitle = normalizeInlineText(document?.title) || String(highlight.documentId);
    const sourceText = cleanHighlightText(highlight);
    const cloze = buildCloze(sourceText);
    const note = normalizeInlineText(highlight.note || '');
    const page = clampInt(highlight.pageIndex, 0) + 1;
    const tags = [
      ...new Set(
        [
          ...(Array.isArray(highlight.tags) ? highlight.tags : []),
          `doc/${toTagSlug(documentTitle).slice(0, 64) || 'untitled'}`,
          'srs/recall',
        ]
          .map((item) => normalizeInlineText(item))
          .filter(Boolean),
      ),
    ];

    return {
      id: `card-${highlight.id}`,
      highlightId: String(highlight.id),
      documentId: String(highlight.documentId),
      documentTitle,
      page,
      front: cloze.front,
      back: cloze.back,
      clozeToken: cloze.clozeToken,
      note,
      tags,
      reviewCount: clampInt(highlight.reviewCount, 0),
      reviewIntervalDays: clampInt(highlight.reviewIntervalDays, 0),
      lastReviewedAt: toIsoOrNull(highlight.lastReviewedAt),
      nextReviewAt: toIsoOrNull(highlight.nextReviewAt),
      createdAt: toIsoOrNull(highlight.createdAt) || nowIso,
    };
  });

  const uniqueDocumentTitles = new Set(cards.map((card) => card.documentTitle));
  const deckName =
    uniqueDocumentTitles.size === 1
      ? `SRS · ${[...uniqueDocumentTitles][0]}`
      : `SRS · Recall Library · ${nowIso.slice(0, 10)}`;

  const dueCount = candidates.filter((highlight) => isDueForReview(highlight, nowTs)).length;
  const newCount = candidates.filter((highlight) => !toIsoOrNull(highlight.nextReviewAt)).length;

  return {
    generatedAt: nowIso,
    dueOnly,
    totalCandidates: candidates.length,
    dueCount,
    newCount,
    deckName,
    cards,
    markdown: buildSrsCardsMarkdown(deckName, cards),
    ankiTsv: buildSrsCardsTsv(cards),
  };
}

function applySrsReviewGrade(highlight, options = {}) {
  const gradeRaw = String(options.grade || '').trim().toLowerCase();
  const grade =
    gradeRaw === 'hard' || gradeRaw === 'good' || gradeRaw === 'easy' ? gradeRaw : 'good';
  const nowIso = toIsoOrNull(options.nowIso) || new Date().toISOString();

  const previousInterval = clampInt(highlight?.reviewIntervalDays, 0, 0, 3650);
  const previousCount = clampInt(highlight?.reviewCount, 0, 0, 100000);
  const reviewCount = previousCount + 1;

  let nextInterval = 0;
  if (grade === 'hard') {
    nextInterval = previousInterval > 0 ? Math.ceil(previousInterval * 1.2) : 1;
    nextInterval = Math.max(1, Math.min(3650, nextInterval));
  } else if (grade === 'easy') {
    nextInterval = previousInterval > 0 ? Math.ceil(previousInterval * 3.5) : 6;
    nextInterval = Math.max(4, Math.min(3650, nextInterval));
  } else {
    nextInterval = previousInterval > 0 ? Math.ceil(previousInterval * 2.2) : 3;
    nextInterval = Math.max(2, Math.min(3650, nextInterval));
  }

  const nextDate = new Date(nowIso);
  nextDate.setUTCDate(nextDate.getUTCDate() + nextInterval);

  return {
    reviewCount,
    reviewIntervalDays: nextInterval,
    lastReviewedAt: nowIso,
    nextReviewAt: nextDate.toISOString(),
    reviewLastGrade: grade,
  };
}

function floorUtcDay(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.valueOf())) {
    return floorUtcDay();
  }
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function buildPeriodRange(periodRaw, anchorDateIso) {
  const period = String(periodRaw || 'daily').toLowerCase() === 'weekly' ? 'weekly' : 'daily';
  const anchor = floorUtcDay(anchorDateIso);
  const start = new Date(anchor);

  if (period === 'weekly') {
    const day = start.getUTCDay();
    const mondayOffset = (day + 6) % 7;
    start.setUTCDate(start.getUTCDate() - mondayOffset);
  }

  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + (period === 'weekly' ? 7 : 1));

  return {
    period,
    start,
    end,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    label:
      period === 'weekly'
        ? `${start.toISOString().slice(0, 10)} — ${new Date(end.getTime() - 1).toISOString().slice(0, 10)}`
        : start.toISOString().slice(0, 10),
  };
}

function inUtcRange(iso, start, end) {
  const normalized = toIsoOrNull(iso);
  if (!normalized) {
    return false;
  }
  const ts = new Date(normalized).valueOf();
  return ts >= start.valueOf() && ts < end.valueOf();
}

function toDayKeyUtc(date) {
  return date.toISOString().slice(0, 10);
}

function topEntriesFromMap(map, limit) {
  return [...map.entries()]
    .sort((left, right) => {
      if (right[1] === left[1]) {
        return String(left[0]).localeCompare(String(right[0]), 'ru');
      }
      return right[1] - left[1];
    })
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

function buildReadingDigest(db, options = {}) {
  const range = buildPeriodRange(options.period, options.anchorDate);
  const documentMap = createDocumentMap(db);
  const highlights = filterHighlights(db, {
    documentIds: Array.isArray(options.documentIds) ? options.documentIds : undefined,
  }).filter((highlight) => inUtcRange(highlight.createdAt, range.start, range.end));

  const readingLog = db?.readingLog && typeof db.readingLog === 'object' ? db.readingLog : {};
  const startKey = toDayKeyUtc(range.start);
  const endKey = toDayKeyUtc(range.end);

  let totalPages = 0;
  let totalSeconds = 0;
  for (const [key, item] of Object.entries(readingLog)) {
    if (String(key) >= startKey && String(key) < endKey) {
      totalPages += clampInt(item?.pages, 0);
      totalSeconds += clampInt(item?.seconds, 0);
    }
  }

  const highlightsByDocument = new Map();
  const tagsMap = new Map();
  const inboxCandidates = [];

  for (const highlight of highlights) {
    const docTitle =
      normalizeInlineText(documentMap.get(String(highlight.documentId))?.title) ||
      String(highlight.documentId);
    highlightsByDocument.set(docTitle, (highlightsByDocument.get(docTitle) || 0) + 1);

    for (const tag of Array.isArray(highlight.tags) ? highlight.tags : []) {
      const normalizedTag = normalizeInlineText(tag).toLowerCase();
      if (!normalizedTag) {
        continue;
      }
      tagsMap.set(normalizedTag, (tagsMap.get(normalizedTag) || 0) + 1);
    }

    const hasNote = Boolean(normalizeInlineText(highlight.note || ''));
    const hasTags = Array.isArray(highlight.tags) && highlight.tags.length > 0;
    if (!hasNote && !hasTags) {
      inboxCandidates.push({
        highlightId: String(highlight.id),
        documentId: String(highlight.documentId),
        documentTitle: docTitle,
        page: clampInt(highlight.pageIndex, 0) + 1,
        text: truncateText(cleanHighlightText(highlight), 180),
      });
    }
  }

  const topDocuments = topEntriesFromMap(highlightsByDocument, 5).map((entry) => ({
    title: entry.key,
    count: entry.count,
  }));
  const topTags = topEntriesFromMap(tagsMap, 8).map((entry) => ({
    tag: entry.key,
    count: entry.count,
  }));

  const minutes = Math.round(totalSeconds / 60);
  const lines = [
    `# ${range.period === 'weekly' ? 'Weekly' : 'Daily'} Digest · ${range.label}`,
    '',
    `- Прочитано: **${totalPages}** стр. · **${minutes}** мин.`,
    `- Новые хайлайты: **${highlights.length}**`,
    `- Активных книг: **${topDocuments.length}**`,
    '',
    '## Топ книг',
  ];

  if (topDocuments.length === 0) {
    lines.push('- Нет данных за выбранный период.');
  } else {
    for (const item of topDocuments) {
      lines.push(`- ${item.title}: ${item.count} выдел.`);
    }
  }

  lines.push('', '## Частые теги');
  if (topTags.length === 0) {
    lines.push('- Теги за период не добавлялись.');
  } else {
    for (const item of topTags) {
      lines.push(`- #${item.tag} (${item.count})`);
    }
  }

  lines.push('', '## Inbox (что разобрать)');
  if (inboxCandidates.length === 0) {
    lines.push('- Inbox пуст.');
  } else {
    for (const item of inboxCandidates.slice(0, 6)) {
      lines.push(`- [ ] ${item.documentTitle} · стр. ${item.page}: ${item.text}`);
    }
  }

  lines.push('');

  return {
    generatedAt: new Date().toISOString(),
    period: range.period,
    range: {
      start: range.startIso,
      end: range.endIso,
      label: range.label,
    },
    stats: {
      pages: totalPages,
      seconds: totalSeconds,
      highlights: highlights.length,
      activeDocuments: topDocuments.length,
    },
    topDocuments,
    topTags,
    inbox: inboxCandidates,
    markdown: lines.join('\n'),
  };
}

function buildTokenFrequency(values) {
  const frequency = new Map();
  for (const value of values) {
    for (const token of tokenize(value)) {
      frequency.set(token, (frequency.get(token) || 0) + 1);
    }
  }
  return frequency;
}

function pickTopKeywords(text, limit = 3) {
  const frequency = buildTokenFrequency([text]);
  return [...frequency.entries()]
    .sort((left, right) => {
      if (right[1] === left[1]) {
        return right[0].length - left[0].length;
      }
      return right[1] - left[1];
    })
    .slice(0, limit)
    .map(([token]) => token);
}

function slugNodeId(value) {
  const normalized = String(value ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '_')
    .replace(/^_+|_+$/g, '');
  return normalized || 'node';
}

function buildKnowledgeGraph(db, options = {}) {
  const topConcepts = clampInt(options.topConcepts, 64, 10, 220);
  const minEdgeWeight = clampInt(options.minEdgeWeight, 2, 1, 50);
  const documentMap = createDocumentMap(db);

  const highlights = filterHighlights(db, {
    documentIds: Array.isArray(options.documentIds) ? options.documentIds : undefined,
  });

  const docWeights = new Map();
  const conceptWeights = new Map();
  const docConceptEdges = new Map();
  const conceptEdges = new Map();

  for (const highlight of highlights) {
    const documentId = String(highlight.documentId);
    docWeights.set(documentId, (docWeights.get(documentId) || 0) + 1);

    const concepts = new Set();
    for (const tag of Array.isArray(highlight.tags) ? highlight.tags : []) {
      const normalized = normalizeInlineText(tag).toLowerCase();
      if (normalized) {
        concepts.add(normalized);
      }
    }

    const sourceText = cleanHighlightText(highlight);
    for (const keyword of pickTopKeywords(sourceText, 3)) {
      concepts.add(keyword);
    }

    const conceptList = [...concepts].slice(0, 6);

    for (const concept of conceptList) {
      conceptWeights.set(concept, (conceptWeights.get(concept) || 0) + 1);
      const edgeKey = `${documentId}=>${concept}`;
      docConceptEdges.set(edgeKey, (docConceptEdges.get(edgeKey) || 0) + 1);
    }

    for (let index = 0; index < conceptList.length; index += 1) {
      for (let next = index + 1; next < conceptList.length; next += 1) {
        const left = conceptList[index];
        const right = conceptList[next];
        const pair = left < right ? `${left}<=>${right}` : `${right}<=>${left}`;
        conceptEdges.set(pair, (conceptEdges.get(pair) || 0) + 1);
      }
    }
  }

  const topConceptSet = new Set(
    [...conceptWeights.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, topConcepts)
      .map(([concept]) => concept),
  );

  const nodes = [];
  const nodeIdByKey = new Map();

  for (const [documentId, weight] of [...docWeights.entries()].sort((left, right) => right[1] - left[1])) {
    const title = normalizeInlineText(documentMap.get(documentId)?.title) || documentId;
    const nodeKey = `doc:${documentId}`;
    const nodeId = `doc_${slugNodeId(documentId)}`;
    nodeIdByKey.set(nodeKey, nodeId);
    nodes.push({
      id: nodeId,
      key: nodeKey,
      kind: 'document',
      label: title,
      weight,
      documentId,
    });
  }

  for (const [concept, weight] of [...conceptWeights.entries()]
    .filter(([concept]) => topConceptSet.has(concept))
    .sort((left, right) => right[1] - left[1])) {
    const nodeKey = `concept:${concept}`;
    const nodeId = `concept_${slugNodeId(concept)}`;
    nodeIdByKey.set(nodeKey, nodeId);
    nodes.push({
      id: nodeId,
      key: nodeKey,
      kind: 'concept',
      label: concept,
      weight,
    });
  }

  const edges = [];
  for (const [edgeKey, weight] of docConceptEdges.entries()) {
    const [documentId, concept] = edgeKey.split('=>');
    if (!topConceptSet.has(concept)) {
      continue;
    }
    const fromId = nodeIdByKey.get(`doc:${documentId}`);
    const toId = nodeIdByKey.get(`concept:${concept}`);
    if (!fromId || !toId) {
      continue;
    }
    edges.push({
      id: `edge_${slugNodeId(edgeKey)}`,
      fromId,
      toId,
      kind: 'document-concept',
      weight,
    });
  }

  for (const [edgeKey, weight] of conceptEdges.entries()) {
    if (weight < minEdgeWeight) {
      continue;
    }
    const [left, right] = edgeKey.split('<=>');
    if (!topConceptSet.has(left) || !topConceptSet.has(right)) {
      continue;
    }
    const fromId = nodeIdByKey.get(`concept:${left}`);
    const toId = nodeIdByKey.get(`concept:${right}`);
    if (!fromId || !toId) {
      continue;
    }
    edges.push({
      id: `edge_${slugNodeId(edgeKey)}`,
      fromId,
      toId,
      kind: 'concept-concept',
      weight,
    });
  }

  const sortedEdges = edges.sort((left, right) => right.weight - left.weight).slice(0, 260);

  const mermaid = ['graph LR'];
  for (const node of nodes) {
    const label = String(node.label).replace(/"/g, "'");
    mermaid.push(`  ${node.id}["${label}"]`);
  }
  for (const edge of sortedEdges) {
    mermaid.push(`  ${edge.fromId} -->|${edge.weight}| ${edge.toId}`);
  }

  return {
    generatedAt: new Date().toISOString(),
    stats: {
      highlights: highlights.length,
      documents: [...docWeights.keys()].length,
      concepts: topConceptSet.size,
      edges: sortedEdges.length,
    },
    nodes,
    edges: sortedEdges,
    mermaid: mermaid.join('\n'),
  };
}

function scoreHighlightByQuery(highlight, queryText, queryTokens) {
  const text = cleanHighlightText(highlight);
  const note = normalizeInlineText(highlight.note || '');
  const tags = Array.isArray(highlight.tags) ? highlight.tags.join(' ') : '';
  const merged = `${text}\n${note}\n${tags}`;
  const mergedLower = merged.toLowerCase();
  const textTokens = tokenizeSet(merged);

  let overlap = 0;
  for (const token of queryTokens) {
    if (textTokens.has(token)) {
      overlap += 1;
    }
  }

  const phraseBoost = mergedLower.includes(queryText.toLowerCase()) ? 0.8 : 0;
  const overlapRatio = queryTokens.length > 0 ? overlap / queryTokens.length : 0;
  const noteBoost = note ? 0.12 : 0;
  const tagBoost = Array.isArray(highlight.tags) && highlight.tags.length > 0 ? 0.08 : 0;
  const recencyBoost = Math.max(
    0,
    0.25 - (Date.now() - new Date(toIsoOrNull(highlight.createdAt) || 0).valueOf()) / (1000 * 60 * 60 * 24 * 200),
  );

  return overlapRatio * 2.4 + phraseBoost + noteBoost + tagBoost + recencyBoost;
}

function askLibrary(db, options = {}) {
  const query = normalizeInlineText(options.query);
  if (!query) {
    throw new Error('Нельзя выполнить поиск по пустому запросу.');
  }

  const limit = clampInt(options.limit, 6, 1, 20);
  const documentMap = createDocumentMap(db);
  const highlights = filterHighlights(db, {
    documentIds: Array.isArray(options.documentIds) ? options.documentIds : undefined,
  });

  const queryTokens = tokenize(query);
  const scored = highlights
    .map((highlight) => ({
      highlight,
      score: scoreHighlightByQuery(highlight, query, queryTokens),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);

  const citations = scored.map((item, index) => {
    const highlight = item.highlight;
    const document = documentMap.get(String(highlight.documentId));
    const documentTitle = normalizeInlineText(document?.title) || String(highlight.documentId);

    return {
      index: index + 1,
      highlightId: String(highlight.id),
      documentId: String(highlight.documentId),
      documentTitle,
      pageIndex: clampInt(highlight.pageIndex, 0),
      page: clampInt(highlight.pageIndex, 0) + 1,
      score: Number(item.score.toFixed(3)),
      snippet: truncateText(cleanHighlightText(highlight), 280),
      note: normalizeInlineText(highlight.note || ''),
      tags: Array.isArray(highlight.tags) ? highlight.tags : [],
      createdAt: toIsoOrNull(highlight.createdAt) || new Date().toISOString(),
    };
  });

  if (citations.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      query,
      answer:
        'По текущему запросу не найдено релевантных фрагментов. Уточните формулировку или расширьте контекст.',
      citations: [],
      confidence: 0,
    };
  }

  const lines = [];
  lines.push(`В библиотеке найдено ${citations.length} релевантных фрагментов.`);
  lines.push('');
  lines.push('Ключевые тезисы:');
  for (const citation of citations.slice(0, 3)) {
    lines.push(`- [${citation.index}] ${citation.snippet}`);
  }

  lines.push('');
  lines.push('Источники:');
  for (const citation of citations) {
    lines.push(
      `- [${citation.index}] ${citation.documentTitle} · стр. ${citation.page} · score=${citation.score}`,
    );
  }

  const confidence = Number(
    Math.min(
      0.99,
      Math.max(0.1, citations.reduce((sum, item) => sum + item.score, 0) / citations.length / 2.8),
    ).toFixed(3),
  );

  return {
    generatedAt: new Date().toISOString(),
    query,
    answer: lines.join('\n'),
    citations,
    confidence,
  };
}

function splitSentences(text) {
  const normalized = normalizeMultilineText(text);
  if (!normalized) {
    return [];
  }

  return normalized
    .split(/(?<=[.!?…])\s+/g)
    .map((sentence) => normalizeInlineText(sentence))
    .filter(Boolean);
}

function summarizeHighlights(db, options = {}) {
  const maxSentences = clampInt(options.maxSentences, 6, 2, 20);
  const documentMap = createDocumentMap(db);
  const highlights = filterHighlights(db, options);

  if (highlights.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      documentId: normalizeInlineText(options.documentId) || null,
      documentTitle: null,
      usedHighlightsCount: 0,
      keyPoints: [],
      summary:
        'Для выбранных фильтров нет хайлайтов. Выберите книгу или диапазон страниц и повторите генерацию.',
      sourceHighlightIds: [],
    };
  }

  const sorted = [...highlights].sort((left, right) => {
    if (left.pageIndex === right.pageIndex) {
      return new Date(left.createdAt || 0).valueOf() - new Date(right.createdAt || 0).valueOf();
    }
    return clampInt(left.pageIndex, 0) - clampInt(right.pageIndex, 0);
  });

  const allSentences = [];
  for (const highlight of sorted) {
    const sourceText = cleanHighlightText(highlight);
    const sentences = splitSentences(sourceText);
    if (sentences.length === 0 && sourceText) {
      sentences.push(sourceText);
    }

    for (const sentence of sentences) {
      allSentences.push({
        sentence,
        highlightId: String(highlight.id),
        pageIndex: clampInt(highlight.pageIndex, 0),
      });
    }
  }

  const frequency = buildTokenFrequency(allSentences.map((item) => item.sentence));

  const scoredSentences = allSentences
    .map((item, index) => {
      const tokens = tokenize(item.sentence);
      const score = tokens.reduce((sum, token) => sum + (frequency.get(token) || 0), 0) /
        Math.max(4, tokens.length);
      return {
        ...item,
        order: index,
        score,
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, maxSentences * 2);

  const uniqueBySentence = new Map();
  for (const item of scoredSentences) {
    const key = item.sentence.toLowerCase();
    if (!uniqueBySentence.has(key)) {
      uniqueBySentence.set(key, item);
    }
  }

  const selectedSentences = [...uniqueBySentence.values()]
    .sort((left, right) => left.order - right.order)
    .slice(0, maxSentences);

  const keyPoints = selectedSentences.map((item) => truncateText(item.sentence, 220));
  const summaryText = keyPoints.map((item, index) => `${index + 1}. ${item}`).join('\n');

  const firstDocumentId = String(sorted[0]?.documentId || options.documentId || '');
  const documentTitle = firstDocumentId
    ? normalizeInlineText(documentMap.get(firstDocumentId)?.title || firstDocumentId)
    : null;

  return {
    generatedAt: new Date().toISOString(),
    documentId: firstDocumentId || null,
    documentTitle,
    usedHighlightsCount: sorted.length,
    keyPoints,
    summary: summaryText,
    sourceHighlightIds: [...new Set(sorted.map((item) => String(item.id)))],
  };
}

module.exports = {
  generateSrsDeck,
  applySrsReviewGrade,
  buildReadingDigest,
  buildKnowledgeGraph,
  askLibrary,
  summarizeHighlights,
  __private: {
    tokenize,
    cleanHighlightText,
    buildCloze,
    buildPeriodRange,
    filterHighlights,
  },
};
