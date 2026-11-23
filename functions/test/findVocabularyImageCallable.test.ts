import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const consumePersistentRateLimit = vi.fn();
const consumePersistentRateLimits = vi.fn();

vi.mock('../src/rateLimiter.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/rateLimiter.js')>(),
  consumePersistentRateLimit: (...args: unknown[]) => consumePersistentRateLimit(...args),
  consumePersistentRateLimits: (...args: unknown[]) => consumePersistentRateLimits(...args),
}));
vi.mock('../src/accountData.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/accountData.js')>(),
  isAccountDeleting: async () => false,
  readAccountAccess: async () => ({ deleting: false, profiled: true }),
}));

type Callable = { run(request: unknown): Promise<unknown> };
const previousEnvironment = { ...process.env };
let findVocabularyImage: Callable;

beforeAll(async () => {
  process.env.ANALYTICS_PSEUDONYM_KEY = 'x'.repeat(32);
  findVocabularyImage = (await import('../src/index.js')).findVocabularyImage as unknown as Callable;
});

afterAll(() => { process.env = { ...previousEnvironment }; });

const wikipediaThumbnail = 'https://upload.wikimedia.org/wikipedia/commons/thumb/river.jpg';
const fetchMock = vi.fn();
const request = { auth: { uid: 'owner-1' }, data: { word: 'river', query: 'river' } };

beforeEach(() => {
  consumePersistentRateLimit.mockReset().mockResolvedValue(undefined);
  consumePersistentRateLimits.mockReset().mockResolvedValue(undefined);
  fetchMock.mockReset().mockImplementation(async (url: string) => {
    if (!url.startsWith('https://en.wikipedia.org/')) throw new Error(`unexpected provider call: ${url}`);
    return new Response(JSON.stringify({ query: { pages: { 1: { thumbnail: { source: wikipediaThumbnail } } } } }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('findVocabularyImage', () => {
  it('falls back to the free encyclopedia when the paid provider budget is used up', async () => {
    const { RateLimitExceededError } = await import('../src/rateLimiter.js');
    consumePersistentRateLimits.mockRejectedValue(new RateLimitExceededError(60_000));

    await expect(findVocabularyImage.run(request)).resolves.toEqual({ imageUrl: wikipediaThumbnail });

    expect(fetchMock.mock.calls.map(call => new URL(String(call[0])).hostname)).toEqual(['en.wikipedia.org']);
    // The exhausted budget is read once, not once per paid provider.
    expect(consumePersistentRateLimits).toHaveBeenCalledTimes(1);
  });

  it('reports a transient failure when the budget is used up and the encyclopedia has no image', async () => {
    const { RateLimitExceededError } = await import('../src/rateLimiter.js');
    consumePersistentRateLimits.mockRejectedValue(new RateLimitExceededError(60_000));
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ query: { pages: {} } }), { status: 200 }));

    await expect(findVocabularyImage.run(request)).resolves.toEqual({ imageUrl: null, status: 'transient' });
  });

  it('falls back when the budget counter cannot be written in time', async () => {
    const { RateLimitStorageTimeoutError } = await import('../src/rateLimiter.js');
    consumePersistentRateLimits.mockRejectedValue(new RateLimitStorageTimeoutError());

    await expect(findVocabularyImage.run(request)).resolves.toEqual({ imageUrl: wikipediaThumbnail });
  });

  it('still refuses a learner whose own hourly image limit is used up', async () => {
    const { RateLimitExceededError } = await import('../src/rateLimiter.js');
    consumePersistentRateLimit.mockRejectedValue(new RateLimitExceededError(60_000));

    await expect(findVocabularyImage.run(request)).rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
