import { afterEach, describe, expect, it, vi } from 'vitest';
import { setZenGlassMode } from './useZenGlassMode';

describe('setZenGlassMode', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('notifies other hook consumers when persistence is unavailable', () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal('window', {
      localStorage: { setItem: () => { throw new Error('denied'); } },
      dispatchEvent,
    });
    vi.stubGlobal('CustomEvent', class {
      type: string;
      detail: { enabled: boolean };

      constructor(type: string, init: { detail: { enabled: boolean } }) {
        this.type = type;
        this.detail = init.detail;
      }
    });

    setZenGlassMode(true);

    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'sonflash-zen-mode-change',
      detail: { enabled: true },
    }));
  });
});
