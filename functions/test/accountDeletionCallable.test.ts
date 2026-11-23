import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const beginAccountDeletion = vi.fn();

vi.mock('../src/accountData.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/accountData.js')>(),
  beginAccountDeletion: (...args: unknown[]) => beginAccountDeletion(...args),
}));

type Callable = { run(request: unknown): Promise<unknown> };
const previousEnv = { ...process.env };
let deleteMyAccount: Callable;

beforeAll(async () => {
  process.env.ANALYTICS_PSEUDONYM_KEY = 'x'.repeat(32);
  ({ deleteMyAccount } = await import('../src/index.js') as unknown as { deleteMyAccount: Callable });
});

afterAll(() => { process.env = { ...previousEnv }; });

beforeEach(() => {
  beginAccountDeletion.mockReset().mockResolvedValue('waiting');
});

describe('deleteMyAccount callable', () => {
  const currentAuth = () => ({ uid: 'owner-a', token: { auth_time: Math.floor(Date.now() / 1_000) } });

  it.each([undefined, 'owner-b'])('rejects a missing or mismatched expected UID before deletion: %s', async expectedUid => {
    await expect(deleteMyAccount.run({
      auth: currentAuth(), data: { confirmation: 'XÓA TÀI KHOẢN', ...(expectedUid === undefined ? {} : { expectedUid }) },
    })).rejects.toMatchObject({ code: 'permission-denied' });

    expect(beginAccountDeletion).not.toHaveBeenCalled();
  });

  it('starts deletion only when the expected UID matches the authenticated owner', async () => {
    await expect(deleteMyAccount.run({
      auth: currentAuth(), data: { confirmation: 'XÓA TÀI KHOẢN', expectedUid: 'owner-a' },
    })).resolves.toEqual({ status: 'waiting' });

    expect(beginAccountDeletion).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'owner-a', 'x'.repeat(32));
  });
});
