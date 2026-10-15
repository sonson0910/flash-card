import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Lumi } from '../../components/lumi/Lumi';
import type { CardData } from '../../types/card';
import { writeFocusModeEnabled } from '../settings/focus-mode-preference';

const hooks = vi.hoisted(() => ({
  cursor: 0,
  refs: [] as Array<{ current: unknown }>,
  states: [] as unknown[],
}));
const confetti = vi.hoisted(() => vi.fn());
const haptic = vi.hoisted(() => vi.fn());
const flipSound = vi.hoisted(() => vi.fn());
const rewardSound = vi.hoisted(() => vi.fn());

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
vi.mock('../../lib/haptics', () => ({ triggerHaptic: haptic }));
vi.mock('../../lib/interactionSounds', () => ({ playFlipSound: flipSound, playRewardSound: rewardSound }));
vi.mock('@lingui/react', async importOriginal => ({
  ...await importOriginal<typeof import('@lingui/react')>(),
  useLingui: () => ({ _: (message: { message: string }) => message.message }),
}));

import { ReviewControls } from '../../components/study/ReviewControls';
import { Flashcard } from '../../components/Flashcard';
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
    haptic.mockReset();
    flipSound.mockReset();
    rewardSound.mockReset();
    writeFocusModeEnabled(false);
  });

  afterEach(() => vi.unstubAllGlobals());

  const render = (
    onRate: (rating: 'again' | 'hard' | 'good' | 'easy') => Promise<StudyRatingSettlement>,
    overrides: Partial<Parameters<typeof StudyView>[0]> = {},
  ) => {
    hooks.cursor = 0;
    const tree = StudyView({
      cards: [card], index: 0, recallMode: 'target-to-native', revealed: true, reviewedCardId: null,
      customDecks: [], onClose: vi.fn(), onRecallMode: vi.fn(), onReveal: vi.fn(), onBookmark: vi.fn(),
      onAssignDeck: vi.fn(), onUpdateCard: vi.fn(), onRate, onIndex: vi.fn(),
      ...overrides,
    });
    return {
      tree,
      surface: findByProp(tree, 'data-study-session')?.props,
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
    expect(haptic).not.toHaveBeenCalled();
    expect(onRate).toHaveBeenCalledOnce();

    settlement.resolve({ status: 'committed', xpAwarded: 0 });
    await Promise.all([pending, duplicate]);

    expect(render(onRate).recap).toMatchObject({ open: true, goodCount: 1, againCount: 0, xpEarned: 0 });
    expect(confetti).toHaveBeenCalledOnce();
    expect(haptic).toHaveBeenCalledExactlyOnceWith('success');
  });

  it('dismisses the locally opened recap after the final committed rating', async () => {
    const committed = vi.fn(async () => ({ status: 'committed', xpAwarded: 2 } as const));
    const onDismissRecap = vi.fn();
    await render(committed, { onDismissRecap }).rate('good');
    const completed = render(committed, { onDismissRecap });
    expect(completed.recap?.open).toBe(true);
    (completed.recap?.onClose as () => void)();
    expect(render(committed, { onDismissRecap }).recap?.open).toBe(false);
    expect(onDismissRecap).toHaveBeenCalledOnce();
  });

  it('passes the owner-scoped delete result into the Study editor', () => {
    const onDeleteCard = vi.fn(async () => true);
    const view = render(vi.fn(async (): Promise<StudyRatingSettlement> => ({ status: 'committed', xpAwarded: 0 })), { onDeleteCard });

    expect(find(view.tree, Flashcard)?.props.onEditDelete).toBeTypeOf('function');
  });

  it('returns focus to the Study surface only after a successful editor deletion', async () => {
    const focus = vi.fn();
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame);
    const onDeleteCard = vi.fn(async () => true);
    const view = render(vi.fn(async (): Promise<StudyRatingSettlement> => ({ status: 'committed', xpAwarded: 0 })), { onDeleteCard });
    const surface = findByProp(view.tree, 'data-study-session')!.props.ref as { current: { focus: typeof focus } | null };
    surface.current = { focus };
    const onEditDelete = find(view.tree, Flashcard)!.props.onEditDelete as (cardId: string) => Promise<boolean>;

    await expect(onEditDelete(card.id)).resolves.toBe(true);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(requestAnimationFrame).toHaveBeenCalledOnce();

    onDeleteCard.mockResolvedValueOnce(false);
    await expect(onEditDelete(card.id)).resolves.toBe(false);
    expect(requestAnimationFrame).toHaveBeenCalledOnce();
  });

  it.each([
    ['conflicted', Promise.resolve('retryable-error' as const)],
    ['failed permanently', Promise.resolve('retryable-error' as const)],
  ])('does not count, celebrate, or recap when the final review is %s', async (_scenario, settlement) => {
    const onRate = vi.fn(() => settlement);
    const view = render(onRate);

    await view.rate('good');

    expect(render(onRate).recap).toMatchObject({ open: false, goodCount: 0, againCount: 0, xpEarned: 0 });
    expect(confetti).not.toHaveBeenCalled();
    expect(haptic).not.toHaveBeenCalled();
  });

  it('uses the persisted rating for recap polarity when a retry changes the requested rating', async () => {
    const onRate = vi.fn(async () => ({ status: 'committed', xpAwarded: 2, rating: 'again' } as const));
    const view = render(onRate);

    await view.rate('good');

    expect(render(onRate).recap).toMatchObject({ goodCount: 0, againCount: 1, xpEarned: 2 });
  });

  it('owns shortcuts inside the study surface and preserves interactive, composing, and unsupported modifier keys', async () => {
    const onRate = vi.fn(async () => ({ status: 'committed', xpAwarded: 2 } as const));
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
        target: { closest: () => options.interactive ? {} : null },
        currentTarget: { querySelector: () => ({ click: play }) },
      });
      return preventDefault;
    };

    expect(dispatch(' ')).toHaveBeenCalledOnce();
    expect(onReveal).toHaveBeenCalledOnce();
    expect(flipSound).toHaveBeenCalledOnce();
    expect(dispatch('ArrowRight')).toHaveBeenCalledOnce();
    expect(onIndex).toHaveBeenCalledWith(0);
    expect(dispatch('p', { altKey: true })).toHaveBeenCalledOnce();
    expect(play).toHaveBeenCalledOnce();
    dispatch('3', { altKey: true });
    await Promise.resolve();
    expect(onRate).toHaveBeenCalledWith('good');

    expect(dispatch(' ', { interactive: true })).not.toHaveBeenCalled();
    expect(dispatch(' ', { composing: true })).not.toHaveBeenCalled();
    expect(dispatch('3', { altKey: true, shiftKey: true })).not.toHaveBeenCalled();
    expect(onBookmark).not.toHaveBeenCalled();
  });

  it('lets the revealed Flashcard own the keyboard flip sound', () => {
    const clicked = vi.fn(() => flipSound());
    const view = render(vi.fn(async () => ({ status: 'committed', xpAwarded: 2 } as const)));
    const surface = view.surface?.onKeyDown as (event: unknown) => void;
    surface({
      key: 'Enter', altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
      defaultPrevented: false, nativeEvent: { isComposing: false },
      preventDefault: vi.fn(), target: { closest: () => null },
      currentTarget: { querySelector: () => ({ click: clicked }) },
    });

    expect(clicked).toHaveBeenCalledOnce();
    expect(flipSound).toHaveBeenCalledOnce();
  });

  it('advances a committed non-final review only after recording final session effects', async () => {
    const nextCard = { ...card, id: 'next-card' };
    const onIndex = vi.fn();
    const committed = vi.fn(async () => ({ status: 'committed', xpAwarded: 2 } as const));
    const view = render(committed, { cards: [card, nextCard], index: 0, onIndex });

    await view.rate('good');

    expect(onIndex).toHaveBeenCalledWith(1);
    expect(render(committed, { cards: [card, nextCard], index: 0, onIndex }).recap)
      .toMatchObject({ open: false, goodCount: 1, againCount: 0, xpEarned: 2 });
  });

  it('counts only committed answers when the learner skips cards before the recap', async () => {
    const skippedCard = { ...card, id: 'skipped-card' };
    const committed = vi.fn(async () => ({ status: 'committed', xpAwarded: 2 } as const));
    const view = render(committed, { cards: [skippedCard, card], index: 1 });

    await view.rate('again');

    expect(render(committed, { cards: [skippedCard, card], index: 1 }).recap)
      .toMatchObject({ open: true, totalCards: 2, goodCount: 0, againCount: 1, xpEarned: 2 });
  });

  it('does not celebrate completion when an earlier card was skipped', async () => {
    const committed = vi.fn(async () => ({ status: 'committed', xpAwarded: 2 } as const));
    await render(committed, { cards: [{ ...card, id: 'skipped' }, card], index: 1 }).rate('good');
    expect(confetti).not.toHaveBeenCalled();
  });

  it('counts Again toward the combo and hides the banner in focus mode', async () => {
    const nextCard = { ...card, id: 'next-card' };
    const cards = [card, nextCard];
    const committed = vi.fn(async () => ({ status: 'committed', xpAwarded: 2 } as const));

    await render(committed, { cards, index: 0 }).rate('good');
    expect(findByProp(render(committed, { cards, index: 1 }).tree, 'data-study-combo')).toBeNull();
    await render(committed, { cards, index: 1 }).rate('again');

    const withCombo = render(committed, { cards, index: 1 });
    expect(findByProp(withCombo.tree, 'data-study-combo')?.props['data-study-combo']).toBe(2);
    (findByProp(withCombo.tree, 'data-study-focus-mode')?.props.onClick as () => void)();

    const focused = render(committed, { cards, index: 1 });
    expect(findByProp(focused.tree, 'data-study-combo')).toBeNull();
    expect(findByProp(focused.tree, 'data-study-focus-mode')?.props['aria-pressed']).toBe(true);
    expect(focused.recap).toMatchObject({ totalCards: 2, xpEarned: 4 });
  });

  it('plays one combo cue on the third committed answer, including Again, and silences it in focus mode', async () => {
    const cards = [card, { ...card, id: 'second' }, { ...card, id: 'third' }];
    const committed = vi.fn(async () => ({ status: 'committed', xpAwarded: 2 } as const));
    await render(committed, { cards, index: 0 }).rate('good');
    await render(committed, { cards, index: 1 }).rate('again');
    expect(rewardSound).not.toHaveBeenCalled();
    await render(committed, { cards, index: 2 }).rate('again');
    expect(rewardSound).toHaveBeenCalledOnce();
    expect(haptic).toHaveBeenLastCalledWith('heavy');

    hooks.refs = [];
    hooks.states = [];
    rewardSound.mockReset();
    haptic.mockReset();
    writeFocusModeEnabled(true);
    await render(committed, { cards, index: 0 }).rate('good');
    await render(committed, { cards, index: 1 }).rate('again');
    await render(committed, { cards, index: 2 }).rate('again');
    expect(rewardSound).not.toHaveBeenCalled();
    expect(haptic).not.toHaveBeenCalledWith('heavy');
  });

  it('suppresses a pending combo cue when focus mode is enabled before the review commits', async () => {
    const cards = [card, { ...card, id: 'second' }, { ...card, id: 'third' }];
    const committed = vi.fn(async () => ({ status: 'committed', xpAwarded: 2 } as const));
    await render(committed, { cards, index: 0 }).rate('good');
    await render(committed, { cards, index: 1 }).rate('again');

    const settlement = deferred<StudyRatingSettlement>();
    const third = render(() => settlement.promise, { cards, index: 2 });
    const pending = third.rate('again');
    (findByProp(third.tree, 'data-study-focus-mode')?.props.onClick as () => void)();
    settlement.resolve({ status: 'committed', xpAwarded: 2 });
    await pending;

    expect(rewardSound).not.toHaveBeenCalled();
    expect(haptic).toHaveBeenLastCalledWith('medium');
  });

  it('shows the Crystal Lumi reaction only after a committed review', async () => {
    vi.stubGlobal('document', { documentElement: { dataset: { themeFamily: 'crystal' } } });
    const committed = vi.fn(async () => ({ status: 'committed', xpAwarded: 2 } as const));
    const view = render(committed);

    await view.rate('good');

    expect(find(render(committed).tree, Lumi)?.props.pose).toBe('happy');
  });
});
