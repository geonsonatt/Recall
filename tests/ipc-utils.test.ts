import { describe, expect, it } from 'vitest';
import {
  sanitizeFileName,
  getDefaultExportBaseName,
  timestampForFile,
  normalizeIds,
  pickOwnProps,
  isTrustedIpcSender,
  assertTrustedIpcSender,
} from '../app/main/ipcUtils.js';

describe('ipc utils', () => {
  it('sanitizes file names and creates fallback export names', () => {
    expect(sanitizeFileName('a<>:"/\\|?*b')).toBe('a b');
    expect(sanitizeFileName('  ')).toBe('');

    expect(
      getDefaultExportBaseName({
        id: 'abcdef123456',
        title: '',
      }),
    ).toBe('документ-abcdef12');
    expect(
      getDefaultExportBaseName({
        id: 'abcdef123456',
        title: '  Тест / Книга  ',
      }),
    ).toBe('Тест Книга');
  });

  it('normalizes identifiers and validates trusted IPC sender', () => {
    expect(normalizeIds(['a', 'a', 2, '', null])).toEqual(['a', '2', 'null']);
    expect(normalizeIds('bad')).toEqual([]);

    expect(
      isTrustedIpcSender(
        {
          senderFrame: { url: 'file:///tmp/index.html' },
        },
        '',
      ),
    ).toBe(true);

    expect(
      isTrustedIpcSender(
        {
          senderFrame: { url: 'http://localhost:5180/page' },
        },
        'http://localhost:5180',
      ),
    ).toBe(true);
    expect(
      isTrustedIpcSender(
        {
          senderFrame: { url: 'http://evil.test/page' },
        },
        'http://localhost:5180',
      ),
    ).toBe(false);

    expect(() =>
      assertTrustedIpcSender(
        {
          senderFrame: { url: 'http://evil.test' },
        },
        'library:list-documents',
        'http://localhost:5180',
      ),
    ).toThrow('Недоверенный IPC источник');
  });

  it('keeps only own properties from payload patch', () => {
    const source = Object.create({ inherited: 1 });
    source.keep = 'x';
    source.dropUndefined = undefined;

    const patch = pickOwnProps(source, ['keep', 'dropUndefined', 'missing', 'inherited']);
    expect(patch).toEqual({
      keep: 'x',
      dropUndefined: undefined,
    });
  });

  it('generates timestamp string for filesystem-safe names', () => {
    const value = timestampForFile();
    expect(value).toMatch(/^\d{8}-\d{6}$/);
  });
});
