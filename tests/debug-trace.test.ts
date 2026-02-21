import { beforeEach, describe, expect, it } from 'vitest';
import {
  addDebugEvent,
  clearDebugTrace,
  getDebugSnapshot,
  incrementDebugCounter,
  recordDebugTiming,
  setDebugEnabled,
  startDebugAction,
} from '../app/renderer/src/app/lib/debugTrace';

describe('debug trace', () => {
  beforeEach(() => {
    clearDebugTrace();
    setDebugEnabled(false);
  });

  it('collects events and metrics with action lifecycle', () => {
    setDebugEnabled(true);
    addDebugEvent('app', 'boot');
    incrementDebugCounter('counter.x', 2, 'app');
    recordDebugTiming('timing.x', 12.7, 'app');

    const action = startDebugAction({
      scope: 'reader',
      name: 'document-load',
      documentId: 'doc-1',
    });
    action.finish(true, {
      details: 'ok',
      documentId: 'doc-1',
    });

    const snapshot = getDebugSnapshot(120);
    expect(snapshot.totalEvents).toBeGreaterThanOrEqual(5);
    expect(snapshot.metrics.some((metric) => metric.name === 'counter.x')).toBe(true);
    expect(snapshot.metrics.some((metric) => metric.name === 'timing.x')).toBe(true);
    expect(
      snapshot.events.some((event) => event.name === 'document-load:success' && event.scope === 'reader'),
    ).toBe(true);
  });

  it('tracks enabled flag and emits state event', () => {
    setDebugEnabled(true);
    const enabledSnapshot = getDebugSnapshot(40);
    expect(enabledSnapshot.enabled).toBe(true);
    expect(enabledSnapshot.events.some((event) => event.name === 'debug.enabled-changed')).toBe(true);

    setDebugEnabled(false);
    const disabledSnapshot = getDebugSnapshot(40);
    expect(disabledSnapshot.enabled).toBe(false);
  });
});
