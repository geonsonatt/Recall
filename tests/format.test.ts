import { describe, expect, it } from 'vitest';
import {
  clamp,
  formatDateTime,
  getDocumentProgress,
  normalizeHttpUrl,
  normalizeSelectionText,
  normalizeText,
  truncate,
  truncateSelectionText,
} from '../app/renderer/src/app/lib/format';

describe('format helpers', () => {
  it('normalizes selection text while preserving meaningful new lines', () => {
    const value = normalizeSelectionText('  Первая\u200b  строка\n\n   Вторая   строка   \n\n\nТретья  ');
    expect(value).toBe('Первая строка\n\nВторая строка\n\nТретья');
  });

  it('repairs uppercase words broken by PDF spacing', () => {
    const value = normalizeSelectionText('П Р Е Ц Е С С И Я  С И М У Л Я К Р О В');
    expect(value).toBe('ПРЕЦЕССИЯ СИМУЛЯКРОВ');
  });

  it('repairs PDF hyphenation and punctuation spacing artifacts', () => {
    const value = normalizeSelectionText('вектор изме-\nнений и ни одно обще\u00ad ство , да');
    expect(value).toBe('вектор изменений и ни одно общество, да');
  });

  it('validates and normalizes only http/https URLs', () => {
    expect(normalizeHttpUrl('https://example.com/path')).toBe('https://example.com/path');
    expect(normalizeHttpUrl('http://example.com')).toBe('http://example.com/');
    expect(normalizeHttpUrl('file:///tmp/local')).toBe('');
    expect(normalizeHttpUrl('javascript:alert(1)')).toBe('');
  });

  it('calculates document progress from max read page and clamps values', () => {
    const progress = getDocumentProgress({
      id: 'doc',
      title: 'Book',
      filePath: '/tmp/book.pdf',
      createdAt: '2026-02-19T10:00:00.000Z',
      highlightsCount: 0,
      lastReadTotalPages: 10,
      lastReadPageIndex: 2,
      maxReadPageIndex: 8,
    });

    expect(progress.progress).toBeCloseTo(0.9, 5);
    expect(progress.pageNumber).toBe(9);
    expect(progress.totalPages).toBe(10);
  });

  it('formats and truncates text safely', () => {
    expect(normalizeText('  a   b  ')).toBe('a b');
    expect(truncate('1234567890', 7)).toBe('123456…');
    expect(truncateSelectionText('  Строка   1\n\nСтрока   2 ', 14)).toBe('Строка 1\n\nСтр…');
    expect(clamp(20, 0, 10)).toBe(10);
    expect(clamp(-2, 0, 10)).toBe(0);
  });

  it('formats ISO datetime for ru locale and returns dash for invalid', () => {
    expect(formatDateTime('invalid')).toBe('—');
    expect(formatDateTime(undefined)).toBe('—');
    expect(formatDateTime('2026-02-19T12:34:00.000Z')).toMatch(/2026/);
  });
});
