import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import { buildLibraryViewModel, type LibraryViewModelInput } from './libraryViewModel';

const makeCard = (id: string, overrides: Partial<CardData> = {}): CardData => ({
  id,
  word: id,
  translation: `${id} translation`,
  explanation: '',
  phonetic: '',
  emoji: '📝',
  category: 'Other',
  audioUrl: null,
  imageUrl: null,
  ...overrides,
});

const cloudStats = {
  total: 0,
  reviewed: 0,
  easy: 0,
  good: 0,
  hard: 0,
  unrated: 0,
  bookmarked: 0,
  due: 0,
};

const input = (overrides: Partial<LibraryViewModelInput> = {}): LibraryViewModelInput => ({
  cards: [],
  isAuthenticated: false,
  usesCloudPagination: false,
  cloudTotal: 0,
  cloudStats,
  cloudCategoryCounts: {},
  cloudFacetsComplete: false,
  cloudReadUnavailable: false,
  query: {
    category: 'All',
    customDeck: 'All',
    date: 'All',
    difficulty: 'All',
    partOfSpeech: 'All',
    starredOnly: false,
    search: '',
  },
  currentPage: 1,
  pageSize: 2,
  hasNextCloudPage: false,
  knownLibraryTotal: 0,
  xpHistory: {},
  ...overrides,
});

afterEach(() => vi.useRealTimers());

describe('library view model', () => {
  it('counts review activity from review events rather than difficulty labels', () => {
    const legacyRated = makeCard('legacy-rated', { difficulty: 'good', reviews: 0 });
    const actuallyReviewed = makeCard('reviewed', { difficulty: 'good', reviews: 1 });

    expect(buildLibraryViewModel(input({ cards: [legacyRated] })).stats.reviewed).toBe(0);
    expect(buildLibraryViewModel(input({ cards: [actuallyReviewed] })).stats.reviewed).toBe(1);
  });

  it('applies every local filter before local pagination', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-03T12:00:00+07:00'));
    const matching = makeCard('target', {
      word: 'Accountability',
      translation: 'trách nhiệm',
      category: 'IELTS',
      customDeck: 'Writing',
      createdAt: '2026-08-03T02:00:00.000Z',
      difficulty: 'hard',
      partOfSpeech: 'Adjective',
      bookmarked: true,
    });
    const model = buildLibraryViewModel(input({
      cards: [matching, makeCard('wrong-category', { category: 'TOEIC' })],
      query: {
        category: 'IELTS',
        customDeck: 'Writing',
        date: 'Today',
        difficulty: 'hard',
        partOfSpeech: 'adjective',
        starredOnly: true,
        search: 'TRÁCH',
      },
      pageSize: 1,
    }));

    expect(model.filteredCards.map(card => card.id)).toEqual(['target']);
    expect(model.paginatedCards.map(card => card.id)).toEqual(['target']);
    expect(model.counts).toMatchObject({ pageable: 1, total: 2, visible: 1, totalPages: 1 });
    expect(model.availableDates).toEqual(['All', 'Today', 'Older']);
  });

  it('includes both missing and explicit unrated difficulty in the local unrated filter', () => {
    const model = buildLibraryViewModel(input({
      cards: [
        makeCard('missing-difficulty'),
        makeCard('explicit-unrated', { difficulty: 'unrated' }),
        makeCard('reviewed', { difficulty: 'good' }),
      ],
      query: { ...input().query, difficulty: 'unrated' },
      pageSize: 10,
    }));

    expect(model.filteredCards.map(card => card.id)).toEqual([
      'missing-difficulty',
      'explicit-unrated',
    ]);
  });

  it('does not count a new unrated card as a scheduled review that is due', () => {
    const newCard = makeCard('new-card', { difficulty: 'unrated', nextReviewDate: undefined });

    const summary = buildLibraryViewModel(input({ cards: [newCard] }));
    const dueFilter = buildLibraryViewModel(input({
      cards: [newCard],
      query: { ...input().query, difficulty: 'due' },
    }));

    expect(summary.difficultySummary.due).toBe(0);
    expect(dueFilter.filteredCards).toEqual([]);
  });

  it('uses server-filtered cloud cards without filtering or slicing them again', () => {
    const cloudPage = [
      makeCard('cloud-1', { category: 'General' }),
      makeCard('cloud-2', { category: 'General' }),
    ];
    const model = buildLibraryViewModel(input({
      cards: cloudPage,
      isAuthenticated: true,
      usesCloudPagination: true,
      cloudTotal: 23,
      cloudStats: { ...cloudStats, total: 30, easy: 8, good: 4, hard: 3, unrated: 15, due: 5 },
      query: { ...input().query, category: 'IELTS', search: 'not on page' },
      currentPage: 3,
      pageSize: 1,
      hasNextCloudPage: true,
      knownLibraryTotal: 30,
    }));

    expect(model.filteredCards).toEqual(cloudPage);
    expect(model.paginatedCards).toEqual(cloudPage);
    expect(model.counts).toEqual({
      pageable: 23,
      total: 30,
      visible: 2,
      practice: 30,
      totalPages: 23,
    });
    expect(model.difficultySummary).toMatchObject({ total: 30, easy: 8, due: 5 });
  });

  it('marks authenticated category stats partial and falls back to the visible page facets', () => {
    const model = buildLibraryViewModel(input({
      cards: [
        makeCard('ielts-1', { category: 'IELTS' }),
        makeCard('uncategorized', { category: '' }),
      ],
      isAuthenticated: true,
      usesCloudPagination: true,
      cloudTotal: 40,
      cloudStats: { ...cloudStats, total: 40, unrated: 40 },
      cloudCategoryCounts: { TOEIC: 12 },
      cloudFacetsComplete: false,
    }));

    expect(model.categoryCounts).toEqual({ All: 40, IELTS: 1, Other: 1, TOEIC: 12 });
    expect(model.sortedCategories).toEqual(['All', 'IELTS', 'Other', 'TOEIC']);
    expect(model.stats.categoryChart).toEqual([
      { name: 'IELTS', value: 1 },
      { name: 'Uncategorized', value: 1 },
    ]);
    expect(model.stats.categoryChartIsPartial).toBe(true);
  });

  it('uses complete cloud facets and builds difficulty, XP, activity, and date groups', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-03T12:00:00+07:00'));
    const model = buildLibraryViewModel(input({
      cards: [
        makeCard('older', { createdAt: '2026-07-01T00:00:00.000Z' }),
        makeCard('today', { createdAt: '2026-08-03T03:00:00.000Z', sortTouchedAt: '2026-08-03T04:00:00.000Z' }),
      ],
      isAuthenticated: true,
      usesCloudPagination: true,
      cloudTotal: 9,
      cloudStats: { ...cloudStats, total: 9, easy: 3, good: 2, hard: 1, unrated: 3, due: 2 },
      cloudCategoryCounts: { IELTS: 6, TOEIC: 3 },
      cloudFacetsComplete: true,
      xpHistory: { 'Aug 2, 2026': 10, 'Aug 1, 2026': 5 },
    }));

    expect(model.stats).toMatchObject({ total: 9, learned: 3, learning: 6, dueToday: 2 });
    expect(model.stats.categoryChart).toEqual([
      { name: 'IELTS', value: 6 },
      { name: 'TOEIC', value: 3 },
    ]);
    expect(model.stats.categoryChartIsPartial).toBe(false);
    expect(model.stats.difficultyChart).toEqual([
      { name: 'Mastered', value: 3, color: '#10b981' },
      { name: 'Learning', value: 3, color: '#f59e0b' },
      { name: 'Not reviewed', value: 3, color: '#94a3b8' },
    ]);
    expect(model.stats.xpChartData).toEqual([
      { date: 'Aug 1, 2026', XP: 5 },
      { date: 'Aug 2, 2026', XP: 10 },
    ]);
    expect(Object.keys(model.groupedCards)).toEqual(['Today', 'Jul 1, 2026']);
  });
});
