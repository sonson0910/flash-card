import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { DevicePendingOperation } from '../../lib/deviceSync';
import type { CardData } from '../../types/card';
import type { RestoreDeviceCardResult } from './learningPersistencePort';
import {
  useLearningWorkspace,
  type LearningWorkspaceActions,
  type LearningWorkspaceDependencies,
  type LearningWorkspaceOptions,
} from './useLearningWorkspace';
import { defaultLearningPersistenceHook } from './learningWorkspacePersistenceAdapter';

const dependencies: LearningWorkspaceDependencies = { usePersistence: defaultLearningPersistenceHook };

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
  let libraryCard: CardData | undefined = sourceCard;
  let practiceCard: CardData | undefined;
  const libraryPatch = vi.fn();
  const practicePatch = vi.fn();
  const restoreLibraryCard = vi.fn((card: CardData) => { libraryCard = card; });
  const restorePracticeCard = vi.fn((card: CardData) => { practiceCard = card; });
  const removeLibraryCard = vi.fn(() => { libraryCard = undefined; });
  const removePracticeCard = vi.fn(() => { practiceCard = undefined; });
  const patchDeviceCards = vi.fn(async (): Promise<DevicePendingOperation[]> => []);
  const removeDeviceCard = vi.fn(async (): Promise<DevicePendingOperation[]> => [{
    type: 'delete', operation: 'delete', opId: 'op-delete', cardId: sourceCard.id,
    fieldMask: [], baseRevision: 1, libraryEpoch: 0,
    updatedAt: '2026-08-12T00:00:00.000Z',
  }]);
  const restoreDeviceCard = vi.fn(async (card: CardData): Promise<RestoreDeviceCardResult> => ({ status: 'queued', card }));
  const value: LearningWorkspaceOptions = {
    owner: { id: null, verifiedEpoch: null },
    library: {
      knownTotal: 1,
      findCard: cardId => cardId === libraryCard?.id ? libraryCard : undefined,
      isPatchCurrent: () => true,
      publication: {
        patch: libraryPatch,
        remove: removeLibraryCard,
        restore: restoreLibraryCard,
        clear: vi.fn(),
      },
    },
    practice: {
      findCard: cardId => cardId === practiceCard?.id ? practiceCard : undefined,
      publication: {
        patch: practicePatch,
        remove: removePracticeCard,
        restore: restorePracticeCard,
        clear: vi.fn(),
      },
    },
    ports: {
      patchDeviceCards,
      removeDeviceCard,
      restoreDeviceCard,
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
    restoreDeviceCard,
    restoreLibraryCard,
    restorePracticeCard,
  };
};

describe('useLearningWorkspace', () => {
  it('keeps the public facade free of vendor and React setter types', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./useLearningWorkspace.ts', import.meta.url)),
      'utf8',
    );

    expect(source).not.toMatch(/useLearningStatePersistence/);
    expect(source).toMatch(/useLearningState\(/);
    expect(source).not.toMatch(/firebase|firestore|cardRepository|Repository/);
    expect(source).not.toMatch(/Dispatch|SetStateAction/);
  });

  it('receives persistence through an injected hook and keeps compact facade actions', async () => {
    const setup = options();
    const usePersistence = vi.fn((persistenceOptions: Parameters<LearningWorkspaceDependencies['usePersistence']>[0]) => ({
      findCard: persistenceOptions.findCard,
      persist: async (mutation: Parameters<ReturnType<LearningWorkspaceDependencies['usePersistence']>['persist']>[0]) => ({
        ownerKey: mutation.ownerKey,
        operationId: mutation.operationId,
        publication: mutation.publication,
      }),
    }));
    let actions: LearningWorkspaceActions | null = null;
    function Harness() {
      actions = useLearningWorkspace(setup.value, { usePersistence }).actions;
      return null;
    }
    renderToStaticMarkup(<Harness />);

    await actions!.toggleBookmark(sourceCard.id);

    expect(usePersistence).toHaveBeenCalledOnce();
    expect(setup.libraryPatch).toHaveBeenCalledWith(sourceCard.id, { bookmarked: true });
    expect(setup.practicePatch).toHaveBeenCalledWith(sourceCard.id, { bookmarked: true });
  });

  it('reviews a bounded daily-pool card through an explicit source and returns a missing-card outcome', async () => {
    const setup = options();
    setup.value.library.findCard = () => undefined;
    let actions: LearningWorkspaceActions | null = null;
    function Harness() {
      actions = useLearningWorkspace(setup.value, dependencies).actions;
      return null;
    }
    renderToStaticMarkup(<Harness />);

    await expect(actions!.reviewCard(sourceCard.id, 'good', 'daily-source', sourceCard))
      .resolves.toMatchObject({ status: 'durably-queued' });
    expect(setup.patchDeviceCards).toHaveBeenCalledWith(expect.any(Array), 1, 'daily-source', 'review');
    await expect(actions!.reviewCard('missing', 'good', 'daily-missing')).resolves.toEqual({ status: 'missing-card' });
  });

  it('publishes compact command aliases to both library and practice bindings', async () => {
    const setup = options();
    let actions: LearningWorkspaceActions | null = null;
    function Harness() {
      actions = useLearningWorkspace(setup.value, dependencies).actions;
      return null;
    }
    renderToStaticMarkup(<Harness />);

    expect(Object.keys(actions!)).toEqual([
      'toggleBookmark', 'assignDeck', 'reviewCard', 'updateCard', 'deleteCard', 'restoreCard', 'clearLibrary',
    ]);
    await actions!.toggleBookmark(sourceCard.id);
    expect(setup.patchDeviceCards).toHaveBeenCalledWith([
      { card: { ...sourceCard, bookmarked: true }, fields: { bookmarked: true } },
    ], 1, 'op-bookmark');
    expect(setup.libraryPatch).toHaveBeenCalledWith(sourceCard.id, { bookmarked: true });
    expect(setup.practicePatch).toHaveBeenCalledWith(sourceCard.id, { bookmarked: true });

    await actions!.assignDeck(sourceCard.id, '  IELTS Writing  ');
    expect(setup.libraryPatch).toHaveBeenLastCalledWith(sourceCard.id, { customDeck: 'IELTS Writing' });
    expect(setup.practicePatch).toHaveBeenLastCalledWith(sourceCard.id, { customDeck: 'IELTS Writing' });

    const deleted = await actions!.deleteCard(sourceCard.id);
    expect(setup.removeDeviceCard).toHaveBeenCalledWith(sourceCard.id, {
      libraryEpoch: 0,
      baseRevisions: { [sourceCard.id]: 1 },
    });
    expect(setup.removeLibraryCard).toHaveBeenCalledWith(sourceCard.id);
    expect(setup.removePracticeCard).toHaveBeenCalledWith(sourceCard.id);
    expect(deleted).toMatchObject({ status: 'durably-queued', result: { undoToken: { card: sourceCard } } });
  });

  it('keeps bookmark mutations usable while signed-in epoch verification is offline', async () => {
    const setup = options();
    setup.value.owner = { id: 'owner-offline', verifiedEpoch: null };
    setup.patchDeviceCards.mockResolvedValue([{
      type: 'patch',
      operation: 'patch',
      opId: 'op-bookmark',
      cardId: sourceCard.id,
      fields: { bookmarked: true },
      fieldMask: ['bookmarked'],
      baseRevision: 1,
      libraryEpoch: -1,
      updatedAt: '2026-08-07T00:00:00.000Z',
      ownerUserId: 'owner-offline',
    }]);
    let actions: LearningWorkspaceActions | null = null;
    function Harness() {
      actions = useLearningWorkspace(setup.value, dependencies).actions;
      return null;
    }
    renderToStaticMarkup(<Harness />);

    await expect(actions!.toggleBookmark(sourceCard.id)).resolves.toBeUndefined();

    expect(setup.patchDeviceCards).toHaveBeenCalledOnce();
    expect(setup.libraryPatch).toHaveBeenCalledWith(sourceCard.id, { bookmarked: true });
    expect(setup.practicePatch).toHaveBeenCalledWith(sourceCard.id, { bookmarked: true });
  });

  it('removes a card from both local views while signed-in epoch verification is offline', async () => {
    const setup = options();
    setup.value.owner = { id: 'owner-offline', verifiedEpoch: null };
    setup.removeDeviceCard.mockResolvedValue([{
      type: 'delete',
      operation: 'delete',
      opId: 'op-delete',
      cardId: sourceCard.id,
      fieldMask: [],
      baseRevision: 1,
      libraryEpoch: -1,
      updatedAt: '2026-08-12T00:00:00.000Z',
      ownerUserId: 'owner-offline',
    }]);
    let actions: LearningWorkspaceActions | null = null;
    function Harness() {
      actions = useLearningWorkspace(setup.value, dependencies).actions;
      return null;
    }
    renderToStaticMarkup(<Harness />);

    const deleted = await actions!.deleteCard(sourceCard.id);

    expect(setup.removeDeviceCard).toHaveBeenCalledOnce();
    expect(deleted).toMatchObject({ status: 'durably-queued', result: { undoToken: { expectedLibraryEpoch: 0 } } });
    expect(setup.removeLibraryCard).toHaveBeenCalledWith(sourceCard.id);
    expect(setup.removePracticeCard).toHaveBeenCalledWith(sourceCard.id);
  });

  it('restores an offline queued deletion with one stable explicit-epoch operation', async () => {
    const setup = options();
    setup.value.owner = { id: 'owner-offline', verifiedEpoch: null };
    let actions: LearningWorkspaceActions | null = null;
    function Harness() {
      actions = useLearningWorkspace(setup.value, dependencies).actions;
      return null;
    }
    renderToStaticMarkup(<Harness />);

    const deleted = await actions!.deleteCard(sourceCard.id);
    const token = ('result' in deleted ? deleted.result.undoToken : undefined)!;
    expect(token.card).toEqual(sourceCard);
    expect(token.expectedLibraryEpoch).toBe(0);

    const restored = await actions!.restoreCard(token);
    const repeated = await actions!.restoreCard(token);

    expect(restored).toMatchObject({ status: 'durably-queued', result: { restoreFinality: 'durably-queued' } });
    expect(repeated).toEqual(restored);
    expect(setup.value.ports.restoreDeviceCard).toHaveBeenCalledOnce();
    expect(setup.value.ports.restoreDeviceCard).toHaveBeenCalledWith(sourceCard, {
      ownerId: 'owner-offline',
      expectedLibraryEpoch: 0,
      operationId: 'op-restore',
      operationCreatedAt: expect.any(String),
    });
    expect(setup.restoreLibraryCard).toHaveBeenCalledOnce();
    expect(setup.restorePracticeCard).toHaveBeenCalledOnce();
  });

  it('does not restore when the owner or verified library epoch changes', async () => {
    const setup = options();
    let actions: LearningWorkspaceActions | null = null;
    function Harness() {
      actions = useLearningWorkspace(setup.value, dependencies).actions;
      return null;
    }
    renderToStaticMarkup(<Harness />);

    const deleted = await actions!.deleteCard(sourceCard.id);
    const token = ('result' in deleted ? deleted.result.undoToken : undefined)!;
    setup.value.owner = { id: 'other-owner', verifiedEpoch: 0 };
    await expect(actions!.restoreCard(token)).resolves.toMatchObject({ status: 'undo-conflict' });
    expect(setup.value.ports.restoreDeviceCard).not.toHaveBeenCalled();
    expect(setup.restoreLibraryCard).not.toHaveBeenCalled();
  });

  it('does not publish a completed old-owner restore after the account switches in flight', async () => {
    const setup = options();
    setup.value.owner = { id: 'owner-a', verifiedEpoch: null };
    let persistenceOptions: Parameters<LearningWorkspaceDependencies['usePersistence']>[0] | undefined;
    const usePersistence: LearningWorkspaceDependencies['usePersistence'] = value => {
      persistenceOptions = value;
      return defaultLearningPersistenceHook(value);
    };
    let finishRestore!: (result: RestoreDeviceCardResult) => void;
    setup.value.ports.restoreDeviceCard = vi.fn(() => new Promise<RestoreDeviceCardResult>(resolve => { finishRestore = resolve; }));
    let actions: LearningWorkspaceActions | null = null;
    function Harness() {
      actions = useLearningWorkspace(setup.value, { usePersistence }).actions;
      return null;
    }
    renderToStaticMarkup(<Harness />);

    const deleted = await actions!.deleteCard(sourceCard.id);
    const token = ('result' in deleted ? deleted.result.undoToken : undefined)!;
    const pending = actions!.restoreCard(token);
    setup.value.owner = { id: 'owner-b', verifiedEpoch: null };
    persistenceOptions!.ownerId = 'owner-b';
    finishRestore({ status: 'restored', card: sourceCard });

    await expect(pending).resolves.toMatchObject({ status: 'stale-owner' });
    expect(setup.restoreLibraryCard).not.toHaveBeenCalled();
    expect(setup.restorePracticeCard).not.toHaveBeenCalled();
    expect(setup.value.ports.mutateCloudStats).not.toHaveBeenCalled();
  });

  it('uses an explicit update source and suppresses stale lifecycle publications', async () => {
    const setup = options();
    const explicit = { ...sourceCard, translation: 'concentrate', revision: 4 };
    setup.value.library.isPatchCurrent = (_cardId, token) => token !== 'stale';
    let actions: LearningWorkspaceActions | null = null;
    function Harness() {
      actions = useLearningWorkspace(setup.value, dependencies).actions;
      return null;
    }
    renderToStaticMarkup(<Harness />);

    await actions!.updateCard(sourceCard.id, { explanation: 'updated' }, {
      source: explicit,
      expectedLifecycle: 'current',
    });
    expect(setup.patchDeviceCards).toHaveBeenCalledWith([
      { card: { ...explicit, explanation: 'updated' }, fields: { explanation: 'updated' } },
    ], 1, 'op-patch');

    const staleOutcome = await actions!.updateCard(sourceCard.id, { explanation: 'ignored' }, {
      source: explicit,
      expectedLifecycle: 'stale',
    });
    expect(setup.patchDeviceCards).toHaveBeenCalledTimes(1);
    expect(staleOutcome).toEqual({ status: 'stale-owner' });
  });

  it('reports a missing-card outcome instead of silently discarding an edit for an unknown card', async () => {
    const setup = options();
    let actions: LearningWorkspaceActions | null = null;
    function Harness() {
      actions = useLearningWorkspace(setup.value, dependencies).actions;
      return null;
    }
    renderToStaticMarkup(<Harness />);

    const outcome = await actions!.updateCard('word-unknown', { explanation: 'updated' });

    expect(outcome).toEqual({ status: 'missing-card' });
    expect(setup.patchDeviceCards).not.toHaveBeenCalled();
  });
});
