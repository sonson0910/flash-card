import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getDocs: vi.fn(async () => ({ docs: [] })),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(() => ({ type: 'collection' })),
  doc: vi.fn(),
  documentId: vi.fn(() => ({ type: 'documentId' })),
  endAt: vi.fn(),
  getCountFromServer: vi.fn(),
  getDocs: mocks.getDocs,
  getDocsFromServer: vi.fn(),
  getDoc: vi.fn(),
  limit: vi.fn((...args: unknown[]) => ({ type: 'limit', args })),
  onSnapshot: vi.fn(),
  orderBy: vi.fn((...args: unknown[]) => ({ type: 'orderBy', args })),
  query: vi.fn((...args: unknown[]) => ({ type: 'query', args })),
  runTransaction: vi.fn(),
  serverTimestamp: vi.fn(),
  setDoc: vi.fn(),
  startAfter: vi.fn(),
  startAt: vi.fn(),
  where: vi.fn((...args: unknown[]) => ({ type: 'where', args })),
  writeBatch: vi.fn(),
}));

vi.mock('./firebase', () => ({
  app: null,
  auth: null,
  isFirebaseConfigured: false,
  protectedFunctionsCapability: { available: false, reason: 'app-check-unconfigured' },
}));

import { query, where } from 'firebase/firestore';
import { fetchCardPage } from './cardRepository';
import { cardMatchesQuery, type CardQueryState } from './cardQuery';
import { ALL_PRACTICE_DECK_SCOPE } from './practiceScope';
import type { CardData } from '../types/card';

const filters = (difficulty: CardQueryState['difficulty']): CardQueryState => ({
  category: null,
  customDeck: ALL_PRACTICE_DECK_SCOPE,
  difficulty,
  partOfSpeech: null,
  bookmarkedOnly: false,
  createdDate: null,
  wordPrefix: '',
  targetLanguage: 'en',
});

beforeEach(() => {
  vi.mocked(where).mockClear();
  vi.mocked(query).mockClear();
});

describe('learning difficulty filter', () => {
  it('asks Firestore for the good and hard ratings together so the page and its total follow the tab', async () => {
    await fetchCardPage({ db: {} as never, userId: 'owner-1', filters: filters('learning') });

    expect(where).toHaveBeenCalledWith('difficulty', 'in', ['good', 'hard']);
    expect(where).not.toHaveBeenCalledWith('difficulty', '==', 'learning');
  });

  it('keeps a single rating as an equality filter', async () => {
    await fetchCardPage({ db: {} as never, userId: 'owner-1', filters: filters('hard') });

    expect(where).toHaveBeenCalledWith('difficulty', '==', 'hard');
  });

  it('matches cached cards rated good or hard and leaves out the rest', () => {
    const card = (difficulty: CardData['difficulty']) => ({ id: difficulty ?? 'none', difficulty, language: 'en' } as CardData);
    const matches = (difficulty: CardData['difficulty']) => cardMatchesQuery(card(difficulty), filters('learning'));

    expect([matches('good'), matches('hard'), matches('easy'), matches('unrated'), matches(undefined)])
      .toEqual([true, true, false, false, false]);
  });
});
