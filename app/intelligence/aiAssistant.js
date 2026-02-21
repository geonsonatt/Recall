const insights = require('./insights');

const { generateSrsDeck, buildReadingDigest, summarizeHighlights } = insights;
const cleanHighlightTextFromInsights =
  insights?.__private && typeof insights.__private.cleanHighlightText === 'function'
    ? insights.__private.cleanHighlightText
    : null;

const DEFAULT_API_URL = normalizeInlineText(
  process.env.RECALL_AI_API_URL || 'https://api.arliai.com/v1/chat/completions',
);
const FREE_DEFAULT_API_MODEL = normalizeInlineText(
  process.env.RECALL_AI_MODEL || 'Gemma-3-27B-ArliAI-RPMax-v3',
);
const EMBEDDED_AI_API_KEY = 'e9420850-87de-44f3-967a-eb43023a9656';
const FREE_MODEL_ALIASES = [
  'Gemma-3-27B-ArliAI-RPMax-v3',
];

const DEPTH_PRESETS = {
  quick: {
    evidenceLimit: 14,
    numCtx: 6144,
    maxOutputTokens: 900,
    promptBudget: 12500,
    maxActions: 6,
  },
  balanced: {
    evidenceLimit: 24,
    numCtx: 12288,
    maxOutputTokens: 1400,
    promptBudget: 19000,
    maxActions: 8,
  },
  deep: {
    evidenceLimit: 40,
    numCtx: 22528,
    maxOutputTokens: 2200,
    promptBudget: 32000,
    maxActions: 10,
  },
};

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

function cleanOcrText(value) {
  return normalizeMultilineText(value)
    .replace(/[‐‑‒–—]/g, '-')
    .replace(/[“”«»„]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/([\p{L}\p{N}])[-‐‑]\s*\n\s*([\p{L}\p{N}])/gu, '$1$2')
    .replace(/([\p{Ll}\d])\n(?=[\p{Ll}\d])/gu, '$1 ')
    .replace(/\n(?=[,.;:!?])/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
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
  const normalized = normalizeInlineText(value);
  if (normalized.length <= max) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function resolveDocumentIds(options = {}) {
  if (Array.isArray(options.documentIds) && options.documentIds.length > 0) {
    return [...new Set(options.documentIds.map((id) => String(id)).filter(Boolean))];
  }

  const documentId = normalizeInlineText(options.documentId);
  if (documentId) {
    return [documentId];
  }

  return undefined;
}

function getReadingMode(modeRaw) {
  const mode = normalizeInlineText(modeRaw).toLowerCase();
  if (mode === 'focus' || mode === 'review') {
    return mode;
  }
  return 'research';
}

function getAnalysisDepth(depthRaw) {
  const depth = normalizeInlineText(depthRaw).toLowerCase();
  if (depth === 'quick' || depth === 'deep') {
    return depth;
  }
  return 'balanced';
}

function resolveProvider(providerRaw) {
  const provider = normalizeInlineText(providerRaw).toLowerCase();
  if (provider === 'local' || provider === 'api') {
    return provider;
  }
  return 'auto';
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
  const normalized = normalizeInlineText(value).toLowerCase().replace(/\s+/g, ' ');
  if (normalized.length < 3) {
    return new Set(normalized ? [normalized] : []);
  }

  const set = new Set();
  for (let index = 0; index <= normalized.length - 3; index += 1) {
    set.add(normalized.slice(index, index + 3));
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

function getDocumentProgress(document) {
  const totalPages = Math.max(0, Number(document?.lastReadTotalPages || 0));
  const maxReadPage = Math.max(0, Number(document?.maxReadPageIndex || 0) + 1);
  const percent = totalPages > 0 ? Math.min(100, Math.round((maxReadPage / totalPages) * 100)) : 0;
  return {
    totalPages,
    maxReadPage,
    percent,
  };
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
  const tagFrequency = new Map();
  const conceptFrequency = new Map();
  const documentsStats = new Map();

  let withNotes = 0;
  let withTags = 0;
  let inboxCount = 0;

  for (const document of filteredDocuments) {
    const documentId = String(document.id || '');
    documentsStats.set(documentId, {
      documentId,
      title: normalizeInlineText(document.title || documentId),
      highlights: 0,
      notes: 0,
      tagged: 0,
      progress: getDocumentProgress(document),
    });
  }

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
      ? [...new Set(highlight.tags.map((item) => normalizeInlineText(item).toLowerCase()).filter(Boolean))]
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

    const lengthSignal = Math.min(1, normalizeInlineText(text).length / 360);
    const noteSignal = note ? 0.24 : 0;
    const tagSignal = Math.min(0.22, tags.length * 0.07);
    const reviewSignal = Math.min(0.2, Math.max(0, Number(highlight?.reviewCount || 0)) * 0.03);
    const recencySignal = Math.max(0, 0.24 - Math.min(0.24, ageDays / 240));
    const baseQuality = 0.28 + lengthSignal * 0.34 + noteSignal + tagSignal + reviewSignal + recencySignal;

    const documentTitle = normalizeInlineText(documentMap.get(documentId)?.title || documentId);
    const documentStat = documentsStats.get(documentId) || {
      documentId,
      title: documentTitle,
      highlights: 0,
      notes: 0,
      tagged: 0,
      progress: { totalPages: 0, maxReadPage: 0, percent: 0 },
    };
    documentStat.highlights += 1;
    if (note) {
      documentStat.notes += 1;
    }
    if (tags.length > 0) {
      documentStat.tagged += 1;
    }
    documentsStats.set(documentId, documentStat);

    const tokens = tokenize(text).filter((token) => token.length >= 5).slice(0, 24);
    for (const token of tokens) {
      conceptFrequency.set(token, (conceptFrequency.get(token) || 0) + 1);
    }
    for (const tag of tags) {
      tagFrequency.set(tag, (tagFrequency.get(tag) || 0) + 1);
      conceptFrequency.set(tag, (conceptFrequency.get(tag) || 0) + 2);
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
      matchVector: buildTokenVector([text, note, tags.join(' ')].join(' ')),
      trigramSet: buildTrigramSet([text, note, tags.join(' ')].join(' ')),
    });
  }

  const topTags = [...tagFrequency.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 12)
    .map(([tag, count]) => ({ tag, count }));

  const topConcepts = [...conceptFrequency.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 14)
    .map(([concept, weight]) => ({ concept, weight: Number(weight.toFixed(2)) }));

  const documentProfiles = [...documentsStats.values()]
    .sort((left, right) => right.highlights - left.highlights)
    .map((item) => ({
      documentId: item.documentId,
      title: item.title,
      highlights: item.highlights,
      notes: item.notes,
      tagged: item.tagged,
      progress: item.progress,
    }));

  return {
    documents: filteredDocuments,
    entries,
    topTags,
    topConcepts,
    documentProfiles,
    stats: {
      documents: filteredDocuments.length,
      highlights: entries.length,
      withNotes,
      withTags,
      inboxCount,
    },
  };
}

function buildQuestionProfile(questionRaw) {
  const question = cleanOcrText(questionRaw);
  return {
    question,
    vector: buildTokenVector(question),
    trigrams: buildTrigramSet(question),
  };
}

function scoreHighlightForQuestion(entry, profile) {
  if (!profile.question) {
    return entry.baseQuality;
  }

  const cosine = cosineSimilarity(profile.vector, entry.matchVector);
  const trigram = jaccardSimilarity(profile.trigrams, entry.trigramSet);
  const noteBoost = entry.note ? 0.06 : 0;
  const tagBoost = Math.min(0.08, entry.tags.length * 0.02);

  return entry.baseQuality * 0.46 + cosine * 0.38 + trigram * 0.16 + noteBoost + tagBoost;
}

function pickEvidenceHighlights(context, question, depth, maxEvidence) {
  const profile = buildQuestionProfile(question);
  const depthPreset = DEPTH_PRESETS[depth] || DEPTH_PRESETS.balanced;
  const limit = clampInt(maxEvidence, depthPreset.evidenceLimit, 8, 64);

  const scored = context.entries
    .map((entry) => ({
      ...entry,
      relevanceScore: scoreHighlightForQuestion(entry, profile),
    }))
    .sort((left, right) => right.relevanceScore - left.relevanceScore);

  const selected = [];
  const perDocument = new Map();
  const softCap = Math.max(2, Math.ceil(limit / Math.max(1, context.stats.documents || 1)));

  for (const item of scored) {
    if (selected.length >= limit) {
      break;
    }

    const count = perDocument.get(item.documentId) || 0;
    if (count >= softCap && selected.length < Math.max(3, limit - 3)) {
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
    text: truncateText(item.text, 680),
    note: item.note ? truncateText(item.note, 260) : undefined,
    tags: item.tags,
  }));
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

function buildLocalPlan(payload, maxActions) {
  const recommendations = [];
  const allowed = clampInt(maxActions, 8, 4, 14);

  if (payload.srs?.dueCount > 0) {
    recommendations.push(`Закрыть сегодня минимум ${Math.min(28, payload.srs.dueCount)} карточек SRS.`);
  } else {
    recommendations.push('SRS очередь пуста: добавьте новые карточки из свежих выделений.');
  }

  if (payload.contextStats.inboxHighlights > 0) {
    recommendations.push(`Разобрать inbox (без тегов/заметок): ${Math.min(payload.contextStats.inboxHighlights, 14)} выделений.`);
  }

  if (payload.summary.usedHighlightsCount > 0) {
    recommendations.push(`Проверить summary главы и зафиксировать 2-3 action пункта.`);
  }

  if (payload.topConcepts.length > 0) {
    recommendations.push(`Повторить концепты: ${payload.topConcepts.slice(0, 4).map((item) => item.concept).join(', ')}.`);
  }

  if (payload.documentProfiles.length > 0) {
    const weakest = payload.documentProfiles
      .filter((item) => item.progress.totalPages > 0)
      .sort((left, right) => left.progress.percent - right.progress.percent)[0];
    if (weakest) {
      recommendations.push(`Подтянуть отстающий документ: ${truncateText(weakest.title, 60)} (${weakest.progress.percent}%).`);
    }
  }

  if (payload.evidence.length > 0) {
    const lead = payload.evidence[0];
    recommendations.push(`Начать с [H${lead.index}] ${truncateText(lead.documentTitle, 36)} · стр. ${lead.page}.`);
  }

  if (recommendations.length === 0) {
    recommendations.push('Недостаточно данных: добавьте выделения, заметки и теги для анализа.');
  }

  return recommendations.slice(0, allowed);
}

function buildPrompt(payload) {
  const depthPreset = DEPTH_PRESETS[payload.depth] || DEPTH_PRESETS.balanced;

  const lines = [];
  lines.push('Ты AI-аналитик библиотеки чтения.');
  lines.push('Ты работаешь только по переданному контексту и только на русском языке.');
  lines.push('Запрещено выдумывать источники, страницы, книги, факты и цитаты.');
  lines.push('Каждый вывод должен ссылаться на опорные фрагменты вида [H1], [H2], ...');
  lines.push('');

  lines.push(`Режим: ${payload.mode}.`);
  lines.push(`Глубина анализа: ${payload.depth}.`);
  lines.push(`Вопрос пользователя: ${payload.question || 'не задан'}.`);
  lines.push(`SRS due: ${payload.srs.dueCount}; total cards: ${payload.srs.cards.length}.`);
  lines.push(`Digest: ${payload.digest.stats.pages} стр., ${payload.digest.stats.highlights} выделений.`);
  lines.push(`Summary highlights: ${payload.summary.usedHighlightsCount}.`);
  lines.push(`Контекст: документов ${payload.contextStats.documents}, выделений ${payload.contextStats.highlights}, заметок ${payload.contextStats.highlightsWithNotes}, тегированных ${payload.contextStats.highlightsWithTags}.`);

  if (payload.topConcepts.length > 0) {
    lines.push(`Ключевые концепты: ${payload.topConcepts.slice(0, 12).map((item) => `${item.concept}(${item.weight})`).join(', ')}.`);
  }

  lines.push('');
  lines.push('Профили документов:');
  for (const profile of payload.documentProfiles.slice(0, 16)) {
    lines.push(`- ${profile.title}: highlights=${profile.highlights}, notes=${profile.notes}, tagged=${profile.tagged}, progress=${profile.progress.percent}% (${profile.progress.maxReadPage}/${profile.progress.totalPages || '—'}).`);
  }

  lines.push('');
  lines.push('Опорные фрагменты:');

  let budget = 0;
  for (const item of payload.evidence) {
    const row = [
      `[H${item.index}] ${item.documentTitle} · стр. ${item.page} · score=${item.score}`,
      `Текст: ${truncateText(item.text, 600)}`,
      item.note ? `Заметка: ${truncateText(item.note, 230)}` : '',
      item.tags?.length ? `Теги: ${item.tags.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    if (budget + row.length > depthPreset.promptBudget) {
      break;
    }

    budget += row.length;
    lines.push(row);
    lines.push('');
  }

  lines.push('Формат ответа (строго markdown):');
  lines.push('## Executive Summary');
  lines.push('Коротко 5-7 пунктов с [Hn].');
  lines.push('## Cross-Book Patterns');
  lines.push('Общие закономерности между книгами/главами (до 7 пунктов).');
  lines.push('## Blind Spots and Risks');
  lines.push('Пробелы, противоречия, риск ложного понимания (до 6 пунктов).');
  lines.push('## 7-Day Action Plan');
  lines.push('План на 7 дней в формате D1..D7.');
  lines.push('## Review First');
  lines.push('Что повторить первым прямо сейчас (до 8 пунктов).');
  lines.push('## Direct Answer');
  lines.push('Прямой ответ на вопрос пользователя (если вопрос задан).');
  lines.push('## Citations Used');
  lines.push('Список [Hn] с кратким комментарием по использованию.');

  return lines.join('\n');
}

function resolveApiRuntime() {
  const apiUrl = normalizeInlineText(process.env.RECALL_AI_API_URL || DEFAULT_API_URL);
  const apiKey = normalizeInlineText(
    process.env.RECALL_AI_API_KEY ||
      process.env.OPENROUTER_API_KEY ||
      process.env.OPENAI_API_KEY ||
      EMBEDDED_AI_API_KEY,
  );
  const model = normalizeInlineText(process.env.RECALL_AI_MODEL || FREE_DEFAULT_API_MODEL);
  const authMode = normalizeInlineText(process.env.RECALL_AI_AUTH_MODE || 'auto').toLowerCase();
  return { apiUrl, apiKey, model, authMode };
}

function extractApiText(json) {
  const direct = normalizeInlineText(json?.output_text || '');
  if (direct) {
    return direct;
  }

  const choiceText = normalizeInlineText(json?.choices?.[0]?.message?.content || '');
  if (choiceText) {
    return choiceText;
  }

  const messageContent = json?.choices?.[0]?.message?.content;
  if (Array.isArray(messageContent)) {
    const parts = messageContent
      .map((item) => normalizeInlineText(item?.text || item?.content || ''))
      .filter(Boolean);
    return normalizeInlineText(parts.join('\n'));
  }

  return '';
}

async function generateWithApi(payload, options = {}) {
  const runtimeBase = resolveApiRuntime();
  const runtime = {
    ...runtimeBase,
    model: normalizeInlineText(options.model || runtimeBase.model),
  };

  if (!runtime.apiUrl) {
    throw new Error('Не задан AI API URL.');
  }
  if (!runtime.apiKey) {
    throw new Error('Не задан AI API ключ (RECALL_AI_API_KEY).');
  }
  if (!runtime.model) {
    throw new Error('Не задана AI модель (RECALL_AI_MODEL).');
  }

  const depthPreset = DEPTH_PRESETS[payload.depth] || DEPTH_PRESETS.balanced;
  const prompt = buildPrompt(payload);
  const urlLower = runtime.apiUrl.toLowerCase();
  const isOpenRouter = urlLower.includes('openrouter.ai');
  const hasOpenRouterKeyFormat = /^sk-or-v1-[a-z0-9]+$/i.test(runtime.apiKey);
  const headers = {
    'Content-Type': 'application/json',
  };
  const authMode = runtime.authMode;
  if (authMode === 'bearer' || authMode === 'auto') {
    headers.Authorization = `Bearer ${runtime.apiKey}`;
  } else if (authMode === 'token') {
    headers.Authorization = runtime.apiKey;
  }
  if (authMode === 'apikey' || authMode === 'auto') {
    headers['X-API-Key'] = runtime.apiKey;
    headers['api-key'] = runtime.apiKey;
  }
  if (isOpenRouter) {
    headers['HTTP-Referer'] = 'https://recall.local';
    headers['X-Title'] = 'Recall PDF';
  }

  const response = await fetch(runtime.apiUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: runtime.model,
      messages: [
        {
          role: 'system',
          content:
            'Ты AI-аналитик чтения. Отвечай на русском. Используй только переданный контекст и ссылки [Hn].',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.15,
      max_tokens: depthPreset.maxOutputTokens,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    const bodyLower = String(body || '').toLowerCase();
    if (response.status >= 500 && bodyLower.includes('servers restarting')) {
      throw new Error('AI API временно недоступен: серверы ArliAI перезапускаются. Повторите через 5 минут.');
    }
    if (response.status === 401 && isOpenRouter) {
      throw new Error(
        hasOpenRouterKeyFormat
          ? 'AI API HTTP 401: OpenRouter отклонил ключ. Проверьте права/лимиты ключа.'
          : 'AI API HTTP 401: для OpenRouter нужен ключ формата sk-or-v1-... (текущий ключ UUID-формата). Укажите корректный endpoint в RECALL_AI_API_URL для вашего UUID-ключа.',
      );
    }
    throw new Error(`AI API HTTP ${response.status}: ${body.slice(0, 280)}`);
  }

  const json = await response.json();
  const text = extractApiText(json);
  if (!text) {
    throw new Error('AI API вернул пустой ответ.');
  }

  const usage = json?.usage || {};

  return {
    provider: `api:${runtime.model}`,
    text,
    model: runtime.model,
    endpoint: runtime.apiUrl,
    promptChars: prompt.length,
    evalCount: Number(usage?.completion_tokens || 0),
    promptEvalCount: Number(usage?.prompt_tokens || 0),
  };
}

function formatLocalAnswer(payload, recommendations) {
  const lines = [];

  lines.push('# Executive Summary');
  lines.push(`- Контекст: ${payload.contextStats.documents} док., ${payload.contextStats.highlights} выделений.`);
  lines.push(`- SRS due: ${payload.srs.dueCount}, digest: ${payload.digest.stats.pages} стр./${payload.digest.stats.highlights} выдел.`);
  if (payload.topConcepts.length > 0) {
    lines.push(`- Ключевые концепты: ${payload.topConcepts.slice(0, 6).map((item) => item.concept).join(', ')}.`);
  }
  lines.push(`- Inbox без обработки: ${payload.contextStats.inboxHighlights}.`);

  lines.push('');
  lines.push('# Cross-Book Patterns');
  if (payload.documentProfiles.length > 0) {
    for (const profile of payload.documentProfiles.slice(0, 4)) {
      lines.push(`- ${profile.title}: ${profile.highlights} выделений, прогресс ${profile.progress.percent}%.`);
    }
  } else {
    lines.push('- Недостаточно данных для кросс-книжного анализа.');
  }

  lines.push('');
  lines.push('# Blind Spots and Risks');
  if (payload.contextStats.inboxHighlights > 0) {
    lines.push(`- Много необработанных выделений без тегов/заметок: ${payload.contextStats.inboxHighlights}.`);
  }
  lines.push('- Уточните вопрос для более узкого анализа: текущий ответ построен из общей выборки.');

  lines.push('');
  lines.push('# 7-Day Action Plan');
  for (let index = 0; index < Math.min(7, recommendations.length); index += 1) {
    lines.push(`- D${index + 1}: ${recommendations[index]}`);
  }

  lines.push('');
  lines.push('# Review First');
  if (payload.evidence.length > 0) {
    for (const item of payload.evidence.slice(0, 6)) {
      lines.push(`- [H${item.index}] ${item.documentTitle} · стр. ${item.page}: ${truncateText(item.text, 170)}`);
    }
  } else {
    lines.push('- Нет релевантных фрагментов для приоритизации.');
  }

  lines.push('');
  lines.push('# Direct Answer');
  if (payload.question) {
    lines.push(`- Вопрос: ${payload.question}`);
    if (payload.evidence.length > 0) {
      lines.push(`- Основной опорный фрагмент: [H${payload.evidence[0].index}] ${truncateText(payload.evidence[0].text, 220)}`);
    } else {
      lines.push('- Для ответа недостаточно релевантных цитат в текущем фильтре.');
    }
  } else {
    lines.push('- Пользовательский вопрос не задан; сформирован общий план повторения.');
  }

  lines.push('');
  lines.push('# Citations Used');
  if (payload.evidence.length > 0) {
    for (const item of payload.evidence.slice(0, 8)) {
      lines.push(`- [H${item.index}] ${item.documentTitle} · стр. ${item.page} (score ${item.score})`);
    }
  } else {
    lines.push('- Нет доступных цитат.');
  }

  return lines.join('\n');
}

function buildResultBase(nowIso, payload, input) {
  return {
    generatedAt: nowIso,
    mode: payload.mode,
    provider: input.provider,
    question: payload.question || undefined,
    text: input.text,
    recommendations: payload.recommendations,
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
    engine: {
      runtime: input.runtime,
      model: input.model,
      endpoint: input.endpoint,
      depth: payload.depth,
      warnings: input.warnings || [],
      promptChars: input.promptChars,
      evidenceUsed: payload.evidence.length,
      evalCount: input.evalCount,
      promptEvalCount: input.promptEvalCount,
      latencyMs: input.latencyMs,
      installHint: input.installHint,
    },
  };
}

async function generateAiAssistantBrief(db, options = {}) {
  const nowIso = new Date().toISOString();
  const startedAt = Date.now();

  const mode = getReadingMode(options.mode);
  const provider = resolveProvider(options.provider);
  const depth = getAnalysisDepth(options.analysisDepth);
  const documentIds = resolveDocumentIds(options);
  const question = cleanOcrText(options.question || options.task || '');

  const depthPreset = DEPTH_PRESETS[depth] || DEPTH_PRESETS.balanced;
  const maxActions = clampInt(options.maxActions, depthPreset.maxActions, 3, 20);
  const maxEvidence = clampInt(options.maxEvidence, depthPreset.evidenceLimit, 8, 64);
  const selectedModel = resolveApiRuntime().model;

  const srs = generateSrsDeck(db, {
    documentIds,
    dueOnly: true,
    limit: 280,
  });
  const digest = buildReadingDigest(db, {
    period: mode === 'review' ? 'weekly' : 'daily',
    documentIds,
  });
  const summary = summarizeHighlights(db, {
    documentId: documentIds?.length === 1 ? documentIds[0] : undefined,
    maxSentences: mode === 'focus' ? 6 : 10,
  });

  const context = collectHighlightContext(db, documentIds);
  const topConcepts = context.topConcepts.slice(0, 10);
  const documentProfiles = context.documentProfiles;
  const evidence = pickEvidenceHighlights(context, question, depth, maxEvidence);
  const contextStats = buildContextStats(context);

  const payload = {
    mode,
    depth,
    question,
    srs,
    digest,
    summary,
    topConcepts,
    documentProfiles,
    contextStats,
    evidence,
    recommendations: [],
  };

  payload.recommendations = buildLocalPlan(payload, maxActions);

  const localText = formatLocalAnswer(payload, payload.recommendations);

  if (provider === 'local') {
    return buildResultBase(nowIso, payload, {
      provider: 'local',
      runtime: 'local',
      model: 'heuristic-local',
      endpoint: '',
      text: localText,
      warnings: ['Запущен локальный fallback без LLM.'],
      promptChars: 0,
      latencyMs: Math.max(0, Date.now() - startedAt),
    });
  }

  const tryApi = async () => {
    const remote = await generateWithApi(payload, { model: selectedModel });
    return buildResultBase(nowIso, payload, {
      provider: remote.provider,
      runtime: 'api',
      model: remote.model,
      endpoint: remote.endpoint,
      text: remote.text,
      warnings: [],
      promptChars: remote.promptChars,
      evalCount: remote.evalCount,
      promptEvalCount: remote.promptEvalCount,
      latencyMs: Math.max(0, Date.now() - startedAt),
      installHint: 'AI runtime управляется приложением и скрыт от пользователя.',
    });
  };

  if (provider === 'api') {
    try {
      return await tryApi();
    } catch (error) {
      const reason = String(error?.message || error);
      return buildResultBase(nowIso, payload, {
        provider: 'local:fallback-api',
        runtime: 'local',
        model: 'heuristic-local',
        endpoint: resolveApiRuntime().apiUrl,
        text: `${localText}\n\n[LLM fallback reason] ${reason}`,
        warnings: [reason],
        promptChars: 0,
        latencyMs: Math.max(0, Date.now() - startedAt),
        installHint: 'Обратитесь к администратору: AI runtime управляется приложением.',
      });
    }
  }

  try {
    return await tryApi();
  } catch (error) {
    const reason = String(error?.message || error);
    return buildResultBase(nowIso, payload, {
      provider: 'local:auto-fallback',
      runtime: 'local',
      model: 'heuristic-local',
      endpoint: resolveApiRuntime().apiUrl,
      text: `${localText}\n\n[LLM fallback reason] ${reason}`,
      warnings: [reason],
      promptChars: 0,
      latencyMs: Math.max(0, Date.now() - startedAt),
      installHint: 'Обратитесь к администратору: AI runtime управляется приложением.',
    });
  }
}

module.exports = {
  generateAiAssistantBrief,
  __private: {
    FREE_DEFAULT_API_MODEL,
    FREE_MODEL_ALIASES,
    DEPTH_PRESETS,
    getAnalysisDepth,
  },
};
