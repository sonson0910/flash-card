import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RateLimitExceededError } from '../src/rateLimiter.js';
import { AccountProfileMissingError } from '../src/account-profile-persistence.js';

const updateAccountUiLocale = vi.fn();
const consumePersistentRateLimit = vi.fn();
const isAccountDeleting = vi.fn();
const readAccountAccess = vi.fn();

vi.mock('../src/account-profile-persistence.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/account-profile-persistence.js')>(),
  updateAccountUiLocale: (...args: unknown[]) => updateAccountUiLocale(...args),
}));

vi.mock('../src/rateLimiter.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/rateLimiter.js')>(),
  consumePersistentRateLimit: (...args: unknown[]) => consumePersistentRateLimit(...args),
}));

vi.mock('../src/accountData.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/accountData.js')>(),
  isAccountDeleting: (...args: unknown[]) => isAccountDeleting(...args),
  readAccountAccess: (...args: unknown[]) => readAccountAccess(...args),
}));

type Callable = { run(request: unknown): Promise<unknown> };

const previousEnvironment = { ...process.env };
let callable: Callable;

beforeAll(async () => {
  process.env.ANALYTICS_PSEUDONYM_KEY = 'x'.repeat(32);
  callable = (await import('../src/index.js')).updateAccountUiLocale as unknown as Callable;
});

afterAll(() => {
  process.env = { ...previousEnvironment };
});

beforeEach(() => {
  updateAccountUiLocale.mockReset().mockResolvedValue({ uiLocale: 'en' });
  consumePersistentRateLimit.mockReset().mockResolvedValue(undefined);
  isAccountDeleting.mockReset().mockResolvedValue(false);
  readAccountAccess.mockReset().mockResolvedValue({ deleting: false, profiled: true });
});

const run = (data: unknown, auth: unknown = { uid: 'owner-1' }) => callable.run({ auth, data });
const signedOut = null;

describe('updateAccountUiLocale callable', () => {
  it('validates the request, spends the account budget and saves the language', async () => {
    await expect(run({ ownerId: 'owner-1', uiLocale: 'en' })).resolves.toEqual({ uiLocale: 'en' });
    expect(updateAccountUiLocale).toHaveBeenCalledWith(expect.anything(), 'owner-1', { ownerId: 'owner-1', uiLocale: 'en' });
    expect(consumePersistentRateLimit).toHaveBeenCalledWith(expect.anything(), 'owner-1', 'account-ui-locale', 60);
  });

  it('refuses signed-out callers, accounts without a profile and owner mismatches before any budget or write', async () => {
    await expect(run({ ownerId: 'owner-1', uiLocale: 'en' }, signedOut)).rejects.toMatchObject({ code: 'unauthenticated' });
    readAccountAccess.mockResolvedValueOnce({ deleting: false, profiled: false });
    await expect(run({ ownerId: 'no-profile', uiLocale: 'en' }, { uid: 'no-profile' }))
      .rejects.toMatchObject({ code: 'failed-precondition', details: { reason: 'account-profile-required' } });
    await expect(run({ ownerId: 'owner-2', uiLocale: 'en' })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(consumePersistentRateLimit).not.toHaveBeenCalled();
    expect(updateAccountUiLocale).not.toHaveBeenCalled();
  });

  it('maps malformed input to invalid-argument before any budget or write', async () => {
    for (const malformed of [{ ownerId: 'owner-1', uiLocale: 'fr' }, { ownerId: 'owner-1' }, { ownerId: 'owner-1', uiLocale: 'en', extra: 1 }]) {
      await expect(run(malformed)).rejects.toMatchObject({ code: 'invalid-argument' });
    }
    expect(consumePersistentRateLimit).not.toHaveBeenCalled();
    expect(updateAccountUiLocale).not.toHaveBeenCalled();
  });

  it('fails closed when the budget is exhausted and reports a profile that vanished meanwhile', async () => {
    consumePersistentRateLimit.mockRejectedValueOnce(new RateLimitExceededError(5_000));
    await expect(run({ ownerId: 'owner-1', uiLocale: 'en' })).rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(updateAccountUiLocale).not.toHaveBeenCalled();
    updateAccountUiLocale.mockRejectedValueOnce(new AccountProfileMissingError());
    await expect(run({ ownerId: 'owner-1', uiLocale: 'en' }))
      .rejects.toMatchObject({ code: 'failed-precondition', details: { reason: 'account-profile-required' } });
  });

  it('logs only the error name when the update fails unexpectedly', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      updateAccountUiLocale.mockRejectedValueOnce(new TypeError('transaction aborted for en'));
      await expect(run({ ownerId: 'owner-1', uiLocale: 'en' })).rejects.toMatchObject({ code: 'internal' });
      expect(error).toHaveBeenCalledWith('Account language update failed.', { errorName: 'TypeError' });
    } finally {
      error.mockRestore();
    }
  });
});
