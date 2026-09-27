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
    useRef: <T,>(initial: T) => {
      const index = hooks.cursor++;
      if (!(index in hooks.states)) hooks.states[index] = { current: initial };
      return hooks.states[index] as { current: T };
    },
    useEffect: (effect: () => void) => { effect(); },
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

const { MockCardHeadwordRenameError, cardRepositoryMocks } = vi.hoisted(() => {
  class HoistedMockCardHeadwordRenameError extends Error {
    constructor(public readonly reason: string) {
      super(`Card headword rename rejected: ${reason}.`);
      this.name = 'CardHeadwordRenameError';
    }
  }
  return {
    MockCardHeadwordRenameError: HoistedMockCardHeadwordRenameError,
    cardRepositoryMocks: {
      renameCardHeadword: vi.fn(),
      applyCategoryDeltas: vi.fn().mockResolvedValue({ categories: {}, complete: true }),
    },
  };
});

vi.mock('../../lib/cardRepository', () => ({
  renameCardHeadword: cardRepositoryMocks.renameCardHeadword,
  applyCategoryDeltas: cardRepositoryMocks.applyCategoryDeltas,
  deriveLibraryFacetOperationId: (operationId: string, suffix: string) => `${operationId}:${suffix}`,
  CardHeadwordRenameError: MockCardHeadwordRenameError,
}));

const firebaseMocks = vi.hoisted(() => ({
  auth: { currentUser: { uid: 'user-1' } as { uid: string } | null },
}));

vi.mock('../../lib/firebase', () => ({
  auth: firebaseMocks.auth,
  db: {},
  isFirebaseConfigured: true,
}));

const imagesMocks = vi.hoisted(() => ({ fetchImageUrl: vi.fn() }));

vi.mock('../../lib/images', () => ({
  fetchImageUrl: imagesMocks.fetchImageUrl,
  getDisplayImageUrl: (url: string) => url,
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

const findAllByText = (node: unknown, text: string): Tree[] => {
  const out: Tree[] = [];
  walk(node, element => {
    const children = JSON.stringify(element.props?.children) ?? '';
    if (element.type === 'button' && children.includes(text)) out.push(element);
  });
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
    tree,
    submit: formProps.onSubmit as (event: { preventDefault(): void }) => Promise<void>,
    textareas: findAllByType(tree, 'textarea'),
    buttons: findAllByType(tree, 'button'),
    errorText: errorProps?.children as string | undefined,
  };
};

describe('EditCardDialog', () => {
  beforeEach(() => {
    hooks.cursor = 0;
    hooks.states = [];
    hooks.locale = 'en';
    firebaseMocks.auth.currentUser = { uid: 'user-1' };
    cardRepositoryMocks.renameCardHeadword.mockReset();
    cardRepositoryMocks.applyCategoryDeltas.mockReset().mockResolvedValue({ categories: {}, complete: true });
    imagesMocks.fetchImageUrl.mockReset();
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

  it('asks before closing a dirty sheet and discards only after the explicit confirmation', () => {
    const onOpenChange = vi.fn();
    let view = render({ card, open: true, onOpenChange, onSave: vi.fn() });
    (view.textareas[translationFieldIndex]!.props!.onChange as (event: { target: { value: string } }) => void)(
      { target: { value: 'dẫn đầu' } },
    );
    view = render({ card, open: true, onOpenChange, onSave: vi.fn() });

    const closeButton = view.buttons.find(button => button.props?.['aria-label'] === 'Close editor');
    expect(closeButton).toBeDefined();
    (closeButton!.props!.onClick as () => void)();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    view = render({ card, open: true, onOpenChange, onSave: vi.fn() });
    const discardButton = findAllByText(view.tree, 'Discard changes')[0];
    expect(discardButton).toBeDefined();
    (discardButton!.props!.onClick as () => void)();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('keeps save pending, exposes retry after a failure, and closes after the retry succeeds', async () => {
    const onOpenChange = vi.fn();
    let resolveFirst: (outcome: LearningStateOutcome) => void = () => {};
    const firstSave = new Promise<LearningStateOutcome>(resolve => { resolveFirst = resolve; });
    const onSave = vi.fn()
      .mockReturnValueOnce(firstSave)
      .mockResolvedValueOnce({ status: 'published', result: { ownerKey: 'o', operationId: 'op', publication: { kind: 'patch', cardId: card.id, fields: {} } } });
    let view = render({ card, open: true, onOpenChange, onSave });
    (view.textareas[translationFieldIndex]!.props!.onChange as (event: { target: { value: string } }) => void)(
      { target: { value: 'dẫn đầu' } },
    );
    view = render({ card, open: true, onOpenChange, onSave });

    const pendingSubmit = view.submit({ preventDefault: vi.fn() });
    view = render({ card, open: true, onOpenChange, onSave });
    const pendingSave = view.buttons.find(button => button.props?.type === 'submit');
    expect(pendingSave?.props?.disabled).toBe(true);

    resolveFirst({ status: 'missing-card' });
    await pendingSubmit;
    view = render({ card, open: true, onOpenChange, onSave });
    expect(findAllByText(view.tree, 'Retry save')).toHaveLength(1);

    await view.submit({ preventDefault: vi.fn() });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it('prevents Radix autofocus from landing on the close button so the meaning field receives focus', () => {
    const view = render({ card, open: true, onOpenChange: vi.fn(), onSave: vi.fn() });
    const autoFocus = findByProp(view.tree, 'onOpenAutoFocus')?.props?.onOpenAutoFocus as ((event: { preventDefault(): void }) => void);
    const event = { preventDefault: vi.fn() };
    autoFocus(event);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('uses the paused-review framing only when the study caller supplies its context', () => {
    const view = render({ card, open: true, onOpenChange: vi.fn(), onSave: vi.fn(), context: { kind: 'review', current: 8, total: 20 } });

    const rendered = JSON.stringify(view.tree);
    expect(rendered).toContain('library.edit-card.review-kicker');
    expect(rendered).toContain('library.edit-card.review-description');
    expect(rendered).toContain('library.edit-card.save-resume');
  });

  it('omits the captured-source note for a card with no source metadata', () => {
    const view = render({ card, open: true, onOpenChange: vi.fn(), onSave: vi.fn() });
    expect(findByProp(view.tree, 'data-edit-source-note')).toBeNull();
  });

  it('renders a captured page title and URL as a safe, plain-text-titled http(s) link', () => {
    const sourcedCard = { ...card, source: { url: 'https://example.com/article', title: 'An Example Article' } };
    const view = render({ card: sourcedCard, open: true, onOpenChange: vi.fn(), onSave: vi.fn() });
    expect(findByProp(view.tree, 'data-edit-source-note')).not.toBeNull();
    const link = findAllByType(view.tree, 'a')[0];
    expect(link?.props?.href).toBe('https://example.com/article');
    expect(link?.props?.target).toBe('_blank');
    expect(link?.props?.rel).toBe('noopener noreferrer');
    expect(link?.props?.children).toBe('An Example Article');
  });

  it('never renders a link for a non-http(s) source url, showing the title as plain text instead', () => {
    const sourcedCard = { ...card, source: { url: 'javascript:alert(1)', title: 'Forged title' } };
    const view = render({ card: sourcedCard, open: true, onOpenChange: vi.fn(), onSave: vi.fn() });
    expect(findAllByType(view.tree, 'a')).toHaveLength(0);
    const sourceNote = findByProp(view.tree, 'data-edit-source-note');
    expect(sourceNote).not.toBeNull();
    expect(JSON.stringify(sourceNote)).toContain('Forged title');
  });

  it('falls back to the raw url as link text when no title was captured', () => {
    const sourcedCard = { ...card, source: { url: 'https://example.com/article' } };
    const view = render({ card: sourcedCard, open: true, onOpenChange: vi.fn(), onSave: vi.fn() });
    const link = findAllByType(view.tree, 'a')[0];
    expect(link?.props?.children).toBe('https://example.com/article');
  });

  describe('headword rename', () => {
    it('renames the headword through the callable and adopts the servers canonical response', async () => {
      const renamed = { ...card, word: 'guide', normalizedWord: 'guide', revision: 2 };
      cardRepositoryMocks.renameCardHeadword.mockResolvedValueOnce(renamed);
      let view = render({ card, open: true, onOpenChange: vi.fn(), onSave: vi.fn() });
      (findByProp(view.tree, 'data-edit-word-input')!.props.onChange as (event: { target: { value: string } }) => void)(
        { target: { value: 'guide' } },
      );
      view = render({ card, open: true, onOpenChange: vi.fn(), onSave: vi.fn() });

      await (findByProp(view.tree, 'data-edit-word-save')!.props.onClick as () => Promise<void>)();

      expect(cardRepositoryMocks.renameCardHeadword).toHaveBeenCalledWith('user-1', 'card-1', 'guide', 0, 0);
      view = render({ card, open: true, onOpenChange: vi.fn(), onSave: vi.fn() });
      expect(findByProp(view.tree, 'data-edit-word-input')!.props.value).toBe('guide');
      expect(findByProp(view.tree, 'role')).toBeNull();
    });

    it('surfaces a duplicate-word message when another card already uses the requested word', async () => {
      cardRepositoryMocks.renameCardHeadword.mockRejectedValueOnce(new MockCardHeadwordRenameError('duplicate-word'));
      let view = render({ card, open: true, onOpenChange: vi.fn(), onSave: vi.fn() });
      (findByProp(view.tree, 'data-edit-word-input')!.props.onChange as (event: { target: { value: string } }) => void)(
        { target: { value: 'guide' } },
      );
      view = render({ card, open: true, onOpenChange: vi.fn(), onSave: vi.fn() });

      await (findByProp(view.tree, 'data-edit-word-save')!.props.onClick as () => Promise<void>)();

      view = render({ card, open: true, onOpenChange: vi.fn(), onSave: vi.fn() });
      const alert = findByProp(view.tree, 'role');
      expect(alert?.props.children).toMatch(/already uses this word/);
    });

    it('surfaces a conflict message for any other rename precondition failure', async () => {
      cardRepositoryMocks.renameCardHeadword.mockRejectedValueOnce(new MockCardHeadwordRenameError('revision-conflict'));
      let view = render({ card, open: true, onOpenChange: vi.fn(), onSave: vi.fn() });
      (findByProp(view.tree, 'data-edit-word-input')!.props.onChange as (event: { target: { value: string } }) => void)(
        { target: { value: 'guide' } },
      );
      view = render({ card, open: true, onOpenChange: vi.fn(), onSave: vi.fn() });

      await (findByProp(view.tree, 'data-edit-word-save')!.props.onClick as () => Promise<void>)();

      view = render({ card, open: true, onOpenChange: vi.fn(), onSave: vi.fn() });
      const alert = findByProp(view.tree, 'role');
      expect(alert?.props.children).toMatch(/changed elsewhere/);
    });

    it('surfaces a generic failure message when the callable throws an unrecognized error', async () => {
      cardRepositoryMocks.renameCardHeadword.mockRejectedValueOnce(new Error('network down'));
      let view = render({ card, open: true, onOpenChange: vi.fn(), onSave: vi.fn() });
      (findByProp(view.tree, 'data-edit-word-input')!.props.onChange as (event: { target: { value: string } }) => void)(
        { target: { value: 'guide' } },
      );
      view = render({ card, open: true, onOpenChange: vi.fn(), onSave: vi.fn() });

      await (findByProp(view.tree, 'data-edit-word-save')!.props.onClick as () => Promise<void>)();

      view = render({ card, open: true, onOpenChange: vi.fn(), onSave: vi.fn() });
      const alert = findByProp(view.tree, 'role');
      expect(alert?.props.children).toMatch(/could not be saved/);
    });

    it('never calls the callable when the draft word matches the live word', async () => {
      let view = render({ card, open: true, onOpenChange: vi.fn(), onSave: vi.fn() });
      await (findByProp(view.tree, 'data-edit-word-save')!.props.onClick as () => Promise<void>)();
      expect(cardRepositoryMocks.renameCardHeadword).not.toHaveBeenCalled();
      view = render({ card, open: true, onOpenChange: vi.fn(), onSave: vi.fn() });
      expect(findByProp(view.tree, 'data-edit-word-save')!.props.disabled).toBe(true);
    });
  });

  describe('category facets mirror', () => {
    it('fires a facets delta call after a save that changes the category', async () => {
      const onSave = vi.fn(async (): Promise<LearningStateOutcome> =>
        ({ status: 'published', result: { ownerKey: 'o', operationId: 'op', publication: { kind: 'patch', cardId: card.id, fields: {} } } }));
      let view = render({ card: { ...card, category: 'Nature' }, open: true, onOpenChange: vi.fn(), onSave });
      (findByProp(view.tree, 'data-edit-category-input')!.props.onChange as (event: { target: { value: string } }) => void)(
        { target: { value: 'Business' } },
      );
      view = render({ card: { ...card, category: 'Nature' }, open: true, onOpenChange: vi.fn(), onSave });

      await view.submit({ preventDefault: vi.fn() });

      expect(onSave).toHaveBeenCalledWith('card-1', { category: 'Business' });
      expect(cardRepositoryMocks.applyCategoryDeltas).toHaveBeenCalledWith(
        {},
        'user-1',
        { Nature: -1, Business: 1 },
        'card-edit:card-1:0:category-edit',
      );
    });

    it('never fires a facets delta call when the category is untouched', async () => {
      const onSave = vi.fn(async (): Promise<LearningStateOutcome> =>
        ({ status: 'published', result: { ownerKey: 'o', operationId: 'op', publication: { kind: 'patch', cardId: card.id, fields: {} } } }));
      let view = render({ card, open: true, onOpenChange: vi.fn(), onSave });
      (view.textareas[translationFieldIndex]!.props!.onChange as (event: { target: { value: string } }) => void)(
        { target: { value: 'dẫn đầu' } },
      );
      view = render({ card, open: true, onOpenChange: vi.fn(), onSave });

      await view.submit({ preventDefault: vi.fn() });

      expect(cardRepositoryMocks.applyCategoryDeltas).not.toHaveBeenCalled();
    });
  });

  describe('image search and removal', () => {
    it('replaces the image after a successful search', async () => {
      imagesMocks.fetchImageUrl.mockResolvedValueOnce('https://images.pexels.com/found.jpg');
      let view = render({ card, open: true, onOpenChange: vi.fn(), onSave: vi.fn() });

      await (findByProp(view.tree, 'data-edit-image-find')!.props.onClick as () => Promise<void>)();

      view = render({ card, open: true, onOpenChange: vi.fn(), onSave: vi.fn() });
      expect(findAllByType(view.tree, 'img').some(image => image.props?.src === 'https://images.pexels.com/found.jpg')).toBe(true);
      expect(findByProp(view.tree, 'data-edit-image-remove')).not.toBeNull();
    });

    it('surfaces a search-failed message when no photo is found', async () => {
      imagesMocks.fetchImageUrl.mockResolvedValueOnce(null);
      let view = render({ card, open: true, onOpenChange: vi.fn(), onSave: vi.fn() });

      await (findByProp(view.tree, 'data-edit-image-find')!.props.onClick as () => Promise<void>)();

      view = render({ card, open: true, onOpenChange: vi.fn(), onSave: vi.fn() });
      const alert = findByProp(view.tree, 'role');
      expect(alert?.props.children).toMatch(/No new photo/);
    });

    it('removes the image through the remove control', () => {
      const withImage = { ...card, imageUrl: 'https://images.pexels.com/old.jpg' };
      let view = render({ card: withImage, open: true, onOpenChange: vi.fn(), onSave: vi.fn() });
      expect(findByProp(view.tree, 'data-edit-image-remove')).not.toBeNull();

      (findByProp(view.tree, 'data-edit-image-remove')!.props.onClick as () => void)();

      view = render({ card: withImage, open: true, onOpenChange: vi.fn(), onSave: vi.fn() });
      expect(findByProp(view.tree, 'data-edit-image-remove')).toBeNull();
    });
  });
});
