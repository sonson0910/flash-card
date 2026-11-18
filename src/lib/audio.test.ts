import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancelSpeech, isSupportedAudioUrl, playCorrectSound, playIncorrectSound, playWordAudio, speakText } from './audio';

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

it('shares playback ownership between native audio and direct speech', () => {
  const players: Array<{ pause: ReturnType<typeof vi.fn> }> = [];
  vi.stubGlobal('Audio', class {
    pause = vi.fn();
    currentTime = 0;
    constructor() { players.push(this); }
    play() { return Promise.resolve(); }
  });
  const speak = vi.fn();
  vi.stubGlobal('window', { speechSynthesis: { speak, cancel: vi.fn(), resume: vi.fn() } });
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(readonly text: string) {} });

  playWordAudio('native', 'https://api.dictionaryapi.dev/native.mp3');
  expect(speakText('direct')).toBe(true);

  expect(players[0].pause).toHaveBeenCalledOnce();
  expect(speak).toHaveBeenCalledWith(expect.objectContaining({ text: 'direct' }));
});

it('releases direct speech ownership when native audio replaces it', () => {
  const cancel = vi.fn();
  vi.stubGlobal('window', { speechSynthesis: { speak: vi.fn(), cancel, resume: vi.fn() } });
  vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(readonly text: string) {} });
  vi.stubGlobal('Audio', class {
    pause = vi.fn();
    currentTime = 0;
    play() { return Promise.resolve(); }
  });

  expect(speakText('direct')).toBe(true);
  cancel.mockClear();
  playWordAudio('native', 'https://api.dictionaryapi.dev/native.mp3');

  expect(cancel).toHaveBeenCalledOnce();
});

describe('playWordAudio speech lifecycle', () => {
  it('cancels speech after it is queued but before onstart', () => {
    const speak = vi.fn();
    const cancel = vi.fn();
    vi.stubGlobal('window', { speechSynthesis: { resume: vi.fn(), speak, cancel } });
    vi.stubGlobal('SpeechSynthesisUtterance', class {
      lang = '';
      rate = 1;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
    });

    const stop = playWordAudio('word', null);
    expect(speak).toHaveBeenCalledOnce();
    stop();
    stop();

    expect(cancel).toHaveBeenCalledOnce();
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
      .mockImplementationOnce(function () { return first; })
      .mockImplementationOnce(function () { return second; });
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
    vi.stubGlobal('Audio', vi.fn(function () { return audio; }));
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
