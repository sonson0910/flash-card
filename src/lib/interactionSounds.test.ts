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

describe('sound-off gating', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // A fresh module import is required here: `audioCtx` is a module-level singleton, so
  // reusing the statically-imported bindings above could hide a regression behind an
  // AudioContext a different test already constructed.
  it('never constructs an AudioContext for the flip, reward or success cues when sound is off', async () => {
    vi.resetModules();
    const AudioContextCtor = vi.fn();
    vi.stubGlobal('window', {
      localStorage: { getItem: () => 'false', setItem: vi.fn() },
      AudioContext: AudioContextCtor,
      dispatchEvent: vi.fn(),
    });
    const { playFlipSound, playRewardSound, playSuccessSound } = await import('./interactionSounds');

    playFlipSound();
    playRewardSound();
    playSuccessSound();

    expect(AudioContextCtor).not.toHaveBeenCalled();
  });
});
