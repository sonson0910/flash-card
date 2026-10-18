import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Firestore } from 'firebase/firestore';
import type { CardData } from '../../types/card';
import { createStarterCards } from './createStarterCards';

const repositoryRuntime = vi.hoisted(() => ({
  createStarterCardBatch: vi.fn(async (
    _db: unknown,
    _ownerId: string,
    _operationId: string,
    cards: readonly CardData[],
  ) => ({ created: cards, quotaExceeded: false })),
}));

vi.mock('../../lib/cardRepository', () => ({
  createStarterCardBatch: repositoryRuntime.createStarterCardBatch,
}));

afterEach(() => {
  repositoryRuntime.createStarterCardBatch.mockClear();
});

describe('createStarterCards', () => {
  it('creates the full catalog through one batch call with a stable per-course operationId', async () => {
    const outcome = await createStarterCards({} as Firestore, 'owner-1', 'en', 'vi');

    expect(repositoryRuntime.createStarterCardBatch).toHaveBeenCalledTimes(1);
    const [, ownerId, operationId, cards] = repositoryRuntime.createStarterCardBatch.mock.calls[0];
    expect(ownerId).toBe('owner-1');
    expect(operationId).toBe('starter-en-vi');
    expect(cards).toHaveLength(5);
    expect(outcome.created).toHaveLength(5);
    expect(outcome.skippedForQuota).toBe(0);
  });

  it('reuses the same operationId for a retried onboarding attempt on the same course pair', async () => {
    await createStarterCards({} as Firestore, 'owner-1', 'en', 'vi');
    await createStarterCards({} as Firestore, 'owner-1', 'en', 'vi');

    const operationIds = repositoryRuntime.createStarterCardBatch.mock.calls.map(call => call[2]);
    expect(operationIds).toEqual(['starter-en-vi', 'starter-en-vi']);
  });

  it('reports the whole catalog as skipped, and creates nothing, when the server refuses the batch for quota', async () => {
    repositoryRuntime.createStarterCardBatch.mockResolvedValueOnce({ created: [], quotaExceeded: true });

    const outcome = await createStarterCards({} as Firestore, 'owner-1', 'en', 'vi');

    expect(outcome.created).toHaveLength(0);
    expect(outcome.skippedForQuota).toBe(5);
  });

  it('never calls the server for a target/native pair with an empty catalog', async () => {
    const outcome = await createStarterCards({} as Firestore, 'owner-1', 'en', 'en');

    expect(outcome).toEqual({ created: [], skippedForQuota: 0 });
    expect(repositoryRuntime.createStarterCardBatch).not.toHaveBeenCalled();
  });
});
