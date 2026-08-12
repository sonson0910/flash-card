import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardQueryState } from '../../lib/cardQuery';
import { CardMutationPreconditionError } from '../../lib/cardRepository';
import {
  DeviceBackupOwnerConflictError,
  type DevicePendingOperation,
} from '../../lib/deviceSync';
import type { CardData } from '../../types/card';
import {
  publishVerifiedEpochIfOwnerCurrent,
  useLibraryDeviceSync,
  type LibraryDeviceSyncEvents,
} from './useLibraryDeviceSync';

const mocks = vi.hoisted(() => ({
  acknowledgeDevicePending: vi.fn(),
  acquireDevicePendingFlush: vi.fn(),
  deleteDeviceCardBackupIfNotNewerThan: vi.fn(),
  loadDeviceCards: vi.fn(),
  loadDevicePending: vi.fn(),
  mergeDeviceCards: vi.fn(),
  mergeDeviceCardsStrict: vi.fn(),
  queueDeviceDeletes: vi.fn(),
  queueDevicePatches: vi.fn(),
  queueDeviceUpserts: vi.fn(),
  releaseDevicePendingFlush: vi.fn(),
  subscribeToDeviceCards: vi.fn(() => vi.fn()),
  beginCardMirrorSync: vi.fn(),
  deleteMirroredCard: vi.fn(),
  deleteMirroredCardIfNotNewerThan: vi.fn(),
  deleteMirroredCardIfOlderThan: vi.fn(),
  finishCardMirrorSync: vi.fn(),
  getCardMirrorStatus: vi.fn(),
  invalidateCardMirrorGeneration: vi.fn(),
  patchMirroredCardBatch: vi.fn(),
  queryMirroredCardPage: vi.fn(),
  upsertMirroredCardBatch: vi.fn(),
  upsertMirroredCardIfNotOlderThan: vi.fn(),
  applyCardPatchIfCurrent: vi.fn(),
  createCardIfAbsent: vi.fn(),
  deleteCardWithTombstone: vi.fn(),
  findCardByNormalizedWord: vi.fn(),
  getLibraryEpoch: vi.fn(),
  streamAllCardsInBatches: vi.fn(),
  removeLocalValue: vi.fn(),
  writeLocalValue: vi.fn(),
}));

vi.mock('../../lib/deviceSync', async () => {
  const actual = await vi.importActual<typeof import('../../lib/deviceSync')>('../../lib/deviceSync');
  return {
    ...actual,
    acknowledgeDevicePending: mocks.acknowledgeDevicePending,
    acquireDevicePendingFlush: mocks.acquireDevicePendingFlush,
    deleteDeviceCardBackupIfNotNewerThan: mocks.deleteDeviceCardBackupIfNotNewerThan,
    loadDeviceCards: mocks.loadDeviceCards,
    loadDevicePending: mocks.loadDevicePending,
    mergeDeviceCards: mocks.mergeDeviceCards,
    mergeDeviceCardsStrict: mocks.mergeDeviceCardsStrict,
    queueDeviceDeletes: mocks.queueDeviceDeletes,
    queueDevicePatches: mocks.queueDevicePatches,
    queueDeviceUpserts: mocks.queueDeviceUpserts,
    releaseDevicePendingFlush: mocks.releaseDevicePendingFlush,
    subscribeToDeviceCards: mocks.subscribeToDeviceCards,
  };
});

vi.mock('../../lib/cardMirror', async () => {
  const actual = await vi.importActual<typeof import('../../lib/cardMirror')>('../../lib/cardMirror');
  return {
    ...actual,
    beginCardMirrorSync: mocks.beginCardMirrorSync,
    deleteMirroredCard: mocks.deleteMirroredCard,
    deleteMirroredCardIfNotNewerThan: mocks.deleteMirroredCardIfNotNewerThan,
    deleteMirroredCardIfOlderThan: mocks.deleteMirroredCardIfOlderThan,
    finishCardMirrorSync: mocks.finishCardMirrorSync,
    getCardMirrorStatus: mocks.getCardMirrorStatus,
    invalidateCardMirrorGeneration: mocks.invalidateCardMirrorGeneration,
    patchMirroredCardBatch: mocks.patchMirroredCardBatch,
    queryMirroredCardPage: mocks.queryMirroredCardPage,
    upsertMirroredCardBatch: mocks.upsertMirroredCardBatch,
    upsertMirroredCardIfNotOlderThan: mocks.upsertMirroredCardIfNotOlderThan,
  };
});

vi.mock('../../lib/cardRepository', async () => {
  const actual = await vi.importActual<typeof import('../../lib/cardRepository')>('../../lib/cardRepository');
  return {
    ...actual,
    applyCardPatchIfCurrent: mocks.applyCardPatchIfCurrent,
    createCardIfAbsent: mocks.createCardIfAbsent,
    deleteCardWithTombstone: mocks.deleteCardWithTombstone,
    findCardByNormalizedWord: mocks.findCardByNormalizedWord,
    getLibraryEpoch: mocks.getLibraryEpoch,
    streamAllCardsInBatches: mocks.streamAllCardsInBatches,
  };
});

vi.mock('../../lib/firebase', () => ({
  db: { kind: 'database' },
  isFirebaseConfigured: true,
}));

vi.mock('../library/libraryStorage', async () => {
  const actual = await vi.importActual<typeof import('../library/libraryStorage')>('../library/libraryStorage');
  return {
    ...actual,
    isCloudBackoffActive: () => false,
    isQuotaError: () => false,
    removeLocalValue: mocks.removeLocalValue,
    writeLocalValue: mocks.writeLocalValue,
  };
});

const query: CardQueryState = {
  category: null,
  customDeck: null,
  difficulty: null,
  partOfSpeech: null,
  bookmarkedOnly: false,
  createdDate: null,
  wordPrefix: '',
};

const card = (id: string, libraryEpoch: number): CardData => ({
  id,
  word: id,
  normalizedWord: id,
  translation: `translation ${id}`,
  explanation: '',
  phonetic: '',
  emoji: '📝',
  category: 'Test',
  audioUrl: null,
  imageUrl: null,
  revision: 1,
  libraryEpoch,
});

const pendingDelete = (
  id: string,
  libraryEpoch: number,
): Extract<DevicePendingOperation, { type: 'delete' }> => ({
  type: 'delete',
  operation: 'delete',
  opId: `delete-${id}`,
  cardId: id,
  fieldMask: [],
  baseRevision: 1,
  libraryEpoch,
  updatedAt: `2026-08-09T00:00:0${libraryEpoch}.000Z`,
  ownerUserId: 'user-a',
});

const pendingUpsert = (
  candidate: CardData,
): Extract<DevicePendingOperation, { type: 'upsert' }> => ({
  type: 'upsert',
  operation: 'create',
  opId: `create-${candidate.id}`,
  card: candidate,
  fieldMask: [],
  baseRevision: candidate.revision ?? 0,
  libraryEpoch: candidate.libraryEpoch ?? 0,
  updatedAt: '2026-08-09T00:00:05.000Z',
  ownerUserId: 'user-a',
});

const pendingPatch = (id: string, libraryEpoch: number): DevicePendingOperation => ({
  type: 'patch',
  operation: 'patch',
  opId: `patch-${id}`,
  cardId: id,
  fields: { bookmarked: true },
  fieldMask: ['bookmarked'],
  baseRevision: 1,
  libraryEpoch,
  updatedAt: `2026-08-09T00:00:0${libraryEpoch}.000Z`,
  ownerUserId: 'user-a',
});

const createEvents = (): LibraryDeviceSyncEvents => ({
  advanceCard: vi.fn(),
  removeCard: vi.fn(),
  findPracticeCard: vi.fn(),
  advancePracticeCard: vi.fn(),
  removePracticeCard: vi.fn(),
  resetPage: vi.fn(),
  refreshCloud: vi.fn(),
  setCloudAvailable: vi.fn(),
  setCloudTotal: vi.fn(),
  publishDeviceCards: vi.fn(),
  publishDevicePage: vi.fn(),
  previousPage: vi.fn(),
  reportError: vi.fn(),
  notify: vi.fn(),
  verifyEpoch: vi.fn(),
});

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
  vi.stubGlobal('addEventListener', vi.fn());
  vi.stubGlobal('removeEventListener', vi.fn());
  return container as unknown as Element;
};

function createHarness({
  epoch = { userId: 'user-a', value: 2 },
  isBrowserOnline = false,
}: {
  epoch?: { userId: string; value: number } | null;
  isBrowserOnline?: boolean;
} = {}) {
  const events = createEvents();
  let sync: ReturnType<typeof useLibraryDeviceSync> | undefined;

  function Harness() {
    sync = useLibraryDeviceSync({
      owner: { uid: 'user-a' },
      epoch,
      cards: [],
      knownLibraryTotal: 0,
      cloudTotal: 0,
      cloudStatsTotal: 0,
      cardsPerPage: 9,
      isBrowserOnline,
      cloudReadUnavailable: false,
      query,
      queryKey: 'all',
      currentPage: 1,
      getPromotedCards: () => [],
      events,
    });
    return null;
  }

  renderToStaticMarkup(<Harness />);
  if (!sync) throw new Error('Device sync hook did not initialize.');
  return { sync, events };
}

describe('useLibraryDeviceSync mirror cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acknowledgeDevicePending.mockResolvedValue(undefined);
    mocks.acquireDevicePendingFlush.mockResolvedValue(true);
    mocks.deleteDeviceCardBackupIfNotNewerThan.mockResolvedValue(true);
    mocks.loadDeviceCards.mockResolvedValue(null);
    mocks.mergeDeviceCards.mockResolvedValue(undefined);
    mocks.mergeDeviceCardsStrict.mockResolvedValue(undefined);
    mocks.releaseDevicePendingFlush.mockResolvedValue(undefined);
    mocks.deleteMirroredCard.mockResolvedValue(undefined);
    mocks.deleteMirroredCardIfNotNewerThan.mockResolvedValue(true);
    mocks.deleteMirroredCardIfOlderThan.mockResolvedValue(true);
    mocks.getCardMirrorStatus.mockResolvedValue(null);
    mocks.invalidateCardMirrorGeneration.mockResolvedValue(true);
    mocks.beginCardMirrorSync.mockResolvedValue(7);
    mocks.finishCardMirrorSync.mockResolvedValue(true);
    mocks.getLibraryEpoch.mockResolvedValue(2);
    mocks.streamAllCardsInBatches.mockResolvedValue(0);
    mocks.upsertMirroredCardIfNotOlderThan.mockResolvedValue(true);
    mocks.deleteCardWithTombstone.mockResolvedValue({
      deleted: true,
      tombstone: {
        cardId: 'delete-card',
        opId: 'delete-delete-card',
        libraryEpoch: 2,
        revision: 2,
        deletedAt: '2026-08-09T00:00:05.000Z',
      },
    });
  });

  it('keeps a cloud-confirmed delete queued when mirror deletion fails', async () => {
    const deletion = pendingDelete('delete-card', 2);
    mocks.loadDevicePending.mockResolvedValue([deletion]);
    mocks.deleteMirroredCardIfNotNewerThan.mockRejectedValue(new Error('IndexedDB delete failed'));
    const { sync } = createHarness();

    await sync.flush(true, { userId: 'user-a', value: 2 });

    expect(mocks.deleteCardWithTombstone).toHaveBeenCalled();
    expect(mocks.deleteDeviceCardBackupIfNotNewerThan).toHaveBeenCalledWith(
      'user-a',
      'delete-card',
      { libraryEpoch: 2, revision: 1 },
    );
    expect(mocks.deleteMirroredCardIfNotNewerThan).toHaveBeenCalledWith(
      'user-a',
      'delete-card',
      { libraryEpoch: 2, revision: 1 },
    );
    expect(mocks.acknowledgeDevicePending).not.toHaveBeenCalled();
  });

  it('queues an offline delete for epoch binding while removing the known local card version', async () => {
    const queued = pendingDelete('offline-delete', -1);
    mocks.queueDeviceDeletes.mockResolvedValue([queued]);
    const { sync } = createHarness({ epoch: null });

    await expect(sync.removeCard('offline-delete', {
      libraryEpoch: 2,
      baseRevisions: { 'offline-delete': 4 },
    })).resolves.toEqual([queued]);

    expect(mocks.queueDeviceDeletes).toHaveBeenCalledWith(
      ['offline-delete'],
      'user-a',
      { libraryEpoch: -1, baseRevisions: { 'offline-delete': 4 } },
    );
    expect(mocks.deleteDeviceCardBackupIfNotNewerThan).toHaveBeenCalledWith(
      'user-a',
      'offline-delete',
      { libraryEpoch: 2, revision: 4 },
    );
    expect(mocks.deleteMirroredCardIfNotNewerThan).toHaveBeenCalledWith(
      'user-a',
      'offline-delete',
      { libraryEpoch: 2, revision: 4 },
    );
  });

  it('keeps stale-generation cleanup queued when mirror deletion fails', async () => {
    const staleDeletion = pendingDelete('stale-card', 1);
    mocks.loadDevicePending.mockResolvedValue([staleDeletion]);
    mocks.deleteMirroredCardIfOlderThan.mockRejectedValue(new Error('IndexedDB delete failed'));
    const { sync } = createHarness();

    await sync.flush(true, { userId: 'user-a', value: 2 });

    expect(mocks.deleteMirroredCardIfOlderThan).toHaveBeenCalledWith('user-a', 'stale-card', 2);
    expect(mocks.deleteDeviceCardBackupIfNotNewerThan).toHaveBeenCalledWith(
      'user-a',
      'stale-card',
      { libraryEpoch: 1, revision: Number.MAX_SAFE_INTEGER },
    );
    expect(mocks.deleteMirroredCard).not.toHaveBeenCalled();
    expect(mocks.acknowledgeDevicePending).not.toHaveBeenCalled();
  });

  it('replaces a word-duplicate candidate in both local stores before acknowledging it', async () => {
    const candidate = {
      ...card('candidate-id', 2),
      word: 'shared word',
      normalizedWord: 'shared word',
      revision: 3,
    };
    const existing = {
      ...card('authoritative-id', 2),
      word: 'shared word',
      normalizedWord: 'shared word',
      revision: 8,
    };
    const operation = pendingUpsert(candidate);
    mocks.loadDevicePending.mockResolvedValue([operation]);
    mocks.findCardByNormalizedWord.mockResolvedValue(existing);
    const { sync } = createHarness();

    await sync.flush(true, { userId: 'user-a', value: 2 });

    expect(mocks.deleteDeviceCardBackupIfNotNewerThan).toHaveBeenCalledWith(
      'user-a',
      candidate.id,
      { libraryEpoch: 2, revision: 3 },
    );
    expect(mocks.deleteMirroredCardIfNotNewerThan).toHaveBeenCalledWith(
      'user-a',
      candidate.id,
      { libraryEpoch: 2, revision: 3 },
    );
    expect(mocks.mergeDeviceCardsStrict).toHaveBeenCalledWith([existing], 1, 'user-a');
    expect(mocks.upsertMirroredCardIfNotOlderThan).toHaveBeenCalledWith('user-a', existing);
    expect(mocks.deleteMirroredCard).not.toHaveBeenCalled();
    expect(mocks.acknowledgeDevicePending).toHaveBeenCalledWith([operation]);
    expect(mocks.mergeDeviceCardsStrict.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteDeviceCardBackupIfNotNewerThan.mock.invocationCallOrder[0],
    );
    expect(mocks.upsertMirroredCardIfNotOlderThan.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteDeviceCardBackupIfNotNewerThan.mock.invocationCallOrder[0],
    );
    expect(mocks.mergeDeviceCardsStrict.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.acknowledgeDevicePending.mock.invocationCallOrder[0],
    );
    expect(mocks.deleteMirroredCardIfNotNewerThan.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.acknowledgeDevicePending.mock.invocationCallOrder[0],
    );
  });

  it('reconciles the device backup when a create race returns another card id', async () => {
    const candidate = {
      ...card('candidate-id', 2),
      word: 'raced word',
      normalizedWord: 'raced word',
      revision: 4,
    };
    const existing = {
      ...card('winner-id', 2),
      word: 'raced word',
      normalizedWord: 'raced word',
      revision: 6,
    };
    const operation = pendingUpsert(candidate);
    mocks.loadDevicePending.mockResolvedValue([operation]);
    mocks.findCardByNormalizedWord.mockResolvedValue(null);
    mocks.createCardIfAbsent.mockResolvedValue({ created: false, card: existing });
    const { sync } = createHarness();

    await sync.flush(true, { userId: 'user-a', value: 2 });

    expect(mocks.deleteDeviceCardBackupIfNotNewerThan).toHaveBeenCalledWith(
      'user-a',
      candidate.id,
      { libraryEpoch: 2, revision: 4 },
    );
    expect(mocks.deleteMirroredCardIfNotNewerThan).toHaveBeenCalledWith(
      'user-a',
      candidate.id,
      { libraryEpoch: 2, revision: 4 },
    );
    expect(mocks.mergeDeviceCardsStrict).toHaveBeenCalledWith([existing], 1, 'user-a');
    expect(mocks.upsertMirroredCardIfNotOlderThan).toHaveBeenCalledWith('user-a', existing);
    expect(mocks.acknowledgeDevicePending).toHaveBeenCalledWith([operation]);
  });

  it('treats preserving a newer same-id local card as a successful reconciliation', async () => {
    const candidate = {
      ...card('same-id', 2),
      word: 'same word',
      normalizedWord: 'same word',
      revision: 3,
    };
    const authoritative = { ...candidate, translation: 'cloud value', revision: 5 };
    const operation = pendingUpsert(candidate);
    mocks.loadDevicePending.mockResolvedValue([operation]);
    mocks.findCardByNormalizedWord.mockResolvedValue(null);
    mocks.createCardIfAbsent.mockResolvedValue({ created: false, card: authoritative });
    mocks.upsertMirroredCardIfNotOlderThan.mockResolvedValue(false);
    const { sync } = createHarness();

    await sync.flush(true, { userId: 'user-a', value: 2 });

    expect(mocks.deleteDeviceCardBackupIfNotNewerThan).not.toHaveBeenCalled();
    expect(mocks.deleteMirroredCardIfNotNewerThan).not.toHaveBeenCalled();
    expect(mocks.mergeDeviceCardsStrict).toHaveBeenCalledWith([authoritative], 1, 'user-a');
    expect(mocks.upsertMirroredCardIfNotOlderThan).toHaveBeenCalledWith(
      'user-a',
      authoritative,
    );
    expect(mocks.acknowledgeDevicePending).toHaveBeenCalledWith([operation]);
  });

  it('keeps a duplicate operation queued when strict authoritative backup merge fails', async () => {
    const candidate = {
      ...card('candidate-id', 2),
      word: 'shared word',
      normalizedWord: 'shared word',
      revision: 3,
    };
    const operation = pendingUpsert(candidate);
    mocks.loadDevicePending.mockResolvedValue([operation]);
    mocks.findCardByNormalizedWord.mockResolvedValue({
      ...card('authoritative-id', 2),
      word: candidate.word,
      normalizedWord: candidate.normalizedWord,
    });
    mocks.mergeDeviceCardsStrict.mockRejectedValue(new Error('Device merge failed'));
    const { sync } = createHarness();

    await sync.flush(true, { userId: 'user-a', value: 2 });

    expect(mocks.upsertMirroredCardIfNotOlderThan).not.toHaveBeenCalled();
    expect(mocks.deleteDeviceCardBackupIfNotNewerThan).not.toHaveBeenCalled();
    expect(mocks.acknowledgeDevicePending).not.toHaveBeenCalled();
  });

  it('acknowledges a cloud-confirmed duplicate when the shared backup belongs to another owner', async () => {
    const candidate = {
      ...card('candidate-id', 2),
      word: 'shared word',
      normalizedWord: 'shared word',
      revision: 3,
    };
    const operation = pendingUpsert(candidate);
    const authoritative = {
      ...card('authoritative-id', 2),
      word: candidate.word,
      normalizedWord: candidate.normalizedWord,
    };
    mocks.loadDevicePending.mockResolvedValue([operation]);
    mocks.findCardByNormalizedWord.mockResolvedValue(authoritative);
    mocks.mergeDeviceCardsStrict.mockRejectedValue(new DeviceBackupOwnerConflictError());
    const { sync } = createHarness();

    await sync.flush(true, { userId: 'user-a', value: 2 });

    expect(mocks.upsertMirroredCardIfNotOlderThan).toHaveBeenCalledWith(
      'user-a',
      authoritative,
    );
    expect(mocks.acknowledgeDevicePending).toHaveBeenCalledWith([operation]);
  });

  it('drops a stale create superseded by a tombstone without blocking later creates', async () => {
    const stale = pendingUpsert(card('stale-deleted-create', 2));
    const current = pendingUpsert(card('current-create', 2));
    mocks.loadDevicePending.mockResolvedValue([stale, current]);
    mocks.findCardByNormalizedWord.mockResolvedValue(null);
    mocks.createCardIfAbsent
      .mockRejectedValueOnce(new CardMutationPreconditionError('deleted'))
      .mockResolvedValueOnce({ created: true, card: current.card });
    const { sync, events } = createHarness();

    await sync.flush(true, { userId: 'user-a', value: 2 });

    expect(mocks.createCardIfAbsent).toHaveBeenCalledTimes(2);
    expect(mocks.createCardIfAbsent).toHaveBeenNthCalledWith(
      1,
      { kind: 'database' },
      'user-a',
      stale.card,
      expect.objectContaining({ operationCreatedAt: stale.updatedAt }),
    );
    expect(mocks.deleteDeviceCardBackupIfNotNewerThan).toHaveBeenCalledWith(
      'user-a',
      stale.card.id,
      { libraryEpoch: 2, revision: stale.baseRevision },
    );
    expect(mocks.deleteMirroredCardIfNotNewerThan).toHaveBeenCalledWith(
      'user-a',
      stale.card.id,
      { libraryEpoch: 2, revision: stale.baseRevision },
    );
    expect(events.removeCard).toHaveBeenCalledWith(stale.card.id);
    expect(events.removePracticeCard).toHaveBeenCalledWith(stale.card.id);
    expect(mocks.acknowledgeDevicePending).toHaveBeenCalledWith([stale, current]);
  });

  it('publishes the current cloud epoch after a stale create and never rebinds the old operation', async () => {
    const operation = pendingUpsert(card('stale-create', 2));
    mocks.loadDevicePending.mockResolvedValue([operation]);
    mocks.findCardByNormalizedWord.mockResolvedValue(null);
    mocks.createCardIfAbsent.mockRejectedValue(
      new CardMutationPreconditionError('stale-library-epoch'),
    );
    mocks.getLibraryEpoch.mockResolvedValue(3);
    const { sync, events } = createHarness();

    await sync.flush(true, { userId: 'user-a', value: 2 });
    await sync.flush(true, { userId: 'user-a', value: 3 });

    expect(events.verifyEpoch).toHaveBeenCalledWith({ userId: 'user-a', value: 3 });
    expect(mocks.createCardIfAbsent).toHaveBeenCalledTimes(1);
    expect(mocks.acknowledgeDevicePending).toHaveBeenCalledWith([operation]);
  });

  it('publishes the current cloud epoch before acknowledging a stale patch', async () => {
    const operation = pendingPatch('stale-patch', 2);
    mocks.loadDevicePending.mockResolvedValue([operation]);
    mocks.applyCardPatchIfCurrent.mockResolvedValue({
      applied: false,
      reason: 'stale-library-epoch',
    });
    mocks.getLibraryEpoch.mockResolvedValue(3);
    const { sync, events } = createHarness();

    await sync.flush(true, { userId: 'user-a', value: 2 });

    expect(events.verifyEpoch).toHaveBeenCalledWith({ userId: 'user-a', value: 3 });
    expect(mocks.acknowledgeDevicePending).toHaveBeenCalledWith([operation]);
  });

  it('publishes the current cloud epoch before acknowledging a stale delete', async () => {
    const operation = pendingDelete('stale-delete', 2);
    mocks.loadDevicePending.mockResolvedValue([operation]);
    mocks.deleteCardWithTombstone.mockResolvedValue({
      deleted: false,
      reason: 'stale-library-epoch',
    });
    mocks.getLibraryEpoch.mockResolvedValue(3);
    const { sync, events } = createHarness();

    await sync.flush(true, { userId: 'user-a', value: 2 });

    expect(events.verifyEpoch).toHaveBeenCalledWith({ userId: 'user-a', value: 3 });
    expect(mocks.acknowledgeDevicePending).toHaveBeenCalledWith([operation]);
  });

  it('verifies the server epoch on every manual retry even when the rendered owner matches', async () => {
    const candidate = card('manual-retry-create', 3);
    const operation = pendingUpsert(candidate);
    mocks.loadDevicePending.mockResolvedValue([operation]);
    mocks.getLibraryEpoch.mockResolvedValue(3);
    mocks.findCardByNormalizedWord.mockResolvedValue(null);
    mocks.createCardIfAbsent.mockResolvedValue({ created: true, card: candidate });
    const { sync, events } = createHarness();

    await sync.retry();

    expect(events.verifyEpoch).toHaveBeenCalledWith({ userId: 'user-a', value: 3 });
    expect(mocks.createCardIfAbsent).toHaveBeenCalledWith(
      { kind: 'database' },
      'user-a',
      candidate,
      expect.objectContaining({ libraryEpoch: 3 }),
    );
  });

  it('recovers the automatic queue when the initial identity epoch is temporarily unverified', async () => {
    const candidate = card('automatic-epoch-recovery', 0);
    const operation: Extract<DevicePendingOperation, { type: 'upsert' }> = {
      ...pendingUpsert(candidate),
      libraryEpoch: -1,
    };
    mocks.loadDevicePending.mockResolvedValue([operation]);
    mocks.getLibraryEpoch.mockResolvedValue(2);
    mocks.findCardByNormalizedWord.mockResolvedValue(null);
    mocks.createCardIfAbsent.mockResolvedValue({
      created: true,
      card: { ...candidate, revision: 1, libraryEpoch: 2 },
    });
    const { sync, events } = createHarness({ epoch: null, isBrowserOnline: true });

    await sync.flush();

    expect(mocks.getLibraryEpoch).toHaveBeenCalledWith({ kind: 'database' }, 'user-a');
    expect(events.verifyEpoch).toHaveBeenCalledWith({ userId: 'user-a', value: 2 });
    expect(mocks.createCardIfAbsent).toHaveBeenCalledWith(
      { kind: 'database' },
      'user-a',
      expect.objectContaining({ id: candidate.id, libraryEpoch: 2 }),
      expect.objectContaining({ libraryEpoch: 2 }),
    );
    expect(mocks.acknowledgeDevicePending).toHaveBeenCalledWith([
      expect.objectContaining({ opId: operation.opId, libraryEpoch: 2 }),
    ]);
  });

  it('binds an offline delete to the verified epoch before flushing it', async () => {
    const operation = pendingDelete('offline-delete', -1);
    mocks.loadDevicePending.mockResolvedValue([operation]);
    mocks.getLibraryEpoch.mockResolvedValue(2);
    mocks.deleteCardWithTombstone.mockResolvedValue({
      deleted: true,
      tombstone: {
        cardId: operation.cardId,
        opId: operation.opId!,
        libraryEpoch: 2,
        revision: 2,
        deletedAt: '2026-08-09T00:00:05.000Z',
      },
    });
    const { sync } = createHarness({ epoch: null, isBrowserOnline: true });

    await sync.flush();

    expect(mocks.deleteCardWithTombstone).toHaveBeenCalledWith(
      { kind: 'database' },
      'user-a',
      expect.objectContaining({
        cardId: operation.cardId,
        libraryEpoch: 2,
        baseRevision: operation.baseRevision,
      }),
    );
    expect(mocks.acknowledgeDevicePending).toHaveBeenCalledWith([
      expect.objectContaining({ opId: operation.opId, libraryEpoch: 2 }),
    ]);
  });

  it('flushes queued changes immediately when the browser reconnects', async () => {
    const owner = { uid: 'user-a' };
    const epoch = { userId: 'user-a', value: 2 };
    const events = createEvents();
    const candidate = card('reconnect-create', 2);
    const operation = pendingUpsert(candidate);
    let browserOnline = false;
    mocks.loadDevicePending.mockResolvedValue([operation]);
    mocks.acquireDevicePendingFlush.mockImplementation(async () => browserOnline);
    mocks.findCardByNormalizedWord.mockResolvedValue(null);
    mocks.createCardIfAbsent.mockResolvedValue({ created: true, card: candidate });

    function Harness({ isBrowserOnline }: { isBrowserOnline: boolean }) {
      useLibraryDeviceSync({
        owner,
        epoch,
        cards: [],
        knownLibraryTotal: 0,
        cloudTotal: 0,
        cloudStatsTotal: 0,
        cardsPerPage: 9,
        isBrowserOnline,
        cloudReadUnavailable: false,
        query,
        queryKey: 'all',
        currentPage: 1,
        getPromotedCards: () => [],
        events,
      });
      return null;
    }

    const root = createRoot(installMinimalReactDom());
    try {
      await act(async () => {
        root.render(<Harness isBrowserOnline={false} />);
      });
      const attemptsBeforeReconnect = mocks.acquireDevicePendingFlush.mock.calls.length;

      browserOnline = true;
      await act(async () => {
        root.render(<Harness isBrowserOnline />);
      });

      expect(mocks.acquireDevicePendingFlush).toHaveBeenCalledTimes(attemptsBeforeReconnect + 1);
      expect(mocks.acknowledgeDevicePending).toHaveBeenCalledWith([operation]);
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });

  it('does not restart owner effects when rerendered with fresh objects for the same owner and epoch', async () => {
    const events = createEvents();
    mocks.loadDevicePending.mockResolvedValue([]);

    function Harness({ renderVersion }: { renderVersion: number }) {
      void renderVersion;
      useLibraryDeviceSync({
        owner: { uid: 'user-a' },
        epoch: { userId: 'user-a', value: 2 },
        cards: [],
        knownLibraryTotal: 0,
        cloudTotal: 0,
        cloudStatsTotal: 0,
        cardsPerPage: 9,
        isBrowserOnline: false,
        cloudReadUnavailable: false,
        query,
        queryKey: 'all',
        currentPage: 1,
        getPromotedCards: () => [],
        events,
      });
      return null;
    }

    const root = createRoot(installMinimalReactDom());
    try {
      await act(async () => {
        root.render(<Harness renderVersion={0} />);
      });
      const readsAfterMount = mocks.loadDevicePending.mock.calls.length;

      await act(async () => {
        root.render(<Harness renderVersion={1} />);
      });

      expect(mocks.loadDevicePending).toHaveBeenCalledTimes(readsAfterMount);
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });

  it('shows a recoverable error when the device sync coordinator cannot acquire a lease', async () => {
    const candidate = card('lease-failure', 2);
    mocks.loadDevicePending.mockResolvedValue([pendingUpsert(candidate)]);
    mocks.acquireDevicePendingFlush.mockRejectedValue(new Error('coordinator offline'));
    const { sync, events } = createHarness();

    await expect(sync.flush(true, { userId: 'user-a', value: 2 })).resolves.toBeUndefined();

    expect(events.reportError).toHaveBeenCalledWith(
      'The device sync coordinator could not be reached. Your changes remain safe on this device; retry after checking the local app connection.',
    );
    expect(mocks.findCardByNormalizedWord).not.toHaveBeenCalled();
  });

  it('joins an in-flight flush in the same tab instead of reporting its own lease as busy', async () => {
    let grantLease: ((granted: boolean) => void) | undefined;
    mocks.loadDevicePending.mockResolvedValue([]);
    mocks.acquireDevicePendingFlush.mockImplementation(() => new Promise<boolean>(resolve => {
      grantLease = resolve;
    }));
    const { sync } = createHarness({ isBrowserOnline: true });

    const first = sync.flush(false, { userId: 'user-a', value: 2 });
    await Promise.resolve();
    const second = sync.flush(false, { userId: 'user-a', value: 2 });

    expect(mocks.acquireDevicePendingFlush).toHaveBeenCalledTimes(1);
    grantLease?.(true);
    await Promise.all([first, second]);
    expect(mocks.releaseDevicePendingFlush).toHaveBeenCalledTimes(1);
  });

  it('does not publish a verified epoch after the active owner changes', () => {
    const publish = vi.fn();

    expect(publishVerifiedEpochIfOwnerCurrent(
      'user-a',
      'user-b',
      3,
      publish,
    )).toBeNull();
    expect(publish).not.toHaveBeenCalled();
  });

  it('keeps a word-duplicate operation queued when device cleanup fails', async () => {
    const candidate = {
      ...card('candidate-id', 2),
      word: 'shared word',
      normalizedWord: 'shared word',
      revision: 3,
    };
    const operation = pendingUpsert(candidate);
    mocks.loadDevicePending.mockResolvedValue([operation]);
    mocks.findCardByNormalizedWord.mockResolvedValue({
      ...card('authoritative-id', 2),
      word: candidate.word,
      normalizedWord: candidate.normalizedWord,
    });
    mocks.deleteDeviceCardBackupIfNotNewerThan.mockRejectedValue(
      new Error('Device cleanup failed'),
    );
    const { sync } = createHarness();

    await sync.flush(true, { userId: 'user-a', value: 2 });

    expect(mocks.acknowledgeDevicePending).not.toHaveBeenCalled();
    expect(mocks.mergeDeviceCardsStrict).toHaveBeenCalled();
    expect(mocks.upsertMirroredCardIfNotOlderThan).toHaveBeenCalled();
  });

  it('does not resurrect stale-generation upserts or patches during mirror sync', async () => {
    const staleUpsert: DevicePendingOperation = {
      type: 'upsert',
      operation: 'create',
      opId: 'stale-upsert',
      card: card('stale-upsert', 1),
      baseRevision: 0,
      libraryEpoch: 1,
      updatedAt: '2026-08-09T00:00:01.000Z',
      ownerUserId: 'user-a',
    };
    const stalePatch: DevicePendingOperation = {
      type: 'patch',
      operation: 'patch',
      opId: 'stale-patch',
      cardId: 'stale-patch',
      fields: { bookmarked: true },
      fieldMask: ['bookmarked'],
      baseRevision: 1,
      libraryEpoch: 1,
      updatedAt: '2026-08-09T00:00:02.000Z',
      ownerUserId: 'user-a',
    };
    const currentUpsert: DevicePendingOperation = {
      ...staleUpsert,
      opId: 'current-upsert',
      card: card('current-upsert', 2),
      libraryEpoch: 2,
      updatedAt: '2026-08-09T00:00:03.000Z',
    };
    const currentPatch: DevicePendingOperation = {
      ...stalePatch,
      opId: 'current-patch',
      cardId: 'current-patch',
      libraryEpoch: 2,
      updatedAt: '2026-08-09T00:00:04.000Z',
    };
    mocks.loadDevicePending.mockResolvedValue([
      staleUpsert,
      stalePatch,
      currentUpsert,
      currentPatch,
    ]);
    const { sync } = createHarness();

    await expect(sync.syncMirror(true)).resolves.toBe(0);

    expect(mocks.getLibraryEpoch).toHaveBeenCalledWith({ kind: 'database' }, 'user-a');
    expect(mocks.upsertMirroredCardBatch).toHaveBeenCalledTimes(1);
    expect(mocks.upsertMirroredCardBatch).toHaveBeenCalledWith(
      'user-a',
      [currentUpsert.card],
      7,
    );
    expect(mocks.patchMirroredCardBatch).toHaveBeenCalledTimes(1);
    expect(mocks.patchMirroredCardBatch).toHaveBeenCalledWith(
      'user-a',
      [{ cardId: 'current-patch', fields: { bookmarked: true } }],
      7,
    );
    expect(mocks.finishCardMirrorSync).toHaveBeenCalledWith('user-a', 7, 0);
  });

  it('clears a stale sync error after a later cloud mirror succeeds', async () => {
    let sync: ReturnType<typeof useLibraryDeviceSync> | undefined;
    const events = createEvents();

    function Harness() {
      sync = useLibraryDeviceSync({
        owner: { uid: 'user-a' },
        epoch: { userId: 'user-a', value: 2 },
        cards: [],
        knownLibraryTotal: 0,
        cloudTotal: 0,
        cloudStatsTotal: 0,
        cardsPerPage: 9,
        isBrowserOnline: false,
        cloudReadUnavailable: false,
        query,
        queryKey: 'all',
        currentPage: 1,
        getPromotedCards: () => [],
        events,
      });
      return null;
    }

    const root = createRoot(installMinimalReactDom());
    try {
      await act(async () => root.render(<Harness />));
      mocks.loadDevicePending.mockResolvedValue([]);
      mocks.getLibraryEpoch.mockRejectedValueOnce(new Error('App Check was not ready'));

      await act(async () => sync?.syncNow());
      expect(sync?.error).toBe(
        'Sync is temporarily unavailable. Your changes are still safe on this device.',
      );

      mocks.getLibraryEpoch.mockResolvedValue(2);
      await act(async () => sync?.syncMirror(true));

      expect(sync?.error).toBeNull();
      expect(events.setCloudAvailable).toHaveBeenLastCalledWith(true);
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });

  it('does not download the complete library again when manual sync already has a fresh mirror', async () => {
    let sync: ReturnType<typeof useLibraryDeviceSync> | undefined;
    const events = createEvents();
    mocks.loadDevicePending.mockResolvedValue([]);
    mocks.getCardMirrorStatus.mockResolvedValue({
      userId: 'user-a',
      complete: true,
      syncing: false,
      libraryEpoch: 2,
      generation: 'complete-generation',
      expectedTotal: 1_167,
      loaded: 1_167,
      syncedAt: new Date().toISOString(),
    });

    function Harness() {
      sync = useLibraryDeviceSync({
        owner: { uid: 'user-a' },
        epoch: { userId: 'user-a', value: 2 },
        cards: [],
        knownLibraryTotal: 1_167,
        cloudTotal: 1_167,
        cloudStatsTotal: 1_167,
        cardsPerPage: 9,
        isBrowserOnline: false,
        cloudReadUnavailable: false,
        query,
        queryKey: 'all',
        currentPage: 1,
        getPromotedCards: () => [],
        events,
      });
      return null;
    }

    const root = createRoot(installMinimalReactDom());
    try {
      await act(async () => root.render(<Harness />));
      await act(async () => sync?.syncNow());

      expect(mocks.streamAllCardsInBatches).not.toHaveBeenCalled();
      expect(events.notify).toHaveBeenCalledWith('Saved 1167 cards locally.');
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  });

  it('reuses a complete mirror for one day instead of refreshing the whole library every 15 minutes', async () => {
    mocks.getCardMirrorStatus.mockResolvedValue({
      userId: 'user-a',
      complete: true,
      syncing: false,
      libraryEpoch: 2,
      generation: 'complete-generation',
      expectedTotal: 1_167,
      loaded: 1_167,
      syncedAt: new Date(Date.now() - (60 * 60 * 1_000)).toISOString(),
    });
    const { sync } = createHarness();

    await expect(sync.syncMirror(false)).resolves.toBe(1_167);

    expect(mocks.streamAllCardsInBatches).not.toHaveBeenCalled();
  });

  it('streams only legacy and captured-epoch cards into a stable mirror generation', async () => {
    const legacy = { ...card('legacy-card', 2) };
    delete legacy.libraryEpoch;
    const stale = card('stale-card', 1);
    const current = card('current-card', 2);
    const future = card('future-card', 3);
    mocks.loadDevicePending.mockResolvedValue([]);
    mocks.streamAllCardsInBatches.mockImplementation(async (_db, _userId, onBatch) => {
      await onBatch([legacy, stale, current, future], 4);
      return 4;
    });
    const { sync } = createHarness();

    await expect(sync.syncMirror(true)).resolves.toBe(2);

    expect(mocks.upsertMirroredCardBatch).toHaveBeenCalledTimes(1);
    expect(mocks.upsertMirroredCardBatch).toHaveBeenCalledWith(
      'user-a',
      [legacy, current],
      7,
    );
    expect(mocks.finishCardMirrorSync).toHaveBeenCalledWith('user-a', 7, 2);
  });

  it('does not publish a mirror generation when the cloud epoch changes during streaming', async () => {
    mocks.getLibraryEpoch
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3);
    mocks.loadDevicePending.mockResolvedValue([]);
    const { sync } = createHarness();

    await expect(sync.syncMirror(true)).rejects.toThrow(
      'Cloud library changed while the local mirror was syncing.',
    );

    expect(mocks.beginCardMirrorSync).toHaveBeenCalled();
    expect(mocks.streamAllCardsInBatches).toHaveBeenCalled();
    expect(mocks.loadDevicePending).not.toHaveBeenCalled();
    expect(mocks.finishCardMirrorSync).not.toHaveBeenCalled();
  });

  it('rechecks the cloud epoch after overlaying pending operations', async () => {
    const pending = pendingUpsert(card('current-upsert', 2));
    mocks.getLibraryEpoch
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3);
    mocks.loadDevicePending.mockResolvedValue([pending]);
    const { sync } = createHarness();

    await expect(sync.syncMirror(true)).rejects.toThrow(
      'Cloud library changed while the local mirror was syncing.',
    );

    expect(mocks.upsertMirroredCardBatch).toHaveBeenCalledWith(
      'user-a',
      [pending.card],
      7,
    );
    expect(mocks.finishCardMirrorSync).not.toHaveBeenCalled();
  });

  it('invalidates a finished mirror if the cloud epoch changes at publication time', async () => {
    mocks.getLibraryEpoch
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3);
    mocks.loadDevicePending.mockResolvedValue([]);
    const { sync, events } = createHarness();

    await expect(sync.syncMirror(true)).rejects.toThrow(
      'Cloud library changed while the local mirror was syncing.',
    );

    expect(mocks.finishCardMirrorSync).toHaveBeenCalledWith('user-a', 7, 0);
    expect(mocks.invalidateCardMirrorGeneration).toHaveBeenCalledWith('user-a', 7);
    expect(events.setCloudTotal).not.toHaveBeenCalled();
    expect(events.refreshCloud).not.toHaveBeenCalled();
  });
});
