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
    expect(isSoundEnabled()).toBe(false);
    expect(toggleSound()).toBe(true);
    expect(isSoundEnabled()).toBe(true);
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

  it('keeps cues off after a denied storage write until re-enabled', async () => {
    vi.resetModules();
    const AudioContextCtor = vi.fn();
    vi.stubGlobal('window', {
      get localStorage(): never {
        throw new DOMException('Access denied', 'SecurityError');
      },
      AudioContext: AudioContextCtor,
      dispatchEvent: vi.fn(),
    });
    const { isSoundEnabled, playFlipSound, setSoundEnabled } = await import('./interactionSounds');

    setSoundEnabled(false);
    playFlipSound();
    expect(isSoundEnabled()).toBe(false);
    expect(AudioContextCtor).not.toHaveBeenCalled();

    setSoundEnabled(true);
    expect(isSoundEnabled()).toBe(true);
  });

  it('uses storage again when a later preference write succeeds', async () => {
    vi.resetModules();
    const values = new Map<string, string>();
    let fails = true;
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          if (fails) {
            fails = false;
            throw new DOMException('Access denied', 'SecurityError');
          }
          values.set(key, value);
        },
      },
      dispatchEvent: vi.fn(),
    });
    const { isSoundEnabled, setSoundEnabled } = await import('./interactionSounds');

    setSoundEnabled(false);
    expect(isSoundEnabled()).toBe(false);

    setSoundEnabled(true);
    expect(isSoundEnabled()).toBe(true);
  });

  it('does not play a study cue while the page is hidden', async () => {
    vi.resetModules();
    const AudioContextCtor = vi.fn();
    vi.stubGlobal('window', {
      localStorage: { getItem: () => 'true' },
      AudioContext: AudioContextCtor,
    });
    vi.stubGlobal('document', { visibilityState: 'hidden' });
    const { playFlipSound, playRewardSound, playSuccessSound } = await import('./interactionSounds');
    playFlipSound();
    playRewardSound();
    playSuccessSound();
    expect(AudioContextCtor).not.toHaveBeenCalled();
  });

  it('creates the flip cue when sound is enabled, visible, and motion is allowed', async () => {
    vi.resetModules();
    const oscillator = {
      frequency: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    const gain = {
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
    };
    const createOscillator = vi.fn(() => oscillator);
    const createGain = vi.fn(() => gain);
    class AudioContextMock {
      currentTime = 0;
      state = 'running';
      destination = {};
      createOscillator = createOscillator;
      createGain = createGain;
    }
    const storage = { getItem: (key: string) => key === 'sonflash_sound_enabled' ? 'true' : null };
    vi.stubGlobal('window', { localStorage: storage, AudioContext: AudioContextMock });
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('document', { visibilityState: 'visible' });
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })));
    const { playFlipSound } = await import('./interactionSounds');

    playFlipSound();

    expect(createOscillator).toHaveBeenCalledOnce();
    expect(oscillator.start).toHaveBeenCalledWith(0);
  });

});
