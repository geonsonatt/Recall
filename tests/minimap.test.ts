import { describe, expect, it } from 'vitest';
import { buildMiniMapModel } from '../app/renderer/src/app/features/reader/lib/miniMap';

describe('reader mini map model', () => {
  it('builds buckets with read/current/highlight state', () => {
    const highlights = new Map<number, number>([
      [0, 1],
      [5, 3],
      [9, 1],
    ]);

    const model = buildMiniMapModel({
      totalPages: 12,
      currentPageIndex: 5,
      maxReadPageIndex: 7,
      highlightCountByPage: highlights,
      maxBuckets: 12,
    });

    expect(model.buckets.length).toBeGreaterThan(0);
    expect(model.highlightedPagesCount).toBe(3);
    expect(model.currentPositionRatio).toBeGreaterThan(0.3);
    expect(model.currentPositionRatio).toBeLessThan(0.6);
    expect(model.currentBucketIndex).toBeGreaterThanOrEqual(0);
    expect(model.maxBucketHighlights).toBeGreaterThanOrEqual(1);
    expect(model.readRatio).toBeGreaterThan(0.5);
    expect(model.readRatio).toBeLessThan(0.9);
    expect(model.pagesWithHighlights).toEqual([0, 5, 9]);
    expect(model.hotspots.length).toBeGreaterThan(0);
    expect(model.hotspots[0].pageIndex).toBe(5);
    expect(model.hotspots[0].highlightCount).toBe(3);

    const currentBucket = model.buckets.find((bucket) => bucket.isCurrent);
    expect(currentBucket).toBeTruthy();
    expect(currentBucket?.isRead).toBe(true);
    expect(Number(currentBucket?.relativeHighlightCount || 0)).toBeGreaterThanOrEqual(0);
    expect(Number(currentBucket?.relativeHighlightCount || 0)).toBeLessThanOrEqual(1);
    expect(Number(currentBucket?.highlightedPages || 0)).toBeGreaterThanOrEqual(0);

    const highlighted = model.buckets.filter((bucket) => bucket.highlightCount > 0);
    expect(highlighted.length).toBeGreaterThan(0);
  });

  it('returns empty model for empty document', () => {
    const model = buildMiniMapModel({
      totalPages: 0,
      currentPageIndex: 0,
      maxReadPageIndex: 0,
      highlightCountByPage: new Map(),
    });

    expect(model.buckets).toEqual([]);
    expect(model.highlightedPagesCount).toBe(0);
    expect(model.currentPositionRatio).toBe(0);
    expect(model.currentBucketIndex).toBe(-1);
    expect(model.maxBucketHighlights).toBe(0);
    expect(model.readRatio).toBe(0);
    expect(model.pagesWithHighlights).toEqual([]);
    expect(model.hotspots).toEqual([]);
  });
});
