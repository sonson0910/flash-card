import { act, createElement, useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  useFlashcardSpeechMatch,
  type FlashcardSpeechMatchResult,
} from './useFlashcardSpeechMatch';

type FakeRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: unknown) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onend: (() => void) | null;
  start: ReturnType<typeof vi.fn>;
  abort: ReturnType<typeof vi.fn>;
};

type HarnessProps = {
  readonly cardId: string;
  readonly word: string;
  readonly explanation: string;
};

type HarnessSnapshot = FlashcardSpeechMatchResult & {
  readonly pronunciationError: string | null;
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

const installRecognition = (options: { readonly webkit?: boolean; readonly constructorThrows?: boolean; readonly startThrows?: boolean } = {}) => {
  const instances: FakeRecognition[] = [];
  class Constructor {
    constructor() {
      if (options.constructorThrows) throw new Error('constructor failed');
      const instance: FakeRecognition = {
        lang: '',
        continuous: true,
        interimResults: true,
        maxAlternatives: 0,
        onstart: null,
        onresult: null,
        onerror: null,
        onend: null,
        start: vi.fn(() => {
          if (options.startThrows) throw new Error('start failed');
        }),
        abort: vi.fn(),
      };
      instances.push(instance);
      return instance;
    }
  }
  vi.stubGlobal(options.webkit ? 'webkitSpeechRecognition' : 'SpeechRecognition', Constructor);
  return { instances };
};

const mountHarness = (onPronunciationError?: (message: string | null) => void) => {
  const container = installMinimalReactDom();
  let snapshot!: HarnessSnapshot;

  function Harness({ cardId, word, explanation }: HarnessProps) {
    const [pronunciationError, setPronunciationError] = useState<string | null>(null);
    const reportPronunciationError = useCallback((message: string | null) => {
      onPronunciationError?.(message);
      setPronunciationError(message);
    }, [onPronunciationError]);
    const result = useFlashcardSpeechMatch({
      cardId,
      word,
      explanation,
      onPronunciationError: reportPronunciationError,
    });
    snapshot = { ...result, pronunciationError };
    return null;
  }

  const root = createRoot(container);
  return {
    root,
    snapshot: () => snapshot,
    render: async (props: HarnessProps) => {
      await act(async () => root.render(createElement(Harness, props)));
    },
  };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useFlashcardSpeechMatch', () => {
  it('uses standard SpeechRecognition with the existing push-to-talk configuration', async () => {
    const { instances } = installRecognition();
    const harness = mountHarness();
    try {
      await harness.render({ cardId: 'card-a', word: 'hello', explanation: 'a greeting' });
      const stopPropagation = vi.fn();
      act(() => harness.snapshot().startPronunciationCheck({ stopPropagation }, 'word'));

      expect(stopPropagation).toHaveBeenCalledOnce();
      expect(instances).toHaveLength(1);
      expect(instances[0]).toMatchObject({
        lang: 'en-US',
        continuous: false,
        interimResults: false,
        maxAlternatives: 1,
      });
      expect(harness.snapshot().isRecording).toBe(true);
      expect(harness.snapshot().recordingTarget).toBe('word');
    } finally {
      await act(async () => harness.root.unmount());
    }
  });

  it('uses the webkit constructor when standard recognition is unavailable', async () => {
    const { instances } = installRecognition({ webkit: true });
    const harness = mountHarness();
    try {
      await harness.render({ cardId: 'card-a', word: 'hello', explanation: 'a greeting' });
      act(() => harness.snapshot().startPronunciationCheck({ stopPropagation: vi.fn() }));

      expect(instances).toHaveLength(1);
      expect(harness.snapshot().isRecording).toBe(true);
    } finally {
      await act(async () => harness.root.unmount());
    }
  });

  it('reports unsupported recognition without opening a session', async () => {
    const harness = mountHarness();
    try {
      await harness.render({ cardId: 'card-a', word: 'hello', explanation: 'a greeting' });
      act(() => harness.snapshot().startPronunciationCheck({ stopPropagation: vi.fn() }));

      expect(harness.snapshot().isRecording).toBe(false);
      expect(harness.snapshot().recordingTarget).toBeNull();
      expect(harness.snapshot().pronunciationError).toBe('This browser does not support speech recognition. Try Google Chrome.');
    } finally {
      await act(async () => harness.root.unmount());
    }
  });

  it('scores final word and explanation transcripts with their captured target and confidence', async () => {
    const { instances } = installRecognition();
    const harness = mountHarness();
    try {
      await harness.render({ cardId: 'card-a', word: 'hello', explanation: 'A clear greeting.' });
      act(() => harness.snapshot().startPronunciationCheck({ stopPropagation: vi.fn() }, 'word'));
      act(() => instances[0].onresult?.({ results: [{ isFinal: true, 0: { transcript: ' Hello!', confidence: 0.82 } }] }));

      expect(harness.snapshot().pronunciationScore).toMatchObject({
        confidence: 0.82,
        transcript: 'hello',
        type: 'word',
      });

      act(() => instances[0].onend?.());
      act(() => harness.snapshot().startPronunciationCheck({ stopPropagation: vi.fn() }, 'explanation'));
      act(() => instances[1].onresult?.({ results: [{ isFinal: true, 0: { transcript: 'A clear greeting.', confidence: 0.61 } }] }));

      expect(harness.snapshot().pronunciationScore).toMatchObject({
        confidence: 0.61,
        transcript: 'a clear greeting',
        type: 'explanation',
      });
    } finally {
      await act(async () => harness.root.unmount());
    }
  });

  it('ignores interim and malformed result events until a final nonempty transcript arrives', async () => {
    const { instances } = installRecognition();
    const harness = mountHarness();
    try {
      await harness.render({ cardId: 'card-a', word: 'hello', explanation: 'a greeting' });
      act(() => harness.snapshot().startPronunciationCheck({ stopPropagation: vi.fn() }));
      const recognition = instances[0];

      act(() => recognition.onresult?.({ results: [{ isFinal: false, 0: { transcript: 'interim', confidence: 0.9 } }] }));
      act(() => recognition.onresult?.({ results: [] }));
      act(() => recognition.onresult?.({ results: [{ isFinal: true, 0: { transcript: 42 } }] }));
      act(() => recognition.onresult?.({ results: [{ isFinal: true, 0: { transcript: '   ' } }] }));
      expect(harness.snapshot().pronunciationScore).toBeNull();
      expect(harness.snapshot().isRecording).toBe(true);

      act(() => recognition.onresult?.({ results: [{ isFinal: true, 0: { transcript: 'hello' } }] }));
      expect(harness.snapshot().pronunciationScore).toMatchObject({ transcript: 'hello', type: 'word' });
    } finally {
      await act(async () => harness.root.unmount());
    }
  });

  it('maps denied and runtime recognition errors to the existing messages', async () => {
    const { instances } = installRecognition();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const harness = mountHarness();
    try {
      await harness.render({ cardId: 'card-a', word: 'hello', explanation: 'a greeting' });
      act(() => harness.snapshot().startPronunciationCheck({ stopPropagation: vi.fn() }));
      act(() => instances[0].onerror?.({ error: 'not-allowed' }));
      expect(harness.snapshot().pronunciationError).toBe('Microphone access is blocked. Allow microphone access for this site, then try again.');
      expect(harness.snapshot().isRecording).toBe(false);

      act(() => harness.snapshot().startPronunciationCheck({ stopPropagation: vi.fn() }));
      act(() => instances[1].onerror?.({ error: 'network' }));
      expect(harness.snapshot().pronunciationError).toBe('Speech could not be recognised. Check microphone permission and try again.');
    } finally {
      await act(async () => harness.root.unmount());
    }
  });

  it('handles constructor and start failures with the microphone start message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const constructorHarness = mountHarness();
    installRecognition({ constructorThrows: true });
    try {
      await constructorHarness.render({ cardId: 'card-a', word: 'hello', explanation: 'a greeting' });
      expect(() => act(() => constructorHarness.snapshot().startPronunciationCheck({ stopPropagation: vi.fn() }))).not.toThrow();
      expect(constructorHarness.snapshot().pronunciationError).toBe('The microphone could not start. Check permission and try again.');
    } finally {
      await act(async () => constructorHarness.root.unmount());
    }

    installRecognition({ startThrows: true });
    const startHarness = mountHarness();
    try {
      await startHarness.render({ cardId: 'card-a', word: 'hello', explanation: 'a greeting' });
      act(() => startHarness.snapshot().startPronunciationCheck({ stopPropagation: vi.fn() }));
      expect(startHarness.snapshot().pronunciationError).toBe('The microphone could not start. Check permission and try again.');
      expect(startHarness.snapshot().isRecording).toBe(false);
    } finally {
      await act(async () => startHarness.root.unmount());
    }
  });

  it('aborts and invalidates new runs, card changes, and unmounts', async () => {
    const { instances } = installRecognition();
    const onPronunciationError = vi.fn<(message: string | null) => void>();
    const harness = mountHarness(onPronunciationError);
    try {
      await harness.render({ cardId: 'card-a', word: 'hello', explanation: 'a greeting' });
      act(() => harness.snapshot().startPronunciationCheck({ stopPropagation: vi.fn() }, 'word'));
      const first = instances[0];
      const staleResult = first.onresult;
      const staleError = first.onerror;
      const staleEnd = first.onend;

      act(() => harness.snapshot().startPronunciationCheck({ stopPropagation: vi.fn() }, 'explanation'));
      expect(first.abort).toHaveBeenCalledOnce();
      const second = instances[1];
      const staleSecondStart = second.onstart;
      const staleSecondResult = second.onresult;
      const staleSecondError = second.onerror;
      const staleSecondEnd = second.onend;
      act(() => {
        staleResult?.({ results: [{ isFinal: true, 0: { transcript: 'hello' } }] });
        staleError?.({ error: 'network' });
        staleEnd?.();
      });
      expect(harness.snapshot().recordingTarget).toBe('explanation');
      expect(harness.snapshot().pronunciationScore).toBeNull();
      expect(harness.snapshot().pronunciationError).toBeNull();

      await harness.render({ cardId: 'card-b', word: 'world', explanation: 'another greeting' });
      expect(second.abort).toHaveBeenCalledOnce();
      expect(harness.snapshot().isRecording).toBe(false);
      expect(harness.snapshot().recordingTarget).toBeNull();
      expect(harness.snapshot().pronunciationScore).toBeNull();
      expect(harness.snapshot().pronunciationError).toBeNull();

      act(() => {
        staleSecondStart?.();
        staleSecondResult?.({ results: [{ isFinal: true, 0: { transcript: 'world' } }] });
        staleSecondError?.({ error: 'network' });
        staleSecondEnd?.();
      });
      expect(harness.snapshot().pronunciationScore).toBeNull();
      expect(harness.snapshot().pronunciationError).toBeNull();

      act(() => harness.snapshot().startPronunciationCheck({ stopPropagation: vi.fn() }));
      const third = instances[2];
      const staleThirdStart = third.onstart;
      const staleThirdResult = third.onresult;
      const staleThirdError = third.onerror;
      const staleThirdEnd = third.onend;
      const errorCallsBeforeUnmount = onPronunciationError.mock.calls.length;
      await act(async () => harness.root.unmount());
      expect(third.abort).toHaveBeenCalledOnce();
      act(() => {
        staleThirdStart?.();
        staleThirdResult?.({ results: [{ isFinal: true, 0: { transcript: 'world' } }] });
        staleThirdError?.({ error: 'network' });
        staleThirdEnd?.();
      });
      expect(onPronunciationError.mock.calls.length).toBe(errorCallsBeforeUnmount);
    } finally {
      // The root is unmounted in the assertion path.
    }
  });

  it('returns to silent idle on a natural end without a result', async () => {
    const { instances } = installRecognition();
    const harness = mountHarness();
    try {
      await harness.render({ cardId: 'card-a', word: 'hello', explanation: 'a greeting' });
      act(() => harness.snapshot().startPronunciationCheck({ stopPropagation: vi.fn() }));
      act(() => instances[0].onend?.());

      expect(harness.snapshot().isRecording).toBe(false);
      expect(harness.snapshot().recordingTarget).toBeNull();
      expect(harness.snapshot().pronunciationScore).toBeNull();
      expect(harness.snapshot().pronunciationError).toBeNull();
    } finally {
      await act(async () => harness.root.unmount());
    }
  });
});
