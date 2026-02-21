const insights = require('./insights');

const { generateSrsDeck, buildReadingDigest, summarizeHighlights } = insights;
const cleanHighlightTextFromInsights =
  insights?.__private && typeof insights.__private.cleanHighlightText === 'function'
    ? insights.__private.cleanHighlightText
    : null;

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

function normalizeText(value) {
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

function cleanOcrText(value) {
  return normalizeMultilineText(value)
    .replace(/[‐‑‒–—]/g, '-')
    .replace(/[“”«»„]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/([\p{L}\p{N}])-\s*\n\s*([\p{L}\p{N}])/gu, '$1$2')
    .replace(/([\p{Ll}])\n(?=[\p{Ll}])/gu, '$1 ')
    .replace(/\n(?=[,.;:!?])/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function clampInt(value, fallback, min = 1, max = 100) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) {
    return Math.max(min, Math.min(max, Math.trunc(fallback || min)));
  }
  return Math.max(min, Math.min(max, Math.trunc(raw)));
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

function truncateText(value, max = 260) {
  const normalized = normalizeText(value);
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function resolveDocumentIds(options = {}) {
  if (Array.isArray(options.documentIds) && options.documentIds.length > 0) {
    return [...new Set(options.documentIds.map((id) => String(id)).filter(Boolean))];
  }
  const documentId = normalizeText(options.documentId);
  if (documentId) {
    return [documentId];
  }
  return undefined;
}

function getReadingMode(modeRaw) {
  const mode = normalizeText(modeRaw).toLowerCase();
  if (mode === 'review' || mode === 'focus') {
    return mode;
  }
  return 'research';
}

function stemToken(token) {
  const normalized = String(token ?? '').toLowerCase().replace(/ё/g, 'е');
  if (normalized.length <= 4) {
    return normalized;
  }

  const ruSuffixes = [
    'иями',
    'ями',
    'ами',
    'ого',
    'ему',
    'ому',
    'ыми',
    'ими',
    'ей',
    'ий',
    'ый',
    'ой',
    'ам',
    'ям',
    'ах',
    'ях',
    'ов',
    'ев',
    'ия',
    'ие',
    'ии',
    'иям',
    'ием',
    'ую',
    'юю',
    'ая',
    'яя',
    'ое',
    'ее',
    'ть',
    'ти',
    'ться',
    'аться',
    'иться',
  ];
  for (const suffix of ruSuffixes) {
    if (normalized.endsWith(suffix) && normalized.length - suffix.length >= 4) {
      return normalized.slice(0, -suffix.length);
    }
  }

  const enSuffixes = ['ments', 'ation', 'ions', 'ingly', 'edly', 'ness', 'ment', 'ing', 'ed', 'es', 's'];
  for (const suffix of enSuffixes) {
    if (normalized.endsWith(suffix) && normalized.length - suffix.length >= 4) {
      return normalized.slice(0, -suffix.length);
    }
  }

  return normalized;
}

function tokenize(value) {
  const tokens = String(value ?? '')
    .toLowerCase()
    .match(/[\p{L}\p{N}]{2,}/gu);

  if (!tokens) {
    return [];
  }

  return tokens
    .map((token) => stemToken(token))
    .map((token) => token.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function buildTokenVector(value) {
  const vector = new Map();
  for (const token of tokenize(value)) {
    vector.set(token, (vector.get(token) || 0) + 1);
  }
  return vector;
}

function cosineSimilarity(left, right) {
  if (!left || !right || left.size === 0 || right.size === 0) {
    return 0;
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (const value of left.values()) {
    leftNorm += value * value;
  }

  for (const [key, value] of right.entries()) {
    rightNorm += value * value;
    const lv = left.get(key);
    if (lv) {
      dot += lv * value;
    }
  }

  if (leftNorm <= 0 || rightNorm <= 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function buildTrigramSet(value) {
  const normalized = normalizeText(value).toLowerCase();
  const compact = normalized.replace(/\s+/g, ' ');
  if (compact.length < 3) {
    return new Set(compact ? [compact] : []);
  }

  const set = new Set();
  for (let index = 0; index <= compact.length - 3; index += 1) {
    set.add(compact.slice(index, index + 3));
  }
  return set;
}

function jaccardSimilarity(leftSet, rightSet) {
  if (!leftSet || !rightSet || leftSet.size === 0 || rightSet.size === 0) {
    return 0;
  }

  let overlap = 0;
  for (const item of leftSet) {
    if (rightSet.has(item)) {
      overlap += 1;
    }
  }

  const union = leftSet.size + rightSet.size - overlap;
  if (union <= 0) {
    return 0;
  }
  return overlap / union;
}

function buildQuestionProfile(questionRaw) {
  const question = cleanOcrText(questionRaw);
  return {
    question,
    tokenVector: buildTokenVector(question),
    trigramSet: buildTrigramSet(question),
  };
}

function cleanHighlightTextSafe(highlight) {
  if (cleanHighlightTextFromInsights) {
    return cleanOcrText(cleanHighlightTextFromInsights(highlight));
  }

  const rich = cleanOcrText(stripHtml(highlight?.selectedRichText || ''));
  const selected = cleanOcrText(highlight?.selectedText || '');
  return selected || rich;
}

function createDocumentMap(db) {
  const map = new Map();
  for (const document of Array.isArray(db?.documents) ? db.documents : []) {
    map.set(String(document.id), document);
  }
  return map;
}

function collectHighlightContext(db, documentIds) {
  const documentMap = createDocumentMap(db);
  const documents = Array.isArray(db?.documents) ? db.documents : [];
  const filteredDocuments = Array.isArray(documentIds) && documentIds.length > 0
    ? documents.filter((item) => documentIds.includes(String(item.id)))
    : documents;
  const allowedDocumentIds = new Set(filteredDocuments.map((item) => String(item.id)));

  const highlights = Array.isArray(db?.highlights) ? db.highlights : [];
  const nowTs = Date.now();

  const entries = [];
  const topTagsMap = new Map();
  const topDocumentsMap = new Map();
  let withNotes = 0;
  let withTags = 0;
  let inboxCount = 0;

  for (const highlight of highlights) {
    const documentId = String(highlight?.documentId || '');
    if (allowedDocumentIds.size > 0 && !allowedDocumentIds.has(documentId)) {
      continue;
    }

    const text = cleanHighlightTextSafe(highlight);
    if (!text) {
      continue;
    }

    const note = cleanOcrText(highlight?.note || '');
    const tags = Array.isArray(highlight?.tags)
      ? [...new Set(highlight.tags.map((item) => normalizeText(item).toLowerCase()).filter(Boolean))]
      : [];

    if (note) {
      withNotes += 1;
    }
    if (tags.length > 0) {
      withTags += 1;
    }
    if (!note && tags.length === 0) {
      inboxCount += 1;
    }

    const createdAt = toIsoOrNull(highlight?.createdAt);
    const ageDays = createdAt
      ? Math.max(0, (nowTs - new Date(createdAt).valueOf()) / (24 * 60 * 60 * 1000))
      : 180;

    const lengthSignal = Math.min(1, normalizeText(text).length / 360);
    const noteSignal = note ? 0.26 : 0;
    const tagSignal = Math.min(0.2, tags.length * 0.07);
    const reviewSignal = Math.min(0.18, Math.max(0, Number(highlight?.reviewCount || 0)) * 0.03);
    const recencySignal = Math.max(0, 0.2 - Math.min(0.2, ageDays / 240));
    const baseQuality = 0.3 + lengthSignal * 0.36 + noteSignal + tagSignal + reviewSignal + recencySignal;

    const documentTitle = normalizeText(documentMap.get(documentId)?.title || documentId);
    topDocumentsMap.set(documentTitle, (topDocumentsMap.get(documentTitle) || 0) + 1);
    for (const tag of tags) {
      topTagsMap.set(tag, (topTagsMap.get(tag) || 0) + 1);
    }

    entries.push({
      index: entries.length + 1,
      highlightId: String(highlight.id || ''),
      documentId,
      documentTitle,
      pageIndex: Math.max(0, clampInt(highlight.pageIndex, 0, 0, 1_000_000)),
      page: Math.max(1, clampInt(highlight.pageIndex, 0, 0, 1_000_000) + 1),
      createdAt,
      text,
      note,
      tags,
      baseQuality,
      matchText: [text, note, tags.join(' ')].join('\n'),
      matchVector: buildTokenVector([text, note, tags.join(' ')].join(' ')),
      trigramSet: buildTrigramSet([text, note, tags.join(' ')].join(' ')),
    });
  }

  const topTags = [...topTagsMap.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 10)
    .map(([tag, count]) => ({ tag, count }));

  const topDocuments = [...topDocumentsMap.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8)
    .map(([title, count]) => ({ title, count }));

  return {
    documents: filteredDocuments,
    entries,
    stats: {
      highlights: entries.length,
      documents: filteredDocuments.length,
      withNotes,
      withTags,
      inboxCount,
    },
    topTags,
    topDocuments,
  };
}

function topConceptsFromContext(context, limit = 6) {
  const scoreMap = new Map();

  for (const entry of context.entries) {
    for (const tag of entry.tags) {
      scoreMap.set(tag, (scoreMap.get(tag) || 0) + 2);
    }

    const textTokens = tokenize(entry.text)
      .filter((token) => token.length >= 5)
      .slice(0, 18);
    for (const token of textTokens) {
      scoreMap.set(token, (scoreMap.get(token) || 0) + 0.25);
    }
  }

  return [...scoreMap.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, Math.max(1, limit))
    .map(([concept, weight]) => ({
      concept,
      weight: Number(weight.toFixed(2)),
    }));
}

function scoreHighlightForQuestion(entry, profile) {
  if (!profile.question) {
    return entry.baseQuality;
  }

  const cosine = cosineSimilarity(profile.tokenVector, entry.matchVector);
  const trigram = jaccardSimilarity(profile.trigramSet, entry.trigramSet);
  const noteBoost = entry.note ? 0.06 : 0;
  const tagBoost = Math.min(0.07, entry.tags.length * 0.015);
  return entry.baseQuality * 0.45 + cosine * 0.4 + trigram * 0.15 + noteBoost + tagBoost;
}

function pickEvidenceHighlights(context, question, limit = 12) {
  const profile = buildQuestionProfile(question);
  const scored = context.entries
    .map((entry) => ({
      ...entry,
      relevanceScore: scoreHighlightForQuestion(entry, profile),
    }))
    .sort((left, right) => right.relevanceScore - left.relevanceScore);

  const selected = [];
  const perDocument = new Map();
  for (const item of scored) {
    if (selected.length >= limit) {
      break;
    }

    const count = perDocument.get(item.documentId) || 0;
    const softCap = Math.max(2, Math.ceil(limit / Math.max(1, context.stats.documents)));
    if (count >= softCap && selected.length < Math.max(2, limit - 2)) {
      continue;
    }

    selected.push(item);
    perDocument.set(item.documentId, count + 1);
  }

  return selected.map((item, index) => ({
    index: index + 1,
    highlightId: item.highlightId,
    documentId: item.documentId,
    documentTitle: item.documentTitle,
    pageIndex: item.pageIndex,
    page: item.page,
    createdAt: item.createdAt || undefined,
    score: Number(item.relevanceScore.toFixed(4)),
    text: truncateText(item.text, 520),
    note: item.note ? truncateText(item.note, 220) : undefined,
    tags: item.tags,
  }));
}

function buildLocalPlan(input) {
  const recommendations = [];

  if (input.srs?.dueCount > 0) {
    recommendations.push(`Пройти сегодня ${Math.min(25, input.srs.dueCount)} карточек (due: ${input.srs.dueCount}).`);
  } else {
    recommendations.push('SRS очередь пуста: добавьте новые карточки из последних хайлайтов.');
  }

  if (input.contextStats?.inboxCount > 0) {
    recommendations.push(`Разобрать inbox-выделения без тегов/заметок: ${Math.min(12, input.contextStats.inboxCount)} шт.`);
  }

  if (input.summary?.usedHighlightsCount > 0) {
    recommendations.push(`Сверить summary (${input.summary.usedHighlightsCount} хайлайтов) и сформулировать 2-3 action пункта.`);
  }

  if (input.topConcepts?.length > 0) {
    recommendations.push(`Закрепить ключевые концепты: ${input.topConcepts.slice(0, 4).map((item) => item.concept).join(', ')}.`);
  }

  if (input.evidence?.length > 0) {
    const top = input.evidence[0];
    recommendations.push(`Начать повторение с [H${top.index}] ${truncateText(top.documentTitle, 38)} · стр. ${top.page}.`);
  }

  if (recommendations.length === 0) {
    recommendations.push('Соберите больше данных чтения: создайте выделения и заметки для анализа.');
  }

  return recommendations.slice(0, clampInt(input.maxActions, 5, 3, 12));
}

function buildContextStats(context) {
  return {
    documents: context.stats.documents,
    highlights: context.stats.highlights,
    highlightsWithNotes: context.stats.withNotes,
    highlightsWithTags: context.stats.withTags,
    inboxHighlights: context.stats.inboxCount,
  };
}

function buildPrompt(payload) {
  const lines = [];
  lines.push('Ты AI-ассистент для глубокого чтения и повторения.');
  lines.push('Отвечай только на русском языке.');
  lines.push('Опирайся строго на переданный контекст. Если данных не хватает - прямо так и скажи.');
  lines.push('Не придумывай цитаты, факты и страницы.');
  lines.push('');

  lines.push(`Режим: ${payload.mode}.`);
  lines.push(`SRS due: ${payload.srs?.dueCount || 0}; cards: ${payload.srs?.cards?.length || 0}.`);
  lines.push(`Digest pages: ${payload.digest?.stats?.pages || 0}; highlights: ${payload.digest?.stats?.highlights || 0}.`);
  lines.push(`Summary highlights: ${payload.summary?.usedHighlightsCount || 0}.`);
  lines.push(
    `Контекст библиотеки: документов ${payload.contextStats.documents}, хайлайтов ${payload.contextStats.highlights}, с заметками ${payload.contextStats.highlightsWithNotes}, с тегами ${payload.contextStats.highlightsWithTags}.`,
  );

  if (payload.topConcepts.length > 0) {
    lines.push(
      `Ключевые концепты: ${payload.topConcepts
        .slice(0, 8)
        .map((item) => `${item.concept} (${item.weight})`)
        .join(', ')}.`,
    );
  }

  lines.push('');
  lines.push('Опорные фрагменты:');

  let budget = 0;
  for (const item of payload.evidence) {
    const header = `[H${item.index}] ${item.documentTitle} · стр. ${item.page} · score ${item.score}`;
    const body = `Текст: ${truncateText(item.text, 430)}`;
    const note = item.note ? `Заметка: ${truncateText(item.note, 180)}` : '';
    const tags = item.tags?.length ? `Теги: ${item.tags.join(', ')}` : '';
    const block = [header, body, note, tags].filter(Boolean).join('\n');

    if (budget + block.length > 13000) {
      break;
    }
    budget += block.length;
    lines.push(block);
    lines.push('');
  }

  if (payload.question) {
    lines.push(`Вопрос пользователя: ${payload.question}`);
  } else {
    lines.push('Пользователь не задал вопрос. Дай приоритетный план повторения.');
  }

  lines.push('');
  lines.push('Формат ответа:');
  lines.push('1) Краткий диагноз (3-5 пунктов).');
  lines.push('2) Приоритетный план на сегодня (5-8 пунктов).');
  lines.push('3) Ответ на вопрос пользователя с ссылками на [Hn].');
  lines.push('4) Что повторить первым (до 5 пунктов).');

  return lines.join('\n');
}

function extractOpenAiText(json) {
  const direct = normalizeText(json?.output_text || '');
  if (direct) {
    return direct;
  }

  const chunks = [];
  const output = Array.isArray(json?.output) ? json.output : [];
  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      const text = normalizeText(part?.text || '');
      if (text) {
        chunks.push(text);
      }
    }
  }

  return normalizeText(chunks.join('\n'));
}

async function generateWithOpenAi(payload) {
  const apiKey = normalizeText(process.env.RECALL_OPENAI_API_KEY || process.env.OPENAI_API_KEY);
  if (!apiKey) {
    return null;
  }

  const model = normalizeText(process.env.RECALL_OPENAI_MODEL || 'gpt-4o-mini');
  const prompt = buildPrompt(payload);

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: prompt,
      temperature: 0.15,
      max_output_tokens: 950,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`OpenAI HTTP ${response.status}: ${body.slice(0, 280)}`);
  }

  const json = await response.json();
  const text = extractOpenAiText(json);
  if (!text) {
    throw new Error('OpenAI returned empty response');
  }

  return {
    provider: `openai:${model}`,
    text,
  };
}

async function generateWithOllama(payload) {
  const baseUrl = normalizeText(process.env.RECALL_OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
  const model = normalizeText(process.env.RECALL_OLLAMA_MODEL || 'qwen2.5:7b');
  if (!baseUrl || !model) {
    return null;
  }

  const prompt = buildPrompt(payload);
  const response = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: {
        temperature: 0.15,
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Ollama HTTP ${response.status}: ${body.slice(0, 280)}`);
  }

  const json = await response.json();
  const text = normalizeText(json?.response || json?.message?.content || '');
  if (!text) {
    throw new Error('Ollama returned empty response');
  }

  return {
    provider: `ollama:${model}`,
    text,
  };
}

function buildLocalQuestionAnswer(question, evidence) {
  if (!question) {
    return 'Вопрос не задан. Сформирован приоритетный план по текущему контексту чтения.';
  }

  if (!Array.isArray(evidence) || evidence.length === 0) {
    return 'Для ответа недостаточно релевантных фрагментов. Добавьте больше выделений или снимите фильтр.';
  }

  const lead = evidence[0];
  const supporting = evidence.slice(1, 3);
  const lines = [
    `Основной опорный тезис: [H${lead.index}] ${truncateText(lead.text, 200)}`,
  ];

  if (supporting.length > 0) {
    lines.push(
      `Поддерживающие фрагменты: ${supporting
        .map((item) => `[H${item.index}] ${truncateText(item.text, 120)}`)
        .join('; ')}`,
    );
  }

  lines.push('Проверьте цитаты в оригинале и уточните вопрос для более точного плана действий.');
  return lines.join('\n');
}

function formatLocalAnswer(payload, recommendations) {
  const lines = [];
  lines.push(`# AI Assistant · ${payload.mode}`);
  lines.push('');
  lines.push('## Диагноз');
  lines.push(`- SRS due: ${payload.srs?.dueCount || 0}, всего карточек: ${payload.srs?.cards?.length || 0}`);
  lines.push(
    `- Чтение за период: ${payload.digest?.stats?.pages || 0} стр. / ${Math.round((payload.digest?.stats?.seconds || 0) / 60)} мин.`,
  );
  lines.push(`- Хайлайтов в контексте: ${payload.contextStats.highlights} (заметки: ${payload.contextStats.highlightsWithNotes}, теги: ${payload.contextStats.highlightsWithTags})`);
  lines.push(`- Inbox без обработки: ${payload.contextStats.inboxHighlights}`);

  if (payload.topConcepts?.length > 0) {
    lines.push(`- Ключевые концепты: ${payload.topConcepts.slice(0, 6).map((item) => item.concept).join(', ')}`);
  }

  lines.push('');
  lines.push('## План');
  for (const step of recommendations) {
    lines.push(`- ${step}`);
  }

  lines.push('');
  lines.push('## Ответ на вопрос');
  lines.push(buildLocalQuestionAnswer(payload.question, payload.evidence));

  if (payload.evidence?.length > 0) {
    lines.push('');
    lines.push('## Опорные фрагменты');
    for (const item of payload.evidence.slice(0, 6)) {
      lines.push(`- [H${item.index}] ${item.documentTitle} · стр. ${item.page}: ${truncateText(item.text, 170)}`);
    }
  }

  return lines.join('\n');
}

function buildResultBase(nowIso, payload, text, provider, recommendations) {
  return {
    generatedAt: nowIso,
    mode: payload.mode,
    provider,
    question: payload.question || undefined,
    text,
    recommendations,
    metrics: {
      dueCount: payload.srs.dueCount,
      digestPages: payload.digest.stats.pages,
      digestHighlights: payload.digest.stats.highlights,
      summaryHighlights: payload.summary.usedHighlightsCount,
    },
    topConcepts: payload.topConcepts,
    ragAnswer: null,
    contextStats: payload.contextStats,
    evidence: payload.evidence,
  };
}

async function generateAiAssistantBrief(db, options = {}) {
  const nowIso = new Date().toISOString();
  const mode = getReadingMode(options.mode);
  const documentIds = resolveDocumentIds(options);
  const maxActions = clampInt(options.maxActions, 5, 3, 12);
  const question = cleanOcrText(options.question || '');
  const provider = normalizeText(options.provider || 'auto').toLowerCase();

  const srs = generateSrsDeck(db, {
    documentIds,
    dueOnly: true,
    limit: 180,
  });
  const digest = buildReadingDigest(db, {
    period: mode === 'review' ? 'weekly' : 'daily',
    documentIds,
  });
  const summary = summarizeHighlights(db, {
    documentId: documentIds?.length === 1 ? documentIds[0] : undefined,
    maxSentences: mode === 'focus' ? 5 : 8,
  });

  const context = collectHighlightContext(db, documentIds);
  const topConcepts = topConceptsFromContext(context, 8);
  const evidence = pickEvidenceHighlights(context, question, mode === 'review' ? 14 : 12);
  const contextStats = buildContextStats(context);

  const recommendations = buildLocalPlan({
    srs,
    digest,
    summary,
    topConcepts,
    evidence,
    contextStats,
    maxActions,
  });

  const promptPayload = {
    mode,
    question,
    srs,
    digest,
    summary,
    topConcepts,
    evidence,
    contextStats,
  };

  const localAnswer = formatLocalAnswer(
    {
      ...promptPayload,
    },
    recommendations,
  );

  if (provider === 'openai') {
    try {
      const ai = await generateWithOpenAi(promptPayload);
      if (!ai) {
        throw new Error('OpenAI key not configured');
      }
      return buildResultBase(nowIso, promptPayload, ai.text, ai.provider, recommendations);
    } catch (error) {
      return buildResultBase(
        nowIso,
        promptPayload,
        `${localAnswer}\n\n[OpenAI fallback reason] ${String(error?.message || error)}`,
        'local:fallback-openai',
        recommendations,
      );
    }
  }

  if (provider === 'ollama') {
    try {
      const ai = await generateWithOllama(promptPayload);
      if (!ai) {
        throw new Error('Ollama settings not configured');
      }
      return buildResultBase(nowIso, promptPayload, ai.text, ai.provider, recommendations);
    } catch (error) {
      return buildResultBase(
        nowIso,
        promptPayload,
        `${localAnswer}\n\n[Ollama fallback reason] ${String(error?.message || error)}`,
        'local:fallback-ollama',
        recommendations,
      );
    }
  }

  if (provider === 'auto') {
    const fallbackErrors = [];
    try {
      const ai = await generateWithOpenAi(promptPayload);
      if (ai) {
        return buildResultBase(nowIso, promptPayload, ai.text, ai.provider, recommendations);
      }
    } catch (error) {
      fallbackErrors.push(`openai: ${String(error?.message || error)}`);
    }

    try {
      const ai = await generateWithOllama(promptPayload);
      if (ai) {
        return buildResultBase(nowIso, promptPayload, ai.text, ai.provider, recommendations);
      }
    } catch (error) {
      fallbackErrors.push(`ollama: ${String(error?.message || error)}`);
    }

    const details = fallbackErrors.length > 0 ? `\n\n[AI fallback reasons] ${fallbackErrors.join(' | ')}` : '';
    return buildResultBase(nowIso, promptPayload, `${localAnswer}${details}`, 'local:auto', recommendations);
  }

  return buildResultBase(nowIso, promptPayload, localAnswer, 'local', recommendations);
}

module.exports = {
  generateAiAssistantBrief,
};
