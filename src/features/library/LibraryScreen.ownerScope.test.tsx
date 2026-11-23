import { prerenderToNodeStream } from 'react-dom/static';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { i18n } from '@lingui/core';
import { ALL_PRACTICE_DECK_SCOPE } from '../../lib/practiceScope';
import type { CardData } from '../../types/card';
import { LibraryScreen, type LibraryScreenActions, type LibraryScreenModel } from './LibraryScreen';

// The collection and the tools load on demand; stand-ins record what the screen hands them.
const received = vi.hoisted(() => ({ grid: [] as Array<{ ownerId?: string | null }> }));
vi.mock('./LibraryCardGrid', () => ({
  LibraryCardGrid: (props: { ownerId?: string | null }) => { received.grid.push(props); return null; },
}));
vi.mock('./LibraryTools', () => ({ LibraryTools: () => null }));
vi.mock('@lingui/react', () => ({
  Trans: ({ message }: { message: string }) => message,
  useLingui: () => ({ i18n }),
}));

beforeEach(() => {
  i18n.load('en', {});
  i18n.activate('en');
  received.grid.length = 0;
});

const card: CardData = {
  id: 'word-focus', word: 'focus', normalizedWord: 'focus', translation: 'tập trung', explanation: '',
  phonetic: '', emoji: '🎯', category: 'Study', audioUrl: null, imageUrl: null,
};

const modelFor = (ownerId: string | null): LibraryScreenModel => ({
  isAuthenticated: ownerId !== null,
  ownerId,
  overview: { total: 1, due: 1, mastered: 0, streak: 2, level: 1, xp: 30, canStudy: true },
  grid: {
    searchQuery: '', legacyCardsPending: 0, legacyIssue: null, isMigratingLegacy: false, activeCategory: 'All', activeCustomDeck: ALL_PRACTICE_DECK_SCOPE,
    filteredCards: [card], isSharing: false, currentPage: 1, paginatedCards: [card],
    isPageLoading: false, cloudReadUnavailable: false, importProgress: null,
    groupedCards: { Today: [card] }, customDecks: [], totalPages: 1,
    hasNextCloudPage: false, libraryCount: 1,
  },
  tools: {
    wordInput: '', isLoading: false, isGenerating: false, isImporting: false,
    generationAccess: { available: true },
    importProgress: null, importResult: null, libraryCount: 1, searchQuery: '',
    showStarredOnly: false, activeDifficulty: 'All', activePartOfSpeech: 'All', activeDate: 'All',
    availableDates: ['All'], customDecks: [], newDeckInput: '', activeCustomDeck: ALL_PRACTICE_DECK_SCOPE, cards: [card],
    cloudFacetsComplete: true, sortedCategories: ['All', 'Study'], categoryCounts: { All: 1, Study: 1 },
    activeCategory: 'All',
  },
});

const actions: LibraryScreenActions = {
  startStudy: vi.fn(async () => undefined),
  openCardCreator: vi.fn(),
  grid: {
    changeSearch: vi.fn(), migrateLegacyCards: vi.fn(async () => undefined), shareCategory: vi.fn(async () => undefined),
    deleteCard: vi.fn(async () => undefined), toggleBookmark: vi.fn(async () => undefined),
    assignDeck: vi.fn(async () => undefined), bulkPatchCards: vi.fn(async () => undefined),
    updateCard: vi.fn(async () => ({ status: 'no-active-owner' as const })),
    changePage: vi.fn(), clearFilters: vi.fn(),
  },
  tools: {
    openPaths: vi.fn(), importCards: vi.fn(), importFile: vi.fn(), generateCard: vi.fn(async () => undefined), changeWordInput: vi.fn(),
    changeSearch: vi.fn(), changeStarredOnly: vi.fn(), changeDifficulty: vi.fn(),
    changePartOfSpeech: vi.fn(), changeDate: vi.fn(), changeNewDeckInput: vi.fn(),
    createCustomDeck: vi.fn(async () => undefined), changeCustomDeck: vi.fn(),
    deleteCustomDeck: vi.fn(async () => undefined), changeCategory: vi.fn(),
  },
};

// Renders the screen until its on-demand parts have loaded.
const renderScreen = async (ownerId: string | null) => {
  const { prelude } = await prerenderToNodeStream(<LibraryScreen model={modelFor(ownerId)} actions={actions} />);
  prelude.resume();
  return received.grid.at(-1);
};

describe('LibraryScreen account scope', () => {
  it('tells the card collection which account its cards belong to', async () => {
    // The collection closes an edit sheet or a delete confirmation opened for one account when
    // another account becomes active; it can only do so when it is told whose cards it shows.
    expect(await renderScreen('owner-a')).toMatchObject({ ownerId: 'owner-a' });
    expect(await renderScreen('owner-b')).toMatchObject({ ownerId: 'owner-b' });
    expect(await renderScreen(null)).toMatchObject({ ownerId: null });
  });
});
