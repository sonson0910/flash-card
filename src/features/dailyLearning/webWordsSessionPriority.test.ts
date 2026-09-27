import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import {
  clearDailySessionPointer,
  clearPendingFreshPriority,
  readDailySessionPointer,
  readPendingFreshPriority,
  writeDailySessionPointer,
  type DailySessionPointer,
} from './dailySessionStages';
import { promoteCardsToActiveSessionNewStage } from './webWordsSessionPriority';

const OWNER = 'owner-1';

/** The vitest node environment has no real sessionStorage; mirrors the in-memory stub `dailySessionStages.test.ts` already uses. */
function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => { store.set(key, value); },
    removeItem: key => { store.delete(key); },
    clear: () => store.clear(),
    key: index => Array.from(store.keys())[index] ?? null,
    get length() { return store.size; },
  } as Storage;
}

const webCard = (id: string): CardData => ({
  id, word: id, translation: 'x', language: 'en', createdAt: '2026-09-27T00:00:00.000Z', reviews: 0,
  source: { url: 'https://example.com', capturedAt: '2026-09-27T00:00:00.000Z' },
} as CardData);

const pointer = (overrides: Partial<DailySessionPointer> = {}): DailySessionPointer => ({
  ownerId: OWNER,
  targetLanguage: '',
  stage: 'new',
  reviewLogicalIds: [],
  freshLogicalIds: ['already-fresh'],
  matchCardIds: [],
  matchSkipReason: null,
  stats: { goodCount: 0, againCount: 0, weakCardIds: [], matchXp: 0 },
  startedAt: '2026-09-27T07:00:00.000Z',
  ...overrides,
});

describe('promoteCardsToActiveSessionNewStage', () => {
  beforeEach(() => vi.stubGlobal('sessionStorage', createMemoryStorage()));

  afterEach(() => {
    clearDailySessionPointer(OWNER);
    clearPendingFreshPriority(OWNER);
    vi.unstubAllGlobals();
  });

  it('reports no-active-session, writes no pointer, and queues the word as pending-fresh-priority', () => {
    const outcome = promoteCardsToActiveSessionNewStage(OWNER, [webCard('new-word')]);

    expect(outcome).toBe('no-active-session');
    expect(readDailySessionPointer(OWNER)).toBeNull();
    expect(readPendingFreshPriority(OWNER)).toEqual(['new-word']);
  });

  it('prepends a second pending word without duplicating one already queued', () => {
    promoteCardsToActiveSessionNewStage(OWNER, [webCard('first-word')]);

    promoteCardsToActiveSessionNewStage(OWNER, [webCard('second-word'), webCard('first-word')]);

    expect(readPendingFreshPriority(OWNER)).toEqual(['second-word', 'first-word']);
  });

  it('puts a newly captured word at the front of the freshLogicalIds queue of an in-progress session', () => {
    writeDailySessionPointer(pointer());

    const outcome = promoteCardsToActiveSessionNewStage(OWNER, [webCard('new-word')]);

    expect(outcome).toBe('promoted');
    expect(readDailySessionPointer(OWNER)?.freshLogicalIds).toEqual(['new-word', 'already-fresh']);
  });

  it('never duplicates a word that is already queued in the pointer', () => {
    writeDailySessionPointer(pointer({ freshLogicalIds: ['already-fresh'] }));

    promoteCardsToActiveSessionNewStage(OWNER, [webCard('already-fresh')]);

    expect(readDailySessionPointer(OWNER)?.freshLogicalIds).toEqual(['already-fresh']);
  });

  it('reports new-stage-already-passed and leaves the pointer untouched once the session reached match or recap', () => {
    writeDailySessionPointer(pointer({ stage: 'recap' }));

    const outcome = promoteCardsToActiveSessionNewStage(OWNER, [webCard('too-late')]);

    expect(outcome).toBe('new-stage-already-passed');
    expect(readDailySessionPointer(OWNER)?.freshLogicalIds).toEqual(['already-fresh']);
  });
});
