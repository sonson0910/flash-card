import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const createCardV2ForOwner = vi.fn();
const parseCreateCardV2Request = vi.fn();
const startPracticeSessionV1ForOwner = vi.fn();
const parseStartPracticeSessionV1Request = vi.fn();
const completePracticeSessionV1ForOwner = vi.fn();
const parseCompletePracticeSessionV1Request = vi.fn();
const equipOwnedFrameForOwner = vi.fn();
const updateReminderSettingsForOwner = vi.fn();
const revokePushTokenForOwner = vi.fn();
const endPushSessionForOwner = vi.fn();
const parseReminderSettingsRequest = vi.fn();
const parsePushTokenRequest = vi.fn();
const parseEndPushSessionRequest = vi.fn();
const consumePersistentRateLimit = vi.fn();
const isAccountDeleting = vi.fn();

vi.mock('../src/cardPersistence.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/cardPersistence.js')>(),
  createCardV2ForOwner: (...args: unknown[]) => createCardV2ForOwner(...args),
  parseCreateCardV2Request: (...args: unknown[]) => parseCreateCardV2Request(...args),
}));
vi.mock('../src/practiceSessionPersistence.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/practiceSessionPersistence.js')>(),
  startPracticeSessionV1: (...args: unknown[]) => startPracticeSessionV1ForOwner(...args),
  parseStartPracticeSessionV1Request: (...args: unknown[]) => parseStartPracticeSessionV1Request(...args),
  completePracticeSessionV1: (...args: unknown[]) => completePracticeSessionV1ForOwner(...args),
  parseCompletePracticeSessionV1Request: (...args: unknown[]) => parseCompletePracticeSessionV1Request(...args),
}));
vi.mock('../src/verifiedGamification.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/verifiedGamification.js')>(),
  equipOwnedFrame: (...args: unknown[]) => equipOwnedFrameForOwner(...args),
}));
vi.mock('../src/reminderSettingsPersistence.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/reminderSettingsPersistence.js')>(),
  updateReminderSettingsForOwner: (...args: unknown[]) => updateReminderSettingsForOwner(...args),
  revokePushTokenForOwner: (...args: unknown[]) => revokePushTokenForOwner(...args),
  endPushSessionForOwner: (...args: unknown[]) => endPushSessionForOwner(...args),
  parseReminderSettingsRequest: (...args: unknown[]) => parseReminderSettingsRequest(...args),
  parsePushTokenRequest: (...args: unknown[]) => parsePushTokenRequest(...args),
  parseEndPushSessionRequest: (...args: unknown[]) => parseEndPushSessionRequest(...args),
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
const previousEnv = { ...process.env };
let handlers: Record<'createCardV2' | 'startPracticeSessionV1' | 'completePracticeSessionV1' | 'equipOwnedFrame' | 'updateReminderSettings' | 'revokePushToken' | 'endPushSession', Callable>;

beforeAll(async () => {
  process.env.ANALYTICS_PSEUDONYM_KEY = 'x'.repeat(32);
  const module = await import('../src/index.js');
  handlers = {
    createCardV2: module.createCardV2 as unknown as Callable,
    startPracticeSessionV1: module.startPracticeSessionV1 as unknown as Callable,
    completePracticeSessionV1: module.completePracticeSessionV1 as unknown as Callable,
    equipOwnedFrame: module.equipOwnedFrame as unknown as Callable,
    updateReminderSettings: module.updateReminderSettings as unknown as Callable,
    revokePushToken: module.revokePushToken as unknown as Callable,
    endPushSession: module.endPushSession as unknown as Callable,
  };
});

afterAll(() => { process.env = { ...previousEnv }; });

beforeEach(() => {
  createCardV2ForOwner.mockReset().mockResolvedValue({ created: true });
  parseCreateCardV2Request.mockReset().mockReturnValue({ card: { id: 'card-1' }, opId: 'create-1', timeZone: 'UTC' });
  startPracticeSessionV1ForOwner.mockReset().mockResolvedValue({ sessionId: 'practice-1' });
  parseStartPracticeSessionV1Request.mockReset().mockReturnValue({ opId: 'practice-1', game: 'quiz', cardIds: ['card-1'] });
  completePracticeSessionV1ForOwner.mockReset().mockResolvedValue({ sessionId: 'practice-1', awardedXp: 5 });
  parseCompletePracticeSessionV1Request.mockReset().mockReturnValue({ sessionId: 'practice-1', completionId: 'complete-1', answers: { responses: { 'card-1': 'answer' } } });
  equipOwnedFrameForOwner.mockReset().mockResolvedValue({ equippedFrameId: 'crimson-wing' });
  updateReminderSettingsForOwner.mockReset().mockResolvedValue({ channels: { push: false } });
  revokePushTokenForOwner.mockReset().mockResolvedValue(true);
  endPushSessionForOwner.mockReset().mockResolvedValue(undefined);
  parseReminderSettingsRequest.mockReset().mockReturnValue({ channels: { push: false, emailDigest: false } });
  parsePushTokenRequest.mockReset().mockReturnValue('a'.repeat(64));
  parseEndPushSessionRequest.mockReset().mockReturnValue('owner-1');
  consumePersistentRateLimit.mockReset().mockResolvedValue(undefined);
  isAccountDeleting.mockReset().mockResolvedValue(false);
});

describe('server authority callables', () => {
  it('routes verified create and practice operations through server persistence with rate limits', async () => {
    await expect(handlers.createCardV2.run({ auth: { uid: 'owner-1' }, data: {} })).resolves.toEqual({ created: true });
    await expect(handlers.startPracticeSessionV1.run({ auth: { uid: 'owner-1' }, data: {} })).resolves.toEqual({ sessionId: 'practice-1' });
    await expect(handlers.completePracticeSessionV1.run({ auth: { uid: 'owner-1' }, data: {} })).resolves.toEqual({ sessionId: 'practice-1', awardedXp: 5 });

    expect(createCardV2ForOwner).toHaveBeenCalledWith(expect.anything(), 'owner-1', { id: 'card-1' }, expect.objectContaining({ opId: 'create-1', timeZone: 'UTC' }));
    expect(startPracticeSessionV1ForOwner).toHaveBeenCalledWith(expect.anything(), 'owner-1', expect.anything(), expect.any(Date));
    expect(completePracticeSessionV1ForOwner).toHaveBeenCalledWith(expect.anything(), 'owner-1', expect.anything(), expect.any(Date));
    expect(consumePersistentRateLimit.mock.calls.map(call => call[2])).toEqual([
      'card-create', 'practice-session-start', 'practice-session-complete',
    ]);
  });

  it('equips an owned frame through the server and rejects malformed input before a rate-limit write', async () => {
    await expect(handlers.equipOwnedFrame.run({ auth: { uid: 'owner-1' }, data: { frameId: 'crimson-wing' } }))
      .resolves.toEqual({ equippedFrameId: 'crimson-wing' });
    expect(equipOwnedFrameForOwner).toHaveBeenCalledWith(expect.anything(), 'owner-1', 'crimson-wing');
    expect(consumePersistentRateLimit).toHaveBeenCalledWith(expect.anything(), 'owner-1', 'reward-frame-equip', 30);

    consumePersistentRateLimit.mockClear();
    await expect(handlers.equipOwnedFrame.run({ auth: { uid: 'owner-1' }, data: { frameId: 'crimson-wing', extra: true } }))
      .rejects.toMatchObject({ code: 'invalid-argument' });
    expect(consumePersistentRateLimit).not.toHaveBeenCalled();
  });

  it('requires authentication before parsing or writing a rate-limit budget', async () => {
    await expect(handlers.startPracticeSessionV1.run({ data: {} })).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(parseStartPracticeSessionV1Request).not.toHaveBeenCalled();
    expect(consumePersistentRateLimit).not.toHaveBeenCalled();
  });

  it('routes reminder settings and token revocation through owner-scoped persistence', async () => {
    const auth = { uid: 'owner-1', token: { auth_time: 100 } };
    await expect(handlers.updateReminderSettings.run({ auth, data: {} }))
      .resolves.toEqual({ saved: true });
    await expect(handlers.revokePushToken.run({ auth, data: { endSession: true, expectedOwnerId: 'owner-1' } }))
      .resolves.toEqual({ revoked: true });
    expect(updateReminderSettingsForOwner).toHaveBeenCalledWith(expect.anything(), 'owner-1', expect.anything(), expect.any(Date), 100);
    expect(revokePushTokenForOwner).toHaveBeenCalledWith(expect.anything(), 'owner-1', 'a'.repeat(64), expect.any(Date), true, 100);
    expect(consumePersistentRateLimit.mock.calls.map(call => call[2])).toEqual([
      'reminder-settings', 'push-token-revoke',
    ]);
  });

  it('ends all server push tokens without a local token and rejects a stale owner or auth session', async () => {
    const auth = { uid: 'owner-1', token: { auth_time: 100 } };
    await expect(handlers.endPushSession.run({ auth, data: { expectedOwnerId: 'owner-1' } }))
      .resolves.toEqual({ ended: true });
    expect(endPushSessionForOwner).toHaveBeenCalledWith(expect.anything(), 'owner-1', 100, expect.any(Date));
    expect(consumePersistentRateLimit).toHaveBeenCalledWith(expect.anything(), 'owner-1', 'push-session-end', 30);

    parseEndPushSessionRequest.mockReturnValueOnce('owner-2');
    await expect(handlers.endPushSession.run({ auth, data: { expectedOwnerId: 'owner-2' } }))
      .rejects.toMatchObject({ code: 'permission-denied' });
    await expect(handlers.endPushSession.run({ auth: { uid: 'owner-1', token: {} }, data: { expectedOwnerId: 'owner-1' } }))
      .rejects.toMatchObject({ code: 'failed-precondition' });
  });
});
