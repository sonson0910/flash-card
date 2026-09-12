import { expect, it, vi } from 'vitest';

const persistence = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('../src/cardPersistence.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/cardPersistence.js')>(),
  createCardForOwner: persistence.create,
}));

it('rejects an operation prepared for A when dispatch resumes authenticated as B', async () => {
  const { createCard } = await import('../src/index.js');
  const data = { expectedOwnerId: 'owner-a', card: { id: 'hello', word: 'hello', translation: 'xin chào', explanation: 'greeting', phonetic: '', category: 'Basics', emoji: '', audioUrl: null, imageUrl: null } };
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
