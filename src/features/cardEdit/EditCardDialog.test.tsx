import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import type { LearningStateOutcome } from '../learning/learningStateController';

const hooks = vi.hoisted(() => ({
  cursor: 0,
  states: [] as unknown[],
  locale: 'en',
}));

vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
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

vi.mock('@lingui/react', () => ({
  Trans: ({ message }: { message: string }) => message,
  useLingui: () => ({
    _: (descriptor: { id?: string; message?: string } | string) => {
      if (typeof descriptor === 'string') return descriptor;
      if (hooks.locale === 'vi' && descriptor.id === 'library.edit-card.save-failed') return 'Không thể lưu thay đổi. Hãy thử lại.';
      return descriptor.message ?? '';
    },
  }),
}));

import { EDIT_CARD_FIELDS } from './editCardModel';
import { EditCardDialog } from './EditCardDialog';

type Tree = { type?: unknown; props?: Record<string, unknown> };

// `EDIT_CARD_FIELDS.map(...)` nests a bare array directly inside `<form>`'s children, so this walk must flatten
// arrays at any depth rather than treating each `children` entry as a single element.
const walk = (node: unknown, visit: (element: Tree) => void): void => {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  if (!node || typeof node !== 'object') return;
  const element = node as Tree;
  visit(element);
  walk(element.props?.children, visit);
};

const findByProp = (node: unknown, name: string): { props: Record<string, unknown> } | null => {
  let match: { props: Record<string, unknown> } | null = null;
  walk(node, element => {
    if (!match && element.props && name in element.props) match = element as { props: Record<string, unknown> };
  });
  return match;
};

const findAllByType = (node: unknown, type: string): Tree[] => {
  const out: Tree[] = [];
  walk(node, element => { if (element.type === type) out.push(element); });
  return out;
};

const card: CardData = {
  id: 'card-1', word: 'lead', translation: 'chì', explanation: 'A metal.', phonetic: '', emoji: '',
  category: 'General', audioUrl: null, imageUrl: null, exampleSentence: 'Old example.',
};

const translationFieldIndex = EDIT_CARD_FIELDS.findIndex(field => field.key === 'translation');

const render = (props: Parameters<typeof EditCardDialog>[0]) => {
  hooks.cursor = 0;
  const tree = EditCardDialog(props);
  const formProps = findByProp(tree, 'onSubmit')?.props ?? {};
  const errorProps = findByProp(tree, 'role')?.props;
  return {
    submit: formProps.onSubmit as (event: { preventDefault(): void }) => Promise<void>,
    textareas: findAllByType(tree, 'textarea'),
    errorText: errorProps?.children as string | undefined,
  };
};

describe('EditCardDialog', () => {
  beforeEach(() => {
    hooks.cursor = 0;
    hooks.states = [];
    hooks.locale = 'en';
  });

  it('keeps the dialog open and reports the localized failure message when the save does not durably succeed', async () => {
    const onOpenChange = vi.fn();
    const onSave = vi.fn(async (): Promise<LearningStateOutcome> => ({ status: 'missing-card' }));
    let view = render({ card, open: true, onOpenChange, onSave });
    (view.textareas[translationFieldIndex]!.props!.onChange as (event: { target: { value: string } }) => void)(
      { target: { value: 'dẫn đầu' } },
    );
    view = render({ card, open: true, onOpenChange, onSave });

    await view.submit({ preventDefault: vi.fn() });

    expect(onSave).toHaveBeenCalledWith('card-1', { translation: 'dẫn đầu' });
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    const closed = render({ card, open: true, onOpenChange, onSave });
    expect(closed.errorText).toMatch(/could not be saved/);
  });

  it('closes the dialog once the save publishes', async () => {
    const onOpenChange = vi.fn();
    const onSave = vi.fn(async (): Promise<LearningStateOutcome> =>
      ({ status: 'published', result: { ownerKey: 'o', operationId: 'op', publication: { kind: 'patch', cardId: card.id, fields: {} } } }));
    let view = render({ card, open: true, onOpenChange, onSave });
    (view.textareas[translationFieldIndex]!.props!.onChange as (event: { target: { value: string } }) => void)(
      { target: { value: 'dẫn đầu' } },
    );
    view = render({ card, open: true, onOpenChange, onSave });

    await view.submit({ preventDefault: vi.fn() });

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('diffs the save against the snapshot captured when the dialog opened, ignoring an untouched field synced in afterward', async () => {
    const onOpenChange = vi.fn();
    const onSave = vi.fn(async (): Promise<LearningStateOutcome> =>
      ({ status: 'published', result: { ownerKey: 'o', operationId: 'op', publication: { kind: 'patch', cardId: card.id, fields: {} } } }));

    // First render: the dialog opens and captures its snapshot from `card`.
    let view = render({ card, open: true, onOpenChange, onSave });
    (view.textareas[translationFieldIndex]!.props!.onChange as (event: { target: { value: string } }) => void)(
      { target: { value: 'dẫn đầu' } },
    );

    // A remote sync changes a field the learner never touched, and the parent re-renders with the newer card.
    const syncedCard = { ...card, exampleSentence: 'Synced example.' };
    view = render({ card: syncedCard, open: true, onOpenChange, onSave });

    await view.submit({ preventDefault: vi.fn() });

    // The patch only reflects the field the learner actually edited; the synced exampleSentence is left alone.
    expect(onSave).toHaveBeenCalledWith('card-1', { translation: 'dẫn đầu' });
  });

  it('marks target and translation values with their card languages', () => {
    const koreanCard = { ...card, language: 'ko', translationLanguage: 'en' };
    const view = render({ card: koreanCard, open: true, onOpenChange: vi.fn(), onSave: vi.fn() });

    expect(view.textareas[translationFieldIndex]!.props!.lang).toBe('en');
    expect(view.textareas[EDIT_CARD_FIELDS.findIndex(field => field.key === 'explanation')]!.props!.lang).toBe('ko');
  });

  it('renders an existing save error in the newly selected locale', async () => {
    const onOpenChange = vi.fn();
    const onSave = vi.fn(async (): Promise<LearningStateOutcome> => ({ status: 'missing-card' }));
    let view = render({ card, open: true, onOpenChange, onSave });
    (view.textareas[translationFieldIndex]!.props!.onChange as (event: { target: { value: string } }) => void)(
      { target: { value: 'dẫn đầu' } },
    );
    view = render({ card, open: true, onOpenChange, onSave });
    await view.submit({ preventDefault: vi.fn() });

    hooks.locale = 'vi';
    const localized = render({ card, open: true, onOpenChange, onSave });
    expect(localized.errorText).toBe('Không thể lưu thay đổi. Hãy thử lại.');
  });
});
