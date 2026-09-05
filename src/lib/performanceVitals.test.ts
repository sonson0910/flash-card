import { afterEach, describe, expect, it, vi } from 'vitest';
import { observeWebVitals, type WebVitalMetric } from './performanceVitals';

type ObserverEntry = { readonly entryType: string; readonly startTime: number; readonly duration?: number; readonly value?: number; readonly id?: string; readonly interactionId?: number };

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('observeWebVitals', () => {
  it('reports LCP, CLS, and INP and cleans up observers', () => {
    const documentStub = {
      visibilityState: 'visible' as DocumentVisibilityState,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const windowStub = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('document', documentStub);
    vi.stubGlobal('window', windowStub);
    const observers: Array<{ observe: ReturnType<typeof vi.fn>; disconnect: ReturnType<typeof vi.fn>; callback: (list: { getEntries: () => ObserverEntry[] }) => void }> = [];
    globalThis.PerformanceObserver = class {
      readonly observe = vi.fn();
      readonly disconnect = vi.fn();
      constructor(callback: (list: { getEntries: () => ObserverEntry[] }) => void) {
        observers.push({ observe: this.observe, disconnect: this.disconnect, callback });
      }
    } as unknown as typeof PerformanceObserver;
    const report = vi.fn<(metric: WebVitalMetric) => void>();

    const cleanup = observeWebVitals(report);
    expect(observers).toHaveLength(3);
    expect(observers.map(observer => observer.observe.mock.calls[0]?.[0])).toEqual([
      { type: 'largest-contentful-paint', buffered: true },
      { type: 'layout-shift', buffered: true },
      { type: 'event', buffered: true, durationThreshold: 40 },
    ]);

    observers[0].callback({ getEntries: () => [{ entryType: 'largest-contentful-paint', startTime: 123, id: 'hero' }] });
    observers[1].callback({ getEntries: () => [{ entryType: 'layout-shift', startTime: 20, value: 0.12 }] });
    observers[2].callback({ getEntries: () => [{ entryType: 'event', startTime: 50, duration: 81, interactionId: 3 }] });
    documentStub.visibilityState = 'hidden';
    const visibilityListener = documentStub.addEventListener.mock.calls[0]?.[1] as (() => void) | undefined;
    visibilityListener?.();

    expect(report).toHaveBeenCalledWith({ name: 'LCP', value: 123, id: 'hero' });
    expect(report).toHaveBeenCalledWith({ name: 'CLS', value: 0.12 });
    expect(report).toHaveBeenCalledWith({ name: 'INP', value: 81 });

    cleanup();
    expect(observers.every(observer => observer.disconnect.mock.calls.length === 1)).toBe(true);
    expect(documentStub.removeEventListener).toHaveBeenCalledWith('visibilitychange', visibilityListener);
  });

  it('returns a safe cleanup when PerformanceObserver is unavailable', () => {
    vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    globalThis.PerformanceObserver = undefined as unknown as typeof PerformanceObserver;
    expect(() => observeWebVitals()).not.toThrow();
  });
});
