import { useEffect, useMemo, useRef, useState } from 'react';
import { scaleLinear } from 'd3-scale';
import { interpolateBlues } from 'd3-scale-chromatic';
import { clamp } from '../../../lib/format';
import { buildMiniMapModel, type MiniMapBucket } from '../lib/miniMap';

export type MiniMapJumpSource =
  | 'mini-map-click'
  | 'mini-map-wheel'
  | 'mini-map-keyboard'
  | 'mini-map-prev-highlight'
  | 'mini-map-next-highlight'
  | 'mini-map-hotspot'
  | 'mini-map-scrub';

interface ReaderMiniMapProps {
  totalPages: number;
  currentPageIndex: number;
  maxReadPageIndex: number;
  totalHighlights: number;
  highlightCountByPage: Map<number, number>;
  onJumpToPage: (pageIndex: number, source: MiniMapJumpSource) => void;
}

function safePercent(value: number) {
  return `${(Math.max(0, Math.min(1, Number(value || 0))) * 100).toFixed(2)}%`;
}

function findBucketByPage(buckets: MiniMapBucket[], pageIndex: number) {
  return (
    buckets.find(
      (bucket) => pageIndex >= bucket.startPageIndex && pageIndex <= bucket.endPageIndex,
    ) || null
  );
}

export function ReaderMiniMap({
  totalPages,
  currentPageIndex,
  maxReadPageIndex,
  totalHighlights,
  highlightCountByPage,
  onJumpToPage,
}: ReaderMiniMapProps) {
  const model = useMemo(
    () =>
      buildMiniMapModel({
        totalPages,
        currentPageIndex,
        maxReadPageIndex,
        highlightCountByPage,
        maxBuckets: Math.min(360, Math.max(36, totalPages || 0)),
      }),
    [currentPageIndex, highlightCountByPage, maxReadPageIndex, totalPages],
  );

  const trackRef = useRef<HTMLDivElement | null>(null);
  const [trackWidth, setTrackWidth] = useState(0);
  const [hoverBucketIndex, setHoverBucketIndex] = useState<number | null>(null);
  const [scrubPageIndex, setScrubPageIndex] = useState<number | null>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);

  const pointerIdRef = useRef<number | null>(null);
  const lastJumpPageRef = useRef<number | null>(null);
  const ignoreClickUntilRef = useRef(0);

  const safeTotalPages = Math.max(1, Math.trunc(totalPages));
  const maxPageIndex = Math.max(0, safeTotalPages - 1);
  const safeCurrentPageIndex = clamp(Math.trunc(currentPageIndex || 0), 0, maxPageIndex);
  const safeCurrentPage = safeCurrentPageIndex + 1;
  const middlePage = Math.max(1, Math.round(safeTotalPages / 2));
  const readPercent = Math.round(model.readRatio * 100);

  const effectivePageIndex = scrubPageIndex ?? safeCurrentPageIndex;
  const effectivePage = effectivePageIndex + 1;

  useEffect(() => {
    lastJumpPageRef.current = safeCurrentPageIndex;
  }, [safeCurrentPageIndex]);

  useEffect(() => {
    const target = trackRef.current;
    if (!target) {
      return;
    }

    const syncWidth = () => {
      setTrackWidth(Math.max(0, target.getBoundingClientRect().width));
    };

    syncWidth();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', syncWidth);
      return () => {
        window.removeEventListener('resize', syncWidth);
      };
    }

    const observer = new ResizeObserver(syncWidth);
    observer.observe(target);
    return () => {
      observer.disconnect();
    };
  }, []);

  const xToPageIndexScale = useMemo(
    () =>
      scaleLinear<number, number>()
        .domain([0, Math.max(1, trackWidth || 1)])
        .range([0, maxPageIndex])
        .clamp(true),
    [maxPageIndex, trackWidth],
  );

  const bucketHeightScale = useMemo(
    () =>
      scaleLinear<number, number>()
        .domain([0, 1])
        .range([18, 92])
        .clamp(true),
    [],
  );

  const readTintScale = useMemo(
    () =>
      scaleLinear<number, number>()
        .domain([0, 1])
        .range([0.08, 0.3])
        .clamp(true),
    [],
  );

  const jumpToPageSafe = (rawPageIndex: number, source: MiniMapJumpSource, force = false) => {
    const pageIndex = clamp(Math.round(rawPageIndex), 0, maxPageIndex);
    if (!force && pageIndex === lastJumpPageRef.current) {
      return;
    }
    lastJumpPageRef.current = pageIndex;
    onJumpToPage(pageIndex, source);
  };

  const resolvePageFromClientX = (clientX: number) => {
    if (!trackRef.current) {
      return safeCurrentPageIndex;
    }

    const bounds = trackRef.current.getBoundingClientRect();
    const localX = clamp(clientX - bounds.left, 0, Math.max(1, bounds.width));
    return clamp(Math.round(xToPageIndexScale(localX)), 0, maxPageIndex);
  };

  const previewFromPointer = (clientX: number) => {
    const pageIndex = resolvePageFromClientX(clientX);
    setScrubPageIndex(pageIndex);

    const bucket = findBucketByPage(model.buckets, pageIndex);
    setHoverBucketIndex(bucket ? bucket.index : null);

    return pageIndex;
  };

  const hoverBucket =
    hoverBucketIndex === null || hoverBucketIndex < 0 || hoverBucketIndex >= model.buckets.length
      ? null
      : model.buckets[hoverBucketIndex];

  const effectiveBucket =
    hoverBucket ||
    findBucketByPage(model.buckets, effectivePageIndex) ||
    model.buckets[model.currentBucketIndex] ||
    null;

  const effectiveHighlights = Math.max(0, Number(highlightCountByPage.get(effectivePageIndex) || 0));
  const effectiveIsRead = effectivePageIndex <= maxReadPageIndex;

  const tooltipLeftRatio =
    model.buckets.length > 0 && effectiveBucket
      ? (effectiveBucket.index + 0.5) / model.buckets.length
      : model.currentPositionRatio;

  const readWindowHalf = Math.max(1, Math.round(safeTotalPages * 0.015));
  const scrubWindowStart = clamp(effectivePageIndex - readWindowHalf, 0, maxPageIndex);
  const scrubWindowEnd = clamp(effectivePageIndex + readWindowHalf, 0, maxPageIndex);
  const scrubWindowCenter = (scrubWindowStart + scrubWindowEnd) / 2 / Math.max(1, maxPageIndex);
  const scrubWindowWidth = (scrubWindowEnd - scrubWindowStart + 1) / Math.max(1, safeTotalPages);

  const prevHighlightPage = useMemo(() => {
    if (model.pagesWithHighlights.length === 0) {
      return null;
    }
    for (let index = model.pagesWithHighlights.length - 1; index >= 0; index -= 1) {
      const pageIndex = model.pagesWithHighlights[index];
      if (pageIndex < safeCurrentPageIndex) {
        return pageIndex;
      }
    }
    return null;
  }, [model.pagesWithHighlights, safeCurrentPageIndex]);

  const nextHighlightPage = useMemo(() => {
    if (model.pagesWithHighlights.length === 0) {
      return null;
    }
    for (const pageIndex of model.pagesWithHighlights) {
      if (pageIndex > safeCurrentPageIndex) {
        return pageIndex;
      }
    }
    return null;
  }, [model.pagesWithHighlights, safeCurrentPageIndex]);

  const trendLinePoints = useMemo(() => {
    if (model.buckets.length === 0) {
      return '';
    }
    return model.buckets
      .map((bucket, index) => {
        const x = clamp(index + 0.5, 0.5, model.buckets.length - 0.5);
        const y = 96 - bucketHeightScale(bucket.relativeHighlightCount);
        return `${x},${y.toFixed(2)}`;
      })
      .join(' ');
  }, [bucketHeightScale, model.buckets]);

  if (model.buckets.length === 0) {
    return null;
  }

  return (
    <section className="reader-mini-map">
      <div className="reader-mini-map-head">
        <strong>Мини-карта</strong>
        <span className="chip">{safeTotalPages} стр.</span>
        <span className="chip">read {readPercent}%</span>
      </div>

      <div className="reader-mini-map-stats muted">
        <span>
          Текущая: {safeCurrentPage} / {safeTotalPages}
        </span>
        <span>
          Выделения: {Math.max(0, totalHighlights)} · активных стр.: {model.highlightedPagesCount}
        </span>
      </div>

      <div className="reader-mini-map-actions action-row compact">
        <button
          type="button"
          className="btn ghost"
          disabled={prevHighlightPage === null}
          onClick={() => {
            if (prevHighlightPage === null) {
              return;
            }
            jumpToPageSafe(prevHighlightPage, 'mini-map-prev-highlight', true);
          }}
          title={prevHighlightPage === null ? 'Нет предыдущего выделения' : `Стр. ${prevHighlightPage + 1}`}
        >
          ← Хайлайт
        </button>
        <button
          type="button"
          className="btn ghost"
          disabled={nextHighlightPage === null}
          onClick={() => {
            if (nextHighlightPage === null) {
              return;
            }
            jumpToPageSafe(nextHighlightPage, 'mini-map-next-highlight', true);
          }}
          title={nextHighlightPage === null ? 'Нет следующего выделения' : `Стр. ${nextHighlightPage + 1}`}
        >
          Хайлайт →
        </button>
        <span className="muted">Пики:</span>
        {model.hotspots.slice(0, 4).map((hotspot) => (
          <button
            key={`hotspot-${hotspot.pageIndex}`}
            type="button"
            className={`chip hotspot ${hotspot.pageIndex === safeCurrentPageIndex ? 'active' : ''}`}
            onClick={() => {
              jumpToPageSafe(hotspot.pageIndex, 'mini-map-hotspot', true);
            }}
            title={`Стр. ${hotspot.pageIndex + 1} · выделений: ${hotspot.highlightCount}`}
          >
            {hotspot.pageIndex + 1} · {hotspot.highlightCount}
          </button>
        ))}
      </div>

      <div className="reader-mini-map-legend muted">
        <span>Подложка: прогресс чтения</span>
        <span>Столбики: плотность выделений</span>
        <span>Линия: общий профиль документа</span>
        <span>Drag по карте: превью + быстрый прыжок</span>
      </div>

      <div className="reader-mini-map-rail-shell">
        <div
          ref={trackRef}
          className={`reader-mini-map-plot ${isScrubbing ? 'scrubbing' : ''}`}
          role="slider"
          tabIndex={0}
          aria-label="Мини-карта документа"
          aria-valuemin={1}
          aria-valuemax={safeTotalPages}
          aria-valuenow={effectivePage}
          onKeyDown={(event) => {
            let nextPageIndex = safeCurrentPageIndex;

            if (event.key === 'ArrowRight') {
              nextPageIndex = clamp(safeCurrentPageIndex + 1, 0, maxPageIndex);
            } else if (event.key === 'ArrowLeft') {
              nextPageIndex = clamp(safeCurrentPageIndex - 1, 0, maxPageIndex);
            } else if (event.key === 'PageDown') {
              nextPageIndex = clamp(safeCurrentPageIndex + 10, 0, maxPageIndex);
            } else if (event.key === 'PageUp') {
              nextPageIndex = clamp(safeCurrentPageIndex - 10, 0, maxPageIndex);
            } else if (event.key === 'Home') {
              nextPageIndex = 0;
            } else if (event.key === 'End') {
              nextPageIndex = maxPageIndex;
            } else {
              return;
            }

            if (nextPageIndex !== safeCurrentPageIndex) {
              event.preventDefault();
              jumpToPageSafe(nextPageIndex, 'mini-map-keyboard', true);
            }
          }}
          onWheel={(event) => {
            event.preventDefault();
            const deltaDirection = event.deltaY > 0 ? 1 : -1;
            const step = event.shiftKey ? 12 : 3;
            const nextPageIndex = clamp(
              safeCurrentPageIndex + deltaDirection * step,
              0,
              maxPageIndex,
            );
            jumpToPageSafe(nextPageIndex, 'mini-map-wheel', true);
          }}
          onMouseMove={(event) => {
            if (isScrubbing) {
              previewFromPointer(event.clientX);
              return;
            }
            const pageIndex = resolvePageFromClientX(event.clientX);
            const bucket = findBucketByPage(model.buckets, pageIndex);
            setHoverBucketIndex(bucket ? bucket.index : null);
          }}
          onMouseLeave={() => {
            if (!isScrubbing) {
              setHoverBucketIndex(null);
            }
          }}
          onClick={(event) => {
            const now = Date.now();
            if (now < ignoreClickUntilRef.current) {
              return;
            }
            const pageIndex = resolvePageFromClientX(event.clientX);
            jumpToPageSafe(pageIndex, 'mini-map-click', true);
          }}
          onPointerDown={(event) => {
            const primaryButton = event.pointerType !== 'mouse' || event.button === 0;
            if (!event.isPrimary || !primaryButton) {
              return;
            }
            pointerIdRef.current = event.pointerId;
            setIsScrubbing(true);
            event.currentTarget.setPointerCapture(event.pointerId);
            previewFromPointer(event.clientX);
          }}
          onPointerMove={(event) => {
            if (!isScrubbing || pointerIdRef.current !== event.pointerId) {
              return;
            }
            previewFromPointer(event.clientX);
          }}
          onPointerUp={(event) => {
            if (pointerIdRef.current !== event.pointerId) {
              return;
            }

            const pageIndex = previewFromPointer(event.clientX);
            jumpToPageSafe(pageIndex, 'mini-map-scrub', true);

            setIsScrubbing(false);
            setScrubPageIndex(null);
            setHoverBucketIndex(null);
            pointerIdRef.current = null;
            ignoreClickUntilRef.current = Date.now() + 180;

            try {
              event.currentTarget.releasePointerCapture(event.pointerId);
            } catch {
              // ignore
            }
          }}
          onPointerCancel={(event) => {
            if (pointerIdRef.current !== event.pointerId) {
              return;
            }
            setIsScrubbing(false);
            setScrubPageIndex(null);
            setHoverBucketIndex(null);
            pointerIdRef.current = null;
            ignoreClickUntilRef.current = Date.now() + 180;
          }}
        >
          <div
            className="reader-mini-map-read-fill"
            style={{ width: safePercent(model.readRatio) }}
            aria-hidden="true"
          />

          <svg
            className="reader-mini-map-svg"
            viewBox={`0 0 ${model.buckets.length} 100`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {model.buckets.map((bucket) => {
              const x = bucket.index + 0.08;
              const width = 0.84;
              const backgroundOpacity = bucket.isRead
                ? readTintScale((bucket.endPageIndex + 1) / Math.max(1, safeTotalPages))
                : 0.06;
              const backgroundFill = `rgba(43, 73, 119, ${backgroundOpacity.toFixed(3)})`;
              const highlightHeight = bucketHeightScale(bucket.relativeHighlightCount);
              const highlightTop = 96 - highlightHeight;
              const highlightFill =
                bucket.highlightCount > 0
                  ? interpolateBlues(0.3 + bucket.highlightDensity * 0.62)
                  : '#e3ebf5';

              return (
                <g key={`mini-${bucket.index}`}>
                  <rect x={x} y={8} width={width} height={88} rx={0.24} fill={backgroundFill} />
                  <rect
                    x={x + 0.06}
                    y={highlightTop}
                    width={Math.max(0.12, width - 0.12)}
                    height={highlightHeight}
                    rx={0.2}
                    fill={highlightFill}
                  />
                  {bucket.isCurrent ? (
                    <rect
                      x={x - 0.02}
                      y={6}
                      width={width + 0.04}
                      height={92}
                      rx={0.26}
                      fill="none"
                      stroke="#18458b"
                      strokeWidth={0.18}
                    />
                  ) : null}
                </g>
              );
            })}

            {trendLinePoints ? (
              <polyline
                points={trendLinePoints}
                fill="none"
                stroke="rgba(22, 72, 146, 0.62)"
                strokeWidth={0.25}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}

            {model.hotspots.slice(0, 8).map((hotspot) => {
              const x = hotspot.pageIndex / Math.max(1, maxPageIndex);
              const bucketX = clamp(
                x * model.buckets.length,
                0.15,
                Math.max(0.15, model.buckets.length - 0.15),
              );
              const radius = 0.18 + hotspot.relativeWeight * 0.28;
              return (
                <circle
                  key={`hotspot-dot-${hotspot.pageIndex}`}
                  cx={bucketX}
                  cy={7.2}
                  r={radius}
                  fill="rgba(34, 97, 194, 0.9)"
                />
              );
            })}

            <line
              x1={Math.max(
                0.18,
                (effectivePageIndex / Math.max(1, maxPageIndex)) * model.buckets.length,
              )}
              y1={4}
              x2={Math.max(
                0.18,
                (effectivePageIndex / Math.max(1, maxPageIndex)) * model.buckets.length,
              )}
              y2={99}
              stroke={isScrubbing ? 'rgba(16, 60, 130, 0.88)' : 'rgba(24,69,139,0.64)'}
              strokeWidth={isScrubbing ? 0.38 : 0.28}
              strokeLinecap="round"
            />
          </svg>

          <div
            className="reader-mini-map-window"
            style={{
              left: safePercent(scrubWindowCenter),
              width: safePercent(scrubWindowWidth),
            }}
            aria-hidden="true"
          />

          <div
            className="reader-mini-map-cursor"
            style={{ left: safePercent(effectivePageIndex / Math.max(1, maxPageIndex)) }}
            aria-hidden="true"
          />

          <div className="reader-mini-map-tooltip" style={{ left: safePercent(tooltipLeftRatio) }}>
            <strong>
              Стр. {effectivePage}
              {effectiveBucket ? ` · блок ${effectiveBucket.label}` : ''}
            </strong>
            <span>
              {effectiveHighlights > 0 ? `выделений: ${effectiveHighlights}` : 'без выделений'} ·{' '}
              {effectiveIsRead ? 'прочитано' : 'непрочитано'}
            </span>
          </div>
        </div>
      </div>

      <div className="reader-mini-map-scale muted">
        <span>1</span>
        <span>{middlePage}</span>
        <span>{safeTotalPages}</span>
      </div>
    </section>
  );
}
