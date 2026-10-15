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
  const snapshot = globalThis.__sonflashWebVitals;
  if (Array.isArray(snapshot)) {
    snapshot.push(metric);
    snapshot.splice(0, snapshot.length - 3);
  } else globalThis.__sonflashWebVitals = [metric];
  const browserWindow = globalThis.window;
  if (typeof browserWindow?.dispatchEvent !== 'function' || typeof browserWindow?.CustomEvent !== 'function') return;
  browserWindow.dispatchEvent(new browserWindow.CustomEvent<WebVitalMetric>('sonflash:web-vital', { detail: metric }));
};

export function observeWebVitals(report: MetricReporter = defaultReporter): () => void {
  if (!globalThis.PerformanceObserver || !globalThis.document || !globalThis.window) return () => undefined;
  const d = document;

  const observers: PerformanceObserver[] = [];
  let largestContentfulPaint: WebVitalMetric | undefined;
  let cumulativeLayoutShift = 0;
  let layoutShiftWindowValue = 0;
  let layoutShiftWindowStart = 0;
  let layoutShiftLastEntry = 0;
  const interactionDurations: Record<number, number> = {};
  let flushed = false;

  const observe = (
    type: PerformanceObserverInit['type'],
    onEntries: (entries: VitalEntry[]) => void,
    options?: { durationThreshold?: number },
  ) => {
    try {
      const observer = new PerformanceObserver(list => onEntries(list.getEntries() as VitalEntry[]));
      observer.observe({ type, buffered: true, ...options } as PerformanceObserverInit);
      observers.push(observer);
    } catch {
      // Older browsers can expose PerformanceObserver without the newer entry type.
    }
  };

  observe('largest-contentful-paint', entries => {
    entries.forEach(entry => largestContentfulPaint = { name: 'LCP', value: entry.startTime });
  });
  observe('layout-shift', entries => {
    entries.forEach(({ startTime: time, value, hadRecentInput }) => {
      if (hadRecentInput || !value) return;
      const sameWindow = layoutShiftWindowValue > 0
        && time - layoutShiftLastEntry <= 1_000
        && time - layoutShiftWindowStart <= 5_000;
      layoutShiftWindowValue = sameWindow ? layoutShiftWindowValue + value : value;
      if (!sameWindow) layoutShiftWindowStart = time;
      layoutShiftLastEntry = time;
      cumulativeLayoutShift = Math.max(cumulativeLayoutShift, layoutShiftWindowValue);
    });
  });
  observe('event', entries => {
    entries.forEach(({ interactionId: id, duration }) => {
      if (id && duration > (interactionDurations[id] || 0)) {
        interactionDurations[id] = duration;
      }
    });
  }, { durationThreshold: 40 });

  const flush = () => {
    if (flushed) return;
    flushed = true;
    if (largestContentfulPaint) report(largestContentfulPaint);
    if (cumulativeLayoutShift > 0) report({ name: 'CLS', value: cumulativeLayoutShift });
    const sortedInteractions = Object.values(interactionDurations).sort((left, right) => left - right);
    if (sortedInteractions.length) report({ name: 'INP', value: sortedInteractions[Math.ceil(sortedInteractions.length * 0.98) - 1] });
  };
  const handleVisibilityChange = () => {
    if (d.hidden) flush();
  };

  d.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('pagehide', flush);

  return () => {
    observers.forEach(observer => observer.disconnect());
    d.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('pagehide', flush);
  };
}
