import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import { LibraryScreen, type LibraryScreenActions, type LibraryScreenModel } from './LibraryScreen';

const card: CardData = {
  id: 'word-focus',
  word: 'focus',
  normalizedWord: 'focus',
  translation: 'tập trung',
  explanation: '',
  phonetic: '',
  emoji: '🎯',
  category: 'Study',
  audioUrl: null,
  imageUrl: null,
};

const model: LibraryScreenModel = {
  isAuthenticated: false,
  overview: { total: 1, due: 1, mastered: 0, streak: 2, level: 1, xp: 30, canStudy: true },
  grid: {
    searchQuery: '', legacyCardsPending: 0, legacyIssue: null, isMigratingLegacy: false, activeCategory: 'All',
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
    availableDates: ['All'], customDecks: [], newDeckInput: '', activeCustomDeck: 'All', cards: [card],
    cloudFacetsComplete: true, sortedCategories: ['All', 'Study'], categoryCounts: { All: 1, Study: 1 },
    activeCategory: 'All',
  },
};

const actions: LibraryScreenActions = {
  startStudy: vi.fn(async () => undefined),
  openCardCreator: vi.fn(),
  grid: {
    changeSearch: vi.fn(), migrateLegacyCards: vi.fn(async () => undefined), shareCategory: vi.fn(async () => undefined),
    deleteCard: vi.fn(async () => undefined), toggleBookmark: vi.fn(async () => undefined),
    assignDeck: vi.fn(async () => undefined), updateCard: vi.fn(async () => undefined),
    changePage: vi.fn(), clearFilters: vi.fn(),
  },
  tools: {
    importCards: vi.fn(), importFile: vi.fn(), generateCard: vi.fn(async () => undefined), changeWordInput: vi.fn(),
    changeSearch: vi.fn(), changeStarredOnly: vi.fn(), changeDifficulty: vi.fn(),
    changePartOfSpeech: vi.fn(), changeDate: vi.fn(), changeNewDeckInput: vi.fn(),
    createCustomDeck: vi.fn(async () => undefined), changeCustomDeck: vi.fn(),
    deleteCustomDeck: vi.fn(async () => undefined), changeCategory: vi.fn(),
  },
};

describe('LibraryScreen', () => {
  it('keeps the hero slogan subordinate to the canonical app view heading', () => {
    const html = renderToStaticMarkup(<LibraryScreen model={model} actions={actions} />);

    expect(html).toMatch(/<h2[^>]*id="learning-home-heading"[^>]*>\s*Make every word unforgettable\.\s*<\/h2>/);
    expect(html).not.toContain('<h1');
  });

  it('makes the collection region wider than the supporting tools', () => {
    const html = renderToStaticMarkup(<LibraryScreen model={model} actions={actions} />);

    expect(html).toContain('data-library-region="collection"');
    expect(html).toContain('lg:col-span-9');
    expect(html).toContain('data-library-region="tools"');
    expect(html).toContain('lg:col-span-3');
  });

  it('puts the single card creator before an empty collection on small screens', () => {
    const emptyModel: LibraryScreenModel = {
      ...model,
      overview: { ...model.overview, total: 0, due: 0, canStudy: false },
      grid: { ...model.grid, filteredCards: [], paginatedCards: [], groupedCards: {}, libraryCount: 0 },
      tools: { ...model.tools, libraryCount: 0, cards: [] },
    };
    const html = renderToStaticMarkup(<LibraryScreen model={emptyModel} actions={actions} />);

    expect(html).toMatch(/data-library-region="tools" class="order-1 /);
    expect(html).toMatch(/data-library-region="collection" class="order-2 /);
  });

  it('treats overview metrics as supporting evidence instead of equal cards', () => {
    const html = renderToStaticMarkup(<LibraryScreen model={model} actions={actions} />);

    expect(html).toContain('data-library-evidence="true"');
    expect(html).not.toContain('featured-learning-metric');
  });

  it('keeps status popups out of the library content flow and preserves accessible lazy fallbacks', () => {
    const html = renderToStaticMarkup(<LibraryScreen model={model} actions={actions} />);
    const overviewIndex = html.indexOf('Make every word unforgettable.');
    const cardsFallbackIndex = html.indexOf('Loading library cards');
    const toolsFallbackIndex = html.indexOf('Loading library tools');

    expect(overviewIndex).toBeGreaterThanOrEqual(0);
    expect(cardsFallbackIndex).toBeGreaterThan(overviewIndex);
    expect(toolsFallbackIndex).toBeGreaterThan(cardsFallbackIndex);
    expect(html).toContain('role="status"');
    expect(html).not.toContain('max-w-xl sm:ml-auto');
    expect(html).not.toContain('Syncing your library');
    expect(html).toContain('grid grid-cols-1 gap-6 lg:grid-cols-12 xl:gap-8');
  });

  it('keeps library presentation sources vendor- and setter-type-free', () => {
    for (const relativePath of ['./LibraryScreen.tsx', './LibraryCardGrid.tsx', './LibraryTools.tsx']) {
      const source = readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
      expect(source).not.toMatch(/firebase|firestore|Repository/);
      expect(source).not.toMatch(/Dispatch|SetStateAction/);
    }
  });
});
