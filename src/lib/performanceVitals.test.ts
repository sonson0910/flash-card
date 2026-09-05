import { afterEach, describe, expect, it, vi } from 'vitest';
import { observeWebVitals, type WebVitalMetric } from './performanceVitals';

type ObserverEntry = { readonly entryType: string; readonly startTime: number; readonly duration?: number; readonly value?: number; readonly id?: string; readonly interactionId?: number; readonly hadRecentInput?: boolean };

afterEach(() => {
  Reflect.deleteProperty(globalThis, '__sonflashWebVitals');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('observeWebVitals', () => {
  it('reports LCP, CLS, and INP and cleans up observers', () => {
    const documentStub = {
      visibilityState: 'visible' as DocumentVisibilityState,
      hidden: false,
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
    vi.stubGlobal('PerformanceObserver', class {
      readonly observe = vi.fn();
      readonly disconnect = vi.fn();
      constructor(callback: (list: { getEntries: () => ObserverEntry[] }) => void) {
        observers.push({ observe: this.observe, disconnect: this.disconnect, callback });
      }
    } as unknown as typeof PerformanceObserver);
    const report = vi.fn<(metric: WebVitalMetric) => void>();

    const cleanup = observeWebVitals(report);
    expect(observers).toHaveLength(3);
    expect(observers.map(observer => observer.observe.mock.calls[0]?.[0])).toEqual([
      { type: 'largest-contentful-paint', buffered: true },
      { type: 'layout-shift', buffered: true },
      { type: 'event', buffered: true, durationThreshold: 40 },
    ]);

    observers[0].callback({ getEntries: () => [{ entryType: 'largest-contentful-paint', startTime: 123, id: 'hero' }] });
    observers[1].callback({ getEntries: () => [
      { entryType: 'layout-shift', startTime: 0, value: 0.05 },
      { entryType: 'layout-shift', startTime: 500, value: 0.1 },
      { entryType: 'layout-shift', startTime: 1700, value: 0.4 },
      { entryType: 'layout-shift', startTime: 2300, value: 0.2 },
      { entryType: 'layout-shift', startTime: 6000, value: 0.2 },
      { entryType: 'layout-shift', startTime: 6200, value: 0.9, hadRecentInput: true },
    ] });
    observers[2].callback({ getEntries: () => Array.from({ length: 100 }, (_, index) => ({
      entryType: 'event', startTime: index, duration: index + 1, interactionId: index + 1,
    })) });
    documentStub.visibilityState = 'hidden';
    documentStub.hidden = true;
    const visibilityListener = documentStub.addEventListener.mock.calls[0]?.[1] as (() => void) | undefined;
    visibilityListener?.();

    expect(report).toHaveBeenCalledWith({ name: 'LCP', value: 123 });
    expect(report).toHaveBeenCalledWith({ name: 'CLS', value: 0.6000000000000001 });
    expect(report).toHaveBeenCalledWith({ name: 'INP', value: 98 });

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

  it('returns a safe cleanup when a document exists without a window', () => {
    vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('PerformanceObserver', class {} as unknown as typeof PerformanceObserver);

    expect(() => observeWebVitals()).not.toThrow();
  });

  it('returns a safe cleanup when a window exists without a document', () => {
    vi.stubGlobal('document', undefined);
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal('PerformanceObserver', class {} as unknown as typeof PerformanceObserver);

    expect(() => observeWebVitals()).not.toThrow();
  });

  it('does not let an invalid snapshot or missing event APIs crash reporting', () => {
    const documentStub = {
      hidden: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const windowStub = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal('document', documentStub);
    vi.stubGlobal('window', windowStub);
    globalThis.__sonflashWebVitals = { invalid: true } as unknown as WebVitalMetric[];
    const observers: Array<{ callback: (list: { getEntries: () => ObserverEntry[] }) => void }> = [];
    vi.stubGlobal('PerformanceObserver', class {
      constructor(callback: (list: { getEntries: () => ObserverEntry[] }) => void) {
        observers.push({ callback });
      }
      observe() {}
      disconnect() {}
    } as unknown as typeof PerformanceObserver);

    const cleanup = observeWebVitals();
    observers[0].callback({ getEntries: () => [{ entryType: 'largest-contentful-paint', startTime: 10 }] });
    documentStub.hidden = true;
    expect(() => (documentStub.addEventListener.mock.calls[0]?.[1] as (() => void) | undefined)?.()).not.toThrow();
    expect(globalThis.__sonflashWebVitals).toEqual([{ name: 'LCP', value: 10 }]);
    cleanup();
  });

  it('keeps the default event reporter observable in a bounded global snapshot', () => {
    const documentStub = {
      visibilityState: 'visible' as DocumentVisibilityState,
      hidden: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const dispatched: Array<{ readonly type: string; readonly detail?: WebVitalMetric }> = [];
    const windowStub = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn((event: { readonly type: string; readonly detail?: WebVitalMetric }) => {
        dispatched.push(event);
        return true;
      }),
      CustomEvent: class {
        readonly type = 'sonflash:web-vital';
        readonly detail?: WebVitalMetric;
        constructor(_type: string, init: { readonly detail?: WebVitalMetric }) {
          this.detail = init.detail;
        }
      },
    };
    vi.stubGlobal('document', documentStub);
    vi.stubGlobal('window', windowStub);
    const observers: Array<{ callback: (list: { getEntries: () => ObserverEntry[] }) => void }> = [];
    vi.stubGlobal('PerformanceObserver', class {
      constructor(callback: (list: { getEntries: () => ObserverEntry[] }) => void) {
        observers.push({ callback });
      }
      observe() {}
      disconnect() {}
    } as unknown as typeof PerformanceObserver);

    const cleanup = observeWebVitals();
    observers[0].callback({ getEntries: () => [{ entryType: 'largest-contentful-paint', startTime: 10 }] });
    observers[1].callback({ getEntries: () => [{ entryType: 'layout-shift', startTime: 10, value: 0.1 }] });
    observers[2].callback({ getEntries: () => [{ entryType: 'event', startTime: 10, duration: 20, interactionId: 1 }] });
    documentStub.visibilityState = 'hidden';
    documentStub.hidden = true;
    (documentStub.addEventListener.mock.calls[0]?.[1] as (() => void) | undefined)?.();

    expect(globalThis.__sonflashWebVitals).toHaveLength(3);
    expect(globalThis.__sonflashWebVitals).toEqual([
      { name: 'LCP', value: 10 },
      { name: 'CLS', value: 0.1 },
      { name: 'INP', value: 20 },
    ]);
    expect(dispatched.map(event => event.detail?.name)).toEqual(['LCP', 'CLS', 'INP']);
    cleanup();
  });
});
