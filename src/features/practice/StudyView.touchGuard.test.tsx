import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';

const hooks = vi.hoisted(() => ({
  cursor: 0,
  refs: [] as Array<{ current: unknown }>,
  states: [] as unknown[],
}));

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

import { shouldIgnoreStudyCardTouch, StudyView } from './StudyView';

const card: CardData = {
  id: 'touch-card', word: 'guard', translation: 'canh gác', explanation: '', phonetic: '', emoji: '',
  category: 'General', audioUrl: null, imageUrl: null,
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

describe('shouldIgnoreStudyCardTouch', () => {
  it('ignores a touch whose real DOM target is outside the card element', () => {
    const cardElement = { contains: () => false };
    expect(shouldIgnoreStudyCardTouch({}, cardElement)).toBe(true);
  });

  it('ignores a touch inside the card element that lands on a dialog surface reached only through React portal bubbling', () => {
    const cardElement = { contains: () => true };
    const dialogTarget = { closest: (selector: string) => selector.includes('role="dialog"') ? {} as Element : null };
    expect(shouldIgnoreStudyCardTouch(dialogTarget, cardElement)).toBe(true);
  });

  it('ignores a touch on an input, textarea, select, or contenteditable surface inside the card', () => {
    const cardElement = { contains: () => true };
    const interactiveTarget = { closest: () => ({} as Element) };
    expect(shouldIgnoreStudyCardTouch(interactiveTarget, cardElement)).toBe(true);
  });

  it('accepts a touch that starts on the card itself, outside any dialog or interactive control', () => {
    const cardElement = { contains: () => true };
    const plainTarget = { closest: () => null };
    expect(shouldIgnoreStudyCardTouch(plainTarget, cardElement)).toBe(false);
  });

  it('ignores a touch when the card element is unavailable', () => {
    expect(shouldIgnoreStudyCardTouch({}, null)).toBe(true);
    expect(shouldIgnoreStudyCardTouch({}, undefined)).toBe(true);
  });
});

describe('StudyView swipe handlers', () => {
  beforeEach(() => {
    hooks.cursor = 0;
    hooks.refs = [];
    hooks.states = [];
  });

  it('does not arm a swipe rating when the touch starts outside the real DOM card element', () => {
    const tree = StudyView({
      cards: [card], index: 0, recallMode: 'en-to-vi', revealed: true, reviewedCardId: null,
      customDecks: [], onClose: vi.fn(), onRecallMode: vi.fn(), onReveal: vi.fn(), onBookmark: vi.fn(),
      onAssignDeck: vi.fn(), onUpdateCard: vi.fn(), onRate: vi.fn(async () => 'committed' as const), onIndex: vi.fn(),
    });
    const studyCard = findByProp(tree, 'onTouchStart')?.props;
    const onTouchStart = studyCard?.onTouchStart as (event: unknown) => void;
    const onTouchMove = studyCard?.onTouchMove as (event: unknown) => void;

    // A touch that bubbled through a portaled dialog: React sees it as coming from the card's subtree,
    // but the real DOM target is not contained by the card element the handlers are bound to.
    onTouchStart({
      target: { closest: () => null },
      currentTarget: { contains: () => false },
      touches: [{ clientX: 100, clientY: 100 }],
    });
    onTouchMove({
      target: { closest: () => null },
      currentTarget: { contains: () => false },
      touches: [{ clientX: 260, clientY: 100 }],
    });

    // touchStartRef stays null, so the ref captured by the mocked useRef never receives coordinates.
    expect(hooks.refs.some(ref => ref.current && typeof ref.current === 'object' && 'x' in (ref.current as object)))
      .toBe(false);
  });
});
