import { useEffect, useMemo, useState } from 'react';
import { getDiagnosticsSnapshot, subscribeDiagnostics } from '../lib/diagnosticsCenter';
import {
  clearStatusCenter,
  dismissStatusOperation,
  retryStatusOperation,
} from '../lib/statusCenter';

function formatDuration(durationMs?: number): string {
  if (!Number.isFinite(Number(durationMs))) {
    return '—';
  }
  const value = Number(durationMs);
  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)}s`;
  }
  return `${Math.round(value)}ms`;
}

export function StatusCenter() {
  const [open, setOpen] = useState(false);
  const [showOnlyErrors, setShowOnlyErrors] = useState(false);
  const [snapshot, setSnapshot] = useState(() => getDiagnosticsSnapshot(60, 220));

  useEffect(() => {
    setSnapshot(getDiagnosticsSnapshot(60, 220));
    return subscribeDiagnostics(() => {
      setSnapshot(getDiagnosticsSnapshot(60, 220));
    });
  }, []);

  const visibleOperations = useMemo(() => {
    if (!showOnlyErrors) {
      return snapshot.status.operations;
    }
    return snapshot.status.operations.filter((operation) => operation.state === 'error');
  }, [showOnlyErrors, snapshot.status.operations]);

  return (
    <div className="status-center-shell">
      <button
        type="button"
        className={`btn ghost ${snapshot.status.pending > 0 || snapshot.status.errors > 0 ? 'active' : ''}`}
        onClick={() => {
          setOpen((value) => !value);
        }}
      >
        Состояние: {snapshot.status.pending}/{snapshot.status.errors}
      </button>

      {open ? (
        <aside className="glass-panel status-center-panel">
          <header className="status-center-head">
            <strong>Центр состояния</strong>
            <div className="action-row compact">
              <button
                type="button"
                className={`btn ghost ${showOnlyErrors ? 'active' : ''}`}
                onClick={() => setShowOnlyErrors((value) => !value)}
              >
                Только ошибки
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  clearStatusCenter('completed');
                }}
              >
                Очистить завершённые
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  setOpen(false);
                }}
              >
                Закрыть
              </button>
            </div>
          </header>

          <div className="status-center-stats">
            <span className="chip">Всего: {snapshot.status.total}</span>
            <span className="chip">Pending: {snapshot.status.pending}</span>
            <span className="chip">Errors: {snapshot.status.errors}</span>
            <span className="chip">Retry queue: {snapshot.status.retryQueue}</span>
          </div>

          <section className="status-center-list">
            {visibleOperations.length === 0 ? (
              <p className="muted">Операции отсутствуют.</p>
            ) : (
              visibleOperations.map((operation) => (
                <article
                  key={operation.id}
                  className={`status-operation-item state-${operation.state}`}
                >
                  <div className="status-operation-main">
                    <p>
                      <strong>{operation.name}</strong>{' '}
                      <span className="muted">
                        ({operation.scope}) · попытка {operation.attempts}
                      </span>
                    </p>
                    <p className="muted">
                      start: {operation.startedAt}
                      {operation.endedAt ? ` · end: ${operation.endedAt}` : ''}
                      {operation.durationMs !== undefined
                        ? ` · duration: ${formatDuration(operation.durationMs)}`
                        : ''}
                    </p>
                    {operation.documentId ? (
                      <p className="muted">
                        doc={operation.documentId}
                        {operation.highlightId ? ` · hl=${operation.highlightId}` : ''}
                      </p>
                    ) : null}
                    {operation.details ? <p>{operation.details}</p> : null}
                    {operation.errorMessage ? (
                      <p className="muted">
                        {operation.errorCode ? `[${operation.errorCode}] ` : ''}
                        {operation.errorMessage}
                      </p>
                    ) : null}
                  </div>
                  <div className="action-row compact">
                    {operation.state === 'error' && operation.retryable ? (
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => {
                          void retryStatusOperation(operation.id);
                        }}
                      >
                        Retry
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => {
                        dismissStatusOperation(operation.id);
                      }}
                    >
                      Убрать
                    </button>
                  </div>
                </article>
              ))
            )}
          </section>
        </aside>
      ) : null}
    </div>
  );
}
