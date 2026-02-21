import { useEffect, useMemo, useState } from 'react';
import {
  clearDebugTrace,
  exportDebugDump,
  getDebugConsoleEnabled,
  recordDebugTiming,
  setDebugGauge,
  setDebugConsoleEnabled,
} from '../lib/debugTrace';
import {
  getDiagnosticsOverlayVisible,
  getDiagnosticsSnapshot,
  setDiagnosticsEnabled,
  setDiagnosticsOverlayVisible,
  subscribeDiagnostics,
  toggleDiagnosticsTrayMode,
} from '../lib/diagnosticsCenter';
import { useRenderProfiler } from '../lib/perfProfiler';

interface DebugOverlayProps {
  activeDocumentId?: string | null;
}

function toSearchable(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

function downloadDebugDump() {
  const dump = exportDebugDump();
  const blob = new Blob([JSON.stringify(dump, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  link.href = url;
  link.download = `recall-debug-${stamp}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export function DebugOverlay({ activeDocumentId = null }: DebugOverlayProps) {
  const [eventLimit, setEventLimit] = useState(260);
  const [snapshot, setSnapshot] = useState(() => getDiagnosticsSnapshot(eventLimit));
  const [query, setQuery] = useState('');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [focusActiveDocument, setFocusActiveDocument] = useState(false);
  const [showMetrics, setShowMetrics] = useState(true);
  const [showEvents, setShowEvents] = useState(true);
  const [showProfiler, setShowProfiler] = useState(true);
  const [fps, setFps] = useState(0);
  const [avgFrameMs, setAvgFrameMs] = useState(0);
  const [heapUsedMb, setHeapUsedMb] = useState<number | null>(null);
  const [longTasksCount, setLongTasksCount] = useState(0);
  const [lastLongTaskMs, setLastLongTaskMs] = useState(0);

  useRenderProfiler('DebugOverlay', snapshot.enabled);

  useEffect(() => {
    setSnapshot(getDiagnosticsSnapshot(eventLimit));
    return subscribeDiagnostics(() => {
      setSnapshot(getDiagnosticsSnapshot(eventLimit));
    });
  }, [eventLimit]);

  const filteredEvents = useMemo(() => {
    const normalizedQuery = toSearchable(query);
    return snapshot.debug.events.filter((event) => {
      if (errorsOnly && event.level !== 'error') {
        return false;
      }
      if (focusActiveDocument && activeDocumentId && event.documentId !== activeDocumentId) {
        return false;
      }
      if (!normalizedQuery) {
        return true;
      }

      const haystack = [
        event.scope,
        event.level,
        event.type,
        event.name,
        event.actionId,
        event.documentId,
        event.highlightId,
        event.details,
        JSON.stringify(event.data ?? ''),
      ]
        .map((item) => toSearchable(item))
        .join(' ');
      return haystack.includes(normalizedQuery);
    });
  }, [activeDocumentId, errorsOnly, focusActiveDocument, query, snapshot.debug.events]);

  const filteredMetrics = useMemo(() => {
    const normalizedQuery = toSearchable(query);
    return snapshot.debug.metrics.filter((metric) => {
      if (!normalizedQuery) {
        return true;
      }
      const haystack = [
        metric.name,
        metric.kind,
        metric.key,
        JSON.stringify(metric.tags || {}),
      ]
        .map((item) => toSearchable(item))
        .join(' ');
      return haystack.includes(normalizedQuery);
    });
  }, [query, snapshot.debug.metrics]);

  const profilerSummary = useMemo(() => {
    const renderMetric = snapshot.debug.metrics.find((metric) => metric.name === 'ui.render.commit.ms');
    const syncLatencyMetric = snapshot.debug.metrics.find((metric) => metric.name === 'ipc.latency.ms');
    return {
      renderAvg: renderMetric?.avg ?? 0,
      renderMax: renderMetric?.max ?? 0,
      syncLatencyAvg: syncLatencyMetric?.avg ?? 0,
      syncLatencyMax: syncLatencyMetric?.max ?? 0,
    };
  }, [snapshot.debug.metrics]);

  useEffect(() => {
    if (!snapshot.enabled || !showProfiler || typeof window === 'undefined') {
      return;
    }

    let frameCount = 0;
    let frameTimeTotal = 0;
    let windowStart = performance.now();
    let lastFrameTs = windowStart;
    let rafId = 0;

    const loop = (timestamp: number) => {
      frameCount += 1;
      frameTimeTotal += Math.max(0, timestamp - lastFrameTs);
      lastFrameTs = timestamp;

      const elapsed = timestamp - windowStart;
      if (elapsed >= 1000) {
        const nextFps = elapsed > 0 ? (frameCount * 1000) / elapsed : 0;
        const nextFrameMs = frameCount > 0 ? frameTimeTotal / frameCount : 0;
        setFps(nextFps);
        setAvgFrameMs(nextFrameMs);
        setDebugGauge('ui.profiler.fps', nextFps, 'ui');
        recordDebugTiming('ui.profiler.frame.ms', nextFrameMs, 'ui');

        const memory = (performance as any)?.memory;
        if (memory && Number.isFinite(Number(memory.usedJSHeapSize))) {
          const usedMb = Number(memory.usedJSHeapSize) / (1024 * 1024);
          setHeapUsedMb(usedMb);
          setDebugGauge('ui.profiler.heap.used.mb', usedMb, 'ui');
        }

        frameCount = 0;
        frameTimeTotal = 0;
        windowStart = timestamp;
      }

      rafId = window.requestAnimationFrame(loop);
    };

    rafId = window.requestAnimationFrame(loop);
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [showProfiler, snapshot.enabled]);

  useEffect(() => {
    if (!snapshot.enabled || !showProfiler || typeof PerformanceObserver === 'undefined') {
      return;
    }

    let disposed = false;
    const observer = new PerformanceObserver((list) => {
      if (disposed) {
        return;
      }
      const entries = list.getEntries();
      if (!entries.length) {
        return;
      }

      setLongTasksCount((value) => value + entries.length);
      const lastDuration = Number(entries[entries.length - 1]?.duration || 0);
      setLastLongTaskMs(lastDuration);
      recordDebugTiming('ui.profiler.longtask.ms', lastDuration, 'ui');
      setDebugGauge('ui.profiler.longtask.count', entries.length, 'ui');
    });

    try {
      observer.observe({ entryTypes: ['longtask'] as any });
    } catch {
      return () => {
        disposed = true;
      };
    }

    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, [showProfiler, snapshot.enabled]);

  if (!snapshot.enabled || !snapshot.overlayVisible) {
    return null;
  }

  return (
    <aside className="glass-panel debug-overlay">
      <div className="debug-overlay-head">
        <strong>Debug Trace</strong>
        <div className="action-row compact">
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              setDiagnosticsOverlayVisible(false);
            }}
          >
            Закрыть
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              setDiagnosticsEnabled(false, {
                trayCapture: false,
                overlayVisible: false,
              });
            }}
          >
            Debug Off
          </button>
        </div>
      </div>

      <div className="debug-overlay-stats">
        <span className="chip">Events: {snapshot.debug.totalEvents}</span>
        <span className="chip">Dropped: {snapshot.debug.droppedEvents}</span>
        <span className="chip">Metrics: {snapshot.debug.metrics.length}</span>
        <span className="chip">Status pending: {snapshot.status.pending}</span>
        <span className="chip">Status errors: {snapshot.status.errors}</span>
        <span className="chip">Tray: {snapshot.trayCaptureEnabled ? 'on' : 'off'}</span>
      </div>

      <div className="debug-overlay-controls">
        <input
          type="text"
          placeholder="Фильтр по scope/action/id/error"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="action-row compact">
          <button
            type="button"
            className={`btn ghost ${errorsOnly ? 'active' : ''}`}
            onClick={() => setErrorsOnly((value) => !value)}
          >
            Только ошибки
          </button>
          <button
            type="button"
            className={`btn ghost ${focusActiveDocument ? 'active' : ''}`}
            onClick={() => setFocusActiveDocument((value) => !value)}
            disabled={!activeDocumentId}
          >
            Текущая книга
          </button>
          <button
            type="button"
            className={`btn ghost ${showMetrics ? 'active' : ''}`}
            onClick={() => setShowMetrics((value) => !value)}
          >
            Метрики
          </button>
          <button
            type="button"
            className={`btn ghost ${showEvents ? 'active' : ''}`}
            onClick={() => setShowEvents((value) => !value)}
          >
            События
          </button>
          <button
            type="button"
            className={`btn ghost ${showProfiler ? 'active' : ''}`}
            onClick={() => setShowProfiler((value) => !value)}
          >
            Profiler
          </button>
          <button
            type="button"
            className={`btn ghost ${snapshot.debug.consoleEnabled ? 'active' : ''}`}
            onClick={() => setDebugConsoleEnabled(!getDebugConsoleEnabled())}
          >
            Console
          </button>
        </div>

        <div className="action-row compact">
          <label className="debug-limit-label">
            Лимит
            <input
              type="number"
              min={80}
              max={1200}
              step={20}
              value={eventLimit}
              onChange={(event) => {
                const next = Math.max(80, Math.min(1200, Number(event.target.value || 260)));
                setEventLimit(next);
              }}
            />
          </label>
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              clearDebugTrace();
            }}
          >
            Очистить
          </button>
          <button
            type="button"
            className="btn secondary"
            onClick={() => {
              downloadDebugDump();
            }}
          >
            Export JSON
          </button>
        </div>
      </div>

      {showProfiler ? (
        <section className="debug-profiler-panel">
          <article className="debug-profiler-card">
            <p>
              <strong>FPS</strong>: {fps.toFixed(1)} · frame {avgFrameMs.toFixed(1)}ms
            </p>
            <p className="muted">
              render avg {profilerSummary.renderAvg.toFixed(1)}ms · max{' '}
              {profilerSummary.renderMax.toFixed(1)}ms
            </p>
            <p className="muted">
              sync latency avg {profilerSummary.syncLatencyAvg.toFixed(1)}ms · max{' '}
              {profilerSummary.syncLatencyMax.toFixed(1)}ms
            </p>
            <p className="muted">
              long tasks: {longTasksCount}
              {lastLongTaskMs > 0 ? ` · last ${lastLongTaskMs.toFixed(1)}ms` : ''}
              {heapUsedMb !== null ? ` · heap ${heapUsedMb.toFixed(1)} MB` : ''}
            </p>
          </article>
        </section>
      ) : null}

      {showMetrics ? (
        <section className="debug-metrics-list">
          {filteredMetrics.length === 0 ? (
            <p className="muted">Нет метрик по текущему фильтру.</p>
          ) : (
            filteredMetrics.slice(0, 120).map((metric) => (
              <article key={metric.key} className="debug-metric-item">
                <p>
                  <strong>{metric.name}</strong> <span className="muted">({metric.kind})</span>
                </p>
                <p className="muted">
                  count={metric.count} · avg={metric.avg.toFixed(1)} · min={metric.min.toFixed(1)} ·
                  max={metric.max.toFixed(1)} · last={metric.last.toFixed(1)}
                </p>
                {Object.keys(metric.tags).length > 0 ? (
                  <p className="muted">tags: {JSON.stringify(metric.tags)}</p>
                ) : null}
              </article>
            ))
          )}
        </section>
      ) : null}

      {showEvents ? (
        <section className="debug-events-list">
          {filteredEvents.length === 0 ? (
            <p className="muted">Нет событий по текущему фильтру.</p>
          ) : (
            filteredEvents.map((event) => (
              <article
                key={event.id}
                className={`debug-event-item ${event.level === 'error' ? 'error' : ''}`}
              >
                <p>
                  <code>{event.id}</code> · <strong>{event.scope}</strong> · {event.name}
                </p>
                <p className="muted">
                  {event.ts}
                  {event.actionId ? ` · action=${event.actionId}` : ''}
                  {event.documentId ? ` · doc=${event.documentId}` : ''}
                  {event.highlightId ? ` · hl=${event.highlightId}` : ''}
                  {Number.isFinite(Number(event.durationMs))
                    ? ` · ${Number(event.durationMs).toFixed(1)}ms`
                    : ''}
                </p>
                {event.details ? <p>{event.details}</p> : null}
                {event.data !== undefined ? <p className="muted">{JSON.stringify(event.data)}</p> : null}
              </article>
            ))
          )}
        </section>
      ) : null}
    </aside>
  );
}

export function DebugToggleButton() {
  const [snapshot, setSnapshot] = useState(() => getDiagnosticsSnapshot(40, 30));

  useEffect(() => {
    setSnapshot(getDiagnosticsSnapshot(40, 30));
    return subscribeDiagnostics(() => {
      setSnapshot(getDiagnosticsSnapshot(40, 30));
    });
  }, []);

  const enabled = snapshot.enabled;
  const label = enabled
    ? snapshot.trayCaptureEnabled
      ? 'Debug: Tray'
      : 'Debug: On'
    : 'Debug: Off';

  return (
    <button
      type="button"
      className={`btn ghost ${enabled ? 'active' : ''} ${snapshot.trayCaptureEnabled ? 'accent' : ''}`}
      title="Клик: вкл/выкл диагностику в трее. Shift+клик: открыть/скрыть панель."
      onClick={(event) => {
        if (event.shiftKey) {
          setDiagnosticsOverlayVisible(!getDiagnosticsOverlayVisible());
          return;
        }
        toggleDiagnosticsTrayMode();
      }}
    >
      {label}
    </button>
  );
}
