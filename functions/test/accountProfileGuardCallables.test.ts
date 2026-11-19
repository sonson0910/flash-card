import { HttpsError } from 'firebase-functions/v2/https';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Every exported callable is classified here on purpose. A new callable fails this test until it is added
// to one list, and each entry is checked against what the endpoint really does.

/** Creates or changes learner content, grants rewards or spends provider money. */
const PROFILE_REQUIRED = [
  'saveGamification', 'updateLibraryFacets',
  'generateVocabulary', 'askCardTutor', 'findVocabularyImage', 'assessPronunciation',
  'createCard', 'createCardV2', 'createStarterCards', 'renameCardHeadword', 'bulkMutateCards', 'clearLibraryCardsPage',
  'reviewCard', 'reviewCardV2', 'startPracticeSessionV1', 'completePracticeSessionV1', 'equipOwnedFrame',
  'reportCard', 'getPilotOffer', 'recordPurchaseIntent', 'updateReminderSettings',
  'createSharedDeck', 'createSharedDeckV2', 'revokeSharedDeck', 'migrateLegacyLibrary',
  'createCourse', 'updateCourse', 'archiveCourse', 'reopenCourse', 'setActiveCourse', 'addGoal', 'updateGoal', 'removeGoal',
] as const;

/** The profile step itself, the account data export and deletion, and calls that end or clean up a session. */
const PROFILE_NOT_REQUIRED = [
  'completeAccountProfile', 'exportMyData', 'deleteMyAccount',
  'recordClientEvents', 'revokePushToken', 'endPushSession', 'cancelCardGeneration',
] as const;

const isAccountDeleting = vi.fn();
const readAccountAccess = vi.fn();

vi.mock('../src/accountData.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/accountData.js')>(),
  isAccountDeleting: (...args: unknown[]) => isAccountDeleting(...args),
  readAccountAccess: (...args: unknown[]) => readAccountAccess(...args),
}));

class PlainAuthenticationReached extends Error {}

type Callable = { run(request: unknown): Promise<unknown>; __endpoint?: { callableTrigger?: unknown } };

const previousEnv = { ...process.env };
let callables: Record<string, Callable>;

beforeAll(async () => {
  process.env.ANALYTICS_PSEUDONYM_KEY = 'x'.repeat(32);
  const module = await import('../src/index.js') as unknown as Record<string, unknown>;
  callables = Object.fromEntries(Object.entries(module).filter(([, value]) =>
    typeof value === 'function' && Boolean((value as unknown as Callable).__endpoint?.callableTrigger))) as Record<string, Callable>;
});

afterAll(() => {
  process.env = { ...previousEnv };
});

beforeEach(() => {
  // Stop both paths right after their account check, so no endpoint reaches a store or a provider.
  isAccountDeleting.mockReset().mockRejectedValue(new PlainAuthenticationReached());
  readAccountAccess.mockReset().mockResolvedValue({ deleting: false, profiled: false });
});

const runWithoutProfile = async (name: string) => {
  try {
    await callables[name]!.run({ auth: { uid: `owner-${name}`, token: {} }, data: {} });
    return null;
  } catch (error) {
    return error;
  }
};

describe('account profile requirement on callables', () => {
  it('classifies every exported callable exactly once', () => {
    const classified = [...PROFILE_REQUIRED, ...PROFILE_NOT_REQUIRED];
    expect(new Set(classified).size).toBe(classified.length);
    expect(Object.keys(callables).sort()).toEqual([...classified].sort());
  });

  it.each(PROFILE_REQUIRED)('%s refuses an account without a completed profile', async name => {
    const error = await runWithoutProfile(name);
    expect(error).toBeInstanceOf(HttpsError);
    expect(error).toMatchObject({ code: 'failed-precondition', details: { reason: 'account-profile-required' } });
    expect(readAccountAccess).toHaveBeenCalledWith(expect.anything(), `owner-${name}`, expect.any(String));
  });

  it.each(PROFILE_NOT_REQUIRED)('%s does not ask for the account profile', async name => {
    const error = await runWithoutProfile(name);
    expect(error).not.toMatchObject({ details: { reason: 'account-profile-required' } });
    expect(readAccountAccess).not.toHaveBeenCalled();
  });

  it('refuses an account in deletion with the existing message on a profile-guarded callable', async () => {
    readAccountAccess.mockResolvedValueOnce({ deleting: true, profiled: true });
    await expect(callables.createCourse!.run({ auth: { uid: 'owner-deleting', token: {} }, data: {} }))
      .rejects.toMatchObject({ code: 'permission-denied', message: 'This account is being deleted.' });
  });

  it('refuses signed-out callers before any read', async () => {
    await expect(callables.createCourse!.run({ data: {} })).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(readAccountAccess).not.toHaveBeenCalled();
  });
});
