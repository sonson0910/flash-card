import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('../src/accountData.js', async importOriginal => ({ ...await importOriginal<typeof import('../src/accountData.js')>(), isAccountDeleting: vi.fn(async () => false), readAccountAccess: vi.fn(async () => ({ deleting: false, profiled: true })) }));

vi.mock('../src/rateLimiter.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/rateLimiter.js')>(),
  consumePersistentRateLimit: vi.fn(async () => undefined),
}));

const persistence = vi.hoisted(() => ({ rename: vi.fn() }));
vi.mock('../src/cardPersistence.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/cardPersistence.js')>(),
  renameCardHeadwordForOwner: persistence.rename,
}));

const request = { cardId: 'word-hello', word: 'Goodbye', baseRevision: 1, libraryEpoch: 0 };

beforeEach(() => {
  persistence.rename.mockReset();
  persistence.rename.mockResolvedValue({ card: { id: 'word-hello' } });
});

it('rejects a rename prepared for owner A when the request resumes authenticated as owner B', async () => {
  const { renameCardHeadword } = await import('../src/index.js');
  await expect(renameCardHeadword.run({
    auth: { uid: 'owner-b' }, data: { ...request, expectedOwnerId: 'owner-a' },
  } as never)).rejects.toMatchObject({ code: 'permission-denied' });
  expect(persistence.rename).not.toHaveBeenCalled();
}, 30_000);

it('renames when the expected owner is the authenticated owner', async () => {
  const { renameCardHeadword } = await import('../src/index.js');
  await expect(renameCardHeadword.run({
    auth: { uid: 'owner-a' }, data: { ...request, expectedOwnerId: 'owner-a' },
  } as never)).resolves.toEqual({ card: { id: 'word-hello' } });
  expect(persistence.rename).toHaveBeenCalledWith(expect.anything(), 'owner-a', expect.objectContaining({ cardId: 'word-hello' }));
}, 30_000);

it('still accepts a request from a client that does not send an expected owner', async () => {
  const { renameCardHeadword } = await import('../src/index.js');
  await expect(renameCardHeadword.run({
    auth: { uid: 'owner-a' }, data: request,
  } as never)).resolves.toEqual({ card: { id: 'word-hello' } });
});

it('rejects an expected owner that is not a plain account id', async () => {
  const { renameCardHeadword } = await import('../src/index.js');
  await expect(renameCardHeadword.run({
    auth: { uid: 'owner-a' }, data: { ...request, expectedOwnerId: 'a/b' },
  } as never)).rejects.toMatchObject({ code: 'invalid-argument' });
  expect(persistence.rename).not.toHaveBeenCalled();
});
