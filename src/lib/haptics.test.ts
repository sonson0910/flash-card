import { afterEach, describe, expect, it, vi } from 'vitest';
import { HAPTICS_STORAGE_KEY, isHapticsEnabled, setHapticsEnabled, triggerHaptic } from './haptics';

interface BrowserOptions {
  readonly vibrate?: boolean;
  readonly hapticsStored?: string | null;
  readonly hidden?: boolean;
  readonly osReducedMotion?: boolean;
}

const installBrowser = ({ vibrate = true, hapticsStored = null, hidden = false, osReducedMotion = false }: BrowserOptions = {}) => {
  const values = new Map<string, string>();
  if (hapticsStored !== null) values.set(HAPTICS_STORAGE_KEY, hapticsStored);
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
  const vibrateFn = vi.fn();
  vi.stubGlobal('window', {
    localStorage: storage,
    dispatchEvent: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('navigator', vibrate ? { vibrate: vibrateFn } : {});
  vi.stubGlobal('document', { visibilityState: hidden ? 'hidden' : 'visible' });
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: osReducedMotion })));
  return { vibrateFn, values };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('haptics preference', () => {
  it('defaults to enabled and persists an explicit choice', () => {
    const { values } = installBrowser();
    expect(isHapticsEnabled()).toBe(true);

    setHapticsEnabled(false);
    expect(values.get(HAPTICS_STORAGE_KEY)).toBe('false');
    expect(isHapticsEnabled()).toBe(false);

    setHapticsEnabled(true);
    expect(isHapticsEnabled()).toBe(true);
  });

  it('defaults to enabled when Web Storage is denied', () => {
    vi.stubGlobal('window', {
      get localStorage(): never {
        throw new DOMException('Access denied', 'SecurityError');
      },
      dispatchEvent: vi.fn(),
    });

    expect(isHapticsEnabled()).toBe(true);
    expect(() => setHapticsEnabled(false)).not.toThrow();
  });
});

describe('triggerHaptic', () => {
  it('vibrates when enabled, supported, visible and motion is not reduced', () => {
    const { vibrateFn } = installBrowser();
    triggerHaptic('light');
    expect(vibrateFn).toHaveBeenCalledWith(12);
  });

  it('uses the pattern for the requested style', () => {
    const { vibrateFn } = installBrowser();
    triggerHaptic('success');
    expect(vibrateFn).toHaveBeenCalledWith([15, 30, 20]);
  });

  it('does not vibrate when the haptics preference is off', () => {
    const { vibrateFn } = installBrowser({ hapticsStored: 'false' });
    triggerHaptic();
    expect(vibrateFn).not.toHaveBeenCalled();
  });

  it('does not vibrate when navigator.vibrate is unsupported', () => {
    const { vibrateFn } = installBrowser({ vibrate: false });
    triggerHaptic();
    expect(vibrateFn).not.toHaveBeenCalled();
  });

  it('does not vibrate when the page is hidden', () => {
    const { vibrateFn } = installBrowser({ hidden: true });
    triggerHaptic();
    expect(vibrateFn).not.toHaveBeenCalled();
  });

  it('does not vibrate when reduced motion is in effect', () => {
    const { vibrateFn } = installBrowser({ osReducedMotion: true });
    triggerHaptic();
    expect(vibrateFn).not.toHaveBeenCalled();
  });

  it('never throws when window or navigator is unavailable', () => {
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('navigator', undefined);
    expect(() => triggerHaptic()).not.toThrow();
  });
});
