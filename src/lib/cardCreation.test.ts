import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../types/card';
import { CardUniquenessCheckError } from './cardUniqueness';
import {
  beginOptimisticCardPersistence,
  canDeferRemoteUniquenessFailure,
  applySuccessfulPatchMetadata,
  partitionPendingOperationsByLibraryEpoch,
  persistCardWithMirrorFallback,
  partitionPendingOperationsForFlush,
  shouldAttemptRemoteUniquenessCheck,
  shouldRequireRemoteUniquenessCheck,
  verifyPendingCardOperations,
} from './cardCreation';
import { OperationTimeoutError } from './async';
import type { DevicePendingOperation } from './deviceSync';

const card: CardData = {
  id: 'word-resilient',
  word: 'resilient',
  normalizedWord: 'resilient',
  translation: 'kiên cường',
  explanation: '',
  phonetic: '',
  emoji: '🌱',
  category: 'Test',
  audioUrl: null,
  imageUrl: null,
  createdAt: '2026-07-19T00:00:00.000Z',
  bookmarked: false,
  difficulty: 'unrated',
  customDeck: null,
};

describe('card creation with a complete local mirror', () => {
  it('does not require another remote uniqueness lookup', () => {
    expect(shouldRequireRemoteUniquenessCheck({ complete: true })).toBe(false);
    expect(shouldRequireRemoteUniquenessCheck({ complete: false })).toBe(true);
    expect(shouldRequireRemoteUniquenessCheck(null)).toBe(true);
  });

  it('does not wait for remote verification when cloud is already known to be unavailable', () => {
    expect(shouldAttemptRemoteUniquenessCheck({
      mirrorStatus: { complete: false },
      cloudAvailable: true,
      verifierAvailable: true,
    })).toBe(true);
    expect(shouldAttemptRemoteUniquenessCheck({
      mirrorStatus: { complete: false },
      cloudAvailable: false,
      verifierAvailable: true,
    })).toBe(false);
    expect(shouldAttemptRemoteUniquenessCheck({
      mirrorStatus: { complete: true },
      cloudAvailable: true,
      verifierAvailable: true,
    })).toBe(false);
  });

  it('queues the new card when Firebase is temporarily unavailable', async () => {
    const createInCloud = vi.fn().mockRejectedValue({ code: 'unavailable' });

    await expect(persistCardWithMirrorFallback({
      card,
      uniquenessVerified: true,
      createInCloud,
    })).resolves.toEqual({ card, created: true, queued: true });
  });

  it('returns a local result before cloud creation settles', async () => {
    let finishCloud!: (value: { card: CardData; created: boolean }) => void;
    const cloud = new Promise<{ card: CardData; created: boolean }>(resolve => {
      finishCloud = resolve;
    });

    const persistence = beginOptimisticCardPersistence({
      card,
      uniquenessVerified: true,
      createInCloud: () => cloud,
    });

    expect(persistence.immediate).toEqual({ card, created: true, queued: true });
    finishCloud({ card, created: true });
    await expect(persistence.settled).resolves.toEqual({ card, created: true, queued: false });
  });

  it('queues without writing cloud when uniqueness verification was deferred', async () => {
    const createInCloud = vi.fn();

    await expect(persistCardWithMirrorFallback({
      card,
      uniquenessVerified: false,
      createInCloud,
    })).resolves.toEqual({ card, created: true, queued: true });
    expect(createInCloud).not.toHaveBeenCalled();
  });

  it('defers every cloud uniqueness failure because pending writes are verified again before flush', () => {
    expect(canDeferRemoteUniquenessFailure(
      new CardUniquenessCheckError(new OperationTimeoutError('too long')),
    )).toBe(true);
    expect(canDeferRemoteUniquenessFailure(
      new CardUniquenessCheckError({ code: 'unavailable' }),
    )).toBe(true);
    expect(canDeferRemoteUniquenessFailure(
      new CardUniquenessCheckError({ code: 'permission-denied' }),
    )).toBe(true);
  });

  it('keeps the card queued even when Firebase reports a non-retryable write error', async () => {
    await expect(persistCardWithMirrorFallback({
      card,
      uniquenessVerified: true,
      createInCloud: async () => { throw { code: 'permission-denied' }; },
    })).resolves.toEqual({ card, created: true, queued: true });
  });

  it('does not write a queued card when that word already exists remotely', async () => {
    const queuedCard = {
      type: 'upsert',
      card,
      updatedAt: '2026-07-19T00:01:00.000Z',
      ownerUserId: 'user-a',
    } satisfies DevicePendingOperation;
    const queuedDelete = {
      type: 'delete',
      cardId: 'old-card',
      updatedAt: '2026-07-19T00:02:00.000Z',
      ownerUserId: 'user-a',
    } satisfies DevicePendingOperation;
    const existingCard = { ...card, id: 'legacy-resilient', difficulty: 'good' as const };

    await expect(verifyPendingCardOperations(
      [queuedCard, queuedDelete],
      async () => existingCard,
    )).resolves.toEqual({
      operationsToWrite: [queuedDelete],
      operationsAlreadyExisting: [queuedCard],
      existingCards: [existingCard],
    });
  });

  it('keeps an update queued when the remote card has the same id', async () => {
    const imageUpdate = {
      type: 'upsert',
      card: { ...card, imageUrl: 'https://images.pexels.com/resilient.jpeg' },
      updatedAt: '2026-07-22T00:01:00.000Z',
      ownerUserId: 'user-a',
    } satisfies DevicePendingOperation;

    await expect(verifyPendingCardOperations(
      [imageUpdate],
      async () => card,
    )).resolves.toEqual({
      operationsToWrite: [imageUpdate],
      operationsAlreadyExisting: [],
      existingCards: [],
    });
  });

  it('writes patches directly without running new-card uniqueness verification', async () => {
    const patch = {
      type: 'patch',
      cardId: card.id,
      fields: { bookmarked: true },
      updatedAt: '2026-07-22T00:02:00.000Z',
      ownerUserId: 'user-a',
    } satisfies DevicePendingOperation;
    const findExisting = vi.fn();

    await expect(verifyPendingCardOperations([patch], findExisting)).resolves.toEqual({
      operationsToWrite: [patch],
      operationsAlreadyExisting: [],
      existingCards: [],
    });
    expect(findExisting).not.toHaveBeenCalled();
  });

  it('isolates patches from batchable upserts and deletes during flush', () => {
    const patch = {
      type: 'patch' as const,
      cardId: card.id,
      fields: { bookmarked: true },
      updatedAt: '2026-07-22T00:02:00.000Z',
    };
    const upsert = {
      type: 'upsert' as const,
      card,
      updatedAt: '2026-07-22T00:01:00.000Z',
    };
    const deletion = {
      type: 'delete' as const,
      cardId: 'old-card',
      updatedAt: '2026-07-22T00:03:00.000Z',
    };

    expect(partitionPendingOperationsForFlush([patch, upsert, deletion])).toEqual({
      creates: [upsert],
      deletes: [deletion],
      patches: [patch],
    });
  });

  it('discards stale epochs, flushes the current epoch and leaves future epochs queued', () => {
    const operation = (id: string, libraryEpoch?: number): DevicePendingOperation => ({
      type: 'delete',
      operation: 'delete',
      opId: `op-${id}`,
      cardId: id,
      baseRevision: 0,
      fieldMask: [],
      ...(libraryEpoch === undefined ? {} : { libraryEpoch }),
      updatedAt: `2026-07-22T00:00:0${id}.000Z`,
      ownerUserId: 'user-a',
    });
    const legacy = operation('0');
    const stale = operation('1', 2);
    const current = operation('2', 3);
    const future = operation('3', 4);

    expect(partitionPendingOperationsByLibraryEpoch(
      [legacy, stale, current, future],
      3,
    )).toEqual({
      stale: [legacy, stale],
      current: [current],
      future: [future],
    });
  });

  it('binds offline mutations to the remotely verified epoch before flushing', () => {
    const create = {
      type: 'upsert' as const,
      card: { ...card, libraryEpoch: 0 },
      libraryEpoch: -1,
      updatedAt: '2026-07-22T00:00:01.000Z',
      ownerUserId: 'user-a',
    };
    const patch = {
      type: 'patch' as const,
      cardId: card.id,
      fields: { bookmarked: true },
      libraryEpoch: -1,
      updatedAt: '2026-07-22T00:00:02.000Z',
      ownerUserId: 'user-a',
    };

    const { current: [boundCreate, boundPatch] } = partitionPendingOperationsByLibraryEpoch(
      [create, patch], 7,
    );

    expect(boundCreate).toMatchObject({
      type: 'upsert',
      libraryEpoch: 7,
      card: { libraryEpoch: 7 },
    });
    expect(boundPatch).toMatchObject({ type: 'patch', libraryEpoch: 7 });
  });

  it('advances local revision metadata so the next sequential patch uses the new base', () => {
    const first = applySuccessfulPatchMetadata(
      { ...card, revision: 1, libraryEpoch: 3 },
      { bookmarked: true },
      { revision: 2, libraryEpoch: 3, updatedAt: '2026-07-26T01:00:00.000Z' },
    );
    const second = applySuccessfulPatchMetadata(
      first,
      { imageUrl: 'https://images.pexels.com/resilient.jpeg' },
      { revision: 3, libraryEpoch: 3, updatedAt: '2026-07-26T01:01:00.000Z' },
    );

    expect(first).toMatchObject({ bookmarked: true, revision: 2 });
    expect(second).toMatchObject({
      bookmarked: true,
      imageUrl: 'https://images.pexels.com/resilient.jpeg',
      revision: 3,
      libraryEpoch: 3,
    });
  });

  it('does not copy stale fields outside the successful patch field mask into the local mirror', () => {
    const updated = applySuccessfulPatchMetadata(
      {
        ...card,
        translation: 'cloud translation',
        bookmarked: false,
        revision: 8,
        libraryEpoch: 3,
      },
      {
        translation: 'stale local translation',
        bookmarked: true,
      },
      {
        revision: 9,
        libraryEpoch: 3,
        updatedAt: '2026-07-26T01:00:00.000Z',
      },
      ['bookmarked'],
    );

    expect(updated).toMatchObject({
      translation: 'cloud translation',
      bookmarked: true,
      revision: 9,
      libraryEpoch: 3,
    });
  });
});
