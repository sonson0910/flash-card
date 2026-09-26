import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseRuntime = vi.hoisted(() => ({
  app: { name: 'test-app' } as unknown,
  isFirebaseConfigured: true,
  protectedFunctionsCapability: { available: true } as
    | { available: true }
    | { available: false; reason: 'firebase-unconfigured' | 'firebase-initialization-failed' | 'app-check-unconfigured' | 'app-check-initialization-failed' },
}));

const mocks = vi.hoisted(() => ({
  getFunctions: vi.fn(() => ({ kind: 'functions' })),
  httpsCallable: vi.fn(),
}));

vi.mock('./firebase', () => firebaseRuntime);

vi.mock('firebase/functions', () => ({
  getFunctions: mocks.getFunctions,
  httpsCallable: mocks.httpsCallable,
}));

import {
  BulkMutationEpochConflictError,
  bulkMutateCardsViaCallable,
  type BulkCardDeleteCommand,
  type BulkCardPatchCommand,
} from './bulkCardMutationRepository';
import { ProtectedFunctionError } from './protectedFunctionsCapability';

const patchCommand: BulkCardPatchCommand = {
  cardId: 'card-1',
  baseRevision: 3,
  fields: { customDeck: null },
  fieldMask: ['customDeck'],
};

const deleteCommand: BulkCardDeleteCommand = {
  cardId: 'card-2',
  baseRevision: 5,
  opId: 'device-a:delete-1',
};

describe('bulkMutateCardsViaCallable', () => {
  beforeEach(() => {
    firebaseRuntime.isFirebaseConfigured = true;
    firebaseRuntime.protectedFunctionsCapability = { available: true };
    mocks.getFunctions.mockClear();
    mocks.httpsCallable.mockReset();
  });

  it('invokes the bulkMutateCards callable and parses applied patch and delete results', async () => {
    const callable = vi.fn().mockResolvedValue({
      data: {
        results: [
          { cardId: 'card-1', op: 'patch', applied: true, revision: 4 },
          { cardId: 'card-2', op: 'delete', applied: true, revision: 6, deletedAt: '2026-09-26T00:00:00.000Z' },
        ],
      },
    });
    mocks.httpsCallable.mockReturnValue(callable);

    const results = await bulkMutateCardsViaCallable({} as never, 'owner-a', 2, [patchCommand], [deleteCommand]);

    expect(mocks.httpsCallable).toHaveBeenCalledWith(expect.anything(), 'bulkMutateCards');
    expect(callable).toHaveBeenCalledWith({
      libraryEpoch: 2,
      patches: [{ ...patchCommand, fieldMask: ['customDeck'] }],
      deletes: [deleteCommand],
    });
    expect(results).toEqual([
      { cardId: 'card-1', op: 'patch', applied: true, revision: 4 },
      { cardId: 'card-2', op: 'delete', applied: true, revision: 6, deletedAt: '2026-09-26T00:00:00.000Z' },
    ]);
  });

  it('parses an unapplied patch result carrying a conflict reason', async () => {
    const callable = vi.fn().mockResolvedValue({
      data: { results: [{ cardId: 'card-1', op: 'patch', applied: false, reason: 'revision-conflict', currentRevision: 9 }] },
    });
    mocks.httpsCallable.mockReturnValue(callable);

    const results = await bulkMutateCardsViaCallable({} as never, 'owner-a', 2, [patchCommand]);

    expect(results).toEqual([
      { cardId: 'card-1', op: 'patch', applied: false, reason: 'revision-conflict', currentRevision: 9 },
    ]);
  });

  // A malformed/invalid-shaped response is not a known epoch conflict, so
  // `readEpochConflict` returns null and the raw validation Error rethrows
  // into `runProtectedFunction`'s own catch. Because it is a plain Error
  // (not a ProtectedFunctionError), the classifier collapses it into the
  // generic safe message -- the same fate as `parseCard`'s validation
  // errors in cardReviewRepository.ts's `applyReviewViaCallable`. This is
  // by design: only the two named epoch-conflict reasons get typed,
  // message-preserving treatment.
  it('collapses a response whose results field is missing or malformed into the generic safe error', async () => {
    const callable = vi.fn().mockResolvedValue({ data: { notResults: [] } });
    mocks.httpsCallable.mockReturnValue(callable);

    const rejection = await bulkMutateCardsViaCallable({} as never, 'owner-a', 0, [patchCommand]).catch(error => error);

    expect(rejection).toBeInstanceOf(ProtectedFunctionError);
    expect(rejection).not.toBeInstanceOf(BulkMutationEpochConflictError);
    expect((rejection as ProtectedFunctionError).kind).toBe('unknown');
  });

  it('collapses an applied result missing a safe-integer revision into the generic safe error', async () => {
    const callable = vi.fn().mockResolvedValue({
      data: { results: [{ cardId: 'card-1', op: 'patch', applied: true, revision: 'not-a-number' }] },
    });
    mocks.httpsCallable.mockReturnValue(callable);

    const rejection = await bulkMutateCardsViaCallable({} as never, 'owner-a', 0, [patchCommand]).catch(error => error);

    expect(rejection).toBeInstanceOf(ProtectedFunctionError);
    expect((rejection as ProtectedFunctionError).kind).toBe('unknown');
  });

  it('collapses a delete result missing deletedAt into the generic safe error', async () => {
    const callable = vi.fn().mockResolvedValue({
      data: { results: [{ cardId: 'card-2', op: 'delete', applied: true, revision: 6 }] },
    });
    mocks.httpsCallable.mockReturnValue(callable);

    const rejection = await bulkMutateCardsViaCallable({} as never, 'owner-a', 0, [], [deleteCommand]).catch(error => error);

    expect(rejection).toBeInstanceOf(ProtectedFunctionError);
    expect((rejection as ProtectedFunctionError).kind).toBe('unknown');
  });

  it('converts a stale-library-epoch HttpsError into a typed conflict error the classifier passes through', async () => {
    const httpsError = Object.assign(new Error('failed-precondition'), {
      code: 'functions/failed-precondition',
      details: { reason: 'stale-library-epoch' },
    });
    const callable = vi.fn().mockRejectedValue(httpsError);
    mocks.httpsCallable.mockReturnValue(callable);

    const rejection = await bulkMutateCardsViaCallable({} as never, 'owner-a', 5, [patchCommand]).catch(error => error);

    expect(rejection).toBeInstanceOf(BulkMutationEpochConflictError);
    expect(rejection).toBeInstanceOf(ProtectedFunctionError);
    expect((rejection as BulkMutationEpochConflictError).reason).toBe('stale-library-epoch');
    expect((rejection as BulkMutationEpochConflictError).message).toBe('Bulk card mutation rejected: stale-library-epoch.');
  });

  it('converts a future-library-epoch HttpsError into a typed conflict error', async () => {
    const httpsError = Object.assign(new Error('failed-precondition'), {
      code: 'functions/failed-precondition',
      details: { reason: 'future-library-epoch' },
    });
    const callable = vi.fn().mockRejectedValue(httpsError);
    mocks.httpsCallable.mockReturnValue(callable);

    const rejection = await bulkMutateCardsViaCallable({} as never, 'owner-a', 5, [patchCommand]).catch(error => error);

    expect(rejection).toBeInstanceOf(BulkMutationEpochConflictError);
    expect((rejection as BulkMutationEpochConflictError).reason).toBe('future-library-epoch');
  });

  it('rethrows an unrelated callable error unchanged in kind', async () => {
    const httpsError = Object.assign(new Error('permission-denied'), { code: 'functions/permission-denied' });
    const callable = vi.fn().mockRejectedValue(httpsError);
    mocks.httpsCallable.mockReturnValue(callable);

    const rejection = await bulkMutateCardsViaCallable({} as never, 'owner-a', 0, [patchCommand]).catch(error => error);

    expect(rejection).toBeInstanceOf(ProtectedFunctionError);
    expect(rejection).not.toBeInstanceOf(BulkMutationEpochConflictError);
    expect((rejection as ProtectedFunctionError).kind).toBe('permission');
  });

  it('fails closed with a configuration error when Firebase is not configured', async () => {
    firebaseRuntime.isFirebaseConfigured = false;
    await expect(bulkMutateCardsViaCallable({} as never, 'owner-a', 0, [patchCommand]))
      .rejects.toMatchObject({ code: 'firebase-unconfigured', kind: 'configuration' });
    firebaseRuntime.isFirebaseConfigured = true;
  });

  it('fails closed when protected functions are unavailable', async () => {
    firebaseRuntime.protectedFunctionsCapability = { available: false, reason: 'app-check-unconfigured' };
    await expect(bulkMutateCardsViaCallable({} as never, 'owner-a', 0, [patchCommand]))
      .rejects.toBeInstanceOf(ProtectedFunctionError);
    firebaseRuntime.protectedFunctionsCapability = { available: true };
  });

  it('defaults deletes to an empty array when omitted', async () => {
    const callable = vi.fn().mockResolvedValue({ data: { results: [] } });
    mocks.httpsCallable.mockReturnValue(callable);

    await bulkMutateCardsViaCallable({} as never, 'owner-a', 0, [patchCommand]);

    expect(callable).toHaveBeenCalledWith(expect.objectContaining({ deletes: [] }));
  });
});
