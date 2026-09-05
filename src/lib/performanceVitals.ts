export type WebVitalName = 'LCP' | 'CLS' | 'INP';

export interface WebVitalMetric {
  readonly name: WebVitalName;
  readonly value: number;
}

declare global {
  var __sonflashWebVitals: WebVitalMetric[] | undefined;
}

type VitalEntry = PerformanceEntry & {
  readonly hadRecentInput?: boolean;
  readonly interactionId?: number;
  readonly value?: number;
};

type MetricReporter = (metric: WebVitalMetric) => void;

const defaultReporter: MetricReporter = metric => {
  const snapshot = Array.isArray(globalThis.__sonflashWebVitals) ? globalThis.__sonflashWebVitals : [];
  globalThis.__sonflashWebVitals = [...snapshot, metric].slice(-3);
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function' || typeof window.CustomEvent !== 'function') return;
  window.dispatchEvent(new window.CustomEvent<WebVitalMetric>('sonflash:web-vital', { detail: metric }));
};

export function observeWebVitals(report: MetricReporter = defaultReporter): () => void {
  if (typeof PerformanceObserver === 'undefined' || typeof document === 'undefined' || typeof window === 'undefined') return () => undefined;

  const observers: PerformanceObserver[] = [];
  let largestContentfulPaint: WebVitalMetric | undefined;
  let cumulativeLayoutShift = 0;
  let layoutShiftWindowValue = 0;
  let layoutShiftWindowStart = 0;
  let layoutShiftLastEntry = 0;
  const interactionDurations = new Map<number, number>();
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
      largestContentfulPaint = { name: 'LCP', value: entry.startTime };
    }
  });
  observe({ type: 'layout-shift', buffered: true }, entries => {
    for (const entry of entries) {
      if (entry.hadRecentInput || !entry.value) continue;
      const sameWindow = layoutShiftWindowValue > 0
        && entry.startTime - layoutShiftLastEntry < 1_000
        && entry.startTime - layoutShiftWindowStart < 5_000;
      layoutShiftWindowValue = sameWindow ? layoutShiftWindowValue + entry.value : entry.value;
      if (!sameWindow) layoutShiftWindowStart = entry.startTime;
      layoutShiftLastEntry = entry.startTime;
      cumulativeLayoutShift = Math.max(cumulativeLayoutShift, layoutShiftWindowValue);
    }
  });
  observe({ type: 'event', buffered: true, durationThreshold: 40 } as PerformanceObserverInit, entries => {
    for (const entry of entries) {
      if (!entry.interactionId || !entry.duration) continue;
      const previousDuration = interactionDurations.get(entry.interactionId);
      if (previousDuration === undefined || entry.duration > previousDuration) interactionDurations.set(entry.interactionId, entry.duration);
    }
  });

  const flush = () => {
    if (flushed) return;
    flushed = true;
    if (largestContentfulPaint) report(largestContentfulPaint);
    if (cumulativeLayoutShift > 0) report({ name: 'CLS', value: cumulativeLayoutShift });
    const sortedInteractions = [...interactionDurations.values()].sort((left, right) => left - right);
    if (sortedInteractions.length) report({ name: 'INP', value: sortedInteractions[Math.ceil(sortedInteractions.length * 0.98) - 1] });
  };
  const handleVisibilityChange = () => {
    if (document.hidden) flush();
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('pagehide', flush);

  return () => {
    observers.forEach(observer => observer.disconnect());
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('pagehide', flush);
  };
}
