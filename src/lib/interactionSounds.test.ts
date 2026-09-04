import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isSoundEnabled,
  playIncorrectSound,
  playSuccessSound,
  setSoundEnabled,
  toggleSound,
} from './interactionSounds';

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

  it('honors the disabled preference for synthesized feedback', () => {
    const audioContext = vi.fn();
    vi.stubGlobal('window', {
      localStorage: { getItem: () => 'false' },
      AudioContext: audioContext,
    });

    playSuccessSound();
    playIncorrectSound();

    expect(audioContext).not.toHaveBeenCalled();
  });
});
