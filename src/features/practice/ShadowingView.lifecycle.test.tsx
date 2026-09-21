import { describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  cursor: 0,
  refCursor: 0,
  states: [] as unknown[],
  refs: [] as Array<{ current: unknown }>,
  cleanups: [] as Array<() => void>,
}));

vi.mock('react', () => ({
  useState: <T,>(initial: T) => {
    const index = runtime.cursor++;
    if (!(index in runtime.states)) runtime.states[index] = initial;
    return [runtime.states[index] as T, (next: T) => { runtime.states[index] = next; }] as const;
  },
  useRef: <T,>(initial: T) => {
    const index = runtime.refCursor++;
    if (!(index in runtime.refs)) runtime.refs[index] = { current: initial };
    return runtime.refs[index] as { current: T };
  },
  useEffect: (callback: () => void | (() => void)) => {
    const cleanup = callback();
    if (typeof cleanup === 'function') runtime.cleanups.push(cleanup);
  },
  useCallback: <T,>(callback: T) => callback,
}));

const addXp = vi.hoisted(() => vi.fn());
vi.mock('../../lib/audio', () => ({ playWordAudio: vi.fn(() => ({ cancel: vi.fn() })) }));
vi.mock('../../lib/confetti', () => ({ triggerConfetti: vi.fn() }));
vi.mock('../../lib/haptics', () => ({ triggerHaptic: vi.fn() }));
vi.mock('../../lib/interactionSounds', () => ({ playRewardSound: vi.fn() }));
vi.mock('../../lib/speechMatch', () => ({ scoreSpeechMatch: vi.fn(() => ({ score: 100, matchedWords: [] })) }));

import { ShadowingView } from './ShadowingView';
import type { CardData } from '../../types/card';

const card = {
  id: 'card', word: 'resilient', translation: 'kiên cường', exampleSentence: 'Be resilient.', audioUrl: null,
} as CardData;

const button = (tree: any, label: string): any => {
  if (!tree || typeof tree !== 'object') return undefined;
  if (tree.type === 'button' && tree.props['aria-label'] === label) return tree;
  const children = tree.props?.children;
  return (Array.isArray(children) ? children : [children]).map(child => button(child, label)).find(Boolean);
};

describe('ShadowingView recognition lifecycle', () => {
  it('aborts replaced recognition and ignores stale or duplicate final results', () => {
    const recognitions: any[] = [];
    class Recognition {
      start = vi.fn(() => this.onstart?.());
      stop = vi.fn();
      abort = vi.fn();
      onstart?: () => void;
      onresult?: (event: unknown) => void;
      onerror?: (event: unknown) => void;
      onend?: () => void;
      constructor() { recognitions.push(this); }
    }
    vi.stubGlobal('window', { SpeechRecognition: Recognition });
    runtime.cursor = 0;
    runtime.refCursor = 0;
    runtime.states = [];
    runtime.refs = [];
    runtime.cleanups = [];
    addXp.mockClear();

    const tree = ShadowingView({ cards: [card], onClose: vi.fn(), onAddXp: addXp });
    button(tree, 'Start reading').props.onClick();
    button(tree, 'Start reading').props.onClick();

    expect(recognitions[0].stop).toHaveBeenCalledOnce();
    expect(recognitions[0].abort).toHaveBeenCalledOnce();
    const final = { results: [{ 0: { transcript: 'Be resilient.', confidence: 1 }, isFinal: true }] };
    recognitions[0].onresult(final);
    recognitions[1].onresult(final);
    recognitions[1].onresult(final);

    expect(addXp).toHaveBeenCalledTimes(1);
    runtime.cleanups.forEach(cleanup => cleanup());
    expect(recognitions[1].abort).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });
});
