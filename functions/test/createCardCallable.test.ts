import { expect, it, vi } from 'vitest';

vi.mock('../src/accountData.js', async importOriginal => ({ ...await importOriginal<typeof import('../src/accountData.js')>(), isAccountDeleting: vi.fn(async () => false) }));

const persistence = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('../src/cardPersistence.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/cardPersistence.js')>(),
  createCardForOwner: persistence.create,
}));

it.each(['createCard', 'createCardV2'] as const)('%s rejects an operation prepared for A when dispatch resumes authenticated as B', async callableName => {
  const module = await import('../src/index.js');
  const createCard = module[callableName];
  const data = { opId: 'owner-create-1', operationCreatedAt: '2026-10-15T00:00:00.000Z', timeZone: 'UTC', expectedOwnerId: 'owner-a', card: { id: 'hello', word: 'hello', translation: 'xin chào', explanation: 'greeting', phonetic: '', category: 'Basics', emoji: '', audioUrl: null, imageUrl: null } };
  if (callableName === 'createCard') Reflect.deleteProperty(data, 'timeZone');
  let resume!: () => void;
  const barrier = new Promise<void>(resolve => { resume = resolve; });
  let authenticatedOwner = 'owner-a';
  const dispatch = (async () => {
    await barrier;
    return createCard.run({ auth: { uid: authenticatedOwner }, data } as never);
  })();
  authenticatedOwner = 'owner-b';
  resume();
  await expect(dispatch).rejects.toMatchObject({ code: 'permission-denied' });
  expect(persistence.create).not.toHaveBeenCalled();
});

it('requires an expected owner even for legacy queued creates', async () => {
  const { createCard } = await import('../src/index.js');
  await expect(createCard.run({ auth: { uid: 'owner-a' }, data: { card: {} } } as never))
    .rejects.toMatchObject({ code: 'invalid-argument' });
});
