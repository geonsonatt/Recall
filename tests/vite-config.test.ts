import { describe, expect, it } from 'vitest';

describe('renderer vite config', () => {
  it('uses expected build and dev server options', async () => {
    const mod: any = await import('../app/renderer/vite.config.mjs');
    const config = mod.default;

    expect(config.server.port).toBe(5180);
    expect(config.server.strictPort).toBe(true);
    expect(String(config.build.outDir)).toContain('dist/renderer');
    expect(Array.isArray(config.plugins)).toBe(true);
    expect(config.plugins.length).toBeGreaterThan(0);
  });
});
