import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeviceMutationAccounting, DevicePendingOperation } from '../../lib/deviceSync';
import type { CardData } from '../../types/card';
import {
  useLearningWorkspace,
  type LearningWorkspaceActions,
  type LearningWorkspaceDependencies,
  type LearningWorkspaceOptions,
} from './useLearningWorkspace';
import { defaultLearningPersistenceHook } from './learningWorkspacePersistenceAdapter';

const dependencies: LearningWorkspaceDependencies = { usePersistence: defaultLearningPersistenceHook };

const installMinimalReactDom = () => {
  const documentLike: Record<string, unknown> = {
    nodeType: 9,
    activeElement: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    defaultView: globalThis,
  };
  const container = {
    nodeType: 1,
    ownerDocument: documentLike,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    nodeName: 'DIV',
    tagName: 'DIV',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
  };
  documentLike.documentElement = container;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', documentLike);
  vi.stubGlobal('HTMLIFrameElement', class HTMLIFrameElement {});
  vi.stubGlobal('HTMLElement', class HTMLElement {});
  vi.stubGlobal('Node', class Node {});
  return container as unknown as Element;
};

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
  const patchDeviceCards = vi.fn(async (
    changes: readonly { card: CardData; fields: Partial<CardData> }[],
    _nextTotal?: number,
    operationId?: string,
    accounting?: DeviceMutationAccounting,
  ): Promise<DevicePendingOperation[]> => changes.map(change => ({
    type: 'patch',
    operation: 'patch',
    opId: operationId,
    cardId: change.card.id,
    fields: change.fields,
    fieldMask: Object.keys(change.fields) as Array<keyof CardData>,
    ...(operationId ? {
      logicalOperations: [{
        id: operationId,
        kind: 'patch' as const,
        ...(accounting ? { accounting } : {}),
      }],
    } : {}),
    baseRevision: change.card.revision ?? 0,
    libraryEpoch: change.card.libraryEpoch ?? 0,
    updatedAt: '2026-08-16T00:00:00.000Z',
  })));
  const removeDeviceCard = vi.fn(async (cardId: string): Promise<DevicePendingOperation[]> => [{
    type: 'delete',
    operation: 'delete',
    opId: `delete-${cardId}`,
    cardId,
    updatedAt: '2026-08-16T00:00:00.000Z',
  }]);
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
      flushDeviceCards: async () => 'applied',
      acknowledgeDevicePending: async () => undefined,
      acceptVerifiedEpoch: vi.fn(),
      mutateCloudStats: vi.fn(),
      resetCloudState: vi.fn(),
      resetCloudPage: vi.fn(),
      refreshCloud: vi.fn(),
      cloudAvailabilityChanged: vi.fn(),
      mutationPendingChanged: vi.fn(),
      reportError: vi.fn(),
      addXp: vi.fn(() => true),
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
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

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

  it('receives persistence through an injected hook without changing facade actions', async () => {
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

  it('reviews a bounded daily-pool card through an explicit source and rejects a missing source', async () => {
    const setup = options();
    setup.value.library.findCard = () => undefined;
    let actions: LearningWorkspaceActions | null = null;
    function Harness() {
      actions = useLearningWorkspace(setup.value, dependencies).actions;
      return null;
    }
    renderToStaticMarkup(<Harness />);

    await expect(actions!.reviewCard(sourceCard.id, 'good', 'daily-source', sourceCard)).resolves.toBeUndefined();
    expect(setup.patchDeviceCards).toHaveBeenCalledWith(
      expect.any(Array),
      1,
      'daily-source',
      { version: 1, xp: { delta: 2 } },
    );
    await expect(actions!.reviewCard('missing', 'good', 'daily-missing')).rejects.toThrow('missing-card');
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
      'toggleBookmark', 'assignDeck', 'reviewCard', 'updateCard', 'deleteCard', 'clearLibrary',
    ]);
    await actions!.toggleBookmark(sourceCard.id);
    expect(setup.patchDeviceCards).toHaveBeenCalledWith([
      { card: { ...sourceCard, bookmarked: true }, fields: { bookmarked: true } },
    ], 1, 'op-bookmark', undefined);
    expect(setup.libraryPatch).toHaveBeenCalledWith(sourceCard.id, { bookmarked: true });
    expect(setup.practicePatch).toHaveBeenCalledWith(sourceCard.id, { bookmarked: true });

    await actions!.assignDeck(sourceCard.id, '  IELTS Writing  ');
    expect(setup.libraryPatch).toHaveBeenLastCalledWith(sourceCard.id, { customDeck: 'IELTS Writing' });
    expect(setup.practicePatch).toHaveBeenLastCalledWith(sourceCard.id, { customDeck: 'IELTS Writing' });

    await actions!.deleteCard(sourceCard.id);
    expect(setup.removeDeviceCard).toHaveBeenCalledWith(sourceCard.id, {
      libraryEpoch: 0,
      baseRevisions: { [sourceCard.id]: 1 },
      logicalOperationId: 'op-delete',
    });
    expect(setup.removeLibraryCard).toHaveBeenCalledWith(sourceCard.id);
    expect(setup.removePracticeCard).toHaveBeenCalledWith(sourceCard.id);
  });

  it('keeps an in-flight owner mutation bound to the ports that staged it', async () => {
    const ownerA = options();
    const ownerB = options();
    ownerA.value.owner = { id: 'owner-a', verifiedEpoch: 1 };
    ownerB.value.owner = { id: 'owner-b', verifiedEpoch: 1 };
    let releaseStaging!: () => void;
    ownerA.value.ports.patchDeviceCards = vi.fn(() => new Promise<DevicePendingOperation[]>(resolve => {
      releaseStaging = () => resolve([{
        type: 'patch',
        operation: 'patch',
        opId: 'owner-a-review',
        cardId: sourceCard.id,
        fields: { difficulty: 'good' },
        fieldMask: ['difficulty'],
        baseRevision: 1,
        libraryEpoch: 1,
        updatedAt: '2026-08-16T00:00:00.000Z',
        ownerUserId: 'owner-a',
      }]);
    }));
    const flushOwnerA = vi.fn(async () => 'applied' as const);
    const flushOwnerB = vi.fn(async () => 'applied' as const);
    ownerA.value.ports.flushDeviceCards = flushOwnerA;
    ownerB.value.ports.flushDeviceCards = flushOwnerB;
    const usePersistence: LearningWorkspaceDependencies['usePersistence'] = persistenceOptions => ({
      findCard: persistenceOptions.findCard,
      persist: async mutation => {
        if ('cardId' in mutation) {
          const card = persistenceOptions.findCard(mutation.cardId);
          if (!card) throw new Error('missing-card');
          const fields = mutation.publication.kind === 'patch' ? mutation.publication.fields : {};
          await persistenceOptions.patchDeviceCards(
            [{ card: { ...card, ...fields }, fields }],
            persistenceOptions.knownLibraryTotal,
            mutation.operationId,
          );
          await persistenceOptions.flushDeviceCards(mutation.operationId);
        }
        return {
          ownerKey: mutation.ownerKey,
          operationId: mutation.operationId,
          publication: mutation.publication,
        };
      },
    });
    let actions: LearningWorkspaceActions | null = null;
    function Harness({ value }: { value: LearningWorkspaceOptions }) {
      actions = useLearningWorkspace(value, { usePersistence }).actions;
      return null;
    }

    const root = createRoot(installMinimalReactDom());
    try {
      await act(async () => { root.render(<Harness value={ownerA.value} />); });
      let review!: Promise<void>;
      act(() => { review = actions!.reviewCard(sourceCard.id, 'good', 'owner-a-review'); });
      await act(async () => { await Promise.resolve(); });
      expect(ownerA.value.ports.patchDeviceCards).toHaveBeenCalledOnce();

      await act(async () => { root.render(<Harness value={ownerB.value} />); });
      await act(async () => {
        releaseStaging();
        await expect(review).rejects.toThrow('stale-owner');
      });

      expect(flushOwnerA).toHaveBeenCalledWith('owner-a-review');
      expect(flushOwnerB).not.toHaveBeenCalled();
      expect(ownerB.patchDeviceCards).not.toHaveBeenCalled();
    } finally {
      await act(async () => { root.unmount(); });
    }
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

    await expect(actions!.deleteCard(sourceCard.id)).resolves.toBeUndefined();

    expect(setup.removeDeviceCard).toHaveBeenCalledOnce();
    expect(setup.removeLibraryCard).toHaveBeenCalledWith(sourceCard.id);
    expect(setup.removePracticeCard).toHaveBeenCalledWith(sourceCard.id);
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
    ], 1, 'op-patch', undefined);

    await actions!.updateCard(sourceCard.id, { explanation: 'ignored' }, {
      source: explicit,
      expectedLifecycle: 'stale',
    });
    expect(setup.patchDeviceCards).toHaveBeenCalledTimes(1);
  });
});
