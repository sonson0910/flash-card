import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RefObject } from 'react';
import type { CardData } from '../../types/card';

type EffectRecord = {
  cleanup?: () => void;
  dependencies?: readonly unknown[];
};

type PendingEffect = {
  callback: () => void | (() => void);
  dependencies?: readonly unknown[];
  index: number;
};

const hooks = vi.hoisted(() => ({
  effectCursor: 0,
  effects: [] as EffectRecord[],
  pendingEffects: [] as PendingEffect[],
  refCursor: 0,
  refs: [] as Array<{ current: unknown }>,
  stateCursor: 0,
  states: [] as unknown[],
}));

const owner = vi.hoisted(() => ({
  id: 'owner-a' as string | null,
  listener: undefined as ((nextOwnerId: string | null) => void) | undefined,
  stop: vi.fn(),
}));

const tutor = vi.hoisted(() => ({ askCardTutor: vi.fn() }));

const dependenciesChanged = (
  previous: readonly unknown[] | undefined,
  next: readonly unknown[] | undefined,
) => previous === undefined
  || next === undefined
  || previous.length !== next.length
  || previous.some((value, index) => !Object.is(value, next[index]));

vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useEffect: (callback: () => void | (() => void), dependencies?: readonly unknown[]) => {
      const index = hooks.effectCursor++;
      if (dependenciesChanged(hooks.effects[index]?.dependencies, dependencies)) {
        hooks.pendingEffects.push({ callback, dependencies, index });
      }
    },
    useRef: <T,>(initial: T) => {
      const index = hooks.refCursor++;
      if (!(index in hooks.refs)) hooks.refs[index] = { current: initial };
      return hooks.refs[index] as { current: T };
    },
    useState: <T,>(initial: T | (() => T)) => {
      const index = hooks.stateCursor++;
      if (!(index in hooks.states)) {
        hooks.states[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
      }
      return [hooks.states[index] as T, (next: T | ((previous: T) => T)) => {
        hooks.states[index] = typeof next === 'function'
          ? (next as (previous: T) => T)(hooks.states[index] as T)
          : next;
      }] as const;
    },
  };
});

vi.mock('@lingui/react', () => ({
  Trans: ({ message }: { message: string }) => message,
  useLingui: () => ({
    _: (descriptor: { message?: string } | string) => typeof descriptor === 'string' ? descriptor : descriptor.message ?? '',
    i18n: { _: (_id: string, values?: Record<string, unknown>) => `Ask anything about “${values?.word ?? ''}”…` },
  }),
}));

vi.mock('@radix-ui/react-dialog', () => ({
  Root: () => null,
  Portal: () => null,
  Overlay: () => null,
  Content: () => null,
  Title: () => null,
  Description: () => null,
  Close: () => null,
}));

vi.mock('../../features/session/ownerSessionPort', () => ({
  currentOwnerId: () => owner.id,
  observeOwner: (listener: (nextOwnerId: string | null) => void) => {
    owner.listener = listener;
    return owner.stop;
  },
}));

vi.mock('../../lib/gemini', () => ({ askCardTutor: tutor.askCardTutor }));

import { CardAiAssistantModal } from './CardAiAssistantModal';

type Tree = { type?: unknown; props?: Record<string, unknown> };

const walk = (node: unknown, visit: (element: Tree) => void): void => {
  if (Array.isArray(node)) {
    node.forEach(child => walk(child, visit));
    return;
  }
  if (!node || typeof node !== 'object') return;
  const element = node as Tree;
  visit(element);
  walk(element.props?.children, visit);
};

const treeText = (node: unknown): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(treeText).join('');
  if (!node || typeof node !== 'object') return '';
  return treeText((node as Tree).props?.children);
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
};

const card = (id: string, word = id): CardData => ({
  id,
  word,
  translation: 'meaning',
  explanation: '',
  phonetic: '',
  emoji: '',
  category: 'General',
  audioUrl: null,
  imageUrl: null,
  customDeck: null,
});

const flushEffects = () => {
  hooks.pendingEffects.splice(0).forEach(({ callback, dependencies, index }) => {
    hooks.effects[index]?.cleanup?.();
    const cleanup = callback();
    hooks.effects[index] = { dependencies, cleanup: typeof cleanup === 'function' ? cleanup : undefined };
  });
};

const resetHooks = () => {
  hooks.effectCursor = 0;
  hooks.effects = [];
  hooks.pendingEffects = [];
  hooks.refCursor = 0;
  hooks.refs = [];
  hooks.stateCursor = 0;
  hooks.states = [];
};

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const createHarness = () => {
  let props = { card: card('card-a', 'first'), open: true, onOpenChange: vi.fn() };
  const render = (overrides: Partial<typeof props> = {}) => {
    props = { ...props, ...overrides };
    hooks.effectCursor = 0;
    hooks.refCursor = 0;
    hooks.stateCursor = 0;
    return CardAiAssistantModal(props);
  };
  const startQuestion = () => {
    const view = render();
    let action: (() => void) | undefined;
    walk(view, element => {
      if (!action && element.type === 'button' && typeof element.props?.onClick === 'function') {
        action = element.props.onClick as () => void;
      }
    });
    expect(action).toBeTypeOf('function');
    action!();
  };
  const close = () => {
    const view = render();
    let onOpenChange: ((open: boolean) => void) | undefined;
    walk(view, element => {
      if (!onOpenChange && typeof element.props?.onOpenChange === 'function') {
        onOpenChange = element.props.onOpenChange as (open: boolean) => void;
      }
    });
    expect(onOpenChange).toBeTypeOf('function');
    onOpenChange!(false);
  };
  const unmount = () => hooks.effects.forEach(effect => effect.cleanup?.());
  return { close, render, startQuestion, unmount };
};

describe('CardAiAssistantModal request lifecycle', () => {
  beforeEach(() => {
    resetHooks();
    owner.id = 'owner-a';
    owner.listener = undefined;
    owner.stop.mockReset();
    tutor.askCardTutor.mockReset();
  });

  it('aborts a closed request and keeps its late answer out of the next modal session', async () => {
    const stale = deferred<string>();
    const fresh = deferred<string>();
    tutor.askCardTutor.mockImplementationOnce(() => stale.promise).mockImplementationOnce(() => fresh.promise);
    const modal = createHarness();
    modal.render();
    flushEffects();
    modal.startQuestion();
    const staleSignal = tutor.askCardTutor.mock.calls[0]![3] as AbortSignal;

    modal.close();
    expect(staleSignal.aborted).toBe(true);
    modal.render({ open: false });
    flushEffects();
    modal.render({ open: true });
    flushEffects();
    modal.startQuestion();

    stale.resolve('stale answer');
    await settle();
    expect(treeText(modal.render())).not.toContain('stale answer');

    fresh.resolve('fresh answer');
    await settle();
    expect(treeText(modal.render())).toContain('fresh answer');
  });

  it('aborts on a card change and only shows the replacement card request', async () => {
    const stale = deferred<string>();
    const fresh = deferred<string>();
    tutor.askCardTutor.mockImplementationOnce(() => stale.promise).mockImplementationOnce(() => fresh.promise);
    const modal = createHarness();
    modal.render();
    flushEffects();
    modal.startQuestion();
    const staleSignal = tutor.askCardTutor.mock.calls[0]![3] as AbortSignal;

    modal.render({ card: card('card-b', 'second') });
    flushEffects();
    expect(staleSignal.aborted).toBe(true);
    modal.startQuestion();
    stale.resolve('answer from first card');
    fresh.resolve('answer from second card');
    await settle();

    const text = treeText(modal.render());
    expect(text).not.toContain('answer from first card');
    expect(text).toContain('answer from second card');
  });

  it('aborts on an owner change and does not show a late failure to the new owner', async () => {
    const stale = deferred<string>();
    const fresh = deferred<string>();
    tutor.askCardTutor.mockImplementationOnce(() => stale.promise).mockImplementationOnce(() => fresh.promise);
    const modal = createHarness();
    modal.render();
    flushEffects();
    modal.startQuestion();
    const staleSignal = tutor.askCardTutor.mock.calls[0]![3] as AbortSignal;

    owner.id = 'owner-b';
    owner.listener?.('owner-b');
    expect(staleSignal.aborted).toBe(true);
    modal.startQuestion();
    stale.reject(new Error('late failure'));
    fresh.resolve('answer for owner b');
    await settle();

    const text = treeText(modal.render());
    expect(text).not.toContain('AI is currently busy');
    expect(text).toContain('answer for owner b');
  });

  it('aborts on unmount and cannot carry a late failure into a new modal instance', async () => {
    const stale = deferred<string>();
    tutor.askCardTutor.mockImplementationOnce(() => stale.promise);
    const first = createHarness();
    first.render();
    flushEffects();
    first.startQuestion();
    const staleSignal = tutor.askCardTutor.mock.calls[0]![3] as AbortSignal;

    first.unmount();
    expect(staleSignal.aborted).toBe(true);
    resetHooks();
    const next = createHarness();
    next.render();
    flushEffects();
    stale.reject(new Error('late unmounted failure'));
    await settle();

    expect(treeText(next.render())).not.toContain('AI is currently busy');
  });

  it('restores focus to its opener after Radix releases the dialog focus scope', () => {
    const focus = vi.fn();
    const view = CardAiAssistantModal({
      card: card('card-a'),
      open: true,
      onOpenChange: vi.fn(),
      restoreFocusRef: { current: { focus } } as RefObject<Pick<HTMLElement, 'focus'> | null>,
    });
    let closeAutoFocus: ((event: { preventDefault(): void }) => void) | undefined;
    walk(view, element => {
      if (!closeAutoFocus && typeof element.props?.onCloseAutoFocus === 'function') {
        closeAutoFocus = element.props.onCloseAutoFocus as (event: { preventDefault(): void }) => void;
      }
    });
    const event = { preventDefault: vi.fn() };

    expect(closeAutoFocus).toBeTypeOf('function');
    closeAutoFocus!(event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });
});
