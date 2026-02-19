import { describe, expect, it } from 'vitest';
import { checkForUpdates, compareVersions } from '../app/main/updateChecker.js';

describe('compareVersions', () => {
  it('compares semantic versions', () => {
    expect(compareVersions('1.2.0', '1.1.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.1')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0);
  });
});

describe('checkForUpdates', () => {
  it('returns disabled state when manifest url is missing', async () => {
    const result = await checkForUpdates({
      manifestUrl: '',
      currentVersion: '0.1.0',
      platform: 'linux',
      fetchImpl: async () => {
        throw new Error('fetch should not be called');
      },
    });

    expect(result.status).toBe('disabled');
    expect(result.updateAvailable).toBe(false);
  });

  it('returns update available state with platform download', async () => {
    const result = await checkForUpdates({
      manifestUrl: 'https://updates.example.com/update-manifest.json',
      currentVersion: '0.1.0',
      platform: 'linux',
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          version: '0.2.0',
          downloads: {
            linux: 'https://updates.example.com/PDF Recall Desktop-0.2.0.AppImage',
          },
        }),
      }),
    });

    expect(result.status).toBe('update-available');
    expect(result.latestVersion).toBe('0.2.0');
    expect(result.downloadUrl).toBe('https://updates.example.com/PDF%20Recall%20Desktop-0.2.0.AppImage');
  });
});
