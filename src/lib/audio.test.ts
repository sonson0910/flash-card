import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancelSpeech, isSupportedAudioUrl, playCorrectSound, playIncorrectSound, playWordAudio, speakText } from './audio';

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


it('replaces native playback and ignores a superseded player rejection', async () => {
  const players: Array<{ pause: ReturnType<typeof vi.fn>; reject: (reason: Error) => void }> = [];
  vi.stubGlobal('Audio', class {
    pause = vi.fn();
    currentTime = 0;
    reject!: (reason: Error) => void;
    constructor() { players.push(this); }
    play() { return new Promise<void>((_resolve, reject) => { this.reject = reject; }); }
  });
  const speak = vi.fn();
  vi.stubGlobal('window', { speechSynthesis: { speak, cancel: vi.fn() } });
  vi.stubGlobal('SpeechSynthesisUtterance', class {});
  const stopFirst = playWordAudio('one', 'https://api.dictionaryapi.dev/one.mp3');
  const stopSecond = playWordAudio('two', 'https://api.dictionaryapi.dev/two.mp3');
  players[0].reject(new Error('late failure'));
  await Promise.resolve();
  expect(players[0].pause).toHaveBeenCalled();
  expect(speak).not.toHaveBeenCalled();
  stopFirst();
  expect(players[1].pause).not.toHaveBeenCalled();
  stopSecond();
  expect(players[1].pause).toHaveBeenCalled();
});
