import { calculateTotalPages, normalizePartOfSpeech, sortCardsByActivity } from '../../lib/cardQuery';
import { resolvePracticeLibraryCount } from '../../lib/practiceAvailability';
import { isCardDue } from '../../lib/srs';
import type { CardData } from '../../types/card';
import type { LibraryDifficulty } from '../catalog/libraryCatalogQuery';
import { formatCardDate, groupCardsByDate } from './libraryPresentation';

export interface LibraryDifficultySummary {
  total: number;
  easy: number;
  good: number;
  hard: number;
  unrated: number;
  bookmarked: number;
  due: number;
}

export interface LibraryViewQuery {
  category: string;
  customDeck: string;
  date: string;
  difficulty: LibraryDifficulty;
  partOfSpeech: string;
  starredOnly: boolean;
  search: string;
}

export interface LibraryViewModelInput {
  cards: CardData[];
  isAuthenticated: boolean;
  usesCloudPagination: boolean;
  cloudTotal: number;
  cloudStats: LibraryDifficultySummary;
  cloudCategoryCounts: Record<string, number>;
  cloudFacetsComplete: boolean;
  cloudReadUnavailable: boolean;
  query: LibraryViewQuery;
  currentPage: number;
  pageSize: number;
  hasNextCloudPage: boolean;
  knownLibraryTotal: number;
  xpHistory: Record<string, number>;
}

export interface LibraryStatsViewModel {
  total: number;
  learned: number;
  learning: number;
  dueToday: number;
  categoryChart: Array<{ name: string; value: number }>;
  categoryChartIsPartial: boolean;
  difficultyChart: Array<{ name: string; value: number; color: string }>;
  xpChartData: Array<{ date: string; XP: number }>;
}

export const selectLocalDifficultySummary = (cards: readonly CardData[]): LibraryDifficultySummary => ({
  total: cards.length,
  easy: cards.filter(card => card.difficulty === 'easy').length,
  good: cards.filter(card => card.difficulty === 'good').length,
  hard: cards.filter(card => card.difficulty === 'hard').length,
  unrated: cards.filter(card => !card.difficulty || card.difficulty === 'unrated').length,
  bookmarked: cards.filter(card => card.bookmarked).length,
  due: cards.filter(card => isCardDue(card)).length,
});

const matchesLocalQuery = (card: CardData, query: LibraryViewQuery): boolean => {
  const matchCategory = query.category === 'All' || card.category === query.category;
  const matchCustomDeck = query.customDeck === 'All'
    || (query.customDeck === 'Unassigned' ? !card.customDeck : card.customDeck === query.customDeck);
  const matchDate = query.date === 'All' || formatCardDate(card.createdAt) === query.date;
  const matchDifficulty = query.difficulty === 'All'
    || (query.difficulty === 'unrated'
      ? !card.difficulty
      : query.difficulty === 'due'
        ? isCardDue(card)
        : card.difficulty === query.difficulty);
  const matchPartOfSpeech = query.partOfSpeech === 'All'
    || normalizePartOfSpeech(card.partOfSpeech) === query.partOfSpeech;
  const matchStarred = !query.starredOnly || card.bookmarked === true;
  const search = query.search.toLowerCase();
  const matchSearch = !query.search
    || card.word.toLowerCase().includes(search)
    || card.translation.toLowerCase().includes(search);
  return matchCategory
    && matchCustomDeck
    && matchDate
    && matchDifficulty
    && matchPartOfSpeech
    && matchStarred
    && matchSearch;
};

export const selectFilteredLibraryCards = (
  cards: CardData[],
  query: LibraryViewQuery,
  usesCloudPage: boolean,
): CardData[] => usesCloudPage ? cards : cards.filter(card => matchesLocalQuery(card, query));

export const selectPaginatedLibraryCards = (
  cards: CardData[],
  currentPage: number,
  pageSize: number,
  usesCloudPage: boolean,
): CardData[] => usesCloudPage
  ? cards
  : cards.slice((currentPage - 1) * pageSize, currentPage * pageSize);

export const selectCategoryNavigation = ({
  cards,
  isAuthenticated,
  cloudTotal,
  cloudStats,
  cloudCategoryCounts,
}: Pick<LibraryViewModelInput,
  'cards' | 'isAuthenticated' | 'cloudTotal' | 'cloudStats' | 'cloudCategoryCounts'>) => {
  const visibleCounts = cards.reduce<Record<string, number>>((counts, card) => {
    const category = card.category || 'Other';
    counts[category] = (counts[category] || 0) + 1;
    return counts;
  }, {});
  const categoryCounts = isAuthenticated
    ? {
        All: Math.max(cloudTotal, cloudStats.total, cards.length),
        ...visibleCounts,
        ...cloudCategoryCounts,
      }
    : { All: cards.length, ...visibleCounts };
  const categories = isAuthenticated
    ? [...Object.keys(cloudCategoryCounts), ...cards.map(card => card.category || 'Other')]
    : cards.map(card => card.category || 'Other');
  const sortedCategories = [
    'All',
    ...Array.from(new Set(categories)).filter(Boolean).sort((left, right) => left.localeCompare(right)),
  ];
  return { categoryCounts, sortedCategories };
};

export const selectLibraryStats = ({
  cards,
  difficultySummary,
  isAuthenticated,
  cloudFacetsComplete,
  cloudCategoryCounts,
  xpHistory,
}: Pick<LibraryViewModelInput,
  'cards' | 'isAuthenticated' | 'cloudFacetsComplete' | 'cloudCategoryCounts' | 'xpHistory'> & {
    difficultySummary: LibraryDifficultySummary;
  }): LibraryStatsViewModel => {
  const categoryCounts = isAuthenticated && cloudFacetsComplete
    ? cloudCategoryCounts
    : cards.reduce<Record<string, number>>((counts, card) => {
        const category = card.category || 'Uncategorized';
        counts[category] = (counts[category] || 0) + 1;
        return counts;
      }, {});
  const difficultyChart = [
    { name: 'Mastered', value: difficultySummary.easy, color: '#10b981' },
    { name: 'Learning', value: difficultySummary.good + difficultySummary.hard, color: '#f59e0b' },
    { name: 'Not reviewed', value: difficultySummary.unrated, color: '#94a3b8' },
  ].filter(entry => entry.value > 0);
  const xpChartData = Object.keys(xpHistory)
    .map(date => ({ date, XP: xpHistory[date] || 0 }))
    .sort((left, right) => new Date(left.date).getTime() - new Date(right.date).getTime());
  if (xpChartData.length === 0) {
    xpChartData.push({
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      XP: 0,
    });
  }
  return {
    total: difficultySummary.total,
    learned: difficultySummary.easy,
    learning: difficultySummary.good + difficultySummary.hard + difficultySummary.unrated,
    dueToday: difficultySummary.due,
    categoryChart: Object.keys(categoryCounts).map(name => ({ name, value: categoryCounts[name] })),
    categoryChartIsPartial: Boolean(isAuthenticated && !cloudFacetsComplete),
    difficultyChart,
    xpChartData,
  };
};

export function buildLibraryViewModel(input: LibraryViewModelInput) {
  const usesCloudPage = input.isAuthenticated && input.usesCloudPagination;
  const filteredCards = selectFilteredLibraryCards(input.cards, input.query, usesCloudPage);
  const pageable = input.isAuthenticated
    ? Math.max(input.cloudTotal, filteredCards.length)
    : filteredCards.length;
  const paginatedCards = selectPaginatedLibraryCards(
    filteredCards,
    input.currentPage,
    input.pageSize,
    usesCloudPage,
  );
  const total = input.isAuthenticated
    ? Math.max(input.cloudTotal, input.cloudStats.total, input.cards.length)
    : input.cards.length;
  const visible = filteredCards.length;
  const difficultySummary = input.isAuthenticated
    ? input.cloudStats
    : selectLocalDifficultySummary(input.cards);
  const presentationCards = sortCardsByActivity(paginatedCards);
  const { categoryCounts, sortedCategories } = selectCategoryNavigation(input);
  const stats = selectLibraryStats({ ...input, difficultySummary });

  return {
    filteredCards,
    paginatedCards,
    presentationCards,
    groupedCards: groupCardsByDate(presentationCards),
    categoryCounts,
    sortedCategories,
    availableDates: ['All', ...new Set(input.cards.map(card => formatCardDate(card.createdAt)))],
    counts: {
      pageable,
      total,
      visible,
      practice: resolvePracticeLibraryCount(visible, input.knownLibraryTotal),
      totalPages: calculateTotalPages(
        pageable,
        input.pageSize,
        input.currentPage,
        Boolean(input.isAuthenticated && input.hasNextCloudPage),
      ),
    },
    countLabel: input.isAuthenticated && input.cloudReadUnavailable
      ? pageable > 0 ? `${pageable} CACHED / ${total} CLOUD` : 'CLOUD PAUSED'
      : `${total} CARDS`,
    difficultySummary,
    stats,
  };
}
