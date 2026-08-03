import { describe, expect, it } from 'vitest';
import {
  CLOUD_PAGE_SIZE,
  calculateTotalPages,
  createLocalCardPage,
  createDailyPracticePivot,
  createPage,
  normalizePartOfSpeech,
  normalizePrefixSearch,
  queryStateKey,
  prioritizePracticeCards,
  sortCardsByActivity,
  type CardQueryState,
} from './cardQuery';
import type { CardData } from '../types/card';

describe('createPage', () => {
  it('keeps only the visible page and uses the lookahead item for hasNext', () => {
    const documents = Array.from({ length: CLOUD_PAGE_SIZE + 1 }, (_, index) => index);

    expect(createPage(documents)).toEqual({
      items: documents.slice(0, CLOUD_PAGE_SIZE),
      hasNext: true,
    });
  });

  it('reports the final page without retaining extra items', () => {
    expect(createPage([1, 2])).toEqual({ items: [1, 2], hasNext: false });
  });
});

describe('calculateTotalPages', () => {
  it('allows the next cursor page even when the cached count is stale', () => {
    expect(calculateTotalPages(27, CLOUD_PAGE_SIZE, 3, true)).toBe(4);
    expect(calculateTotalPages(27, CLOUD_PAGE_SIZE, 3, false)).toBe(3);
  });
});

describe('createLocalCardPage', () => {
  it('paginates by available local cards instead of stale cloud totals', () => {
    const filters: CardQueryState = {
      category: null,
      customDeck: null,
      difficulty: null,
      partOfSpeech: null,
      bookmarkedOnly: false,
      createdDate: null,
      wordPrefix: '',
    };
    const cards = Array.from({ length: 23 }, (_, index) => ({
      id: `card-${index}`,
      word: `word-${index}`,
      translation: '',
      explanation: '',
      phonetic: '',
      emoji: '📘',
      category: 'Other',
      audioUrl: null,
      imageUrl: null,
      createdAt: new Date(2026, 0, index + 1).toISOString(),
    } satisfies CardData));

    expect(createLocalCardPage(cards, filters, 3, CLOUD_PAGE_SIZE)).toMatchObject({
      total: 23,
      hasNext: false,
    });
    expect(createLocalCardPage(cards, filters, 4, CLOUD_PAGE_SIZE)).toBeNull();
  });

  it('applies the same search filter before local fallback pagination', () => {
    const filters: CardQueryState = {
      category: null,
      customDeck: null,
      difficulty: null,
      partOfSpeech: null,
      bookmarkedOnly: false,
      createdDate: null,
      wordPrefix: 'fa',
    };
    const cards = [
      { id: '1', word: 'facilitate' },
      { id: '2', word: 'chance' },
    ].map(card => ({
      ...card,
      translation: '',
      explanation: '',
      phonetic: '',
      emoji: '📘',
      category: 'Other',
      audioUrl: null,
      imageUrl: null,
    } satisfies CardData));

    expect(createLocalCardPage(cards, filters, 1, CLOUD_PAGE_SIZE)?.items.map(card => card.word)).toEqual(['facilitate']);
  });

  it('keeps a reopened existing card at the top without rewriting createdAt', () => {
    const filters: CardQueryState = {
      category: null,
      customDeck: null,
      difficulty: null,
      partOfSpeech: null,
      bookmarkedOnly: false,
      createdDate: null,
      wordPrefix: '',
    };
    const oldReopened = {
      id: 'old',
      word: 'consider',
      translation: '',
      explanation: '',
      phonetic: '',
      emoji: '📘',
      category: 'Other',
      audioUrl: null,
      imageUrl: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      sortTouchedAt: '2026-07-28T10:00:00.000Z',
    } satisfies CardData;
    const newestByCreation = {
      ...oldReopened,
      id: 'new',
      word: 'brand new',
      createdAt: '2026-07-28T09:00:00.000Z',
      sortTouchedAt: undefined,
    } satisfies CardData;

    expect(createLocalCardPage([newestByCreation, oldReopened], filters, 1, CLOUD_PAGE_SIZE)?.items[0]).toMatchObject({
      id: 'old',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  });
});

describe('sortCardsByActivity', () => {
  it('prefers sortTouchedAt, then lastOpenedAt, then createdAt', () => {
    const base = {
      translation: '',
      explanation: '',
      phonetic: '',
      emoji: '📘',
      category: 'Other',
      audioUrl: null,
      imageUrl: null,
    };

    const cards = [
      { ...base, id: 'created', word: 'created', createdAt: '2026-07-27T00:00:00.000Z' },
      { ...base, id: 'opened', word: 'opened', createdAt: '2026-01-01T00:00:00.000Z', lastOpenedAt: '2026-07-28T09:00:00.000Z' },
      { ...base, id: 'touched', word: 'touched', createdAt: '2026-01-01T00:00:00.000Z', sortTouchedAt: '2026-07-28T10:00:00.000Z' },
      {
        ...base,
        id: 'invalid-touched',
        word: 'invalid touched',
        createdAt: '2025-01-01T00:00:00.000Z',
        lastOpenedAt: '2026-07-29T00:00:00.000Z',
        sortTouchedAt: 'not-a-date',
      },
    ] satisfies CardData[];

    expect(sortCardsByActivity(cards).map(card => card.id)).toEqual([
      'invalid-touched',
      'touched',
      'opened',
      'created',
    ]);
    expect(cards.map(card => card.id)).toEqual(['created', 'opened', 'touched', 'invalid-touched']);
  });
});

describe('prioritizePracticeCards', () => {
  it('keeps due cards first and removes fallback duplicates within the limit', () => {
    const due = [{ id: 'due-1' }, { id: 'due-2' }];
    const fallback = [{ id: 'due-2' }, { id: 'new-1' }, { id: 'new-2' }];

    expect(prioritizePracticeCards(due, fallback, 3).map(card => card.id)).toEqual(['due-1', 'due-2', 'new-1']);
  });
});

describe('createDailyPracticePivot', () => {
  it('is stable within a day and rotates the bounded fallback across days', () => {
    const first = createDailyPracticePivot('user-1', new Date('2026-07-12T01:00:00.000Z'));
    const sameDay = createDailyPracticePivot('user-1', new Date('2026-07-12T20:00:00.000Z'));
    const nextDay = createDailyPracticePivot('user-1', new Date('2026-07-13T01:00:00.000Z'));

    expect(first).toHaveLength(20);
    expect(sameDay).toBe(first);
    expect(nextDay).not.toBe(first);
  });
});

describe('normalizePrefixSearch', () => {
  it('normalizes casing and repeated whitespace for indexed prefix search', () => {
    expect(normalizePrefixSearch('  Hello   WORLD  ')).toBe('hello world');
  });
});

describe('part-of-speech filtering', () => {
  it('normalizes generated labels to stable filter keys', () => {
    expect(normalizePartOfSpeech('  Phrasal-Verb ')).toBe('phrasal verb');
    expect(normalizePartOfSpeech('Adverb of frequency')).toBe('adverb');
  });

  it('filters the complete local fallback before pagination', () => {
    const filters: CardQueryState = {
      category: null,
      customDeck: null,
      difficulty: null,
      partOfSpeech: 'verb',
      bookmarkedOnly: false,
      createdDate: null,
      wordPrefix: '',
    };
    const cards = [
      { id: '1', word: 'run', partOfSpeech: 'Verb' },
      { id: '2', word: 'quick', partOfSpeech: 'adjective' },
    ].map(card => ({
      ...card,
      translation: '',
      explanation: '',
      phonetic: '',
      emoji: '📘',
      category: 'Other',
      audioUrl: null,
      imageUrl: null,
    } satisfies CardData));

    expect(createLocalCardPage(cards, filters, 1, CLOUD_PAGE_SIZE)?.items.map(card => card.word)).toEqual(['run']);
  });
});

describe('queryStateKey', () => {
  it('changes whenever a server-side filter changes', () => {
    const base: CardQueryState = {
      category: null,
      customDeck: null,
      difficulty: null,
      partOfSpeech: null,
      bookmarkedOnly: false,
      createdDate: null,
      wordPrefix: '',
    };

    expect(queryStateKey(base)).not.toBe(queryStateKey({ ...base, bookmarkedOnly: true }));
    expect(queryStateKey(base)).not.toBe(queryStateKey({ ...base, wordPrefix: 'hello' }));
    expect(queryStateKey(base)).not.toBe(queryStateKey({ ...base, partOfSpeech: 'verb' }));
  });
});
