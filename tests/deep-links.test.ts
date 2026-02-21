import { describe, expect, it } from 'vitest';
import {
  buildAbsoluteDeepLink,
  buildDeepLink,
  buildExternalDeepLink,
  parseDeepLink,
} from '../app/renderer/src/app/lib/deepLinks';

describe('deep links', () => {
  it('parses internal hash deep links', () => {
    expect(
      parseDeepLink('#/reader?documentId=doc-1&page=12&highlightId=hl-7&search=query'),
    ).toEqual({
      view: 'reader',
      documentId: 'doc-1',
      pageIndex: 12,
      highlightId: 'hl-7',
      search: 'query',
      smartViewId: undefined,
    });
  });

  it('parses external recall deep links', () => {
    expect(
      parseDeepLink('recall://open?view=highlights&documentId=doc-2&smartViewId=view-1'),
    ).toEqual({
      view: 'highlights',
      documentId: 'doc-2',
      pageIndex: undefined,
      highlightId: undefined,
      search: undefined,
      smartViewId: 'view-1',
    });
  });

  it('builds internal and external deep links', () => {
    const payload = {
      view: 'reader' as const,
      documentId: 'doc-1',
      pageIndex: 4,
      highlightId: 'hl-2',
    };

    expect(buildDeepLink(payload)).toBe('#/reader?documentId=doc-1&page=4&highlightId=hl-2');
    expect(buildExternalDeepLink(payload)).toBe(
      'recall://open?view=reader&documentId=doc-1&page=4&highlightId=hl-2',
    );
  });

  it('uses external links as absolute fallback outside browser origin context', () => {
    expect(
      buildAbsoluteDeepLink({
        view: 'library',
      }),
    ).toBe('recall://open?view=library');
  });

  it('supports insights view in deep links', () => {
    expect(parseDeepLink('#/insights?documentId=doc-1')).toEqual({
      view: 'insights',
      documentId: 'doc-1',
      pageIndex: undefined,
      highlightId: undefined,
      search: undefined,
      smartViewId: undefined,
    });
  });
});
