// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

function flushMicrotasks() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('diagnostics center', () => {
  beforeEach(() => {
    vi.resetModules();
    window.localStorage.clear();
    (window as any).recallApi = {
      setDiagnosticsTrayCapture: vi.fn().mockResolvedValue({ enabled: true, buffered: 0, total: 0 }),
      pushDiagnosticsEvents: vi.fn().mockResolvedValue({ accepted: 0, buffered: 0, total: 0 }),
    };
  });

  it('toggles tray diagnostics mode and syncs with main bridge', async () => {
    const diagnostics = await import('../app/renderer/src/app/lib/diagnosticsCenter');

    expect(diagnostics.getDiagnosticsSnapshot(40, 20).enabled).toBe(false);

    diagnostics.toggleDiagnosticsTrayMode();
    await flushMicrotasks();

    let snapshot = diagnostics.getDiagnosticsSnapshot(40, 20);
    expect(snapshot.enabled).toBe(true);
    expect(snapshot.trayCaptureEnabled).toBe(true);
    expect((window as any).recallApi.setDiagnosticsTrayCapture).toHaveBeenCalled();

    diagnostics.toggleDiagnosticsTrayMode();
    await flushMicrotasks();

    snapshot = diagnostics.getDiagnosticsSnapshot(40, 20);
    expect(snapshot.enabled).toBe(false);
    expect(snapshot.trayCaptureEnabled).toBe(false);
  });

  it('controls overlay visibility independently', async () => {
    const diagnostics = await import('../app/renderer/src/app/lib/diagnosticsCenter');

    diagnostics.setDiagnosticsEnabled(true, { trayCapture: false, overlayVisible: false });
    diagnostics.setDiagnosticsOverlayVisible(true);

    let snapshot = diagnostics.getDiagnosticsSnapshot(20, 20);
    expect(snapshot.enabled).toBe(true);
    expect(snapshot.overlayVisible).toBe(true);

    diagnostics.setDiagnosticsOverlayVisible(false);
    snapshot = diagnostics.getDiagnosticsSnapshot(20, 20);
    expect(snapshot.overlayVisible).toBe(false);
  });

  it('retries tray event forwarding after sync error without losing events', async () => {
    const diagnostics = await import('../app/renderer/src/app/lib/diagnosticsCenter');
    const debug = await import('../app/renderer/src/app/lib/debugTrace');

    const push = (window as any).recallApi.pushDiagnosticsEvents;
    push.mockRejectedValueOnce(new Error('sync-failed'));
    push.mockResolvedValue({ accepted: 2, buffered: 2, total: 2 });

    diagnostics.toggleDiagnosticsTrayMode();
    await flushMicrotasks();

    const firstEvent = debug.addDebugEvent('app', 'event.first', {
      details: 'first',
    });
    await flushMicrotasks();

    debug.addDebugEvent('app', 'event.second', {
      details: 'second',
    });
    await flushMicrotasks();

    expect(push.mock.calls.length).toBeGreaterThanOrEqual(2);
    const payloads = push.mock.calls
      .map((call: any[]) => call[0])
      .filter((payload: any) => Array.isArray(payload?.events));
    const hasRetriedFirstEvent = payloads.some((payload: any) =>
      payload.events.some((item: any) => item.id === firstEvent.id),
    );
    expect(hasRetriedFirstEvent).toBe(true);
  });
});
