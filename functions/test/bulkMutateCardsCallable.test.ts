import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('../src/accountData.js', async importOriginal => ({ ...await importOriginal<typeof import('../src/accountData.js')>(), isAccountDeleting: vi.fn(async () => false), readAccountAccess: vi.fn(async () => ({ deleting: false, profiled: true })) }));

vi.mock('../src/rateLimiter.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/rateLimiter.js')>(),
  consumePersistentRateLimit: vi.fn(async () => undefined),
}));

const persistence = vi.hoisted(() => ({ apply: vi.fn() }));
vi.mock('../src/bulkCardMutationPersistence.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/bulkCardMutationPersistence.js')>(),
  applyBulkCardMutationsForOwner: persistence.apply,
}));

const deleteCommand = { cardId: 'word-hello', baseRevision: 2, opId: 'delete-hello-a' };

beforeEach(() => {
  persistence.apply.mockReset();
  persistence.apply.mockResolvedValue({ results: [] });
});

it('rejects a command prepared for owner A when the request resumes authenticated as owner B', async () => {
  const { bulkMutateCards } = await import('../src/index.js');
  await expect(bulkMutateCards.run({
    auth: { uid: 'owner-b' },
    data: { expectedOwnerId: 'owner-a', libraryEpoch: 0, deletes: [deleteCommand] },
  } as never)).rejects.toMatchObject({ code: 'permission-denied' });
  expect(persistence.apply).not.toHaveBeenCalled();
});

it('applies a command whose expected owner is the authenticated owner', async () => {
  const { bulkMutateCards } = await import('../src/index.js');
  await expect(bulkMutateCards.run({
    auth: { uid: 'owner-a' },
    data: { expectedOwnerId: 'owner-a', libraryEpoch: 0, deletes: [deleteCommand] },
  } as never)).resolves.toEqual({ results: [] });
  expect(persistence.apply).toHaveBeenCalledWith(expect.anything(), 'owner-a', expect.objectContaining({ libraryEpoch: 0 }));
});

it('still accepts a request from a client that does not send an expected owner', async () => {
  const { bulkMutateCards } = await import('../src/index.js');
  await expect(bulkMutateCards.run({
    auth: { uid: 'owner-a' }, data: { libraryEpoch: 0, deletes: [deleteCommand] },
  } as never)).resolves.toEqual({ results: [] });
});

it('rejects an expected owner that is not a plain account id', async () => {
  const { bulkMutateCards } = await import('../src/index.js');
  await expect(bulkMutateCards.run({
    auth: { uid: 'owner-a' }, data: { expectedOwnerId: 'a/b', libraryEpoch: 0, deletes: [deleteCommand] },
  } as never)).rejects.toMatchObject({ code: 'invalid-argument' });
  expect(persistence.apply).not.toHaveBeenCalled();
});
