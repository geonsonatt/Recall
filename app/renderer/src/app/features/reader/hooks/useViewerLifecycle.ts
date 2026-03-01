import { useEffect, useRef, useState } from 'react';

interface UseViewerLifecycleOptions {
  toolbarGroup: string;
  licenseKey?: string;
}

export function useViewerLifecycle(options: UseViewerLifecycleOptions) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<any>(null);
  const [viewerReady, setViewerReady] = useState(false);
  const [viewerInitError, setViewerInitError] = useState('');
  const [initAttempt, setInitAttempt] = useState(0);

  useEffect(() => {
    let disposed = false;

    async function ensureViewer() {
      if (!hostRef.current) {
        return;
      }

      setViewerInitError('');

      if (instanceRef.current) {
        setViewerReady(true);
        return;
      }

      const WebViewerModule = await import('@pdftron/webviewer');
      const WebViewer = (WebViewerModule as any).default ?? WebViewerModule;
      const runtimeLicenseKey = String(options.licenseKey || '').trim();
      const buildLicenseKey = String(import.meta.env.VITE_APRYSE_LICENSE_KEY || '').trim();
      const licenseKey = runtimeLicenseKey || buildLicenseKey || undefined;

      const instance = await WebViewer(
        {
          path: '/webviewer',
          fullAPI: false,
          disableLogs: true,
          defaultLanguage: 'ru',
          enableAnnotations: true,
          notesInLeftPanel: true,
          licenseKey,
        },
        hostRef.current,
      );

      if (disposed) {
        return;
      }

      instanceRef.current = instance;
      setViewerReady(true);
      await instance.UI.setLanguage('ru').catch(() => undefined);
      instance.UI.setToolbarGroup(options.toolbarGroup);
      instance.UI.disableElements([
        'ribbons',
        'toolsOverlay',
        'leftPanelButton',
        'toggleNotesButton',
        'menuButton',
        'searchButton',
        'thumbnailControlButton',
        'notesPanelButton',
        'contextMenuPopup',
      ]);
    }

    void ensureViewer().catch((error: any) => {
      if (!disposed) {
        setViewerReady(false);
        setViewerInitError(error?.message || 'Не удалось инициализировать PDF-движок.');
      }
    });

    return () => {
      disposed = true;
      const instance = instanceRef.current;
      if (instance?.UI?.dispose) {
        try {
          instance.UI.dispose();
        } catch {
          // Ignore viewer dispose errors on shutdown.
        }
      }
      instanceRef.current = null;
      setViewerReady(false);
    };
  }, [initAttempt, options.licenseKey, options.toolbarGroup]);

  const retryViewerInit = () => {
    const instance = instanceRef.current;
    if (instance?.UI?.dispose) {
      try {
        instance.UI.dispose();
      } catch {
        // ignore dispose errors
      }
    }
    instanceRef.current = null;
    setViewerReady(false);
    setViewerInitError('');
    setInitAttempt((value) => value + 1);
  };

  return {
    hostRef,
    instanceRef,
    viewerReady,
    viewerInitError,
    retryViewerInit,
  };
}
