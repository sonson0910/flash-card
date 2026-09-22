import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';

const hooks = vi.hoisted(() => ({
  cursor: 0,
  refs: [] as Array<{ current: unknown }>,
  states: [] as unknown[],
}));
const confetti = vi.hoisted(() => vi.fn());

vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useCallback: <T,>(callback: T) => callback,
    useEffect: vi.fn(),
    useRef: <T,>(initial: T) => {
      const index = hooks.cursor++;
      if (!(index in hooks.refs)) hooks.refs[index] = { current: initial };
      return hooks.refs[index] as { current: T };
    },
    useState: <T,>(initial: T | (() => T)) => {
      const index = hooks.cursor++;
      if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function'
        ? (initial as () => T)()
        : initial;
      return [hooks.states[index] as T, (value: T | ((current: T) => T)) => {
        const current = hooks.states[index] as T;
        hooks.states[index] = typeof value === 'function'
          ? (value as (current: T) => T)(current)
          : value;
      }] as const;
    },
  };
});

vi.mock('../../lib/confetti', () => ({ triggerConfetti: confetti }));

import { ReviewControls } from '../../components/study/ReviewControls';
import { SessionRecapModal } from './SessionRecapModal';
import { StudyView } from './StudyView';
import type { StudyRatingSettlement } from './usePracticeSession';

const card: CardData = {
  id: 'final-card', word: 'final', translation: 'cuối cùng', explanation: '', phonetic: '', emoji: '',
  category: 'General', audioUrl: null, imageUrl: null,
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(settle => { resolve = settle; });
  return { promise, resolve };
};

const find = (node: unknown, type: unknown): { props: Record<string, unknown> } | null => {
  if (!node || typeof node !== 'object') return null;
  const element = node as { type?: unknown; props?: Record<string, unknown> };
  if (element.type === type) return element as { props: Record<string, unknown> };
  const children = element.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const match = find(child, type);
    if (match) return match;
  }
  return null;
};

const findByProp = (node: unknown, name: string): { props: Record<string, unknown> } | null => {
  if (!node || typeof node !== 'object') return null;
  const element = node as { props?: Record<string, unknown> };
  if (name in (element.props ?? {})) return element as { props: Record<string, unknown> };
  const children = element.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const match = findByProp(child, name);
    if (match) return match;
  }
  return null;
};

describe('StudyView final-card persistence', () => {
  beforeEach(() => {
    hooks.cursor = 0;
    hooks.refs = [];
    hooks.states = [];
    confetti.mockReset();
  });

  const render = (
    onRate: (rating: 'again' | 'hard' | 'good' | 'easy') => Promise<StudyRatingSettlement>,
    overrides: Partial<Parameters<typeof StudyView>[0]> = {},
  ) => {
    hooks.cursor = 0;
    const tree = StudyView({
      cards: [card], index: 0, recallMode: 'en-to-vi', revealed: true, reviewedCardId: null,
      customDecks: [], onClose: vi.fn(), onRecallMode: vi.fn(), onReveal: vi.fn(), onBookmark: vi.fn(),
      onAssignDeck: vi.fn(), onUpdateCard: vi.fn(), onRate, onIndex: vi.fn(),
      ...overrides,
    });
    return {
      surface: findByProp(tree, 'data-study-session')?.props,
      provisional: findByProp(tree, 'data-study-provisional')?.props,
      rate: find(tree, ReviewControls)?.props.onRate as (rating: 'again' | 'hard' | 'good' | 'easy') => Promise<void>,
      recap: find(tree, SessionRecapModal)?.props,
    };
  };

  it('does not count or recap while the final rating is pending, then recaps once after commit', async () => {
    const settlement = deferred<StudyRatingSettlement>();
    const onRate = vi.fn(() => settlement.promise);
    const first = render(onRate);
    const pending = first.rate('good');
    const duplicate = first.rate('good');

    expect(render(onRate).recap).toMatchObject({ open: false, goodCount: 0, againCount: 0, xpEarned: 0 });
    expect(confetti).not.toHaveBeenCalled();
    expect(onRate).toHaveBeenCalledOnce();

    settlement.resolve('committed');
    await Promise.all([pending, duplicate]);

    expect(render(onRate).recap).toMatchObject({ open: true, goodCount: 1, againCount: 0, xpEarned: 5 });
    expect(confetti).toHaveBeenCalledOnce();
  });

  it.each([
    ['durably queued', Promise.resolve('sync-pending' as const)],
    ['conflicted', Promise.resolve('retryable-error' as const)],
    ['failed permanently', Promise.resolve('retryable-error' as const)],
  ])('does not count, celebrate, or recap when the final review is %s', async (_scenario, settlement) => {
    const onRate = vi.fn(() => settlement);
    const view = render(onRate);

    await view.rate('good');

    expect(render(onRate).recap).toMatchObject({ open: false, goodCount: 0, againCount: 0, xpEarned: 0 });
    expect(confetti).not.toHaveBeenCalled();
  });

  it('owns shortcuts inside the study surface and preserves interactive, composing, and unsupported modifier keys', async () => {
    const onRate = vi.fn(async () => 'committed' as const);
    const onReveal = vi.fn();
    const onIndex = vi.fn();
    const onBookmark = vi.fn();
    const play = vi.fn();
    const view = render(onRate, { revealed: false, onReveal, onIndex, onBookmark });
    const surface = view.surface?.onKeyDown as (event: unknown) => void;
    const dispatch = (key: string, options: {
      altKey?: boolean;
      shiftKey?: boolean;
      composing?: boolean;
      interactive?: boolean;
      summary?: boolean;
    } = {}) => {
      const preventDefault = vi.fn();
      surface({
        key,
        altKey: options.altKey ?? false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: options.shiftKey ?? false,
        defaultPrevented: false,
        nativeEvent: { isComposing: options.composing ?? false },
        preventDefault,
        target: { closest: (selector: string) => (
          options.interactive || (options.summary && selector.includes('summary')) ? {} : null
        ) },
        currentTarget: { querySelector: () => ({ click: play }) },
      });
      return preventDefault;
    };

    expect(dispatch(' ')).toHaveBeenCalledOnce();
    expect(onReveal).toHaveBeenCalledOnce();
    expect(dispatch('ArrowRight')).toHaveBeenCalledOnce();
    expect(onIndex).toHaveBeenCalledWith(0);
    expect(dispatch('p', { altKey: true })).toHaveBeenCalledOnce();
    expect(play).toHaveBeenCalledOnce();
    dispatch('3', { altKey: true });
    await Promise.resolve();
    expect(onRate).toHaveBeenCalledWith('good');

    expect(dispatch(' ', { interactive: true })).not.toHaveBeenCalled();
    expect(dispatch(' ', { summary: true })).not.toHaveBeenCalled();
    expect(dispatch(' ', { composing: true })).not.toHaveBeenCalled();
    expect(dispatch('3', { altKey: true, shiftKey: true })).not.toHaveBeenCalled();
    expect(onBookmark).not.toHaveBeenCalled();
  });

  it('advances a queued non-final review provisionally without final counts, then keeps a queued final card out of recap', async () => {
    const nextCard = { ...card, id: 'next-card' };
    const onIndex = vi.fn();
    const queued = vi.fn(async () => 'sync-pending' as const);
    const intermediate = render(queued, { cards: [card, nextCard], index: 0, onIndex });

    await intermediate.rate('good');

    expect(onIndex).toHaveBeenCalledWith(1);
    expect(render(queued, { cards: [card, nextCard], index: 0, onIndex }).recap)
      .toMatchObject({ open: false, goodCount: 0, againCount: 0, xpEarned: 0 });

    hooks.cursor = 0;
    hooks.refs = [];
    hooks.states = [];
    const finalCard = render(queued);
    await finalCard.rate('good');
    const finalRender = render(queued);

    expect(finalRender.recap).toMatchObject({ open: false, goodCount: 0, againCount: 0, xpEarned: 0 });
    expect(finalRender.provisional).toBeDefined();
    expect(confetti).not.toHaveBeenCalled();
  });

  it('advances a committed non-final review only after recording final session effects', async () => {
    const nextCard = { ...card, id: 'next-card' };
    const onIndex = vi.fn();
    const committed = vi.fn(async () => 'committed' as const);
    const view = render(committed, { cards: [card, nextCard], index: 0, onIndex });

    await view.rate('good');

    expect(onIndex).toHaveBeenCalledWith(1);
    expect(render(committed, { cards: [card, nextCard], index: 0, onIndex }).recap)
      .toMatchObject({ open: false, goodCount: 1, againCount: 0, xpEarned: 5 });
  });
});
