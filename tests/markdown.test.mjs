import { describe, it, expect } from 'vitest';
import markdownModule from '../app/export/markdown.js';

const { buildHighlightsMarkdown } = markdownModule;

describe('buildHighlightsMarkdown', () => {
  it('renders highlights with optional note lines', () => {
    const markdown = buildHighlightsMarkdown('Deep Work', [
      {
        pageIndex: 1,
        selectedText: 'Focus is the new IQ.',
        color: 'yellow',
        createdAt: '2025-01-01T10:00:00.000Z',
      },
      {
        pageIndex: 0,
        selectedText: 'You must train your concentration.',
        color: 'green',
        note: 'Use time-blocking daily',
        createdAt: '2025-01-01T09:00:00.000Z',
      },
    ]);

    expect(markdown).toBe(`# Deep Work

- p.1 — "You must train your concentration."
  Заметка: Use time-blocking daily
- p.2 — "Focus is the new IQ."
`);
  });

  it('preserves basic formatting from selectedRichText', () => {
    const markdown = buildHighlightsMarkdown('Форматирование', [
      {
        pageIndex: 2,
        selectedText: 'Это важно и курсив строка 2',
        selectedRichText:
          '<p>Это <strong>важно</strong> и <em>курсив</em><br>строка 2</p>',
        color: 'yellow',
        createdAt: '2026-02-19T10:00:00.000Z',
      },
    ]);

    expect(markdown).toBe(`# Форматирование

- p.3 —
  Это **важно** и *курсив*
  строка 2
`);
  });

  it('repairs PDF hyphenation artifacts in exported text', () => {
    const markdown = buildHighlightsMarkdown('Артефакты PDF', [
      {
        pageIndex: 4,
        selectedText: 'вектор изме- нений и ни одно обще­ ство',
        color: 'yellow',
        createdAt: '2026-02-19T10:00:00.000Z',
      },
    ]);

    expect(markdown).toBe(`# Артефакты PDF

- p.5 — "вектор изменений и ни одно общество"
`);
  });
});
