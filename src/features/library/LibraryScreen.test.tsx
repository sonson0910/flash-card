import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LearningStateOutcome } from '../learning/learningStateController';
import type { CardData } from '../../types/card';
import { LibraryScreen, shouldShowFirstUseLibraryPanel, type LibraryScreenActions, type LibraryScreenModel } from './LibraryScreen';
import { i18n } from '@lingui/core';
import { setFormatLocale } from '../../lib/format';

beforeEach(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

vi.mock('@lingui/react', () => ({
  Trans: ({ message }: { message: string }) => message,
  useLingui: () => ({ i18n }),
}));

const publishedUpdateOutcome: LearningStateOutcome = {
  status: 'published',
  result: { ownerKey: 'owner-1', operationId: 'op-1', publication: { kind: 'patch', cardId: 'word-focus', fields: {} } },
};

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
    assignDeck: vi.fn(async () => undefined), updateCard: vi.fn(async () => publishedUpdateOutcome),
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

function renderLibrary(currentModel = model) {
  return renderToStaticMarkup(<LibraryScreen model={currentModel} actions={actions} />);
}

describe('LibraryScreen', () => {
  it('shows the first-use panel only for a known empty library without loading, search, or migration state', () => {
    const empty: LibraryScreenModel = {
      ...model,
      overview: { ...model.overview, total: 0 },
      grid: { ...model.grid, searchQuery: '', filteredCards: [], paginatedCards: [], libraryCount: 0 },
      tools: { ...model.tools, libraryCount: 0, cards: [] },
    };

    expect(shouldShowFirstUseLibraryPanel(empty)).toBe(true);
    expect(shouldShowFirstUseLibraryPanel({ ...empty, grid: { ...empty.grid, searchQuery: 'focus' } })).toBe(false);
    expect(shouldShowFirstUseLibraryPanel({ ...empty, grid: { ...empty.grid, isPageLoading: true } })).toBe(false);
    expect(shouldShowFirstUseLibraryPanel({ ...empty, grid: { ...empty.grid, cloudReadUnavailable: true } })).toBe(false);
    expect(shouldShowFirstUseLibraryPanel({ ...empty, grid: { ...empty.grid, legacyCardsPending: 1 } })).toBe(false);
    expect(shouldShowFirstUseLibraryPanel({ ...empty, grid: { ...empty.grid, legacyIssue: { kind: 'cloud-access', message: 'Retry sync', retryable: true } } })).toBe(false);
  });

  it('renders the first-use panel with its real actions and one import input', () => {
    const empty: LibraryScreenModel = {
      ...model,
      overview: { ...model.overview, total: 0 },
      grid: { ...model.grid, searchQuery: '', filteredCards: [], paginatedCards: [], libraryCount: 0 },
      tools: { ...model.tools, libraryCount: 0, cards: [] },
    };
    const html = renderLibrary(empty);

    expect(html).toContain('data-empty-library-panel="true"');
    expect(html).toContain('Generate card');
    expect(html).toContain('Scan a text');
    expect(html).toContain('Import CSV / Excel');
    expect(html).toContain('Browse paths');
    expect(html.match(/type="file"/g)).toHaveLength(1);
    expect(html).not.toContain('data-primary-learning-action="true"');
  });

  it('keeps the original ready grid and tools flow when the empty results come from a search', () => {
    const emptySearch: LibraryScreenModel = {
      ...model,
      overview: { ...model.overview, total: 0 },
      grid: { ...model.grid, searchQuery: 'focus', filteredCards: [], paginatedCards: [], libraryCount: 0 },
      tools: { ...model.tools, searchQuery: 'focus', libraryCount: 0, cards: [] },
    };
    const html = renderLibrary(emptySearch);

    expect(html).not.toContain('data-empty-library-panel="true"');
    expect(html).toContain('lg:col-span-9');
    expect(html).toContain('lg:col-span-3');
  });

  it('keeps a compact vocabulary heading and real library actions above the collection', () => {
    const html = renderLibrary();

    expect(html).toMatch(/<h2[^>]*id="learning-home-heading"[^>]*>\s*Your library\s*<\/h2>/);
    expect(html).not.toContain('<h1');
    expect(html).toContain('data-primary-learning-action="true"');
    expect(html).toContain('data-library-create-action="true"');
    expect(html).toContain('data-library-evidence="true"');
    expect(html).not.toContain('min-h-[260px]');
  });

  it('makes the collection region wider than the supporting tools', () => {
    const html = renderLibrary();

    expect(html).toContain('data-library-region="collection"');
    expect(html).toContain('lg:col-span-9');
    expect(html).toContain('data-library-region="tools"');
    expect(html).toContain('lg:col-span-3');
  });

  it('keeps real total and due evidence in one compact strip', () => {
    const html = renderLibrary();

    expect(html).toContain('data-library-evidence="true"');
    expect(html).toContain('Library');
    expect(html).toContain('Due today');
    expect(html).toContain('grid grid-cols-2 overflow-hidden');
  });

  it('formats library evidence with the active Vietnamese locale', () => {
    const previousTotal = model.overview.total;
    setFormatLocale('vi');
    model.overview.total = 1_000;

    try {
      expect(renderLibrary()).toContain('1.000');
    } finally {
      model.overview.total = previousTotal;
      setFormatLocale('en');
    }
  });

  it('keeps status popups out of the library content flow and preserves accessible lazy fallbacks', () => {
    const html = renderLibrary();
    const overviewIndex = html.indexOf('Your library');
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
