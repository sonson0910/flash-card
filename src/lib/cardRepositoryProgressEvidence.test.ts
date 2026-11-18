import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getCountFromServer: vi.fn(), getDocs: vi.fn() }));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((...args: unknown[]) => ({ type: 'collection', args })), doc: vi.fn(), documentId: vi.fn(), endAt: vi.fn(),
  getCountFromServer: mocks.getCountFromServer, getDocs: mocks.getDocs, getDocsFromServer: vi.fn(), getDoc: vi.fn(), limit: vi.fn((...args: unknown[]) => ({ type: 'limit', args })), onSnapshot: vi.fn(), orderBy: vi.fn((...args: unknown[]) => ({ type: 'orderBy', args })), query: vi.fn((...args: unknown[]) => ({ type: 'query', args })), runTransaction: vi.fn(), serverTimestamp: vi.fn(), setDoc: vi.fn(), startAfter: vi.fn(), startAt: vi.fn(), where: vi.fn((...args: unknown[]) => ({ type: 'where', args })), writeBatch: vi.fn(),
}));
vi.mock('./firebase', () => ({ app: null, auth: null, isFirebaseConfigured: false, protectedFunctionsCapability: { available: false } }));

import { fetchProgressEvidence } from './cardRepository';

const storage = new Map<string, string>();

describe('fetchProgressEvidence', () => {
  beforeEach(() => {
    storage.clear(); mocks.getCountFromServer.mockReset(); mocks.getDocs.mockReset();
    vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
    mocks.getCountFromServer.mockResolvedValue({ data: () => ({ count: 2 }) });
    mocks.getDocs.mockResolvedValue({ docs: [] });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('keeps Catalog-safe forecast reads to once per owner, language and local day', async () => {
    const now = new Date(2026, 8, 27, 10);
    await fetchProgressEvidence({} as never, 'owner-a', 'en', now);
    await fetchProgressEvidence({} as never, 'owner-a', 'en', now);
    await fetchProgressEvidence({} as never, 'owner-a', 'ko', now);

    expect(mocks.getCountFromServer).toHaveBeenCalledTimes(26);
    expect(mocks.getDocs).toHaveBeenCalledTimes(3);
  });
  it('shares concurrent same-key forecasts while retaining each hydration recent-card read', async () => {
    const now = new Date(2026, 8, 27, 10);
    const count = { data: () => ({ count: 2 }) };
    let release!: () => void;
    const held = new Promise<typeof count>(resolve => { release = () => resolve(count); });
    mocks.getCountFromServer.mockReturnValue(held);

    const first = fetchProgressEvidence({} as never, 'owner-b', 'en', now);
    const second = fetchProgressEvidence({} as never, 'owner-b', 'en', now);
    await Promise.resolve();
    expect(mocks.getCountFromServer).toHaveBeenCalledTimes(13);
    expect(mocks.getDocs).toHaveBeenCalledTimes(2);

    release();
    await Promise.all([first, second]);
    expect(mocks.getCountFromServer).toHaveBeenCalledTimes(13);
  });

  it('labels forecast days in the local calendar date', async () => {
    const now = new Date('2026-09-27T18:30:00.000Z');
    const result = await fetchProgressEvidence({} as never, 'owner-c', 'en', now);
    const expectedTomorrow = new Date(now);
    expectedTomorrow.setHours(0, 0, 0, 0);
    expectedTomorrow.setDate(expectedTomorrow.getDate() + 1);
    const key = [expectedTomorrow.getFullYear(), String(expectedTomorrow.getMonth() + 1).padStart(2, '0'), String(expectedTomorrow.getDate()).padStart(2, '0')].join('-');
    expect(result.dueForecast?.[0]?.date).toBe(key);
  });

  it('keeps private card content out of the bounded forecast cache', async () => {
    await fetchProgressEvidence({} as never, 'owner-d', 'ja', new Date(2026, 8, 27, 10));
    expect([...storage.keys()]).toEqual(['sonflash_progress_forecast_owner-d:ja']);
    expect(storage.get('sonflash_progress_forecast_owner-d:ja')).not.toContain('recentlyMastered');
  });

  it('does not start count queries when the daily reservation cannot be saved', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null, setItem: () => { throw new Error('storage full'); }, removeItem: () => undefined,
    });
    const now = new Date(2026, 8, 27, 10);
    expect((await fetchProgressEvidence({} as never, 'owner-e', 'en', now)).dueForecast).toBeUndefined();
    expect((await fetchProgressEvidence({} as never, 'owner-e', 'en', now)).dueForecast).toBeUndefined();
    expect(mocks.getCountFromServer).not.toHaveBeenCalled();
    expect(mocks.getDocs).toHaveBeenCalledTimes(2);
  });

  it('replaces a malformed cached forecast before rendering', async () => {
    storage.set('sonflash_progress_forecast_owner-f:en', JSON.stringify({ date: '2026-09-27', dueForecast: 'invalid' }));
    const result = await fetchProgressEvidence({} as never, 'owner-f', 'en', new Date(2026, 8, 27, 10));
    expect(result.dueForecast).toHaveLength(13);
    expect(mocks.getCountFromServer).toHaveBeenCalledTimes(13);
  });

});
