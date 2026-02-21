import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => {
  class TrayMock {
    tooltip = '';
    menu: any = null;
    listeners = new Map<string, Function>();

    setToolTip(value: string) {
      this.tooltip = value;
    }

    setContextMenu(menu: any) {
      this.menu = menu;
    }

    on(event: string, handler: Function) {
      this.listeners.set(event, handler);
    }

    destroy() {
      this.listeners.clear();
    }
  }

  return {
    Tray: TrayMock,
    Menu: {
      buildFromTemplate: (template: any) => ({ template }),
    },
    clipboard: {
      writeText: vi.fn(),
    },
    nativeImage: {
      createFromDataURL: () => ({
        resize: () => ({})
      }),
    },
    shell: {
      showItemInFolder: vi.fn(),
    },
  };
});

describe('diagnostics tray', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('accepts events without id and handles circular data safely', async () => {
    const diagnosticsTray = await import('../app/main/diagnosticsTray.js');
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'recall-diag-tray-'));

    diagnosticsTray.initializeDiagnosticsTray({
      appName: 'Recall Test',
      userDataPath: tmpRoot,
    });
    diagnosticsTray.setDiagnosticsTrayCapture(true);

    const circular: any = { value: 1 };
    circular.self = circular;

    const result = diagnosticsTray.appendDiagnosticsEvents([
      {
        ts: 'broken-ts',
        scope: 'ui',
        name: 'ui.click',
        level: 'info',
        type: 'event',
        data: circular,
      },
    ]);

    expect(result.accepted).toBe(1);
    const state = diagnosticsTray.getDiagnosticsTrayState();
    expect(state.total).toBeGreaterThanOrEqual(1);

    diagnosticsTray.disposeDiagnosticsTray();
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });
});
