import { useEffect, useRef } from 'react';
import { recordDebugTiming, setDebugGauge } from './debugTrace';

function nowMs() {
  if (typeof performance !== 'undefined' && Number.isFinite(performance.now())) {
    return performance.now();
  }
  return Date.now();
}

export function useRenderProfiler(componentName: string, enabled = true) {
  const renderStartedAt = nowMs();
  const commitsRef = useRef(0);
  const lastCommitAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const committedAt = nowMs();
    const commitDuration = Math.max(0, committedAt - renderStartedAt);
    commitsRef.current += 1;

    recordDebugTiming('ui.render.commit.ms', commitDuration, 'ui', {}, {
      component: componentName,
    });
    setDebugGauge('ui.render.commit.count', commitsRef.current, 'ui', {}, {
      component: componentName,
    });

    if (lastCommitAtRef.current !== null) {
      const interval = Math.max(0, committedAt - lastCommitAtRef.current);
      recordDebugTiming('ui.render.interval.ms', interval, 'ui', {}, {
        component: componentName,
      });
    }

    lastCommitAtRef.current = committedAt;
  });
}

