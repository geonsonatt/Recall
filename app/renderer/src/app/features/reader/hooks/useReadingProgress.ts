import { useEffect, useRef, useState } from 'react';
import { clamp } from '../../../lib/format';
import type { DocumentRecord } from '../../../types';

export function useReadingProgress(document: DocumentRecord) {
  const [pageInput, setPageInput] = useState(
    String(Math.max(1, Number(document.lastReadPageIndex ?? 0) + 1)),
  );
  const [currentPageLocal, setCurrentPageLocal] = useState(
    Math.max(0, Number(document.lastReadPageIndex ?? 0)),
  );
  const [totalPagesLocal, setTotalPagesLocal] = useState(
    Math.max(0, Number(document.lastReadTotalPages ?? 0)),
  );

  const loadingDocumentRef = useRef(false);
  const restoreTargetPageRef = useRef<number>(0);
  const restoreGuardUntilRef = useRef(0);
  const restoreInProgressRef = useRef(false);

  const lastPersistTsRef = useRef<number>(Date.now());
  const lastPersistPageRef = useRef<number>(Math.max(0, Number(document.lastReadPageIndex ?? 0)));
  const maxPageSeenRef = useRef<number>(
    Math.max(0, Number(document.maxReadPageIndex ?? document.lastReadPageIndex ?? 0)),
  );

  useEffect(() => {
    setPageInput(String(Math.max(1, Number(document.lastReadPageIndex ?? 0) + 1)));
    setCurrentPageLocal(Math.max(0, Number(document.lastReadPageIndex ?? 0)));
    setTotalPagesLocal(Math.max(0, Number(document.lastReadTotalPages ?? 0)));

    restoreInProgressRef.current = false;
    restoreTargetPageRef.current = 0;
    restoreGuardUntilRef.current = 0;

    lastPersistTsRef.current = Date.now();
    lastPersistPageRef.current = Math.max(0, Number(document.lastReadPageIndex ?? 0));
    maxPageSeenRef.current = Math.max(
      0,
      Number(document.maxReadPageIndex ?? document.lastReadPageIndex ?? 0),
    );
  }, [document.id, document.lastReadPageIndex, document.lastReadTotalPages, document.maxReadPageIndex]);

  const beginRestoreNavigation = (targetPageIndex: number, guardMs = 3000) => {
    const target = Math.max(0, Math.trunc(Number(targetPageIndex || 0)));
    restoreTargetPageRef.current = target;
    restoreGuardUntilRef.current = Date.now() + Math.max(600, Math.trunc(Number(guardMs || 0)));
    restoreInProgressRef.current = true;
  };

  const completeRestoreNavigationIfNeeded = (pageIndex: number) => {
    if (!restoreInProgressRef.current) {
      return;
    }

    const now = Date.now();
    if (now > restoreGuardUntilRef.current) {
      restoreInProgressRef.current = false;
      return;
    }

    if (pageIndex !== restoreTargetPageRef.current) {
      return;
    }

    restoreInProgressRef.current = false;
  };

  const enforceRestoreTarget = (
    instance: any,
    targetPageIndexRaw: number,
    attempts = 14,
    delayMs = 170,
  ) => {
    let remaining = Math.max(1, Math.trunc(Number(attempts || 1)));
    const run = () => {
      if (!restoreInProgressRef.current || remaining <= 0) {
        return;
      }

      const documentViewer = instance?.Core?.documentViewer;
      if (
        !documentViewer?.getPageCount ||
        !documentViewer?.setCurrentPage ||
        !documentViewer?.getCurrentPage
      ) {
        return;
      }

      const totalPages = Math.max(1, Number(documentViewer.getPageCount() || 1));
      const targetPageIndex = clamp(Number(targetPageIndexRaw || 0), 0, totalPages - 1);
      const currentPageIndex = clamp(Number(documentViewer.getCurrentPage() || 1) - 1, 0, totalPages - 1);

      if (currentPageIndex !== targetPageIndex) {
        documentViewer.setCurrentPage(targetPageIndex + 1, false);
      }

      remaining -= 1;
      window.setTimeout(run, Math.max(80, Math.trunc(Number(delayMs || 0))));
    };

    run();
  };

  return {
    pageInput,
    setPageInput,
    currentPageLocal,
    setCurrentPageLocal,
    totalPagesLocal,
    setTotalPagesLocal,

    loadingDocumentRef,
    restoreTargetPageRef,
    restoreGuardUntilRef,
    restoreInProgressRef,

    lastPersistTsRef,
    lastPersistPageRef,
    maxPageSeenRef,

    beginRestoreNavigation,
    completeRestoreNavigationIfNeeded,
    enforceRestoreTarget,
  };
}
