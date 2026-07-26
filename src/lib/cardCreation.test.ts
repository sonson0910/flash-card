import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../types/card';
import { CardUniquenessCheckError } from './cardUniqueness';
import {
  canDeferRemoteUniquenessFailure,
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
      batchOperations: [upsert, deletion],
      patches: [patch],
    });
  });
});
