import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFlashcardAudio, type FlashcardAudioResult } from './useFlashcardAudio';

type FakeAudio = {
  currentTime: number;
  playbackRate: number;
  onended: (() => void) | null;
  onerror: (() => void) | null;
  pause: ReturnType<typeof vi.fn>;
  play: ReturnType<typeof vi.fn>;
};

type FakeUtterance = {
  text: string;
  lang: string;
  rate: number;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

const installMinimalReactDom = () => {
  const documentLike: Record<string, unknown> = {
    nodeType: 9,
    activeElement: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    defaultView: globalThis,
  };
  const container = {
    nodeType: 1,
    ownerDocument: documentLike,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    nodeName: 'DIV',
    tagName: 'DIV',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
  };
  documentLike.documentElement = container;
  documentLike.body = container;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', documentLike);
  vi.stubGlobal('HTMLIFrameElement', class HTMLIFrameElement {});
  vi.stubGlobal('HTMLElement', class HTMLElement {});
  vi.stubGlobal('Node', class Node {});
  return container as unknown as Element;
};

const createAudio = (): FakeAudio => ({
  currentTime: 0,
  playbackRate: 1,
  onended: null,
  onerror: null,
  pause: vi.fn(),
  play: vi.fn(async () => undefined),
});

const createSpeech = () => {
  const utterances: FakeUtterance[] = [];
  const speechSynthesis = {
    cancel: vi.fn(),
    resume: vi.fn(),
    speak: vi.fn((utterance: FakeUtterance) => { utterances.push(utterance); }),
  };
  class SpeechSynthesisUtterance implements FakeUtterance {
    text: string;
    lang = '';
    rate = 1;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;

    constructor(text: string) {
      this.text = text;
    }
  }
  vi.stubGlobal('SpeechSynthesisUtterance', SpeechSynthesisUtterance);
  vi.stubGlobal('speechSynthesis', speechSynthesis);
  return { speechSynthesis, utterances };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useFlashcardAudio', () => {
  it('falls back to speech once when native audio reports a source error', async () => {
    const container = installMinimalReactDom();
    const { speechSynthesis, utterances } = createSpeech();
    const audio = createAudio();
    let result!: FlashcardAudioResult;

    function Harness() {
      result = useFlashcardAudio({ cardId: 'card-a', word: 'hello', explanation: 'a greeting' });
      (result.audioRef as { current: HTMLAudioElement | null }).current = audio as unknown as HTMLAudioElement;
      return null;
    }

    const root = createRoot(container);
    try {
      await act(async () => root.render(createElement(Harness)));
      act(() => result.playAudio({ stopPropagation: vi.fn() }));
      const sourceError = audio.onerror;
      act(() => {
        sourceError?.();
        sourceError?.();
      });
      await act(async () => undefined);

      expect(speechSynthesis.speak).toHaveBeenCalledOnce();
      expect(utterances[0]).toMatchObject({ text: 'hello', rate: 0.9 });
      expect(result.isPlayingAudio).toBe(true);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('keeps speech playback active when a captured native completion arrives late', async () => {
    const container = installMinimalReactDom();
    const { utterances } = createSpeech();
    const audio = createAudio();
    let result!: FlashcardAudioResult;

    function Harness() {
      result = useFlashcardAudio({ cardId: 'card-a', word: 'hello', explanation: 'a greeting' });
      (result.audioRef as { current: HTMLAudioElement | null }).current = audio as unknown as HTMLAudioElement;
      return null;
    }

    const root = createRoot(container);
    try {
      await act(async () => root.render(createElement(Harness)));
      act(() => result.playAudio({ stopPropagation: vi.fn() }));
      const nativeCompletion = audio.onended;
      act(() => audio.onerror?.());
      expect(utterances).toHaveLength(1);

      act(() => nativeCompletion?.());
      expect(result.isPlayingAudio).toBe(true);
      act(() => utterances[0].onend?.());
      expect(result.isPlayingAudio).toBe(false);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('ignores a captured native error after playback has completed', async () => {
    const container = installMinimalReactDom();
    const { speechSynthesis } = createSpeech();
    const audio = createAudio();
    let result!: FlashcardAudioResult;

    function Harness() {
      result = useFlashcardAudio({ cardId: 'card-a', word: 'hello', explanation: 'a greeting' });
      (result.audioRef as { current: HTMLAudioElement | null }).current = audio as unknown as HTMLAudioElement;
      return null;
    }

    const root = createRoot(container);
    try {
      await act(async () => root.render(createElement(Harness)));
      act(() => result.playAudio({ stopPropagation: vi.fn() }));
      const nativeError = audio.onerror;
      act(() => audio.onended?.());
      act(() => nativeError?.());
      expect(speechSynthesis.speak).not.toHaveBeenCalled();
      expect(result.isPlayingAudio).toBe(false);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('falls back when native play is rejected and ignores a later source error', async () => {
    const container = installMinimalReactDom();
    const { speechSynthesis } = createSpeech();
    const audio = createAudio();
    audio.play = vi.fn(() => Promise.reject(new Error('native failed')));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let result!: FlashcardAudioResult;

    function Harness() {
      result = useFlashcardAudio({ cardId: 'card-a', word: 'hello', explanation: 'a greeting' });
      (result.audioRef as { current: HTMLAudioElement | null }).current = audio as unknown as HTMLAudioElement;
      return null;
    }

    const root = createRoot(container);
    try {
      await act(async () => root.render(createElement(Harness)));
      act(() => result.playAudio({ stopPropagation: vi.fn() }));
      const lateSourceError = audio.onerror;
      await act(async () => undefined);
      act(() => lateSourceError?.());
      await act(async () => undefined);

      expect(speechSynthesis.speak).toHaveBeenCalledOnce();
      expect(warning).toHaveBeenCalledOnce();
    } finally {
      warning.mockRestore();
      await act(async () => root.unmount());
    }
  });

  it('keeps native and speech playback at their existing speed settings', async () => {
    const container = installMinimalReactDom();
    const { utterances } = createSpeech();
    const audio = createAudio();
    let result!: FlashcardAudioResult;

    function Harness() {
      result = useFlashcardAudio({ cardId: 'card-a', word: 'hello', explanation: 'a greeting' });
      (result.audioRef as { current: HTMLAudioElement | null }).current = audio as unknown as HTMLAudioElement;
      return null;
    }

    const root = createRoot(container);
    try {
      await act(async () => root.render(createElement(Harness)));
      act(() => result.toggleAudioSpeed({ stopPropagation: vi.fn() }));
      expect(result.audioSpeed).toBe(0.75);

      act(() => result.playAudio({ stopPropagation: vi.fn() }));
      expect(audio.playbackRate).toBe(0.75);

      (result.audioRef as { current: HTMLAudioElement | null }).current = null;
      act(() => result.playExplanationAudio({ stopPropagation: vi.fn() }));
      expect(utterances[0]).toMatchObject({ text: 'a greeting', rate: 0.65 });
      expect(result.isPlayingAudio).toBe(false);
    } finally {
      await act(async () => root.unmount());
    }
  });

  it('reports the existing messages for unavailable or failed speech', async () => {
    const unsupportedContainer = installMinimalReactDom();
    let unsupportedResult!: FlashcardAudioResult;

    function UnsupportedHarness() {
      unsupportedResult = useFlashcardAudio({ cardId: 'card-a', word: 'hello', explanation: 'a greeting' });
      (unsupportedResult.audioRef as { current: HTMLAudioElement | null }).current = null;
      return null;
    }

    const unsupportedRoot = createRoot(unsupportedContainer);
    try {
      await act(async () => unsupportedRoot.render(createElement(UnsupportedHarness)));
      act(() => unsupportedResult.playAudio({ stopPropagation: vi.fn() }));
      expect(unsupportedResult.isPlayingAudio).toBe(false);
      expect(unsupportedResult.pronunciationError).toBe('Audio playback is not supported by this browser.');
    } finally {
      await act(async () => unsupportedRoot.unmount());
    }

    const failedContainer = installMinimalReactDom();
    const { utterances } = createSpeech();
    let failedResult!: FlashcardAudioResult;

    function FailedHarness() {
      failedResult = useFlashcardAudio({ cardId: 'card-a', word: 'hello', explanation: 'a greeting' });
      (failedResult.audioRef as { current: HTMLAudioElement | null }).current = null;
      return null;
    }

    const failedRoot = createRoot(failedContainer);
    try {
      await act(async () => failedRoot.render(createElement(FailedHarness)));
      act(() => failedResult.playExplanationAudio({ stopPropagation: vi.fn() }));
      act(() => utterances[0].onerror?.());
      await act(async () => undefined);
      expect(failedResult.isPlayingAudio).toBe(false);
      expect(failedResult.pronunciationError).toBe('Audio could not be played. Check this site’s audio permission and try again.');
    } finally {
      await act(async () => failedRoot.unmount());
    }
  });

  it('invalidates a rejected run when the card changes and cancels audio on unmount', async () => {
    const container = installMinimalReactDom();
    const { speechSynthesis, utterances } = createSpeech();
    const audio = createAudio();
    let rejectPlay!: (error: Error) => void;
    audio.play = vi.fn(() => new Promise<void>((_, reject) => { rejectPlay = reject; }));
    let result!: FlashcardAudioResult;

    function Harness({ cardId }: { readonly cardId: string }) {
      result = useFlashcardAudio({ cardId, word: cardId, explanation: `explanation-${cardId}` });
      (result.audioRef as { current: HTMLAudioElement | null }).current = audio as unknown as HTMLAudioElement;
      return null;
    }

    const root = createRoot(container);
    try {
      await act(async () => root.render(createElement(Harness, { cardId: 'card-a' })));
      act(() => result.playAudio({ stopPropagation: vi.fn() }));
      await act(async () => root.render(createElement(Harness, { cardId: 'card-b' })));
      rejectPlay(new Error('late native failure'));
      await act(async () => undefined);

      expect(speechSynthesis.speak).not.toHaveBeenCalled();
      expect(result.isPlayingAudio).toBe(false);
      expect(result.pronunciationError).toBeNull();
      expect(audio.pause).toHaveBeenCalled();

      act(() => result.playExplanationAudio({ stopPropagation: vi.fn() }));
      expect(speechSynthesis.speak).toHaveBeenCalledOnce();
      const staleUtterance = utterances[0];
      await act(async () => root.render(createElement(Harness, { cardId: 'card-c' })));
      act(() => staleUtterance.onerror?.());
      await act(async () => undefined);
      expect(result.pronunciationError).toBeNull();

      act(() => result.playExplanationAudio({ stopPropagation: vi.fn() }));
      expect(speechSynthesis.speak).toHaveBeenCalledTimes(2);
      const pausesBeforeUnmount = audio.pause.mock.calls.length;
      await act(async () => root.unmount());
      expect(speechSynthesis.cancel).toHaveBeenCalled();
      expect(audio.pause).toHaveBeenCalledTimes(pausesBeforeUnmount + 1);
    } finally {
      // The root is already unmounted in the assertion path.
    }
  });
});
