import { HttpsError } from 'firebase-functions/v2/https';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const readAccountAccess = vi.fn();

vi.mock('../src/accountData.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/accountData.js')>(),
  isAccountDeleting: vi.fn().mockResolvedValue(false),
  readAccountAccess: (...args: unknown[]) => readAccountAccess(...args),
}));

type Callable = { run(request: unknown): Promise<unknown> };

const previousEnv = { ...globalThis.process.env };
let callables: Record<string, Callable>;

beforeAll(async () => {
  globalThis.process.env.ANALYTICS_PSEUDONYM_KEY = 'x'.repeat(32);
  readAccountAccess.mockResolvedValue({ deleting: false, profiled: true });
  callables = await import('../src/index.js') as unknown as Record<string, Callable>;
});

afterAll(() => {
  globalThis.process.env = { ...previousEnv };
});

describe('callables that act for the signed-in account', () => {
  it.each([
    ['createStarterCards', { operationId: 'starter-en-vi', cards: [{}] }],
    ['reportCard', { cardId: 'word-focus', reason: 'other' }],
  ])('%s refuses a request prepared for another account before spending any budget', async (name, data) => {
    const error = await callables[name]!.run({
      auth: { uid: 'owner-b', token: {} },
      data: { ...data, expectedOwnerId: 'owner-a' },
    }).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(HttpsError);
    expect(error).toMatchObject({ code: 'permission-denied' });
  });
});
