import { afterEach, describe, expect, it, vi } from 'vitest';
import { isSupportedAudioUrl, playCorrectSound, playIncorrectSound } from './audio';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isSupportedAudioUrl', () => {
  it('allows only trusted dictionary media hosts over HTTPS', () => {
    expect(isSupportedAudioUrl('https://api.dictionaryapi.dev/media/pronunciations/en/word.mp3')).toBe(true);
    expect(isSupportedAudioUrl('//ssl.gstatic.com/dictionary/static/sounds/word.mp3')).toBe(true);
    expect(isSupportedAudioUrl('https://cdn.example.com/word.mp3')).toBe(false);
    expect(isSupportedAudioUrl('http://cdn.example.com/word.mp3')).toBe(false);
    expect(isSupportedAudioUrl('javascript:alert(1)')).toBe(false);
    expect(isSupportedAudioUrl('https://api.dictionaryapi.dev.evil.example/word.mp3')).toBe(false);
  });

  it('re-exports feedback sounds with the shared preference gate', () => {
    const audioContext = vi.fn();
    vi.stubGlobal('window', {
      localStorage: { getItem: () => 'false' },
      AudioContext: audioContext,
    });

    playCorrectSound();
    playIncorrectSound();

    expect(audioContext).not.toHaveBeenCalled();
  });
});
