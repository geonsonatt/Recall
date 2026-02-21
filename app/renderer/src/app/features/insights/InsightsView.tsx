import { useEffect, useMemo, useState } from 'react';
import {
  buildReadingDigest,
  generateAiAssistantBrief,
  generateSrsDeck,
  summarizeHighlights,
} from '../../api';
import { LiquidSurface } from '../../components/LiquidSurface';
import { formatDateTime, truncate, truncateSelectionText } from '../../lib/format';
import { useRenderProfiler } from '../../lib/perfProfiler';
import type {
  AiAssistantResult,
  DigestResult,
  DocumentRecord,
  HighlightRecord,
  HighlightSummaryResult,
  SrsCard,
  SrsDeckResult,
  WorkspacePreset,
} from '../../types';

interface InsightsViewProps {
  workspacePreset: WorkspacePreset;
  documents: DocumentRecord[];
  activeDocumentId: string | null;
  onNotify: (message: string, type?: 'info' | 'error' | 'success') => void;
  onOpenReaderHighlight: (documentId: string, pageIndex: number, highlightId?: string) => void;
  onReviewSrsCard: (
    highlightId: string,
    grade: 'hard' | 'good' | 'easy',
  ) => Promise<HighlightRecord>;
}

const AI_QUICK_PROMPTS = [
  'Что повторить в первую очередь?',
  'Где у меня слабые места в понимании?',
  'Собери план на 30 минут повторения.',
  'Какие идеи из книги наиболее прикладные?',
] as const;

function normalizeDocFilter(value: string, documents: DocumentRecord[]) {
  if (value === 'all') {
    return 'all';
  }
  return documents.some((document) => document.id === value) ? value : 'all';
}

function copyToClipboard(value: string) {
  const text = String(value || '').trim();
  if (!text) {
    return Promise.resolve(false);
  }

  if (!navigator?.clipboard?.writeText) {
    return Promise.resolve(false);
  }

  return navigator.clipboard
    .writeText(text)
    .then(() => true)
    .catch(() => false);
}

function documentIdsForFilter(documentFilter: string): string[] | undefined {
  if (documentFilter === 'all') {
    return undefined;
  }
  return [documentFilter];
}

function getCurrentCard(srsDeck: SrsDeckResult | null, index: number): SrsCard | null {
  if (!srsDeck || srsDeck.cards.length === 0) {
    return null;
  }
  return srsDeck.cards[Math.max(0, Math.min(index, srsDeck.cards.length - 1))] || null;
}

export function InsightsView({
  workspacePreset,
  documents,
  activeDocumentId,
  onNotify,
  onOpenReaderHighlight,
  onReviewSrsCard,
}: InsightsViewProps) {
  useRenderProfiler('InsightsView');

  const [documentFilter, setDocumentFilter] = useState<string>(activeDocumentId || 'all');

  const [srsLoading, setSrsLoading] = useState(false);
  const [srsDeck, setSrsDeck] = useState<SrsDeckResult | null>(null);
  const [srsIndex, setSrsIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [reviewing, setReviewing] = useState(false);

  const [digestLoading, setDigestLoading] = useState(false);
  const [dailyDigest, setDailyDigest] = useState<DigestResult | null>(null);
  const [weeklyDigest, setWeeklyDigest] = useState<DigestResult | null>(null);

  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryResult, setSummaryResult] = useState<HighlightSummaryResult | null>(null);

  const [aiLoading, setAiLoading] = useState(false);
  const [aiMode, setAiMode] = useState<'focus' | 'research' | 'review'>('research');
  const [aiProvider, setAiProvider] = useState<'auto' | 'local' | 'ollama' | 'openai'>('auto');
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiResult, setAiResult] = useState<AiAssistantResult | null>(null);

  const [activeDigestPeriod, setActiveDigestPeriod] = useState<'daily' | 'weekly'>('daily');

  useEffect(() => {
    setDocumentFilter((current) => {
      if (activeDocumentId) {
        return normalizeDocFilter(activeDocumentId, documents);
      }
      return normalizeDocFilter(current, documents);
    });
  }, [activeDocumentId, documents]);

  useEffect(() => {
    if (workspacePreset === 'focus') {
      setActiveDigestPeriod('daily');
      setAiMode('focus');
    }
    if (workspacePreset === 'review') {
      setShowAnswer(true);
      setAiMode('review');
    }
    if (workspacePreset === 'research') {
      setAiMode('research');
    }
  }, [workspacePreset]);

  const selectedDocument = useMemo(
    () => documents.find((document) => document.id === documentFilter) || null,
    [documentFilter, documents],
  );

  const currentCard = useMemo(() => getCurrentCard(srsDeck, srsIndex), [srsDeck, srsIndex]);

  async function handleRefreshSrs(dueOnly = true) {
    setSrsLoading(true);
    try {
      const result = await generateSrsDeck({
        documentIds: documentIdsForFilter(documentFilter),
        dueOnly,
        limit: 180,
      });
      setSrsDeck(result);
      setSrsIndex(0);
      setShowAnswer(false);
      if (result.cards.length === 0) {
        onNotify('SRS: нет карточек для review.', 'info');
      }
    } catch (error: any) {
      onNotify(`SRS ошибка: ${String(error?.message || error)}`, 'error');
    } finally {
      setSrsLoading(false);
    }
  }

  async function handleReview(grade: 'hard' | 'good' | 'easy') {
    if (!currentCard || reviewing) {
      return;
    }

    setReviewing(true);
    try {
      await onReviewSrsCard(currentCard.highlightId, grade);
      onNotify(`Карточка оценена: ${grade}.`, 'success');

      setSrsDeck((current) => {
        if (!current) {
          return current;
        }

        const nextCards = current.cards.filter((card) => card.highlightId !== currentCard.highlightId);
        return {
          ...current,
          cards: nextCards,
          dueCount: Math.max(0, Number(current.dueCount || 0) - 1),
        };
      });
      setSrsIndex((index) => Math.max(0, index - 1));
      setShowAnswer(false);
    } catch (error: any) {
      onNotify(`Review ошибка: ${String(error?.message || error)}`, 'error');
    } finally {
      setReviewing(false);
    }
  }

  async function handleCopySrs() {
    const ok = await copyToClipboard(srsDeck?.markdown || '');
    onNotify(ok ? 'SRS markdown скопирован.' : 'Не удалось скопировать SRS markdown.', ok ? 'success' : 'error');
  }

  async function handleLoadDigest(period: 'daily' | 'weekly') {
    setDigestLoading(true);
    try {
      const result = await buildReadingDigest({
        period,
        documentIds: documentIdsForFilter(documentFilter),
      });
      if (period === 'daily') {
        setDailyDigest(result);
      } else {
        setWeeklyDigest(result);
      }
      setActiveDigestPeriod(period);
    } catch (error: any) {
      onNotify(`Digest ошибка: ${String(error?.message || error)}`, 'error');
    } finally {
      setDigestLoading(false);
    }
  }

  async function handleCopyDigest() {
    const digest = activeDigestPeriod === 'daily' ? dailyDigest : weeklyDigest;
    const ok = await copyToClipboard(digest?.markdown || '');
    onNotify(ok ? 'Digest скопирован.' : 'Не удалось скопировать digest.', ok ? 'success' : 'error');
  }

  async function handleSummarize() {
    setSummaryLoading(true);
    try {
      const result = await summarizeHighlights({
        documentId: documentFilter === 'all' ? undefined : documentFilter,
        maxSentences: 8,
      });
      setSummaryResult(result);
    } catch (error: any) {
      onNotify(`Summary ошибка: ${String(error?.message || error)}`, 'error');
    } finally {
      setSummaryLoading(false);
    }
  }

  async function handleCopySummary() {
    const ok = await copyToClipboard(summaryResult?.summary || '');
    onNotify(ok ? 'Summary скопирован.' : 'Не удалось скопировать summary.', ok ? 'success' : 'error');
  }

  async function handleRunAiAssistant() {
    setAiLoading(true);
    try {
      const result = await generateAiAssistantBrief({
        documentId: documentFilter === 'all' ? undefined : documentFilter,
        mode: aiMode,
        provider: aiProvider,
        question: aiQuestion.trim() || undefined,
        maxActions: 8,
      });
      setAiResult(result);
      onNotify(`AI анализ готов (${result.provider}).`, 'success');
    } catch (error: any) {
      onNotify(`AI ошибка: ${String(error?.message || error)}`, 'error');
    } finally {
      setAiLoading(false);
    }
  }

  async function handleCopyAiAnswer() {
    const ok = await copyToClipboard(aiResult?.text || '');
    onNotify(ok ? 'AI-ответ скопирован.' : 'Не удалось скопировать AI-ответ.', ok ? 'success' : 'error');
  }

  useEffect(() => {
    if (documents.length === 0) {
      return;
    }
    setAiResult(null);
    void handleRefreshSrs(true);
    void handleLoadDigest('daily');
  }, [documentFilter]);

  const activeDigest = activeDigestPeriod === 'daily' ? dailyDigest : weeklyDigest;

  return (
    <section className="view-shell">
      <LiquidSurface className="glass-panel view-header insights-header">
        <div className="insights-header-main">
          <h1>Insights</h1>
          <p className="muted">Единый центр повторения: AI-анализ по книгам и хайлайтам, SRS, digest и chapter summary.</p>
          <div className="insights-stats-row">
            <span className="chip">Документов: {documents.length}</span>
            <span className="chip">Фильтр: {selectedDocument ? truncate(selectedDocument.title, 46) : 'Вся библиотека'}</span>
            <span className="chip">SRS в очереди: {srsDeck?.cards.length || 0}</span>
          </div>
        </div>
        <div className="action-row header-actions insights-header-actions">
          <label>
            Контекст
            <select
              value={documentFilter}
              onChange={(event) => setDocumentFilter(normalizeDocFilter(event.target.value, documents))}
            >
              <option value="all">Вся библиотека</option>
              {documents.map((document) => (
                <option key={document.id} value={document.id}>
                  {truncate(document.title, 72)}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="btn secondary" onClick={() => void handleRefreshSrs(true)} disabled={srsLoading}>
            {srsLoading ? 'Обновление…' : 'Обновить SRS'}
          </button>
          <button type="button" className="btn ghost" onClick={() => void handleRefreshSrs(false)} disabled={srsLoading}>
            Все карточки
          </button>
        </div>
      </LiquidSurface>

      <section className="insights-grid">
        <LiquidSurface className="glass-panel insights-card insights-card-wide insights-card-ai">
          <div className="table-head">
            <h2>AI Ассистент библиотеки</h2>
            <span className="muted">{aiResult ? aiResult.provider : 'assistant'}</span>
          </div>
          <p className="muted">Ассистент строит ответ по книгам, хайлайтам, заметкам и текущему прогрессу чтения с цитатами-источниками.</p>
          <div className="insights-ai-controls">
            <label>
              Режим
              <select
                value={aiMode}
                onChange={(event) => setAiMode(event.target.value as 'focus' | 'research' | 'review')}
              >
                <option value="focus">Focus</option>
                <option value="research">Research</option>
                <option value="review">Review</option>
              </select>
            </label>
            <label>
              Провайдер
              <select
                value={aiProvider}
                onChange={(event) => setAiProvider(event.target.value as 'auto' | 'local' | 'ollama' | 'openai')}
              >
                <option value="auto">auto</option>
                <option value="local">local</option>
                <option value="ollama">ollama</option>
                <option value="openai">openai</option>
              </select>
            </label>
          </div>
          <label>
            Вопрос (опционально)
            <input
              type="text"
              value={aiQuestion}
              placeholder="Например: что повторять в первую очередь и почему?"
              onChange={(event) => setAiQuestion(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void handleRunAiAssistant();
                }
              }}
            />
          </label>
          <div className="insights-prompt-hints">
            {AI_QUICK_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                className="btn ghost"
                onClick={() => {
                  setAiQuestion(prompt);
                }}
              >
                {prompt}
              </button>
            ))}
          </div>
          <div className="action-row compact">
            <button type="button" className="btn primary" onClick={() => void handleRunAiAssistant()} disabled={aiLoading}>
              {aiLoading ? 'Анализ…' : 'Запустить AI-анализ'}
            </button>
            <button type="button" className="btn ghost" onClick={() => void handleCopyAiAnswer()}>
              Копировать ответ
            </button>
          </div>
          {aiResult ? (
            <div className="insights-block-scroll insights-ai-result">
              <div className="insights-stats-row">
                <span className="chip">due: {aiResult.metrics.dueCount}</span>
                <span className="chip">pages: {aiResult.metrics.digestPages}</span>
                <span className="chip">highlights: {aiResult.metrics.digestHighlights}</span>
                <span className="chip">summary: {aiResult.metrics.summaryHighlights}</span>
                {aiResult.contextStats ? (
                  <>
                    <span className="chip">контекст: {aiResult.contextStats.highlights}</span>
                    <span className="chip">с заметками: {aiResult.contextStats.highlightsWithNotes}</span>
                    <span className="chip">inbox: {aiResult.contextStats.inboxHighlights}</span>
                  </>
                ) : null}
              </div>
              <pre className="insights-pre">{aiResult.text}</pre>
              {aiResult.recommendations.length > 0 ? (
                <>
                  <p className="muted">Рекомендации:</p>
                  <ul className="insights-recommendations">
                    {aiResult.recommendations.map((item, index) => (
                      <li key={`${index}-${item}`}>{item}</li>
                    ))}
                  </ul>
                </>
              ) : null}
              {aiResult.evidence?.length ? (
                <>
                  <p className="muted">Опорные фрагменты:</p>
                  <div className="insights-citations">
                    {aiResult.evidence.slice(0, 8).map((citation) => (
                      <article key={`${citation.highlightId}-${citation.index}`} className="insights-citation-card">
                        <p>
                          <strong>[{citation.index}] {truncate(citation.documentTitle, 64)}</strong> · стр. {citation.page}
                        </p>
                        <p>{truncateSelectionText(citation.text, 220)}</p>
                        {citation.note ? <p className="muted">Заметка: {truncateSelectionText(citation.note, 140)}</p> : null}
                        <div className="action-row compact">
                          <button
                            type="button"
                            className="btn secondary"
                            onClick={() => onOpenReaderHighlight(citation.documentId, citation.pageIndex, citation.highlightId)}
                          >
                            Открыть
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                </>
              ) : null}
            </div>
          ) : (
            <p className="muted">Запустите AI-анализ для плана повторения и рекомендаций по вашим книгам.</p>
          )}
        </LiquidSurface>

        <LiquidSurface className="glass-panel insights-card">
          <div className="table-head">
            <h2>SRS Review</h2>
            <span className="muted">Due: {srsDeck?.dueCount || 0}</span>
          </div>
          {currentCard ? (
            <div className="srs-review-card">
              <div className="srs-meta">
                <span className="chip">{truncate(currentCard.documentTitle, 42)}</span>
                <span className="chip">стр. {currentCard.page}</span>
                {currentCard.nextReviewAt ? <span className="chip">след. {formatDateTime(currentCard.nextReviewAt)}</span> : null}
              </div>
              <p className="srs-front">{currentCard.front}</p>
              {showAnswer ? <p className="srs-back">{currentCard.back}</p> : null}
              <div className="action-row compact">
                <button type="button" className="btn ghost" onClick={() => setShowAnswer((value) => !value)}>
                  {showAnswer ? 'Скрыть ответ' : 'Показать ответ'}
                </button>
                <button
                  type="button"
                  className="btn secondary"
                  onClick={() => onOpenReaderHighlight(currentCard.documentId, currentCard.page - 1, currentCard.highlightId)}
                >
                  Открыть в читалке
                </button>
              </div>
              <div className="srs-grade-row">
                <button type="button" className="btn ghost danger" disabled={reviewing} onClick={() => void handleReview('hard')}>
                  Hard
                </button>
                <button type="button" className="btn secondary" disabled={reviewing} onClick={() => void handleReview('good')}>
                  Good
                </button>
                <button type="button" className="btn primary" disabled={reviewing} onClick={() => void handleReview('easy')}>
                  Easy
                </button>
              </div>
              <div className="action-row compact">
                <button type="button" className="btn ghost" onClick={() => void handleCopySrs()}>
                  Копировать deck markdown
                </button>
              </div>
            </div>
          ) : (
            <p className="muted">Очередь review пуста. Обновите SRS или снимите фильтр.</p>
          )}
        </LiquidSurface>

        <LiquidSurface className="glass-panel insights-card">
          <div className="table-head">
            <h2>Daily / Weekly Digest</h2>
            <span className="muted">Период: {activeDigestPeriod}</span>
          </div>
          <div className="action-row compact">
            <button type="button" className="btn secondary" onClick={() => void handleLoadDigest('daily')} disabled={digestLoading}>
              Daily
            </button>
            <button type="button" className="btn secondary" onClick={() => void handleLoadDigest('weekly')} disabled={digestLoading}>
              Weekly
            </button>
            <button type="button" className="btn ghost" onClick={() => void handleCopyDigest()}>
              Копировать digest
            </button>
          </div>
          {activeDigest ? (
            <div className="insights-block-scroll">
              <p className="muted">
                {activeDigest.range.label} · стр. {activeDigest.stats.pages} · мин. {Math.round(activeDigest.stats.seconds / 60)} · хайлайтов {activeDigest.stats.highlights}
              </p>
              <pre className="insights-pre">{activeDigest.markdown}</pre>
            </div>
          ) : (
            <p className="muted">Сводка ещё не сформирована.</p>
          )}
        </LiquidSurface>

        <LiquidSurface className="glass-panel insights-card insights-card-wide">
          <div className="table-head">
            <h2>Авто-саммари главы</h2>
            <span className="muted">Extractive summary</span>
          </div>
          <div className="action-row compact">
            <button type="button" className="btn primary" onClick={() => void handleSummarize()} disabled={summaryLoading}>
              {summaryLoading ? 'Сборка…' : 'Сгенерировать summary'}
            </button>
            <button type="button" className="btn ghost" onClick={() => void handleCopySummary()}>
              Копировать summary
            </button>
          </div>
          {summaryResult ? (
            <div className="insights-block-scroll">
              <p className="muted">Хайлайтов в summary: {summaryResult.usedHighlightsCount}</p>
              <pre className="insights-pre">{summaryResult.summary}</pre>
            </div>
          ) : (
            <p className="muted">Summary ещё не сформирован.</p>
          )}
        </LiquidSurface>
      </section>
    </section>
  );
}
