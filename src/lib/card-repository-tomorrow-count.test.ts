import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ getCountFromServer: vi.fn() }));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn((...args: unknown[]) => ({ type: 'collection', args })),
  doc: vi.fn(), documentId: vi.fn(), endAt: vi.fn(),
  getCountFromServer: mocks.getCountFromServer,
  getDocs: vi.fn(), getDocsFromServer: vi.fn(), getDoc: vi.fn(), limit: vi.fn(),
  onSnapshot: vi.fn(), orderBy: vi.fn(),
  query: vi.fn((...args: unknown[]) => ({ type: 'query', args })),
  runTransaction: vi.fn(), serverTimestamp: vi.fn(), setDoc: vi.fn(),
  startAfter: vi.fn(), startAt: vi.fn(),
  where: vi.fn((...args: unknown[]) => ({ type: 'where', args })),
  writeBatch: vi.fn(),
}));

vi.mock('./firebase', () => ({
  app: null, auth: null, isFirebaseConfigured: false,
  protectedFunctionsCapability: { available: false, reason: 'app-check-unconfigured' },
}));

import { query } from 'firebase/firestore';
import { countCardsDueTomorrow } from './cardRepository';

describe('countCardsDueTomorrow', () => {
  beforeEach(() => {
    vi.mocked(query).mockClear();
    mocks.getCountFromServer.mockReset();
  });

  it('counts cards due by the end of the next local day, backlog included, in one aggregate', async () => {
    mocks.getCountFromServer.mockResolvedValue({ data: () => ({ count: 3 }) });
    const now = new Date(2026, 8, 27, 23, 50);
    const end = new Date(2026, 8, 29).toISOString();

    await expect(countCardsDueTomorrow({} as never, 'owner-1', 'ko', now)).resolves.toBe(3);
    expect(mocks.getCountFromServer).toHaveBeenCalledTimes(1);
    expect(vi.mocked(query).mock.calls[0]).toEqual([
      { type: 'collection', args: [{}, 'users', 'owner-1', 'cards'] },
      { type: 'where', args: ['language', '==', 'ko'] },
      { type: 'where', args: ['nextReviewDate', '<', end] },
    ]);
  });

  it('returns zero without loading documents when no cards are due', async () => {
    mocks.getCountFromServer.mockResolvedValue({ data: () => ({ count: 0 }) });
    await expect(countCardsDueTomorrow({} as never, 'owner-1', undefined, new Date(2026, 11, 31))).resolves.toBe(0);
    expect(mocks.getCountFromServer).toHaveBeenCalledTimes(1);
    expect(vi.mocked(query).mock.calls[0]).toHaveLength(2);
  });
});
