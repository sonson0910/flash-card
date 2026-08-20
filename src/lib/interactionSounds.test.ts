import { afterEach, describe, expect, it, vi } from 'vitest';
import { isSoundEnabled, setSoundEnabled, toggleSound } from './interactionSounds';

describe('interaction sound preference', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to enabled when Web Storage is denied', () => {
    vi.stubGlobal('window', {
      get localStorage() {
        throw new DOMException('Access denied', 'SecurityError');
      },
      dispatchEvent: vi.fn(),
    });

    expect(isSoundEnabled()).toBe(true);
    expect(() => setSoundEnabled(false)).not.toThrow();
    expect(toggleSound()).toBe(false);
  });
});
