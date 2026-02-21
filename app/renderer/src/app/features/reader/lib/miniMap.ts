import { clamp } from '../../../lib/format';

export interface MiniMapBucket {
  index: number;
  startPageIndex: number;
  endPageIndex: number;
  targetPageIndex: number;
  label: string;
  highlightCount: number;
  relativeHighlightCount: number;
  highlightDensity: number;
  highlightedPages: number;
  isCurrent: boolean;
  isRead: boolean;
}

export interface MiniMapHotspot {
  pageIndex: number;
  highlightCount: number;
  relativeWeight: number;
}

export interface MiniMapModel {
  buckets: MiniMapBucket[];
  highlightedPagesCount: number;
  currentPositionRatio: number;
  currentBucketIndex: number;
  maxBucketHighlights: number;
  readRatio: number;
  pagesWithHighlights: number[];
  hotspots: MiniMapHotspot[];
}

export interface BuildMiniMapModelInput {
  totalPages: number;
  currentPageIndex: number;
  maxReadPageIndex: number;
  highlightCountByPage: Map<number, number>;
  maxBuckets?: number;
}

function safePage(value: number, totalPages: number): number {
  if (totalPages <= 0) {
    return 0;
  }
  return clamp(Math.trunc(Number(value || 0)), 0, totalPages - 1);
}

export function buildMiniMapModel(input: BuildMiniMapModelInput): MiniMapModel {
  const totalPages = Math.max(0, Math.trunc(Number(input.totalPages || 0)));
  if (totalPages <= 0) {
    return {
      buckets: [],
      highlightedPagesCount: 0,
      currentPositionRatio: 0,
      currentBucketIndex: -1,
      maxBucketHighlights: 0,
      readRatio: 0,
      pagesWithHighlights: [],
      hotspots: [],
    };
  }

  const currentPageIndex = safePage(input.currentPageIndex, totalPages);
  const maxReadPageIndex = safePage(input.maxReadPageIndex, totalPages);
  const maxBucketsRaw = Math.max(24, Math.trunc(Number(input.maxBuckets || 260)));
  const bucketCount = Math.min(totalPages, maxBucketsRaw);
  const bucketSize = Math.max(1, Math.ceil(totalPages / bucketCount));
  const normalizedBucketCount = Math.ceil(totalPages / bucketSize);

  const highlightCountByPage = input.highlightCountByPage instanceof Map
    ? input.highlightCountByPage
    : new Map<number, number>();
  const pageEntries = [...highlightCountByPage.entries()]
    .map(([pageIndex, count]) => [safePage(pageIndex, totalPages), Math.max(0, Number(count || 0))] as const)
    .filter(([, count]) => count > 0);
  const pagesWithHighlights = pageEntries.map(([pageIndex]) => pageIndex).sort((left, right) => left - right);
  const highlightedPagesCount = pagesWithHighlights.length;
  const maxPageHighlightCount = Math.max(1, ...pageEntries.map(([, count]) => count), 1);
  const hotspots: MiniMapHotspot[] = [...pageEntries]
    .sort((left, right) => {
      if (right[1] !== left[1]) {
        return right[1] - left[1];
      }
      return left[0] - right[0];
    })
    .slice(0, 10)
    .map(([pageIndex, highlightCount]) => ({
      pageIndex,
      highlightCount,
      relativeWeight: clamp(highlightCount / maxPageHighlightCount, 0, 1),
    }));

  const bucketsRaw: Array<Omit<MiniMapBucket, 'relativeHighlightCount'>> = [];
  let maxBucketHighlights = 0;
  for (let index = 0; index < normalizedBucketCount; index += 1) {
    const startPageIndex = index * bucketSize;
    const endPageIndex = Math.min(totalPages - 1, startPageIndex + bucketSize - 1);
    const targetPageIndex = startPageIndex + Math.floor((endPageIndex - startPageIndex) / 2);

    let bucketHighlights = 0;
    let bucketPeak = 0;
    let highlightedPages = 0;
    for (let pageIndex = startPageIndex; pageIndex <= endPageIndex; pageIndex += 1) {
      const value = Math.max(0, Number(highlightCountByPage.get(pageIndex) || 0));
      bucketHighlights += value;
      bucketPeak = Math.max(bucketPeak, value);
      if (value > 0) {
        highlightedPages += 1;
      }
    }

    maxBucketHighlights = Math.max(maxBucketHighlights, bucketHighlights);

    bucketsRaw.push({
      index,
      startPageIndex,
      endPageIndex,
      targetPageIndex,
      label:
        startPageIndex === endPageIndex
          ? `${startPageIndex + 1}`
          : `${startPageIndex + 1}-${endPageIndex + 1}`,
      highlightCount: bucketHighlights,
      highlightDensity: clamp(bucketPeak / maxPageHighlightCount, 0, 1),
      highlightedPages,
      isCurrent: currentPageIndex >= startPageIndex && currentPageIndex <= endPageIndex,
      isRead: endPageIndex <= maxReadPageIndex,
    });
  }

  const safeBucketPeak = Math.max(1, maxBucketHighlights);
  const buckets: MiniMapBucket[] = bucketsRaw.map((bucket) => ({
    ...bucket,
    relativeHighlightCount: clamp(bucket.highlightCount / safeBucketPeak, 0, 1),
  }));
  const currentBucketIndex = buckets.findIndex((bucket) => bucket.isCurrent);

  return {
    buckets,
    highlightedPagesCount,
    currentPositionRatio: totalPages <= 1 ? 0 : currentPageIndex / (totalPages - 1),
    currentBucketIndex,
    maxBucketHighlights,
    readRatio: clamp((maxReadPageIndex + 1) / Math.max(1, totalPages), 0, 1),
    pagesWithHighlights,
    hotspots,
  };
}
