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

vi.mock('../files/imageResize', async original => ({
  ...(await original<typeof import('../files/imageResize')>()),
  resizeImageForUpload: async (blob: Blob) => ({ blob: new Blob([await blob.arrayBuffer()], { type: 'image/webp' }), contentType: 'image/webp', width: 10, height: 10 }),
}));

import { normalizeCardData } from '../../lib/cardNormalization';
import { isSupportedImageUrl, ownStorageImageOwner } from '../../lib/mediaUrlPolicy';
import { createCardImageUploader } from '../files/fileLibrary';
import { createMemoryFilePort } from '../files/memoryFileAdapter';
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
    expect(JSON.stringify(view.tree)).toContain('Your remaining draft will be removed.');
    (discardButton!.props!.onClick as () => void)();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('keeps a dirty draft safe until the delete confirmation succeeds', async () => {
    const onOpenChange = vi.fn();
    const remove = vi.fn(async () => true);
    let view = render({ card, open: true, onOpenChange, onSave: vi.fn(), onDelete: remove });
    (view.textareas[translationFieldIndex]!.props!.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'dẫn đầu' } });
    view = render({ card, open: true, onOpenChange, onSave: vi.fn(), onDelete: remove });

    (findByProp(view.tree, 'data-edit-delete')!.props.onClick as () => void)();
    view = render({ card, open: true, onOpenChange, onSave: vi.fn(), onDelete: remove });
    expect(JSON.stringify(view.tree)).toContain('Your remaining draft will be removed.');
    expect(remove).not.toHaveBeenCalled();

    await (findByProp(view.tree, 'data-edit-delete-confirm')!.props.onClick as () => Promise<void>)();
    expect(remove).toHaveBeenCalledWith('card-1');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('keeps the editor and confirmation open while deletion is pending, then shows a retry on failure', async () => {
    const onOpenChange = vi.fn();
    let resolveDelete: (deleted: boolean) => void = () => {};
    const remove = vi.fn(() => new Promise<boolean>(resolve => { resolveDelete = resolve; }));
    let view = render({ card, open: true, onOpenChange, onSave: vi.fn(), onDelete: remove });
    (findByProp(view.tree, 'data-edit-delete')!.props.onClick as () => void)();
    view = render({ card, open: true, onOpenChange, onSave: vi.fn(), onDelete: remove });

    const pending = (findByProp(view.tree, 'data-edit-delete-confirm')!.props.onClick as () => Promise<void>)();
    view = render({ card, open: true, onOpenChange, onSave: vi.fn(), onDelete: remove });
    expect(findByProp(view.tree, 'data-edit-delete-confirm')!.props.disabled).toBe(true);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    resolveDelete(false);
    await pending;
    view = render({ card, open: true, onOpenChange, onSave: vi.fn(), onDelete: remove });
    expect(JSON.stringify(view.tree)).toContain('This card could not be deleted. Try again.');
    expect(JSON.stringify(view.tree)).toContain('Retry delete');
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('offers Unassigned and the profile decks, and keeps a deck missing from the list selectable with a note', () => {
    const view = render({ card: { ...card, customDeck: 'Old deck' }, open: true, onOpenChange: vi.fn(), onSave: vi.fn(), customDecks: ['IELTS', 'Work'] });
    const select = findByProp(view.tree, 'data-edit-deck-select')!;
    expect(select.props.value).toBe('Old deck');
    const options = findAllByType(select, 'option');
    expect(options.map(option => option.props?.value)).toEqual(['', 'IELTS', 'Work', 'Old deck']);
    expect(options[0]!.props?.children).toBe('Unassigned');
    expect(options[3]!.props?.children).toBe('{name} (not in your deck list)');
  });

  it('offers only Unassigned and the current deck when the host passes no deck list', () => {
    const view = render({ card: { ...card, customDeck: 'IELTS' }, open: true, onOpenChange: vi.fn(), onSave: vi.fn() });
    const options = findAllByType(findByProp(view.tree, 'data-edit-deck-select')!, 'option');
    expect(options.map(option => option.props?.value)).toEqual(['', 'IELTS']);
    expect(options[1]!.props?.children).toBe('IELTS');
  });

  it('saves the deck and the star with the other fields in one patch, in both editor modes', async () => {
    for (const context of [undefined, { kind: 'review' as const, current: 2, total: 9 }]) {
      hooks.states = [];
      const onSave = vi.fn(async (): Promise<LearningStateOutcome> =>
        ({ status: 'published', result: { ownerKey: 'o', operationId: 'op', publication: { kind: 'patch', cardId: card.id, fields: {} } } }));
      const props = { card, open: true, onOpenChange: vi.fn(), onSave, customDecks: ['IELTS', 'Work'], context };
      let view = render(props);
      (findByProp(view.tree, 'data-edit-deck-select')!.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'Work' } });
      view = render(props);
      const star = findByProp(view.tree, 'data-edit-starred')!;
      expect(star.props['aria-pressed']).toBe(false);
      (star.props.onClick as () => void)();
      (view.textareas[translationFieldIndex]!.props!.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'dẫn đầu' } });
      view = render(props);
      expect(findByProp(view.tree, 'data-edit-starred')!.props['aria-pressed']).toBe(true);

      await view.submit({ preventDefault: vi.fn() });
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave).toHaveBeenCalledWith('card-1', { translation: 'dẫn đầu', customDeck: 'Work', bookmarked: true });
    }
  });

  it('refuses to save a deck that was deleted while the editor was open', async () => {
    const onSave = vi.fn();
    const onOpenChange = vi.fn();
    let view = render({ card, open: true, onOpenChange, onSave, customDecks: ['IELTS', 'Work'] });
    (findByProp(view.tree, 'data-edit-deck-select')!.props.onChange as (event: { target: { value: string } }) => void)({ target: { value: 'Work' } });
    view = render({ card, open: true, onOpenChange, onSave, customDecks: ['IELTS'] });
    expect(findAllByType(findByProp(view.tree, 'data-edit-deck-select')!, 'option').map(option => option.props?.value)).toEqual(['', 'IELTS', 'Work']);

    await view.submit({ preventDefault: vi.fn() });
    view = render({ card, open: true, onOpenChange, onSave, customDecks: ['IELTS'] });
    expect(onSave).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(view.errorText).toBe('This deck no longer exists. Choose another deck.');
  });

  describe('tags, difficulty label and AI meanings', () => {
    type Handler<T> = (event: T) => void;
    const key = (name: string) => ({ key: name, preventDefault: vi.fn(), nativeEvent: { isComposing: false } });
    const findAllByProp = (node: unknown, name: string): Array<{ props: Record<string, unknown> }> => {
      const out: Array<{ props: Record<string, unknown> }> = [];
      walk(node, element => { if (element.props && name in element.props) out.push(element as { props: Record<string, unknown> }); });
      return out;
    };
    const published = async (): Promise<LearningStateOutcome> =>
      ({ status: 'published', result: { ownerKey: 'o', operationId: 'op', publication: { kind: 'patch', cardId: card.id, fields: {} } } });
    const tagInput = (tree: unknown) => findByProp(tree, 'data-edit-tag-input')!.props;
    const tagTexts = (tree: unknown) => findAllByProp(tree, 'data-edit-tag-remove').map(button => button.props['data-edit-tag-remove']);

    it('shows the stored tags as removable chips and saves the edited list', async () => {
      const onSave = vi.fn(published);
      const props = { card: { ...card, tags: ['news', 'B2'] }, open: true, onOpenChange: vi.fn(), onSave };
      let view = render(props);
      expect(tagTexts(view.tree)).toEqual(['news', 'B2']);
      expect(findByProp(view.tree, 'data-edit-tag-remove')!.props['aria-label']).toBe('Remove tag {tag}');

      (findByProp(view.tree, 'data-edit-tag-remove')!.props.onClick as () => void)();
      view = render(props);
      (tagInput(view.tree).onChange as Handler<{ target: { value: string } }>)({ target: { value: 'travel' } });
      view = render(props);
      const enter = key('Enter');
      (tagInput(view.tree).onKeyDown as Handler<ReturnType<typeof key>>)(enter);
      expect(enter.preventDefault).toHaveBeenCalled();
      view = render(props);
      expect(tagTexts(view.tree)).toEqual(['B2', 'travel']);
      expect(tagInput(view.tree).value).toBe('');

      await view.submit({ preventDefault: vi.fn() });
      expect(onSave).toHaveBeenCalledWith('card-1', { tags: ['B2', 'travel'] });
    });

    it('adds a tag when a comma is typed and removes the last chip with Backspace on an empty input', () => {
      const props = { card, open: true, onOpenChange: vi.fn(), onSave: vi.fn() };
      let view = render(props);
      expect(tagInput(view.tree).placeholder).toBe('Add a tag');
      (tagInput(view.tree).onChange as Handler<{ target: { value: string } }>)({ target: { value: 'news, phrasal  verbs,' } });
      view = render(props);
      expect(tagTexts(view.tree)).toEqual(['news', 'phrasal verbs']);
      expect(tagInput(view.tree).placeholder).toBeUndefined();

      const backspace = key('Backspace');
      (tagInput(view.tree).onKeyDown as Handler<ReturnType<typeof key>>)(backspace);
      view = render(props);
      expect(backspace.preventDefault).toHaveBeenCalled();
      expect(tagTexts(view.tree)).toEqual(['news']);
    });

    it('leaves Enter to the form when the tag input is empty and ignores keys while composing', () => {
      const props = { card: { ...card, tags: ['news'] }, open: true, onOpenChange: vi.fn(), onSave: vi.fn() };
      let view = render(props);
      const enter = key('Enter');
      (tagInput(view.tree).onKeyDown as Handler<ReturnType<typeof key>>)(enter);
      expect(enter.preventDefault).not.toHaveBeenCalled();

      const composing = { ...key('Backspace'), nativeEvent: { isComposing: true } };
      (tagInput(view.tree).onKeyDown as Handler<typeof composing>)(composing);
      view = render(props);
      expect(tagTexts(view.tree)).toEqual(['news']);
    });

    it('announces a duplicate or an over-long tag politely and keeps the long text for editing', () => {
      const props = { card: { ...card, tags: ['News'] }, open: true, onOpenChange: vi.fn(), onSave: vi.fn() };
      let view = render(props);
      const notice = () => findByProp(view.tree, 'data-edit-tag-notice')!.props;
      expect(notice()['aria-live']).toBe('polite');
      expect(notice().role).toBeUndefined();
      expect(notice().children).toBe('');

      (tagInput(view.tree).onChange as Handler<{ target: { value: string } }>)({ target: { value: 'news,' } });
      view = render(props);
      expect(notice().children).toBe('Already added');
      expect(tagTexts(view.tree)).toEqual(['News']);

      (tagInput(view.tree).onChange as Handler<{ target: { value: string } }>)({ target: { value: `${'x'.repeat(33)},` } });
      view = render(props);
      expect(notice().children).toBe('Tags can be up to {max} characters');
      expect(tagInput(view.tree).value).toBe('x'.repeat(33));
    });

    it('stops taking tags at 8 without moving focus away from the input', () => {
      const full = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
      const view = render({ card: { ...card, tags: full }, open: true, onOpenChange: vi.fn(), onSave: vi.fn() });
      expect(tagInput(view.tree).readOnly).toBe(true);
      expect(tagInput(view.tree)['aria-disabled']).toBe(true);
      expect(tagInput(view.tree).disabled).toBeUndefined();
      expect(tagInput(view.tree)['aria-describedby']).toBe('edit-card-tags-limit');
      expect(JSON.stringify(view.tree)).toContain('Up to {max} tags');
      expect(findByProp(view.tree, 'data-edit-tag-suggestions')).toBeNull();
    });

    it('suggests the card category and CEFR level as tags, never as AI suggestions', () => {
      const props = { card: { ...card, category: 'Travel', cefrLevel: 'B2', tags: ['b2'] }, open: true, onOpenChange: vi.fn(), onSave: vi.fn() };
      let view = render(props);
      const suggestions = findByProp(view.tree, 'data-edit-tag-suggestions')!;
      expect(JSON.stringify(suggestions)).toContain('From this card:');
      expect(JSON.stringify(suggestions)).not.toContain('AI suggested');
      expect(findAllByProp(view.tree, 'data-edit-tag-suggestion').map(button => button.props['data-edit-tag-suggestion'])).toEqual(['Travel']);

      (findByProp(view.tree, 'data-edit-tag-suggestion')!.props.onClick as () => void)();
      view = render(props);
      expect(tagTexts(view.tree)).toEqual(['b2', 'Travel']);
      expect(findByProp(view.tree, 'data-edit-tag-suggestions')).toBeNull();
    });

    it('offers the difficulty label as native radios in the library dialog and clears it to no label', async () => {
      const onSave = vi.fn(published);
      const props = { card: { ...card, learnerDifficulty: 'easy' as const }, open: true, onOpenChange: vi.fn(), onSave };
      let view = render(props);
      const radios = findAllByType(findByProp(view.tree, 'data-edit-difficulty')!, 'input');
      expect(radios.map(radio => [radio.props?.type, radio.props?.name, radio.props?.value, radio.props?.checked])).toEqual([
        ['radio', 'edit-card-learner-difficulty', 'easy', true],
        ['radio', 'edit-card-learner-difficulty', 'medium', false],
        ['radio', 'edit-card-learner-difficulty', 'hard', false],
      ]);
      expect(findAllByType(findByProp(view.tree, 'data-edit-difficulty')!, 'legend')).toHaveLength(1);
      expect(JSON.stringify(view.tree)).toContain('Your own label. It does not change when this card is due.');

      (radios[2]!.props!.onChange as () => void)();
      view = render(props);
      expect(findAllByType(findByProp(view.tree, 'data-edit-difficulty')!, 'input')[2]!.props?.checked).toBe(true);
      await view.submit({ preventDefault: vi.fn() });
      expect(onSave).toHaveBeenLastCalledWith('card-1', { learnerDifficulty: 'hard' });

      hooks.states = [];
      view = render(props);
      (findByProp(view.tree, 'data-edit-difficulty-clear')!.props.onClick as () => void)();
      view = render(props);
      expect(findByProp(view.tree, 'data-edit-difficulty-clear')).toBeNull();
      expect(findAllByType(findByProp(view.tree, 'data-edit-difficulty')!, 'input').every(radio => radio.props?.checked === false)).toBe(true);
      await view.submit({ preventDefault: vi.fn() });
      expect(onSave).toHaveBeenLastCalledWith('card-1', { learnerDifficulty: null });
    });

    it('shows the last review rating read-only beside the label only once the card was reviewed', () => {
      const unreviewed = render({ card: { ...card, difficulty: 'good' }, open: true, onOpenChange: vi.fn(), onSave: vi.fn() });
      expect(JSON.stringify(unreviewed.tree)).not.toContain('Last review');

      hooks.states = [];
      const reviewed = render({ card: { ...card, difficulty: 'good', reviews: 3 }, open: true, onOpenChange: vi.fn(), onSave: vi.fn() });
      expect(JSON.stringify(findByProp(reviewed.tree, 'data-edit-difficulty'))).toContain('Last review: Good');
    });

    it('keeps the difficulty label out of the paused-review sheet, which shows tags beside the deck', () => {
      const view = render({ card, open: true, onOpenChange: vi.fn(), onSave: vi.fn(), context: { kind: 'review', current: 1, total: 3 } });
      expect(findByProp(view.tree, 'data-edit-difficulty')).toBeNull();
      expect(findByProp(view.tree, 'data-edit-tag-input')).not.toBeNull();
      expect(findByProp(view.tree, 'data-edit-starred')).not.toBeNull();
    });

    it('offers the AI meanings that differ from the draft and picks one into the draft', async () => {
      const onSave = vi.fn(published);
      const aiCard: CardData = { ...card, origin: 'ai', translationAlternatives: ['dẫn dắt', 'chì', 'kim loại; nặng'] };
      for (const context of [undefined, { kind: 'review' as const, current: 1, total: 3 }]) {
        hooks.states = [];
        onSave.mockClear();
        const props = { card: aiCard, open: true, onOpenChange: vi.fn(), onSave, context };
        let view = render(props);
        expect(findByProp(view.tree, 'data-edit-ai-suggested')).not.toBeNull();
        const choices = findAllByProp(view.tree, 'data-edit-meaning-choice');
        expect(choices.map(choice => choice.props.children)).toEqual(['dẫn dắt', 'kim loại']);
        expect(choices[1]!.props['aria-label']).toBe('Use meaning: {meaning}');

        (choices[1]!.props.onClick as () => void)();
        view = render(props);
        expect(view.textareas[0]!.props!.value).toBe('kim loại; nặng');
        expect(findAllByProp(view.tree, 'data-edit-meaning-choice').map(choice => choice.props.children)).toEqual(['dẫn dắt', 'chì']);
        await view.submit({ preventDefault: vi.fn() });
        expect(onSave).toHaveBeenCalledWith('card-1', { translation: 'kim loại; nặng' });
      }
    });

    it('shows no AI badge or meaning chips for a card without alternatives', () => {
      const view = render({ card: { ...card, translationAlternatives: ['chì'] }, open: true, onOpenChange: vi.fn(), onSave: vi.fn() });
      expect(findByProp(view.tree, 'data-edit-ai-suggested')).toBeNull();
      expect(findByProp(view.tree, 'data-edit-meaning-choice')).toBeNull();
    });

    it('saves meaning, deck, star, tags and difficulty label in one patch', async () => {
      const onSave = vi.fn(published);
      const props = {
        card: { ...card, origin: 'ai' as const, translationAlternatives: ['dẫn dắt'], tags: ['news'] },
        open: true, onOpenChange: vi.fn(), onSave, customDecks: ['IELTS', 'Work'],
      };
      let view = render(props);
      (findByProp(view.tree, 'data-edit-meaning-choice')!.props.onClick as () => void)();
      (findByProp(view.tree, 'data-edit-deck-select')!.props.onChange as Handler<{ target: { value: string } }>)({ target: { value: 'IELTS' } });
      view = render(props);
      (findByProp(view.tree, 'data-edit-starred')!.props.onClick as () => void)();
      (tagInput(view.tree).onChange as Handler<{ target: { value: string } }>)({ target: { value: 'B2,' } });
      view = render(props);
      (findAllByType(findByProp(view.tree, 'data-edit-difficulty')!, 'input')[1]!.props!.onChange as () => void)();
      view = render(props);

      await view.submit({ preventDefault: vi.fn() });
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave).toHaveBeenCalledWith('card-1', {
        translation: 'dẫn dắt', customDeck: 'IELTS', bookmarked: true, tags: ['news', 'B2'], learnerDifficulty: 'medium',
      });
    });

    it('drops typed tags and a picked meaning when the editor reopens after a discard', () => {
      const aiCard: CardData = { ...card, origin: 'ai', translationAlternatives: ['dẫn dắt'] };
      const props = { card: aiCard, open: true, onOpenChange: vi.fn(), onSave: vi.fn() };
      let view = render(props);
      (findByProp(view.tree, 'data-edit-meaning-choice')!.props.onClick as () => void)();
      (tagInput(view.tree).onChange as Handler<{ target: { value: string } }>)({ target: { value: 'half typed' } });
      view = render(props);
      (tagInput(view.tree).onChange as Handler<{ target: { value: string } }>)({ target: { value: 'news,' } });
      view = render(props);
      expect(tagTexts(view.tree)).toEqual(['news']);

      render({ ...props, open: false });
      render(props);
      view = render(props);
      expect(view.textareas[0]!.props!.value).toBe('chì');
      expect(tagTexts(view.tree)).toEqual([]);
      expect(tagInput(view.tree).value).toBe('');
      expect(findAllByProp(view.tree, 'data-edit-meaning-choice')).toHaveLength(1);
    });
  });

  it('treats an unsaved headword as dirty when Escape requests a close', () => {
    const onOpenChange = vi.fn();
    let view = render({ card, open: true, onOpenChange, onSave: vi.fn() });
    (findByProp(view.tree, 'data-edit-word-input')!.props.onChange as (event: { target: { value: string } }) => void)(
      { target: { value: 'guide' } },
    );
    view = render({ card, open: true, onOpenChange, onSave: vi.fn() });

    (findByProp(view.tree, 'onOpenChange')!.props.onOpenChange as (open: boolean) => void)(false);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    view = render({ card, open: true, onOpenChange, onSave: vi.fn() });
    const discardButton = findAllByText(view.tree, 'Discard changes')[0];
    expect(discardButton).toBeDefined();
    (discardButton!.props!.onClick as () => void)();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('keeps the sheet open while a headword rename is pending', async () => {
    const onOpenChange = vi.fn();
    let resolveRename: (renamed: CardData) => void = () => {};
    cardRepositoryMocks.renameCardHeadword.mockReturnValueOnce(new Promise<CardData>(resolve => { resolveRename = resolve; }));
    let view = render({ card, open: true, onOpenChange, onSave: vi.fn() });
    (findByProp(view.tree, 'data-edit-word-input')!.props.onChange as (event: { target: { value: string } }) => void)(
      { target: { value: 'guide' } },
    );
    view = render({ card, open: true, onOpenChange, onSave: vi.fn() });

    const pendingRename = findByProp(view.tree, 'data-edit-word-save')!.props.onClick as () => Promise<void>;
    const renaming = pendingRename();
    view = render({ card, open: true, onOpenChange, onSave: vi.fn() });
    (findByProp(view.tree, 'onOpenChange')!.props.onOpenChange as (open: boolean) => void)(false);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    resolveRename({ ...card, word: 'guide', normalizedWord: 'guide' });
    await renaming;
    view = render({ card, open: true, onOpenChange, onSave: vi.fn() });
    (findByProp(view.tree, 'onOpenChange')!.props.onOpenChange as (open: boolean) => void)(false);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('saves an unsaved headword and ordinary fields in one submit', async () => {
    const onOpenChange = vi.fn();
    const onSave = vi.fn(async (): Promise<LearningStateOutcome> =>
      ({ status: 'published', result: { ownerKey: 'o', operationId: 'op', publication: { kind: 'patch', cardId: card.id, fields: {} } } }));
    const renamed = { ...card, word: 'guide', normalizedWord: 'guide', revision: 1 };
    cardRepositoryMocks.renameCardHeadword.mockResolvedValueOnce(renamed);
    let view = render({ card, open: true, onOpenChange, onSave });
    (findByProp(view.tree, 'data-edit-word-input')!.props.onChange as (event: { target: { value: string } }) => void)(
      { target: { value: 'guide' } },
    );
    (view.textareas[translationFieldIndex]!.props!.onChange as (event: { target: { value: string } }) => void)(
      { target: { value: 'dẫn đầu' } },
    );
    view = render({ card, open: true, onOpenChange, onSave });

    await view.submit({ preventDefault: vi.fn() });

    expect(cardRepositoryMocks.renameCardHeadword).toHaveBeenCalledWith('user-1', 'card-1', 'guide', 0, 0);
    expect(onSave).toHaveBeenCalledWith('card-1', { translation: 'dẫn đầu' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('keeps the ordinary draft for retry after the rename succeeds but the patch fails', async () => {
    const onSave = vi.fn(async (): Promise<LearningStateOutcome> => ({ status: 'missing-card' }));
    const renamed = { ...card, word: 'guide', normalizedWord: 'guide', revision: 1 };
    cardRepositoryMocks.renameCardHeadword.mockResolvedValueOnce(renamed);
    let view = render({ card, open: true, onOpenChange: vi.fn(), onSave });
    (findByProp(view.tree, 'data-edit-word-input')!.props.onChange as (event: { target: { value: string } }) => void)(
      { target: { value: 'guide' } },
    );
    (view.textareas[translationFieldIndex]!.props!.onChange as (event: { target: { value: string } }) => void)(
      { target: { value: 'dẫn đầu' } },
    );
    view = render({ card, open: true, onOpenChange: vi.fn(), onSave });

    await view.submit({ preventDefault: vi.fn() });
    view = render({ card, open: true, onOpenChange: vi.fn(), onSave });

    expect(findByProp(view.tree, 'data-edit-word-input')!.props.value).toBe('guide');
    expect(view.textareas[translationFieldIndex]!.props!.value).toBe('dẫn đầu');
    expect(findAllByText(view.tree, 'Retry save')).toHaveLength(1);

    await view.submit({ preventDefault: vi.fn() });
    expect(cardRepositoryMocks.renameCardHeadword).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledTimes(2);
  });

  it('locks the headword controls while an ordinary save is pending', async () => {
    let resolveSave: (outcome: LearningStateOutcome) => void = () => {};
    const onSave = vi.fn(() => new Promise<LearningStateOutcome>(resolve => { resolveSave = resolve; }));
    let view = render({ card, open: true, onOpenChange: vi.fn(), onSave });
    (view.textareas[translationFieldIndex]!.props!.onChange as (event: { target: { value: string } }) => void)(
      { target: { value: 'dẫn đầu' } },
    );
    view = render({ card, open: true, onOpenChange: vi.fn(), onSave });

    const pendingSubmit = view.submit({ preventDefault: vi.fn() });
    view = render({ card, open: true, onOpenChange: vi.fn(), onSave });
    expect(findByProp(view.tree, 'data-edit-word-input')!.props.disabled).toBe(true);
    expect(findByProp(view.tree, 'data-edit-word-save')!.props.disabled).toBe(true);

    await (findByProp(view.tree, 'data-edit-word-save')!.props.onClick as () => Promise<void>)();
    expect(cardRepositoryMocks.renameCardHeadword).not.toHaveBeenCalled();

    resolveSave({ status: 'published', result: { ownerKey: 'o', operationId: 'op', publication: { kind: 'patch', cardId: card.id, fields: {} } } });
    await pendingSubmit;
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

  it('keeps the compact draft preview for the mobile sheet while a paused review shows the canvas preview backdrop', () => {
    const review = render({ card, open: true, onOpenChange: vi.fn(), onSave: vi.fn(), context: { kind: 'review', current: 8, total: 20 } });

    expect(findByProp(review.tree, 'data-edit-preview')?.props.className).toContain('md:hidden');
    expect(findByProp(review.tree, 'data-edit-preview-backdrop')).not.toBeNull();
    expect(findByProp(review.tree, 'data-card-edit-sheet')?.props.className).toContain('edit-sheet--review');
  });

  it('edits a library card in a centred dialog without the review preview backdrop', () => {
    const view = render({ card, open: true, onOpenChange: vi.fn(), onSave: vi.fn() });

    expect(findByProp(view.tree, 'data-edit-preview')?.props.className).toContain('md:hidden');
    expect(findByProp(view.tree, 'data-edit-preview-backdrop')).toBeNull();
    expect(findByProp(view.tree, 'data-card-edit-sheet')?.props.className).toContain('edit-sheet--dialog');
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
      const renamed = { ...card, word: 'guide', normalizedWord: 'guide' };
      cardRepositoryMocks.renameCardHeadword
        .mockRejectedValueOnce(new Error('network down'))
        .mockResolvedValueOnce(renamed);
      let view = render({ card, open: true, onOpenChange: vi.fn(), onSave: vi.fn() });
      (findByProp(view.tree, 'data-edit-word-input')!.props.onChange as (event: { target: { value: string } }) => void)(
        { target: { value: 'guide' } },
      );
      view = render({ card, open: true, onOpenChange: vi.fn(), onSave: vi.fn() });

      await (findByProp(view.tree, 'data-edit-word-save')!.props.onClick as () => Promise<void>)();

      view = render({ card, open: true, onOpenChange: vi.fn(), onSave: vi.fn() });
      const alert = findByProp(view.tree, 'role');
      expect(alert?.props.children).toMatch(/could not be saved/);

      await (findByProp(view.tree, 'data-edit-word-save')!.props.onClick as () => Promise<void>)();
      view = render({ card, open: true, onOpenChange: vi.fn(), onSave: vi.fn() });
      expect(cardRepositoryMocks.renameCardHeadword).toHaveBeenCalledTimes(2);
      expect(findByProp(view.tree, 'data-edit-word-input')!.props.value).toBe('guide');
      expect(findByProp(view.tree, 'role')).toBeNull();
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

  describe('photo upload', () => {
    const photo = new File([new Uint8Array(8)], 'photo.png', { type: 'image/png' });
    const pick = (tree: unknown) => {
      const input = findAllByType(tree, 'input').find(element => element.props?.accept === 'image/*');
      (input!.props!.onChange as (event: unknown) => void)({ currentTarget: { files: [photo], value: 'photo.png' } });
    };
    const heldUpload = () => {
      let resolve!: (url: string) => void;
      let reject!: (error: unknown) => void;
      let progress: (fraction: number | null) => void = () => undefined;
      const cancel = vi.fn(() => reject(Object.assign(new Error('canceled'), { kind: 'canceled' })));
      const upload = vi.fn((_file: File, onProgress: (fraction: number | null) => void) => {
        progress = onProgress;
        return { done: new Promise<string>((res, rej) => { resolve = res; reject = rej; }), cancel };
      });
      return { uploader: { upload }, upload, cancel, progress: (fraction: number | null) => progress(fraction), finish: (url: string) => resolve(url), fail: (error: unknown) => reject(error) };
    };
    const flush = async () => { for (let index = 0; index < 5; index += 1) await Promise.resolve(); };

    it('offers Upload only when the host passes an uploader', () => {
      expect(findByProp(render({ card, open: true, onOpenChange: vi.fn(), onSave: vi.fn() }).tree, 'data-edit-image-upload')).toBeNull();
      const { uploader } = heldUpload();
      expect(findByProp(render({ card, open: true, onOpenChange: vi.fn(), onSave: vi.fn(), imageUpload: uploader }).tree, 'data-edit-image-upload')).not.toBeNull();
    });

    it('shows progress, then puts the uploaded photo on the draft', async () => {
      const held = heldUpload();
      const props = { card, open: true, onOpenChange: vi.fn(), onSave: vi.fn(), imageUpload: held.uploader };
      pick(render(props).tree);
      expect(held.upload).toHaveBeenCalledWith(photo, expect.any(Function));
      held.progress(0.4);
      let view = render(props);
      expect(JSON.stringify(findByProp(view.tree, 'role')?.props.children)).toContain('Uploading photo');
      expect(findByProp(view.tree, 'data-edit-image-upload-cancel')).not.toBeNull();
      held.finish('https://firebasestorage.googleapis.com/v0/b/demo/o/photo.webp?alt=media&token=t');
      await flush();
      view = render(props);
      expect(findAllByType(view.tree, 'img').some(image => String(image.props?.src).startsWith('https://firebasestorage.googleapis.com/'))).toBe(true);
      expect(findByProp(view.tree, 'data-edit-image-remove')).not.toBeNull();
    });

    it('saves a photo from the uploader the hosts pass, and the card keeps it once stored', async () => {
      const port = createMemoryFilePort({ limits: { tier: 'free', limitBytes: 4_096, maxFileBytes: 2_048 } });
      port.downloadUrl = async fileId =>
        `https://firebasestorage.googleapis.com/v0/b/encoded-hangout-433912-h2.firebasestorage.app/o/users%2Fuser-1%2Ffiles%2F${fileId}?alt=media&token=0b0f1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d`;
      const onSave = vi.fn(async (): Promise<LearningStateOutcome> => ({ status: 'missing-card' }));
      const props = { card, open: true, onOpenChange: vi.fn(), onSave, imageUpload: createCardImageUploader(port) };
      pick(render(props).tree);
      await vi.waitFor(() => {
        expect(findAllByType(render(props).tree, 'img').some(image => String(image.props?.src).startsWith('https://firebasestorage.googleapis.com/'))).toBe(true);
      }, { timeout: 8_000, interval: 50 });
      await render(props).submit({ preventDefault: vi.fn() });
      expect(onSave).toHaveBeenCalledTimes(1);
      const [, patch] = onSave.mock.calls[0] as unknown as [string, Partial<CardData>];
      const [stored] = (await port.list()).files;
      expect(stored).toMatchObject({ purpose: 'card-image', status: 'ready' });
      expect(patch).toMatchObject({ imageUrl: expect.stringContaining(`%2Ffiles%2F${stored!.id}?alt=media`), imageSearchQuery: '' });
      expect(isSupportedImageUrl(patch.imageUrl)).toBe(true);
      expect(ownStorageImageOwner(patch.imageUrl)).toBe('user-1');
      expect(normalizeCardData({ ...card, ...patch }, card.id).imageUrl).toBe(patch.imageUrl);
    });

    it('cancels quietly and keeps the previous photo', async () => {
      const held = heldUpload();
      const withImage = { ...card, imageUrl: 'https://images.pexels.com/old.jpg' };
      const props = { card: withImage, open: true, onOpenChange: vi.fn(), onSave: vi.fn(), imageUpload: held.uploader };
      pick(render(props).tree);
      (findByProp(render(props).tree, 'data-edit-image-upload-cancel')!.props.onClick as () => void)();
      await flush();
      const view = render(props);
      expect(held.cancel).toHaveBeenCalled();
      expect(findByProp(view.tree, 'role')).toBeNull();
      expect(findAllByType(view.tree, 'img').some(image => image.props?.src === 'https://images.pexels.com/old.jpg')).toBe(true);
    });

    it('explains a full storage allowance without offering a plan', async () => {
      const held = heldUpload();
      const props = { card, open: true, onOpenChange: vi.fn(), onSave: vi.fn(), imageUpload: held.uploader };
      pick(render(props).tree);
      held.fail(Object.assign(new Error('quota'), { kind: 'quota' }));
      await flush();
      const alert = JSON.stringify(findByProp(render(props).tree, 'role')?.props.children);
      expect(alert).toContain('Your storage is full');
      expect(alert).not.toMatch(/upgrade|pricing|plan/i);
    });
  });
});
