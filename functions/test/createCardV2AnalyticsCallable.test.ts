import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const createCardV2ForOwner = vi.fn();
const emitAnalyticsBestEffort = vi.fn(async (..._args: unknown[]) => undefined);

vi.mock('../src/cardPersistence.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/cardPersistence.js')>(),
  createCardV2ForOwner: (...args: unknown[]) => createCardV2ForOwner(...args),
  parseCreateCardV2Request: () => ({
    expectedOwnerId: 'owner-1', card: { id: 'card-1' }, opId: 'create-1', timeZone: 'UTC',
  }),
}));
vi.mock('../src/analyticsEvents.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/analyticsEvents.js')>(),
  emitAnalyticsBestEffort: (...args: unknown[]) => emitAnalyticsBestEffort(...args),
}));
vi.mock('../src/pilotConfig.js', async importOriginal => {
  const original = await importOriginal<typeof import('../src/pilotConfig.js')>();
  return { ...original, loadPilotConfig: async () => ({ ...original.PILOT_CONFIG_DEFAULTS, analyticsEnabled: true }) };
});
vi.mock('../src/rateLimiter.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/rateLimiter.js')>(),
  consumePersistentRateLimit: async () => undefined,
  consumePersistentRateLimits: async () => undefined,
}));
vi.mock('../src/accountData.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/accountData.js')>(),
  isAccountDeleting: async () => false,
  readAccountAccess: async () => ({ deleting: false, profiled: true }),
}));

type Callable = { run(request: unknown): Promise<unknown> };
const previousEnvironment = { ...process.env };
let createCardV2: Callable;

beforeAll(async () => {
  process.env.ANALYTICS_PSEUDONYM_KEY = 'x'.repeat(32);
  createCardV2 = (await import('../src/index.js')).createCardV2 as unknown as Callable;
});

afterAll(() => { process.env = { ...previousEnvironment }; });

beforeEach(() => { emitAnalyticsBestEffort.mockClear(); });

const run = () => createCardV2.run({ auth: { uid: 'owner-1' }, data: {} });
const emittedCaptures = () => emitAnalyticsBestEffort.mock.calls.filter(call => call[4] === 'capture_completed');

describe('createCardV2 capture analytics', () => {
  it('records one capture with its origin and an opaque card reference for a new card', async () => {
    createCardV2ForOwner.mockResolvedValue({ created: true, card: { id: 'card-1', origin: 'ai' }, gamification: null });

    await expect(run()).resolves.toEqual({ created: true, card: { id: 'card-1', origin: 'ai' }, gamification: null });

    expect(emittedCaptures()).toHaveLength(1);
    expect(emittedCaptures()[0][5]).toEqual({ origin: 'ai', cardRef: expect.stringMatching(/^[0-9a-f]{32}$/) });
    expect(JSON.stringify(emittedCaptures()[0][5])).not.toContain('card-1');
  });

  it('records a manual capture for a card without an AI origin', async () => {
    createCardV2ForOwner.mockResolvedValue({ created: true, card: { id: 'card-1', origin: 'manual' }, gamification: null });
    await run();
    expect(emittedCaptures()[0][5]).toMatchObject({ origin: 'manual' });
  });

  it('records nothing when the card already existed', async () => {
    createCardV2ForOwner.mockResolvedValue({ created: false, card: { id: 'card-1', origin: 'manual' }, gamification: null });
    await run();
    expect(emittedCaptures()).toEqual([]);
  });

  it('records nothing when the same operation is replayed from its receipt, and keeps the marker off the response', async () => {
    createCardV2ForOwner.mockResolvedValue({
      created: true, card: { id: 'card-1', origin: 'manual' }, gamification: null, replayed: true,
    });

    await expect(run()).resolves.toEqual({ created: true, card: { id: 'card-1', origin: 'manual' }, gamification: null });

    expect(emittedCaptures()).toEqual([]);
  });
});
