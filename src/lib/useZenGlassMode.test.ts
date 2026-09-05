import { afterEach, describe, expect, it, vi } from 'vitest';
import { setZenGlassMode } from './useZenGlassMode';

describe('setZenGlassMode', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('persists the value and dispatches one change event', () => {
    const setItem = vi.fn();
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { localStorage: { setItem }, dispatchEvent });

    setZenGlassMode(true);

    expect(setItem).toHaveBeenCalledWith('sonflash_zen_glass_mode', 'true');
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect(dispatchEvent.mock.calls[0][0]).toMatchObject({
      type: 'sonflash-zen-mode-change',
      detail: { enabled: true },
    });
  });

  it('dispatches one change event when storage is blocked', () => {
    const setItem = vi.fn(() => {
      throw new Error('storage blocked');
    });
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', { localStorage: { setItem }, dispatchEvent });

    expect(() => setZenGlassMode(false)).not.toThrow();

    expect(setItem).toHaveBeenCalledWith('sonflash_zen_glass_mode', 'false');
    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect(dispatchEvent.mock.calls[0][0]).toMatchObject({
      type: 'sonflash-zen-mode-change',
      detail: { enabled: false },
    });
  });
});
