export type WebVitalName = 'LCP' | 'CLS' | 'INP';

export interface WebVitalMetric {
  readonly name: WebVitalName;
  readonly value: number;
  readonly id?: string;
}

type VitalEntry = PerformanceEntry & {
  readonly hadRecentInput?: boolean;
  readonly interactionId?: number;
  readonly value?: number;
  readonly id?: string;
};

type MetricReporter = (metric: WebVitalMetric) => void;

const defaultReporter: MetricReporter = metric => {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function' || typeof window.CustomEvent !== 'function') return;
  window.dispatchEvent(new CustomEvent<WebVitalMetric>('sonflash:web-vital', { detail: metric }));
};

export function observeWebVitals(report: MetricReporter = defaultReporter): () => void {
  if (typeof PerformanceObserver === 'undefined' || typeof document === 'undefined' || typeof window === 'undefined') return () => undefined;

  const observers: PerformanceObserver[] = [];
  let largestContentfulPaint: WebVitalMetric | undefined;
  let cumulativeLayoutShift = 0;
  let interactionToNextPaint: WebVitalMetric | undefined;
  let flushed = false;

  const observe = (
    options: PerformanceObserverInit,
    onEntries: (entries: VitalEntry[]) => void,
  ) => {
    try {
      const observer = new PerformanceObserver(list => onEntries(list.getEntries() as VitalEntry[]));
      observer.observe(options);
      observers.push(observer);
    } catch {
      // Older browsers can expose PerformanceObserver without the newer entry type.
    }
  };

  observe({ type: 'largest-contentful-paint', buffered: true }, entries => {
    for (const entry of entries) {
      largestContentfulPaint = { name: 'LCP', value: entry.startTime, ...(entry.id ? { id: entry.id } : {}) };
    }
  });
  observe({ type: 'layout-shift', buffered: true }, entries => {
    for (const entry of entries) {
      if (!entry.hadRecentInput) cumulativeLayoutShift += entry.value ?? 0;
    }
  });
  observe({ type: 'event', buffered: true, durationThreshold: 40 } as PerformanceObserverInit, entries => {
    for (const entry of entries) {
      if (!entry.interactionId || entry.duration === undefined) continue;
      if (!interactionToNextPaint || entry.duration > interactionToNextPaint.value) {
        interactionToNextPaint = { name: 'INP', value: entry.duration };
      }
    }
  });

  const flush = () => {
    if (flushed) return;
    flushed = true;
    if (largestContentfulPaint) report(largestContentfulPaint);
    if (cumulativeLayoutShift > 0) report({ name: 'CLS', value: cumulativeLayoutShift });
    if (interactionToNextPaint) report(interactionToNextPaint);
  };
  const handleVisibilityChange = () => {
    if (document.visibilityState === 'hidden') flush();
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('pagehide', flush);

  return () => {
    observers.forEach(observer => observer.disconnect());
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('pagehide', flush);
  };
}
