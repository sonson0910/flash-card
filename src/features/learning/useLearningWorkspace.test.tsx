import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import type { LearningStateMutation, LearningStateMutationResult } from './learningStateController';
import type { LearningPersistenceHook } from './learningPersistencePort';
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

/** A minimal stand-in for useLearningStatePersistence that echoes the mutation back as committed. */
function createPersistenceStub() {
  const persistCalls: LearningStateMutation[] = [];
  let restoreOverride: ((mutation: LearningStateMutation) => Promise<LearningStateMutationResult>) | null = null;
  let capturedOptions: Parameters<LearningPersistenceHook>[0] | undefined;
  const usePersistence: LearningPersistenceHook = options => {
    capturedOptions = options;
    return {
      ownerId: () => options.ownerId,
      findCard: cardId => options.findCard(cardId),
      persist: async mutation => {
        persistCalls.push(mutation);
        if (mutation.operation === 'restore') {
          const conflict = options.validateRestore(mutation.undoToken);
          if (conflict) {
            return {
              ownerKey: mutation.ownerKey,
              operationId: mutation.operationId,
              publication: mutation.publication,
              restoreFinality: 'conflict',
              restoreConflictReason: conflict,
            };
          }
          if (restoreOverride) return restoreOverride(mutation);
          return {
            ownerKey: mutation.ownerKey,
            operationId: mutation.operationId,
            publication: mutation.publication,
            restoreFinality: 'restored',
          };
        }
        if (mutation.operation === 'delete') {
          return {
            ownerKey: mutation.ownerKey,
            operationId: mutation.operationId,
            publication: mutation.publication,
            deleteReceipt: {
              finality: 'committed',
              ownerId: options.ownerId,
              operationId: mutation.operationId,
              libraryEpoch: mutation.libraryEpoch,
              deletedAt: '2026-08-12T00:00:00.000Z',
            },
          };
        }
        return { ownerKey: mutation.ownerKey, operationId: mutation.operationId, publication: mutation.publication };
      },
    };
  };
  return {
    usePersistence,
    persistCalls,
    setRestoreOverride(handler: (mutation: LearningStateMutation) => Promise<LearningStateMutationResult>) {
      restoreOverride = handler;
    },
    getCapturedOptions() {
      if (!capturedOptions) throw new Error('usePersistence has not been called yet.');
      return capturedOptions;
    },
  };
}

const options = () => {
  let libraryCard: CardData | undefined = sourceCard;
  let practiceCard: CardData | undefined;
  const libraryPatch = vi.fn();
  const practicePatch = vi.fn();
  const restoreLibraryCard = vi.fn((card: CardData) => { libraryCard = card; });
  const restorePracticeCard = vi.fn((card: CardData) => { practiceCard = card; });
  const removeLibraryCard = vi.fn(() => { libraryCard = undefined; });
  const removePracticeCard = vi.fn(() => { practiceCard = undefined; });
  const value: LearningWorkspaceOptions = {
    owner: { id: 'owner-a', verifiedEpoch: 0 },
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
    const stub = createPersistenceStub();
    let actions: LearningWorkspaceActions | null = null;
    function Harness() {
      actions = useLearningWorkspace(setup.value, { usePersistence: stub.usePersistence }).actions;
      return null;
    }
    renderToStaticMarkup(<Harness />);

    await actions!.toggleBookmark(sourceCard.id);

    expect(setup.libraryPatch).toHaveBeenCalledWith(sourceCard.id, { bookmarked: true });
    expect(setup.practicePatch).toHaveBeenCalledWith(sourceCard.id, { bookmarked: true });
    expect(stub.persistCalls).toHaveLength(1);
  });

  it('reviews a bounded daily-pool card through an explicit source and returns a missing-card outcome', async () => {
    const setup = options();
    const stub = createPersistenceStub();
    setup.value.library.findCard = () => undefined;
    let actions: LearningWorkspaceActions | null = null;
    function Harness() {
      actions = useLearningWorkspace(setup.value, { usePersistence: stub.usePersistence }).actions;
      return null;
    }
    renderToStaticMarkup(<Harness />);

    await expect(actions!.reviewCard(sourceCard.id, 'good', 'daily-source', sourceCard))
      .resolves.toMatchObject({ status: 'published' });
    expect(stub.persistCalls[0]).toMatchObject({ operation: 'review', cardId: sourceCard.id, operationId: 'daily-source' });
    await expect(actions!.reviewCard('missing', 'good', 'daily-missing')).resolves.toEqual({ status: 'missing-card' });
  });

  it('publishes compact command aliases to both library and practice bindings', async () => {
    const setup = options();
    const stub = createPersistenceStub();
    let actions: LearningWorkspaceActions | null = null;
    function Harness() {
      actions = useLearningWorkspace(setup.value, { usePersistence: stub.usePersistence }).actions;
      return null;
    }
    renderToStaticMarkup(<Harness />);

    expect(Object.keys(actions!)).toEqual([
      'toggleBookmark', 'assignDeck', 'reviewCard', 'updateCard', 'deleteCard', 'restoreCard', 'clearLibrary',
    ]);
    await actions!.toggleBookmark(sourceCard.id);
    expect(setup.libraryPatch).toHaveBeenCalledWith(sourceCard.id, { bookmarked: true });
    expect(setup.practicePatch).toHaveBeenCalledWith(sourceCard.id, { bookmarked: true });

    await actions!.assignDeck(sourceCard.id, '  IELTS Writing  ');
    expect(setup.libraryPatch).toHaveBeenLastCalledWith(sourceCard.id, { customDeck: 'IELTS Writing' });
    expect(setup.practicePatch).toHaveBeenLastCalledWith(sourceCard.id, { customDeck: 'IELTS Writing' });

    const deleted = await actions!.deleteCard(sourceCard.id);
    expect(setup.removeLibraryCard).toHaveBeenCalledWith(sourceCard.id);
    expect(setup.removePracticeCard).toHaveBeenCalledWith(sourceCard.id);
    expect(deleted).toMatchObject({ status: 'published', result: { undoToken: { card: sourceCard } } });
  });

  it('restores a deleted card with one stable explicit-epoch operation', async () => {
    const setup = options();
    const stub = createPersistenceStub();
    let actions: LearningWorkspaceActions | null = null;
    function Harness() {
      actions = useLearningWorkspace(setup.value, { usePersistence: stub.usePersistence }).actions;
      return null;
    }
    renderToStaticMarkup(<Harness />);

    const deleted = await actions!.deleteCard(sourceCard.id);
    const token = ('result' in deleted ? deleted.result.undoToken : undefined)!;
    expect(token.card).toEqual(sourceCard);
    expect(token.expectedLibraryEpoch).toBe(0);

    const restored = await actions!.restoreCard(token);
    const repeated = await actions!.restoreCard(token);

    expect(restored).toMatchObject({ status: 'published', result: { restoreFinality: 'restored' } });
    expect(repeated).toEqual(restored);
    const restoreCalls = stub.persistCalls.filter(mutation => mutation.operation === 'restore');
    expect(restoreCalls).toHaveLength(1);
    expect(setup.restoreLibraryCard).toHaveBeenCalledOnce();
    expect(setup.restorePracticeCard).toHaveBeenCalledOnce();
  });

  it('does not restore when the owner or verified library epoch changes', async () => {
    const setup = options();
    const stub = createPersistenceStub();
    let actions: LearningWorkspaceActions | null = null;
    function Harness() {
      actions = useLearningWorkspace(setup.value, { usePersistence: stub.usePersistence }).actions;
      return null;
    }
    renderToStaticMarkup(<Harness />);

    const deleted = await actions!.deleteCard(sourceCard.id);
    const token = ('result' in deleted ? deleted.result.undoToken : undefined)!;
    setup.value.owner = { id: 'other-owner', verifiedEpoch: 0 };
    await expect(actions!.restoreCard(token)).resolves.toMatchObject({ status: 'undo-conflict' });
    expect(setup.restoreLibraryCard).not.toHaveBeenCalled();
  });

  it('does not publish a completed old-owner restore after the account switches in flight', async () => {
    const setup = options();
    setup.value.owner = { id: 'owner-a', verifiedEpoch: 0 };
    const stub = createPersistenceStub();
    let finishRestore!: () => void;
    stub.setRestoreOverride(mutation => new Promise(resolve => {
      finishRestore = () => resolve({
        ownerKey: mutation.ownerKey, operationId: mutation.operationId,
        publication: mutation.publication, restoreFinality: 'restored',
      });
    }));
    let actions: LearningWorkspaceActions | null = null;
    function Harness() {
      actions = useLearningWorkspace(setup.value, { usePersistence: stub.usePersistence }).actions;
      return null;
    }
    renderToStaticMarkup(<Harness />);

    const deleted = await actions!.deleteCard(sourceCard.id);
    const token = ('result' in deleted ? deleted.result.undoToken : undefined)!;
    const pending = actions!.restoreCard(token);
    stub.getCapturedOptions().ownerId = 'owner-b';
    finishRestore();

    await expect(pending).resolves.toMatchObject({ status: 'stale-owner' });
    expect(setup.restoreLibraryCard).not.toHaveBeenCalled();
    expect(setup.restorePracticeCard).not.toHaveBeenCalled();
    expect(setup.value.ports.mutateCloudStats).not.toHaveBeenCalled();
  });

  it('uses an explicit update source and suppresses stale lifecycle publications', async () => {
    const setup = options();
    const stub = createPersistenceStub();
    const explicit = { ...sourceCard, translation: 'concentrate', revision: 4 };
    setup.value.library.isPatchCurrent = (_cardId, token) => token !== 'stale';
    let actions: LearningWorkspaceActions | null = null;
    function Harness() {
      actions = useLearningWorkspace(setup.value, { usePersistence: stub.usePersistence }).actions;
      return null;
    }
    renderToStaticMarkup(<Harness />);

    await actions!.updateCard(sourceCard.id, { explanation: 'updated' }, {
      source: explicit,
      expectedLifecycle: 'current',
    });
    expect(stub.persistCalls).toHaveLength(1);
    expect(stub.persistCalls[0]).toMatchObject({ operation: 'patch', fields: { explanation: 'updated' } });

    const staleOutcome = await actions!.updateCard(sourceCard.id, { explanation: 'ignored' }, {
      source: explicit,
      expectedLifecycle: 'stale',
    });
    expect(stub.persistCalls).toHaveLength(1);
    expect(staleOutcome).toEqual({ status: 'stale-owner' });
  });

  it('reports a missing-card outcome instead of silently discarding an edit for an unknown card', async () => {
    const setup = options();
    const stub = createPersistenceStub();
    let actions: LearningWorkspaceActions | null = null;
    function Harness() {
      actions = useLearningWorkspace(setup.value, { usePersistence: stub.usePersistence }).actions;
      return null;
    }
    renderToStaticMarkup(<Harness />);

    const outcome = await actions!.updateCard('word-unknown', { explanation: 'updated' });

    expect(outcome).toEqual({ status: 'missing-card' });
    expect(stub.persistCalls).toHaveLength(0);
  });
});
