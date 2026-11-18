import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFocusModeEnabled, writeFocusModeEnabled } from './focus-mode-preference';

afterEach(() => {
  writeFocusModeEnabled(false);
  vi.unstubAllGlobals();
});

describe('focus mode preference', () => {
  it('keeps the choice for a later Study screen', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    vi.stubGlobal('dispatchEvent', vi.fn());

    writeFocusModeEnabled(true);

    expect(readFocusModeEnabled()).toBe(true);
    expect(values.get('sonflash_focus_mode_enabled')).toBe('true');
    values.delete('sonflash_focus_mode_enabled');
    expect(readFocusModeEnabled()).toBe(false);
  });
});
