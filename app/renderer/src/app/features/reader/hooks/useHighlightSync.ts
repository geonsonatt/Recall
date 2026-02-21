import { useEffect } from 'react';
import type { MutableRefObject } from 'react';
import {
  WEBVIEWER_CUSTOM_COLOR_KEY,
  WEBVIEWER_CUSTOM_ID_KEY,
  WEBVIEWER_CUSTOM_RICH_TEXT_KEY,
  WEBVIEWER_CUSTOM_TEXT_KEY,
  buildQuadSignature,
  highlightToWebViewerColor,
  mergeNormalizedRects,
  normalizedRectToWebViewerQuad,
  webViewerColorToHighlight,
} from '../../../lib/highlight';
import { clamp, normalizeSelectionText, normalizeText } from '../../../lib/format';
import { HIGHLIGHT_COLORS } from '../../../lib/highlightColors';
import type { HighlightColor, HighlightRecord } from '../../../types';

interface UseHighlightSyncOptions {
  viewerReady: boolean;
  instanceRef: MutableRefObject<any>;
  loadingDocumentRef: MutableRefObject<boolean>;
  suppressSyncRef: MutableRefObject<boolean>;
  documentId: string;
  highlights: HighlightRecord[];
  onSyncStats?: (stats: { added: number; updated: number; removed: number }) => void;
}

function readAnnotationColor(annotation: any): HighlightColor {
  const customColor = String(annotation?.getCustomData?.(WEBVIEWER_CUSTOM_COLOR_KEY) || '').trim();
  if (HIGHLIGHT_COLORS.includes(customColor as HighlightColor)) {
    return customColor as HighlightColor;
  }

  const annotationColor =
    annotation?.Color ??
    annotation?.StrokeColor ??
    annotation?.FillColor ??
    (typeof annotation?.getColor === 'function' ? annotation.getColor() : undefined);
  return webViewerColorToHighlight(annotationColor);
}

function buildHighlightFingerprint(highlight: HighlightRecord, pageNumber: number, quads: any[]): string {
  const signature = buildQuadSignature(quads);
  const note = normalizeText(highlight.note || '');
  const text = normalizeSelectionText(highlight.selectedText || '');
  const rich = String(highlight.selectedRichText || '').trim();
  return [
    String(pageNumber),
    signature,
    highlight.color,
    note,
    text,
    rich,
  ].join('|');
}

function buildAnnotationFingerprint(annotation: any): string {
  const pageNumber = Math.max(1, Number(annotation?.PageNumber || 1));
  const signature = buildQuadSignature(annotation.getQuads?.() ?? annotation?.Quads ?? []);
  const note = normalizeText(annotation?.getContents?.() || '');
  const text = normalizeSelectionText(annotation?.getCustomData?.(WEBVIEWER_CUSTOM_TEXT_KEY) || '');
  const rich = String(annotation?.getCustomData?.(WEBVIEWER_CUSTOM_RICH_TEXT_KEY) || '').trim();
  const color = readAnnotationColor(annotation);
  return [
    String(pageNumber),
    signature,
    color,
    note,
    text,
    rich,
  ].join('|');
}

export function useHighlightSync({
  viewerReady,
  instanceRef,
  loadingDocumentRef,
  suppressSyncRef,
  documentId,
  highlights,
  onSyncStats,
}: UseHighlightSyncOptions) {
  useEffect(() => {
    const instance = instanceRef.current;
    if (!viewerReady || !instance || loadingDocumentRef.current) {
      return;
    }

    const { documentViewer, annotationManager, Annotations, Math: MathCore } = instance.Core;

    if (!documentViewer.getDocument()) {
      return;
    }

    suppressSyncRef.current = true;

    try {
      const pageCount = Math.max(1, Number(documentViewer.getPageCount() || 1));
      const managedAnnotations = annotationManager
        .getAnnotationsList()
        .filter((annotation: any) => annotation.getCustomData(WEBVIEWER_CUSTOM_ID_KEY));

      const existingById = new Map<string, any>();
      for (const annotation of managedAnnotations) {
        const id = String(annotation.getCustomData(WEBVIEWER_CUSTOM_ID_KEY) || '').trim();
        if (!id || existingById.has(id)) {
          continue;
        }
        existingById.set(id, annotation);
      }

      const nextHighlights = highlights.filter((highlight) => highlight.documentId === documentId);
      const nextIds = new Set(nextHighlights.map((highlight) => String(highlight.id)));

      const toDelete = managedAnnotations.filter((annotation: any) => {
        const id = String(annotation.getCustomData(WEBVIEWER_CUSTOM_ID_KEY) || '').trim();
        return id && !nextIds.has(id);
      });

      if (toDelete.length > 0) {
        annotationManager.deleteAnnotations(toDelete, {
          imported: true,
          source: 'recall-sync',
        });
      }

      const toAdd = [];
      const toRedraw = [];
      let updatedCount = 0;

      for (const highlight of nextHighlights) {
        const highlightId = String(highlight.id);
        const pageNumber = clamp(highlight.pageIndex + 1, 1, pageCount);
        const pageInfo = documentViewer.getDocument().getPageInfo(pageNumber);
        const quads = mergeNormalizedRects(highlight.rects ?? [])
          .map((rect) => normalizedRectToWebViewerQuad(rect, pageInfo, MathCore))
          .filter(Boolean);

        if (quads.length === 0) {
          continue;
        }

        const expectedFingerprint = buildHighlightFingerprint(highlight, pageNumber, quads);
        const existingAnnotation = existingById.get(highlightId) || null;

        if (existingAnnotation) {
          const currentFingerprint = buildAnnotationFingerprint(existingAnnotation);
          if (currentFingerprint === expectedFingerprint) {
            continue;
          }

          existingAnnotation.Id = highlightId;
          existingAnnotation.PageNumber = pageNumber;
          existingAnnotation.Quads = quads;
          existingAnnotation.Color = highlightToWebViewerColor(highlight.color, Annotations);
          existingAnnotation.Opacity = 0.24;
          existingAnnotation.StrokeThickness = 0;
          existingAnnotation.setContents(highlight.note || '');
          existingAnnotation.setCustomData(WEBVIEWER_CUSTOM_ID_KEY, highlightId);
          existingAnnotation.setCustomData(WEBVIEWER_CUSTOM_COLOR_KEY, highlight.color);
          existingAnnotation.setCustomData(WEBVIEWER_CUSTOM_TEXT_KEY, highlight.selectedText || '');
          existingAnnotation.setCustomData(
            WEBVIEWER_CUSTOM_RICH_TEXT_KEY,
            highlight.selectedRichText || '',
          );

          toRedraw.push(existingAnnotation);
          updatedCount += 1;
          continue;
        }

        const annotation = new Annotations.TextHighlightAnnotation();
        annotation.Id = highlightId;
        annotation.PageNumber = pageNumber;
        annotation.Quads = quads;
        annotation.Color = highlightToWebViewerColor(highlight.color, Annotations);
        annotation.Opacity = 0.24;
        annotation.StrokeThickness = 0;
        annotation.setContents(highlight.note || '');
        annotation.setCustomData(WEBVIEWER_CUSTOM_ID_KEY, highlightId);
        annotation.setCustomData(WEBVIEWER_CUSTOM_COLOR_KEY, highlight.color);
        annotation.setCustomData(WEBVIEWER_CUSTOM_TEXT_KEY, highlight.selectedText || '');
        annotation.setCustomData(WEBVIEWER_CUSTOM_RICH_TEXT_KEY, highlight.selectedRichText || '');
        toAdd.push(annotation);
      }

      if (toAdd.length > 0) {
        annotationManager.addAnnotations(toAdd, {
          imported: true,
          source: 'recall-sync',
        });
      }

      for (const annotation of [...toAdd, ...toRedraw]) {
        annotationManager.redrawAnnotation(annotation);
      }

      onSyncStats?.({
        added: toAdd.length,
        updated: updatedCount,
        removed: toDelete.length,
      });
    } finally {
      suppressSyncRef.current = false;
    }
  }, [
    documentId,
    highlights,
    instanceRef,
    loadingDocumentRef,
    onSyncStats,
    suppressSyncRef,
    viewerReady,
  ]);
}
