import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RateLimitExceededError } from '../src/rateLimiter.js';
import { CURRENT_PRIVACY_VERSION, CURRENT_TERMS_VERSION } from '../src/account-profile-contract.js';
import {
  AccountProfileConsentOutdatedError,
  AccountProfileStoredDataError,
} from '../src/account-profile-persistence.js';

const completeAccountProfile = vi.fn();
const consumePersistentRateLimit = vi.fn();
const isAccountDeleting = vi.fn();

vi.mock('../src/account-profile-persistence.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/account-profile-persistence.js')>(),
  completeAccountProfile: (...args: unknown[]) => completeAccountProfile(...args),
}));

vi.mock('../src/rateLimiter.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/rateLimiter.js')>(),
  consumePersistentRateLimit: (...args: unknown[]) => consumePersistentRateLimit(...args),
}));

vi.mock('../src/accountData.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/accountData.js')>(),
  isAccountDeleting: (...args: unknown[]) => isAccountDeleting(...args),
}));

type Callable = { run(request: unknown): Promise<unknown> };

const data = (overrides: Record<string, unknown> = {}) => ({
  ownerId: 'owner-1',
  birthYear: 1994,
  uiLocale: 'en',
  nativeLanguage: 'vi',
  consent: { accepted: true, termsVersion: CURRENT_TERMS_VERSION, privacyVersion: CURRENT_PRIVACY_VERSION },
  ...overrides,
});

const completed = {
  status: 'complete',
  profile: {
    birthYear: 1994,
    uiLocale: 'en',
    nativeLanguage: 'vi',
    termsVersion: CURRENT_TERMS_VERSION,
    privacyVersion: CURRENT_PRIVACY_VERSION,
    consentAcceptedAt: '2026-11-19T00:00:00.000Z',
    completedAt: '2026-11-19T00:00:00.000Z',
  },
};

const previousEnv = { ...process.env };
let callable: Callable;

beforeAll(async () => {
  process.env.ANALYTICS_PSEUDONYM_KEY = 'x'.repeat(32);
  callable = (await import('../src/index.js')).completeAccountProfile as unknown as Callable;
});

afterAll(() => {
  process.env = { ...previousEnv };
});

beforeEach(() => {
  completeAccountProfile.mockReset().mockResolvedValue(completed);
  consumePersistentRateLimit.mockReset().mockResolvedValue(undefined);
  isAccountDeleting.mockReset().mockResolvedValue(false);
});

describe('completeAccountProfile callable', () => {
  it('validates the request, spends the account budget and returns the stored outcome', async () => {
    await expect(callable.run({ auth: { uid: 'owner-1' }, data: data() })).resolves.toEqual(completed);
    expect(completeAccountProfile).toHaveBeenCalledWith(expect.anything(), 'owner-1', data());
    expect(consumePersistentRateLimit).toHaveBeenCalledWith(expect.anything(), 'owner-1', 'account-profile', 20);
  });

  it('returns the restricted outcome as data, not as an error', async () => {
    completeAccountProfile.mockResolvedValueOnce({ status: 'restricted', restrictedAt: '2026-11-19T00:00:00.000Z' });
    await expect(callable.run({ auth: { uid: 'owner-1' }, data: data({ birthYear: 2012 }) }))
      .resolves.toEqual({ status: 'restricted', restrictedAt: '2026-11-19T00:00:00.000Z' });
  });

  it('denies signed-out callers, accounts being deleted and owner mismatches before any budget or write', async () => {
    await expect(callable.run({ auth: undefined, data: data() })).rejects.toMatchObject({ code: 'unauthenticated' });
    isAccountDeleting.mockResolvedValueOnce(true);
    await expect(callable.run({ auth: { uid: 'owner-1' }, data: data() })).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(callable.run({ auth: { uid: 'owner-1' }, data: data({ ownerId: 'owner-2' }) }))
      .rejects.toMatchObject({ code: 'permission-denied' });
    expect(consumePersistentRateLimit).not.toHaveBeenCalled();
    expect(completeAccountProfile).not.toHaveBeenCalled();
  });

  it('maps malformed input to invalid-argument before any budget or write', async () => {
    for (const malformed of [data({ birthYear: '1994' }), data({ uiLocale: 'fr' }), data({ consent: { accepted: false } }), data({ extra: 1 })]) {
      await expect(callable.run({ auth: { uid: 'owner-1' }, data: malformed })).rejects.toMatchObject({ code: 'invalid-argument' });
    }
    expect(consumePersistentRateLimit).not.toHaveBeenCalled();
    expect(completeAccountProfile).not.toHaveBeenCalled();
  });

  it('maps outdated consent and stored-data errors to failed-precondition reasons', async () => {
    completeAccountProfile.mockRejectedValueOnce(new AccountProfileConsentOutdatedError());
    await expect(callable.run({ auth: { uid: 'owner-1' }, data: data() }))
      .rejects.toMatchObject({ code: 'failed-precondition', details: { reason: 'consent-outdated' } });
    completeAccountProfile.mockRejectedValueOnce(new AccountProfileStoredDataError(new Error('bad')));
    await expect(callable.run({ auth: { uid: 'owner-1' }, data: data() }))
      .rejects.toMatchObject({ code: 'failed-precondition', details: { reason: 'profile-invalid' } });
  });

  it('fails closed when the budget is exhausted', async () => {
    consumePersistentRateLimit.mockRejectedValueOnce(new RateLimitExceededError(5_000));
    await expect(callable.run({ auth: { uid: 'owner-1' }, data: data() })).rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(completeAccountProfile).not.toHaveBeenCalled();
  });

  it('logs only the error name when completion fails unexpectedly', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      completeAccountProfile.mockRejectedValueOnce(new TypeError('transaction aborted for 1994'));
      await expect(callable.run({ auth: { uid: 'owner-1' }, data: data() })).rejects.toMatchObject({ code: 'internal' });
      expect(error).toHaveBeenCalledWith('Account profile completion failed.', { errorName: 'TypeError' });
      expect(JSON.stringify(error.mock.calls)).not.toContain('1994');
    } finally {
      error.mockRestore();
    }
  });
});
