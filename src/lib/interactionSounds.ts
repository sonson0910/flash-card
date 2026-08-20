import { useState, useEffect } from 'react';

// Web Audio API Sound Synthesizer for SonFlash
// Zero external files, ultra-low latency, <1KB footprint.

let audioCtx: AudioContext | null = null;

const SOUND_STORAGE_KEY = 'sonflash_sound_enabled';

const getAudioContext = (): AudioContext | null => {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    void audioCtx.resume().catch(() => undefined);
  }
  return audioCtx;
};

export const isSoundEnabled = (): boolean => {
  if (typeof window === 'undefined') return true;
  const stored = window.localStorage.getItem(SOUND_STORAGE_KEY);
  return stored === null ? true : stored === 'true';
};

export const setSoundEnabled = (enabled: boolean): void => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(SOUND_STORAGE_KEY, String(enabled));
  window.dispatchEvent(new Event('sonflash_sound_changed'));
};

export const toggleSound = (): boolean => {
  const next = !isSoundEnabled();
  setSoundEnabled(next);
  return next;
};

/**
 * Play a gentle, high-tactile pop sound (ideal for flipping cards).
 */
export const playFlipSound = (): void => {
  try {
    if (!isSoundEnabled()) return;
    const ctx = getAudioContext();
    if (!ctx || typeof ctx.createOscillator !== 'function' || typeof ctx.createGain !== 'function') return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(380, now);
    osc.frequency.exponentialRampToValueAtTime(120, now + 0.06);

    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.06);
  } catch {
    // Audio playback must never throw or interrupt UX
  }
};

/**
 * Play an elegant ascending harmonic chime for rewards/streaks/stars.
 */
export const playRewardSound = (): void => {
  try {
    if (!isSoundEnabled()) return;
    const ctx = getAudioContext();
    if (!ctx || typeof ctx.createOscillator !== 'function' || typeof ctx.createGain !== 'function') return;

    const now = ctx.currentTime;
    const notes = [587.33, 880, 1174.66]; // D5, A5, D6 harmonic chord

    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.05);

      gain.gain.setValueAtTime(0.001, now + i * 0.05);
      gain.gain.linearRampToValueAtTime(0.08, now + i * 0.05 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.05 + 0.28);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + i * 0.05);
      osc.stop(now + i * 0.05 + 0.3);
    });
  } catch {
    // Audio playback must never throw
  }
};

/**
 * Play a light positive checkmark chime for correct answers.
 */
export const playSuccessSound = (): void => {
  try {
    if (!isSoundEnabled()) return;
    const ctx = getAudioContext();
    if (!ctx || typeof ctx.createOscillator !== 'function' || typeof ctx.createGain !== 'function') return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(659.25, now); // E5
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.09); // A5

    gain.gain.setValueAtTime(0.09, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(now);
    osc.stop(now + 0.14);
  } catch {
    // Audio playback must never throw
  }
};

/**
 * React hook to observe and toggle sound state.
 */
export const useSoundSettings = () => {
  const [enabled, setEnabled] = useState(isSoundEnabled);

  useEffect(() => {
    const handleUpdate = () => setEnabled(isSoundEnabled());
    window.addEventListener('sonflash_sound_changed', handleUpdate);
    window.addEventListener('storage', handleUpdate);
    return () => {
      window.removeEventListener('sonflash_sound_changed', handleUpdate);
      window.removeEventListener('storage', handleUpdate);
    };
  }, []);

  return {
    isSoundEnabled: enabled,
    toggleSound: () => toggleSound(),
    setSoundEnabled,
  };
};
