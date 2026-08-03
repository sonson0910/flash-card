import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import {
  useLearningWorkspace,
  type LearningWorkspaceActions,
  type LearningWorkspaceOptions,
} from './useLearningWorkspace';

const sourceCard: CardData = {
  id: 'word-focus',
  word: 'focus',
  translation: 'tập trung',
  explanation: '',
  phonetic: '',
  emoji: '🎯',
  category: 'Study',
  audioUrl: null,
  imageUrl: null,
  bookmarked: false,
  customDeck: null,
  revision: 1,
  libraryEpoch: 0,
};

const options = () => {
  const libraryPatch = vi.fn();
  const practicePatch = vi.fn();
  const removeLibraryCard = vi.fn();
  const removePracticeCard = vi.fn();
  const patchDeviceCards = vi.fn(async () => []);
  const removeDeviceCard = vi.fn(async () => []);
  const value: LearningWorkspaceOptions = {
    owner: { id: null, verifiedEpoch: null },
    library: {
      knownTotal: 1,
      findCard: cardId => cardId === sourceCard.id ? sourceCard : undefined,
      isPatchCurrent: () => true,
      publication: {
        patch: libraryPatch,
        remove: removeLibraryCard,
        clear: vi.fn(),
      },
    },
    practice: {
      findCard: () => undefined,
      publication: {
        patch: practicePatch,
        remove: removePracticeCard,
        clear: vi.fn(),
      },
    },
    ports: {
      patchDeviceCards,
      removeDeviceCard,
      acknowledgeDevicePending: async () => undefined,
      acceptVerifiedEpoch: vi.fn(),
      mutateCloudStats: vi.fn(),
      publishCategoryFacets: async () => undefined,
      resetCloudState: vi.fn(),
      resetCloudPage: vi.fn(),
      refreshCloud: vi.fn(),
      cloudAvailabilityChanged: vi.fn(),
      mutationPendingChanged: vi.fn(),
      reportError: vi.fn(),
      addXp: vi.fn(),
    },
    createOperationId: intent => `op-${intent}`,
  };
  return {
    value,
    libraryPatch,
    practicePatch,
    removeLibraryCard,
    removePracticeCard,
    patchDeviceCards,
    removeDeviceCard,
  };
};

describe('useLearningWorkspace', () => {
  it('keeps the public facade free of vendor and React setter types', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./useLearningWorkspace.ts', import.meta.url)),
      'utf8',
    );

    expect(source).toMatch(/useLearningStatePersistence\(/);
    expect(source).toMatch(/useLearningState\(/);
    expect(source).not.toMatch(/firebase|firestore|cardRepository|Repository/);
    expect(source).not.toMatch(/Dispatch|SetStateAction/);
  });

  it('publishes compact command aliases to both library and practice bindings', async () => {
    const setup = options();
    let actions: LearningWorkspaceActions | null = null;
    function Harness() {
      actions = useLearningWorkspace(setup.value).actions;
      return null;
    }
    renderToStaticMarkup(<Harness />);

    expect(Object.keys(actions!)).toEqual([
      'toggleBookmark', 'assignDeck', 'reviewCard', 'updateCard', 'deleteCard', 'clearLibrary',
    ]);
    await actions!.toggleBookmark(sourceCard.id);
    expect(setup.patchDeviceCards).toHaveBeenCalledWith([
      { card: { ...sourceCard, bookmarked: true }, fields: { bookmarked: true } },
    ], 1);
    expect(setup.libraryPatch).toHaveBeenCalledWith(sourceCard.id, { bookmarked: true });
    expect(setup.practicePatch).toHaveBeenCalledWith(sourceCard.id, { bookmarked: true });

    await actions!.assignDeck(sourceCard.id, '  IELTS Writing  ');
    expect(setup.libraryPatch).toHaveBeenLastCalledWith(sourceCard.id, { customDeck: 'IELTS Writing' });
    expect(setup.practicePatch).toHaveBeenLastCalledWith(sourceCard.id, { customDeck: 'IELTS Writing' });

    await actions!.deleteCard(sourceCard.id);
    expect(setup.removeDeviceCard).toHaveBeenCalledWith(sourceCard.id);
    expect(setup.removeLibraryCard).toHaveBeenCalledWith(sourceCard.id);
    expect(setup.removePracticeCard).toHaveBeenCalledWith(sourceCard.id);
  });

  it('uses an explicit update source and suppresses stale lifecycle publications', async () => {
    const setup = options();
    const explicit = { ...sourceCard, translation: 'concentrate', revision: 4 };
    setup.value.library.isPatchCurrent = (_cardId, token) => token !== 'stale';
    let actions: LearningWorkspaceActions | null = null;
    function Harness() {
      actions = useLearningWorkspace(setup.value).actions;
      return null;
    }
    renderToStaticMarkup(<Harness />);

    await actions!.updateCard(sourceCard.id, { explanation: 'updated' }, {
      source: explicit,
      expectedLifecycle: 'current',
    });
    expect(setup.patchDeviceCards).toHaveBeenCalledWith([
      { card: { ...explicit, explanation: 'updated' }, fields: { explanation: 'updated' } },
    ], 1);

    await actions!.updateCard(sourceCard.id, { explanation: 'ignored' }, {
      source: explicit,
      expectedLifecycle: 'stale',
    });
    expect(setup.patchDeviceCards).toHaveBeenCalledTimes(1);
  });
});
