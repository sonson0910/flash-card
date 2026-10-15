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
  it('uses the card speech locale for synthesized pronunciation', () => {
    const speak = vi.fn();
    const utterances: Array<{ lang: string; voice?: SpeechSynthesisVoice }> = [];
    const selectedVoice = { lang: 'ko-KR', name: 'Korean voice', voiceURI: 'korean', localService: true } as SpeechSynthesisVoice;
    class FakeUtterance {
      lang = '';
      rate = 1;
      voice?: SpeechSynthesisVoice;
      constructor() { utterances.push(this); }
    }
    vi.stubGlobal('window', {
      speechSynthesis: { speak, cancel: vi.fn() },
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    });
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);

    const playback = playWordAudio('안녕', null, 'ko-KR', selectedVoice);
    expect(utterances[0].lang).toBe('ko-KR');
    expect(utterances[0].voice).toBe(selectedVoice);
    expect(speak).toHaveBeenCalledOnce();
    playback.cancel();
  });

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

  it('cancels fallback speech that is already queued', () => {
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
    expect(speak).toHaveBeenCalledOnce();
    playback.cancel();
    utterance!.onstart?.();

    expect(utterance!.volume).toBe(0);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('cancels only its active speech before another surface starts', () => {
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
    utterances[0].onstart?.();
    first.cancel();
    expect(cancel).toHaveBeenCalledOnce();

    const second = playWordAudio('second', null);
    utterances[1].onstart?.();
    first.cancel();

    expect(speak).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledOnce();
    second.cancel();
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it('cancels a current utterance after speak queues it but before onstart', () => {
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
    expect(speak).toHaveBeenCalledOnce();
    first.cancel();
    expect(cancel).toHaveBeenCalledOnce();

    playWordAudio('second', null);
    utterances[1].onstart?.();
    first.cancel();

    expect(speak).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledOnce();
  });
});
