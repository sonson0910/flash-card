import { afterEach, describe, expect, it, vi } from 'vitest';
import { isSupportedAudioUrl, playWordAudio } from './audio';

afterEach(() => {
  vi.useRealTimers();
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
});

describe('playWordAudio', () => {
  it('returns an idempotent handle that only stops its own audio element', () => {
    const first = { play: vi.fn(() => Promise.resolve()), pause: vi.fn(), currentTime: 4 };
    const second = { play: vi.fn(() => Promise.resolve()), pause: vi.fn(), currentTime: 7 };
    const Audio = vi.fn()
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(() => second);
    vi.stubGlobal('Audio', Audio);

    const firstPlayback = playWordAudio('first', 'https://api.dictionaryapi.dev/media/pronunciations/en/first.mp3');
    const secondPlayback = playWordAudio('second', 'https://api.dictionaryapi.dev/media/pronunciations/en/second.mp3');
    firstPlayback.cancel();
    firstPlayback.cancel();

    expect(first.pause).toHaveBeenCalledTimes(1);
    expect(first.currentTime).toBe(0);
    expect(second.pause).not.toHaveBeenCalled();
    secondPlayback.cancel();
    expect(second.pause).toHaveBeenCalledTimes(1);
  });

  it('does not start fallback speech after its audio handle is cancelled', async () => {
    const rejected = Promise.reject(new Error('blocked'));
    rejected.catch(() => undefined);
    const audio = { play: vi.fn(() => rejected), pause: vi.fn(), currentTime: 0 };
    const speak = vi.fn();
    vi.stubGlobal('Audio', vi.fn(() => audio));
    vi.stubGlobal('window', { speechSynthesis: { speak, cancel: vi.fn() } });
    vi.stubGlobal('SpeechSynthesisUtterance', class { lang = ''; rate = 1; });

    const playback = playWordAudio('word', 'https://api.dictionaryapi.dev/media/pronunciations/en/word.mp3');
    playback.cancel();
    await Promise.resolve();

    expect(speak).not.toHaveBeenCalled();
  });

  it('cancels queued fallback speech before its utterance can start', () => {
    vi.useFakeTimers();
    const speak = vi.fn();
    const cancel = vi.fn();
    let utterance: { volume: number; onstart: (() => void) | null } | null = null;
    class FakeUtterance {
      lang = '';
      rate = 1;
      volume = 1;
      onstart: (() => void) | null = null;
      constructor() { utterance = this; }
    }
    vi.stubGlobal('window', {
      speechSynthesis: { speak, cancel },
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    });
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);

    const playback = playWordAudio('word', null);
    playback.cancel();
    utterance!.onstart?.();
    vi.advanceTimersByTime(50);

    expect(utterance!.volume).toBe(0);
    expect(speak).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  it('cancels only its active speech before another surface starts', () => {
    vi.useFakeTimers();
    const speak = vi.fn();
    const cancel = vi.fn();
    const utterances: Array<{ onstart: (() => void) | null }> = [];
    class FakeUtterance {
      lang = '';
      rate = 1;
      volume = 1;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      constructor() { utterances.push(this); }
    }
    vi.stubGlobal('window', {
      speechSynthesis: { speak, cancel },
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    });
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);

    const first = playWordAudio('first', null);
    vi.advanceTimersByTime(50);
    utterances[0].onstart?.();
    first.cancel();
    expect(cancel).toHaveBeenCalledOnce();

    const second = playWordAudio('second', null);
    vi.advanceTimersByTime(50);
    utterances[1].onstart?.();
    first.cancel();

    expect(speak).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledOnce();
    second.cancel();
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it('cancels a current utterance after speak queues it but before onstart', () => {
    vi.useFakeTimers();
    const speak = vi.fn();
    const cancel = vi.fn();
    const utterances: Array<{ onstart: (() => void) | null }> = [];
    class FakeUtterance {
      lang = '';
      rate = 1;
      volume = 1;
      onstart: (() => void) | null = null;
      constructor() { utterances.push(this); }
    }
    vi.stubGlobal('window', {
      speechSynthesis: { speak, cancel },
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    });
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);

    const first = playWordAudio('first', null);
    vi.advanceTimersByTime(50);
    expect(speak).toHaveBeenCalledOnce();
    first.cancel();
    expect(cancel).toHaveBeenCalledOnce();

    playWordAudio('second', null);
    vi.advanceTimersByTime(50);
    utterances[1].onstart?.();
    first.cancel();

    expect(speak).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledOnce();
  });
});
