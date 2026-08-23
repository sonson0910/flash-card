import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DevicePendingOperation } from '../../lib/deviceSync';
import type { CardData } from '../../types/card';
import type { LearningPersistenceOptions, LearningPersistenceStats } from './learningPersistencePort';
import type { LearningStateMutation } from './learningStateController';
import type { LearningStatePersistencePort } from './useLearningState';
import type { ReviewApplyResult, ReviewCommand } from '../../lib/cardReviewRepository';
import type { CardMutableField } from '../../lib/cardMutationProtocol';
import { scheduleReview } from '../../lib/reviewScheduler';

const mocks = vi.hoisted(() => ({
  deleteDeviceCardBackupIfNotNewerThan: vi.fn(),
  applyCardPatchIfCurrent: vi.fn(),
  deleteAllCards: vi.fn(),
  deleteCardWithTombstone: vi.fn(),
  getLibraryEpoch: vi.fn(),
  incrementLibraryEpoch: vi.fn(),
  clearMirroredCards: vi.fn(),
  deleteMirroredCard: vi.fn(),
  deleteMirroredCardIfNotNewerThan: vi.fn(),
  deleteMirroredCardIfOlderThan: vi.fn(),
  patchMirroredCardBatch: vi.fn(),
  applyReviewViaCallable: vi.fn(),
  applyReviewWithConflictRecovery: vi.fn(),
}));

vi.mock('../../lib/deviceSync', async () => {
  const actual = await vi.importActual<typeof import('../../lib/deviceSync')>('../../lib/deviceSync');
  return {
    ...actual,
    deleteDeviceCardBackupIfNotNewerThan: mocks.deleteDeviceCardBackupIfNotNewerThan,
  };
});

vi.mock('../../lib/cardRepository', () => ({
  applyCardPatchIfCurrent: mocks.applyCardPatchIfCurrent,
  deleteAllCards: mocks.deleteAllCards,
  deleteCardWithTombstone: mocks.deleteCardWithTombstone,
  getLibraryEpoch: mocks.getLibraryEpoch,
  incrementLibraryEpoch: mocks.incrementLibraryEpoch,
}));

vi.mock('../../lib/cardMirror', () => ({
  clearMirroredCards: mocks.clearMirroredCards,
  deleteMirroredCard: mocks.deleteMirroredCard,
  deleteMirroredCardIfNotNewerThan: mocks.deleteMirroredCardIfNotNewerThan,
  deleteMirroredCardIfOlderThan: mocks.deleteMirroredCardIfOlderThan,
  patchMirroredCardBatch: mocks.patchMirroredCardBatch,
}));

vi.mock('../../lib/cardReviewRepository', async () => {
  const actual = await vi.importActual<typeof import('../../lib/cardReviewRepository')>('../../lib/cardReviewRepository');
  return {
    ...actual,
    applyReviewViaCallable: mocks.applyReviewViaCallable,
    applyReviewWithConflictRecovery: mocks.applyReviewWithConflictRecovery,
  };
});

vi.mock('../../lib/firebase', () => ({
  db: { kind: 'database' },
  handleFirestoreError: vi.fn(),
  isFirebaseConfigured: true,
  OperationType: { DELETE: 'delete' },
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  setDoc: vi.fn(),
}));

import { useLearningStatePersistence } from './useLearningStatePersistence';

const card: CardData = {
  id: 'word-focus',
  word: 'focus',
  normalizedWord: 'focus',
  translation: 'tập trung',
  explanation: '',
  phonetic: '',
  emoji: '🎯',
  category: 'Study',
  audioUrl: null,
  imageUrl: null,
  bookmarked: false,
  difficulty: 'unrated',
  reviews: 0,
  revision: 3,
  libraryEpoch: 2,
};

const pendingPatch: DevicePendingOperation = {
  type: 'patch',
  operation: 'patch',
  opId: 'review-1',
  cardId: card.id,
  fields: { difficulty: 'hard', reviews: 1 },
  fieldMask: ['difficulty', 'reviews'],
  baseRevision: 3,
  libraryEpoch: 2,
  updatedAt: '2026-08-09T00:00:00.000Z',
  ownerUserId: 'user-a',
};

const pendingDelete: DevicePendingOperation = {
  type: 'delete',
  operation: 'delete',
  opId: 'cleanup-1',
  cardId: card.id,
  fieldMask: [],
  baseRevision: 3,
  libraryEpoch: 2,
  updatedAt: '2026-08-09T00:00:01.000Z',
  ownerUserId: 'user-a',
};

const reviewMutation: LearningStateMutation = {
  ownerKey: 'user-a',
  operationId: 'review-1',
  operation: 'review',
  intent: 'review',
  cardId: card.id,
  fields: { difficulty: 'hard', reviews: 1 },
  fieldMask: ['difficulty', 'reviews'],
  baseRevision: 3,
  libraryEpoch: 2,
  publication: {
    kind: 'patch',
    cardId: card.id,
    fields: { difficulty: 'hard', reviews: 1 },
  },
};

const deleteMutation: LearningStateMutation = {
  ownerKey: 'user-a',
  operationId: 'cleanup-1',
  operation: 'delete',
  intent: 'delete',
  cardId: card.id,
  baseRevision: 3,
  libraryEpoch: 2,
  publication: { kind: 'delete', cardId: card.id },
};

function createHarness({
  verifiedEpoch = 2,
  patchResult = pendingPatch,
}: {
  verifiedEpoch?: number | null;
  patchResult?: DevicePendingOperation;
} = {}) {
  const acknowledgeDevicePending = vi.fn(async () => undefined);
  const removeDeviceCard = vi.fn(async () => [pendingDelete]);
  const updateCloudStats = vi.fn<(update: (current: LearningPersistenceStats) => LearningPersistenceStats) => void>();
  const addXp = vi.fn();
  const options: LearningPersistenceOptions = {
    ownerId: 'user-a',
    verifiedEpoch,
    knownLibraryTotal: 1,
    findCard: cardId => cardId === card.id ? card : undefined,
    canPublishPatch: () => true,
    patchDeviceCards: vi.fn(async () => [patchResult]),
    removeDeviceCard,
    acknowledgeDevicePending,
    acceptVerifiedEpoch: vi.fn(),
    updateCloudStats,
    updateCategoryFacets: vi.fn(async () => undefined),
    resetCloudState: vi.fn(),
    resetCloudPage: vi.fn(),
    refreshCloud: vi.fn(),
    setCloudUnavailable: vi.fn(),
    setMutationPending: vi.fn(),
    reportError: vi.fn(),
    addXp,
  };
  const captured: { persistence?: LearningStatePersistencePort } = {};

  function Harness() {
    captured.persistence = useLearningStatePersistence(options);
    return null;
  }

  renderToStaticMarkup(<Harness />);
  if (!captured.persistence) throw new Error('Persistence hook did not initialize.');

  return {
    persistence: captured.persistence,
    acknowledgeDevicePending,
    removeDeviceCard,
    updateCloudStats,
    addXp,
    patchDeviceCards: options.patchDeviceCards,
  };
}

describe('useLearningStatePersistence patch reconciliation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteDeviceCardBackupIfNotNewerThan.mockResolvedValue(true);
    mocks.deleteMirroredCard.mockResolvedValue(undefined);
    mocks.deleteMirroredCardIfNotNewerThan.mockResolvedValue(true);
    mocks.deleteMirroredCardIfOlderThan.mockResolvedValue(true);
    mocks.getLibraryEpoch.mockResolvedValue(3);
  });

  it('removes an optimistic device patch from a stale library epoch without stats or XP', async () => {
    mocks.applyCardPatchIfCurrent.mockResolvedValue({
      applied: false,
      reason: 'stale-library-epoch',
    });
    const harness = createHarness();

    await expect(harness.persistence.persist(reviewMutation)).resolves.toEqual({
      ownerKey: 'user-a',
      operationId: 'review-1',
      publication: { kind: 'delete', cardId: card.id },
    });
    expect(harness.removeDeviceCard).not.toHaveBeenCalled();
    expect(mocks.deleteDeviceCardBackupIfNotNewerThan).toHaveBeenCalledWith('user-a', card.id, {
      libraryEpoch: 2,
      revision: Number.MAX_SAFE_INTEGER,
    });
    expect(mocks.deleteMirroredCardIfOlderThan).toHaveBeenCalledWith('user-a', card.id, 3);
    expect(harness.acknowledgeDevicePending).toHaveBeenCalledWith([pendingPatch]);
    expect(harness.updateCloudStats).not.toHaveBeenCalled();
    expect(harness.addXp).not.toHaveBeenCalled();
  });

  it('routes an immediate review through the protected callable and preserves its queue kind', async () => {
    const reviewedAt = new Date('2026-08-24T00:00:00.000Z');
    const fields = scheduleReview(card, 'good', reviewedAt);
    const reviewPendingPatch: DevicePendingOperation = {
      ...pendingPatch,
      operation: 'review',
      fields,
      fieldMask: Object.keys(fields) as CardMutableField[],
    };
    const authoritative = { ...card, ...fields, revision: 4, libraryEpoch: 2 };
    mocks.applyReviewWithConflictRecovery.mockImplementation(async (
      command: ReviewCommand,
      apply: (value: ReviewCommand) => Promise<ReviewApplyResult>,
    ) => apply(command));
    mocks.applyReviewViaCallable.mockResolvedValue({ applied: true, duplicate: false, card: authoritative });
    const harness = createHarness({ patchResult: reviewPendingPatch });
    const mutation: LearningStateMutation = {
      ...reviewMutation,
      fields,
      fieldMask: Object.keys(fields) as CardMutableField[],
      publication: { kind: 'patch', cardId: card.id, fields },
    };

    await harness.persistence.persist(mutation);

    expect(harness.patchDeviceCards).toHaveBeenCalledWith(
      [{ card: { ...card, ...fields }, fields }],
      1,
      mutation.operationId,
      'review',
    );
    expect(mocks.applyReviewViaCallable).toHaveBeenCalledWith(
      expect.anything(),
      'user-a',
      expect.objectContaining({ opId: mutation.operationId, rating: 'good', reviewedAt: reviewedAt.toISOString() }),
    );
    expect(harness.acknowledgeDevicePending).toHaveBeenCalledWith([reviewPendingPatch]);
  });

  it('publishes a delete and removes the local copy when the cloud card is missing', async () => {
    mocks.applyCardPatchIfCurrent.mockResolvedValue({
      applied: false,
      reason: 'missing',
    });
    const harness = createHarness();

    await expect(harness.persistence.persist(reviewMutation)).resolves.toEqual({
      ownerKey: 'user-a',
      operationId: 'review-1',
      publication: { kind: 'delete', cardId: card.id },
    });
    expect(harness.removeDeviceCard).not.toHaveBeenCalled();
    expect(mocks.deleteDeviceCardBackupIfNotNewerThan).toHaveBeenCalledWith('user-a', card.id, {
      libraryEpoch: 2,
      revision: 3,
    });
    expect(mocks.deleteMirroredCardIfNotNewerThan).toHaveBeenCalledWith('user-a', card.id, {
      libraryEpoch: 2,
      revision: 3,
    });
    expect(harness.acknowledgeDevicePending).toHaveBeenCalledWith([pendingPatch]);
    expect(harness.updateCloudStats).not.toHaveBeenCalled();
    expect(harness.addXp).not.toHaveBeenCalled();
  });

  it('keeps a stale patch queued when conditional mirror cleanup fails', async () => {
    mocks.applyCardPatchIfCurrent.mockResolvedValue({
      applied: false,
      reason: 'stale-library-epoch',
    });
    mocks.deleteMirroredCardIfOlderThan.mockRejectedValue(new Error('IndexedDB delete failed'));
    const harness = createHarness();

    await expect(harness.persistence.persist(reviewMutation)).resolves.toMatchObject({
      publication: { kind: 'delete', cardId: card.id },
    });
    expect(harness.removeDeviceCard).not.toHaveBeenCalled();
    expect(mocks.deleteMirroredCardIfOlderThan).toHaveBeenCalledWith('user-a', card.id, 3);
    expect(harness.acknowledgeDevicePending).not.toHaveBeenCalled();
    expect(harness.updateCloudStats).not.toHaveBeenCalled();
    expect(harness.addXp).not.toHaveBeenCalled();
  });

  it('keeps a missing-card cleanup queued when mirror deletion fails', async () => {
    mocks.applyCardPatchIfCurrent.mockResolvedValue({ applied: false, reason: 'missing' });
    mocks.deleteMirroredCardIfNotNewerThan.mockRejectedValue(new Error('IndexedDB delete failed'));
    const harness = createHarness();

    await expect(harness.persistence.persist(reviewMutation)).resolves.toMatchObject({
      publication: { kind: 'delete', cardId: card.id },
    });
    expect(harness.removeDeviceCard).not.toHaveBeenCalled();
    expect(mocks.deleteMirroredCardIfNotNewerThan).toHaveBeenCalledWith('user-a', card.id, {
      libraryEpoch: 2,
      revision: 3,
    });
    expect(harness.acknowledgeDevicePending).not.toHaveBeenCalled();
    expect(harness.updateCloudStats).not.toHaveBeenCalled();
    expect(harness.addXp).not.toHaveBeenCalled();
  });

  it('keeps a cloud-confirmed delete queued when mirror deletion fails', async () => {
    mocks.deleteCardWithTombstone.mockResolvedValue({
      deleted: true,
      tombstone: {
        cardId: card.id,
        opId: 'cleanup-1',
        libraryEpoch: 2,
        revision: 4,
        deletedAt: '2026-08-09T00:00:05.000Z',
      },
    });
    mocks.deleteMirroredCardIfNotNewerThan.mockRejectedValue(new Error('IndexedDB delete failed'));
    const harness = createHarness();

    await expect(harness.persistence.persist(deleteMutation)).resolves.toMatchObject({
      publication: { kind: 'delete', cardId: card.id },
    });
    expect(mocks.deleteDeviceCardBackupIfNotNewerThan).toHaveBeenCalledWith('user-a', card.id, {
      libraryEpoch: 2,
      revision: 3,
    });
    expect(mocks.deleteMirroredCardIfNotNewerThan).toHaveBeenCalledWith('user-a', card.id, {
      libraryEpoch: 2,
      revision: 3,
    });
    expect(harness.acknowledgeDevicePending).not.toHaveBeenCalled();
  });

  it('preserves a current-generation same-id mirror after a stale delete', async () => {
    mocks.deleteCardWithTombstone.mockResolvedValue({
      deleted: false,
      reason: 'stale-library-epoch',
    });
    mocks.deleteMirroredCardIfOlderThan.mockResolvedValue(false);
    const harness = createHarness();

    await expect(harness.persistence.persist(deleteMutation)).resolves.toMatchObject({
      publication: { kind: 'delete', cardId: card.id },
    });
    expect(mocks.deleteMirroredCardIfOlderThan).toHaveBeenCalledWith('user-a', card.id, 3);
    expect(mocks.deleteMirroredCard).not.toHaveBeenCalled();
    expect(harness.acknowledgeDevicePending).toHaveBeenCalledWith([pendingDelete]);
    expect(harness.updateCloudStats).not.toHaveBeenCalled();
  });

  it('queues and publishes a local delete while the signed-in cloud epoch is unavailable', async () => {
    const harness = createHarness({ verifiedEpoch: null });

    await expect(harness.persistence.persist(deleteMutation)).resolves.toEqual({
      ownerKey: 'user-a',
      operationId: 'cleanup-1',
      publication: { kind: 'delete', cardId: card.id },
    });

    expect(harness.removeDeviceCard).toHaveBeenCalledWith(card.id, {
      libraryEpoch: 2,
      baseRevisions: { [card.id]: 3 },
    });
    expect(mocks.deleteCardWithTombstone).not.toHaveBeenCalled();
    expect(harness.acknowledgeDevicePending).not.toHaveBeenCalled();
  });
});
