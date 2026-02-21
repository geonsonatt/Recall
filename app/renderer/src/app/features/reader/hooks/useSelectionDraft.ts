import { useEffect, useRef, useState } from 'react';
import type { HighlightRecord } from '../../../types';

export type LastSelectionState = {
  pageNumber: number;
  pageNumberTo: number;
  text: string;
  richText: string;
  signature: string;
  quads: any[];
  groups: Array<{
    pageNumber: number;
    quads: any[];
    signature: string;
  }>;
  timestamp: number;
};

export function useSelectionDraft(documentId: string) {
  const [searchText, setSearchText] = useState('');
  const [visibleHighlightsCount, setVisibleHighlightsCount] = useState(80);
  const [pendingSelectionText, setPendingSelectionText] = useState('');
  const [pendingSelectionPage, setPendingSelectionPage] = useState<number | null>(null);
  const [pendingSelectionPageEnd, setPendingSelectionPageEnd] = useState<number | null>(null);
  const [pendingNote, setPendingNote] = useState('');
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  const lastSelectionRef = useRef<LastSelectionState | null>(null);
  const pendingNoteRef = useRef('');

  useEffect(() => {
    pendingNoteRef.current = pendingNote;
  }, [pendingNote]);

  useEffect(() => {
    setVisibleHighlightsCount(80);
  }, [searchText, documentId]);

  useEffect(() => {
    setPendingSelectionText('');
    setPendingSelectionPage(null);
    setPendingSelectionPageEnd(null);
    setPendingNote('');
    setNoteDrafts({});
    setVisibleHighlightsCount(80);
    lastSelectionRef.current = null;
  }, [documentId]);

  const clearPendingSelection = () => {
    lastSelectionRef.current = null;
    setPendingSelectionText('');
    setPendingSelectionPage(null);
    setPendingSelectionPageEnd(null);
    setPendingNote('');
  };

  const getHighlightNoteDraft = (highlight: HighlightRecord) => {
    if (Object.prototype.hasOwnProperty.call(noteDrafts, highlight.id)) {
      return noteDrafts[highlight.id] ?? '';
    }
    return highlight.note ?? '';
  };

  const setHighlightNoteDraft = (highlightId: string, value: string) => {
    setNoteDrafts((current) => ({
      ...current,
      [highlightId]: value,
    }));
  };

  const clearHighlightNoteDraft = (highlightId: string) => {
    setNoteDrafts((current) => {
      if (!Object.prototype.hasOwnProperty.call(current, highlightId)) {
        return current;
      }
      const next = { ...current };
      delete next[highlightId];
      return next;
    });
  };

  return {
    searchText,
    setSearchText,
    visibleHighlightsCount,
    setVisibleHighlightsCount,
    pendingSelectionText,
    setPendingSelectionText,
    pendingSelectionPage,
    setPendingSelectionPage,
    pendingSelectionPageEnd,
    setPendingSelectionPageEnd,
    pendingNote,
    setPendingNote,
    pendingNoteRef,
    noteDrafts,
    setNoteDrafts,
    lastSelectionRef,
    clearPendingSelection,
    getHighlightNoteDraft,
    setHighlightNoteDraft,
    clearHighlightNoteDraft,
  };
}
