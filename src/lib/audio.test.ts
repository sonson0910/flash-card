import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancelSpeech, isSupportedAudioUrl, playCorrectSound, playIncorrectSound, speakText } from './audio';

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

  it('uses speech synthesis as an explicit reply-reading seam', () => {
    const speak = vi.fn();
    const cancel = vi.fn();
    vi.stubGlobal('window', { speechSynthesis: { speaking: false, cancel, speak } });
    vi.stubGlobal('SpeechSynthesisUtterance', class {
      readonly text: string;
      lang = '';
      rate = 0;
      constructor(text: string) { this.text = text; }
    });

    speakText('  The reply is here.  ');

    expect(cancel).toHaveBeenCalledOnce();
    expect(speak).toHaveBeenCalledWith(expect.objectContaining({ text: 'The reply is here.' }));
  });

  it('cancels active speech safely when the owner-scoped surface is disposed', () => {
    const cancel = vi.fn();
    vi.stubGlobal('window', { speechSynthesis: { cancel } });

    cancelSpeech();

    expect(cancel).toHaveBeenCalledOnce();
  });
});
