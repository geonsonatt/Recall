// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __readerTestUtils as readerUtils,
} from '../app/renderer/src/app/features/reader/ReaderView';

describe('ReaderView helper utils', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('converts different binary payloads to ArrayBuffer', () => {
    const original = new ArrayBuffer(4);
    expect(readerUtils.toArrayBuffer(original)).toBe(original);

    const uint = new Uint8Array([1, 2, 3]);
    const result = readerUtils.toArrayBuffer(uint);
    expect(result).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(result)).toEqual(uint);

    const nodeLike = { type: 'Buffer', data: [4, 5, 6] };
    expect(new Uint8Array(readerUtils.toArrayBuffer(nodeLike))).toEqual(new Uint8Array([4, 5, 6]));

    expect(() => readerUtils.toArrayBuffer({} as any)).toThrow('Неподдерживаемый формат PDF-данных.');
  });

  it('extracts rich text from selection and falls back to plain text', () => {
    const host = document.createElement('div');
    host.innerHTML = '<p><b>Текст</b> <i>выделения</i></p>';
    document.body.appendChild(host);

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(host.querySelector('p')!);
    selection?.removeAllRanges();
    selection?.addRange(range);

    const rich = readerUtils.selectionToRichText(selection, 'fallback');
    expect(rich).toContain('<b>Текст</b>');
    expect(rich).toContain('<i>выделения</i>');

    expect(readerUtils.selectionToRichText(null, 'fallback')).toBe('fallback');
  });

  it('normalizes annotation payload and highlight selection helpers', () => {
    const annotation = {
      PageNumber: 2,
      Color: { R: 245, G: 210, B: 85 },
      getContents: () => '  заметка  ',
      getQuads: () => [{ x1: 10, y1: 90, x2: 30, y2: 90, x3: 30, y3: 100, x4: 10, y4: 100 }],
    };
    const documentViewer = {
      getDocument: () => ({
        getPageInfo: () => ({ width: 100, height: 100 }),
      }),
    };

    const payload = readerUtils.normalizeHighlightPayload(
      annotation,
      documentViewer,
      'Выделенный текст',
      '<p>Выделенный текст</p>',
    );
    expect(payload).toMatchObject({
      pageIndex: 1,
      selectedText: 'Выделенный текст',
      selectedRichText: '<p>Выделенный текст</p>',
      color: 'yellow',
      note: 'заметка',
    });
    expect(payload?.rects.length).toBe(1);

    expect(readerUtils.colorLabel('yellow')).toBe('Жёлтый');
    expect(readerUtils.colorLabel('green')).toBe('Зелёный');
    expect(readerUtils.colorLabel('pink')).toBe('Розовый');
    expect(readerUtils.colorLabel('blue')).toBe('Синий');
    expect(readerUtils.colorLabel('orange')).toBe('Оранжевый');
    expect(readerUtils.colorLabel('purple')).toBe('Фиолетовый');
  });

  it('does not ignore user annotation events during loading phase', () => {
    expect(
      readerUtils.shouldIgnoreAnnotationSyncEvent(false, {
        imported: false,
        source: 'recall-selection',
      }),
    ).toBe(false);

    expect(
      readerUtils.shouldIgnoreAnnotationSyncEvent(true, {
        imported: false,
        source: 'recall-selection',
      }),
    ).toBe(true);

    expect(
      readerUtils.shouldIgnoreAnnotationSyncEvent(false, {
        imported: true,
      }),
    ).toBe(true);

    expect(
      readerUtils.shouldIgnoreAnnotationSyncEvent(false, {
        source: 'recall-sync',
      }),
    ).toBe(true);
  });

  it('selects existing highlight annotation with retry', () => {
    const target = {
      getCustomData: vi.fn(() => 'hl-77'),
    };
    const annotationManager = {
      getAnnotationsList: vi.fn(() => [target]),
      deselectAllAnnotations: vi.fn(),
      selectAnnotation: vi.fn(),
    };

    const instance = {
      Core: {
        annotationManager,
      },
    };

    const selected = readerUtils.trySelectHighlightAnnotation(instance, 'hl-77');
    expect(selected).toBe(true);
    expect(annotationManager.selectAnnotation).toHaveBeenCalledWith(target);

    const delayedInstance = {
      Core: {
        annotationManager: {
          getAnnotationsList: vi
            .fn()
            .mockReturnValueOnce([])
            .mockReturnValueOnce([target]),
          deselectAllAnnotations: vi.fn(),
          selectAnnotation: vi.fn(),
        },
      },
    };

    readerUtils.selectHighlightAnnotationWithRetry(delayedInstance, 'hl-77', 2);
    vi.advanceTimersByTime(145);
    expect(delayedInstance.Core.annotationManager.selectAnnotation).toHaveBeenCalledWith(target);
  });

  it('normalizes selection quad groups and retries page navigation', async () => {
    const groups = readerUtils.extractSelectionQuadGroups({
      2: [{ x1: 1, y1: 2, x2: 3, y2: 2, x3: 3, y3: 4, x4: 1, y4: 4 }],
      5: [{ x1: 10, y1: 20, x2: 30, y2: 20, x3: 30, y3: 40, x4: 10, y4: 40 }],
    });
    expect(groups).toHaveLength(2);
    expect(groups[0].pageNumber).toBe(2);
    expect(groups[1].pageNumber).toBe(5);

    const normalized = readerUtils.normalizeSelectionQuadGroups({
      2: [{ x1: 1, y1: 2, x2: 3, y2: 2, x3: 3, y3: 4, x4: 1, y4: 4 }],
      5: [{ x1: 10, y1: 20, x2: 30, y2: 20, x3: 30, y3: 40, x4: 10, y4: 40 }],
    });
    expect(normalized).toHaveLength(2);
    expect(normalized[0].signature).toContain('1.0000:2.0000');
    expect(normalized[1].signature).toContain('10.0000:20.0000');

    const segments = readerUtils.splitSelectionTextByGroups(
      'Первый фрагмент текста второй фрагмент текста',
      normalized,
    );
    expect(segments).toHaveLength(2);
    expect(segments.join(' ')).toBe('Первый фрагмент текста второй фрагмент текста');

    const getCurrentPage = vi.fn()
      .mockReturnValueOnce(1)
      .mockReturnValueOnce(3);
    const documentViewer = {
      getPageCount: vi.fn(() => 10),
      setCurrentPage: vi.fn(),
      getCurrentPage,
    };
    const instance = {
      Core: {
        documentViewer,
      },
    };

    const promise = readerUtils.navigateToPageWithRetry(instance, 2, 3);
    await vi.advanceTimersByTimeAsync(260);
    const navigated = await promise;

    expect(navigated).toBe(true);
    expect(documentViewer.setCurrentPage).toHaveBeenCalled();
  });
});
