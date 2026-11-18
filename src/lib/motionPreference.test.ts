import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getEffectiveReducedMotion,
  setUserReducedMotion,
  USER_REDUCED_MOTION_KEY,
} from './motionPreference';

afterEach(() => {
  vi.unstubAllGlobals();
});

const installBrowser = (osReduced = false) => {
  const values = new Map<string, string>();
  const document = { documentElement: { dataset: {} as DOMStringMap } };
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  vi.stubGlobal('document', document);
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: osReduced })));
  return { document, values };
};

describe('motion preference', () => {
  it('persists the user choice and marks the document for CSS motion reduction', () => {
    const { document, values } = installBrowser();
    setUserReducedMotion(true);

    expect(values.get(USER_REDUCED_MOTION_KEY)).toBe('true');
    expect(document.documentElement.dataset.motion).toBe('reduced');

    setUserReducedMotion(false);
    expect(values.get(USER_REDUCED_MOTION_KEY)).toBe('false');
    expect(document.documentElement.dataset.motion).toBe('system');
  });

  it('uses OS reduction unless the user has explicitly enabled reduction', () => {
    installBrowser(true);
    setUserReducedMotion(false);
    expect(getEffectiveReducedMotion()).toBe(true);

    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    setUserReducedMotion(true);
    expect(getEffectiveReducedMotion()).toBe(true);
  });
});
