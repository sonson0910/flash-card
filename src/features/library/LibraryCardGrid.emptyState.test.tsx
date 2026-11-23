import { describe, expect, it, vi } from 'vitest';

vi.mock('@lingui/react', () => ({
  Trans: ({ message }: { message: string }) => message,
  useLingui: () => ({ i18n: { _: (value: unknown) => (typeof value === 'string' ? value : 'label') } }),
}));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)) => [typeof initial === 'function' ? (initial as () => T)() : initial, vi.fn()] as const,
    useRef: <T,>(initial: T) => ({ current: initial }),
    useEffect: () => undefined,
    useLayoutEffect: () => undefined,
    useMemo: <T,>(factory: () => T) => factory(),
    useCallback: <T,>(callback: T) => callback,
  };
});

import { i18n } from '@lingui/core';
import { LibraryCardGrid } from './LibraryCardGrid';
import { ALL_PRACTICE_DECK_SCOPE } from '../../lib/practiceScope';

type Tree = { type?: unknown; props?: Record<string, unknown> };
const buttons = (node: unknown): Tree[] => {
  if (Array.isArray(node)) return node.flatMap(buttons);
  if (!node || typeof node !== 'object') return [];
  const value = node as Tree;
  return [...(value.type === 'button' ? [value] : []), ...buttons(value.props?.children)];
};
const text = (node: unknown): string => {
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(text).join('');
  if (!node || typeof node !== 'object') return '';
  const props = (node as Tree).props;
  return typeof props?.message === 'string' ? props.message : text(props?.children);
};

i18n.load('en', {});
i18n.activate('en');

const baseProps = {
  isAuthenticated: true, searchQuery: '', legacyIssue: null, migrateLegacyCards: vi.fn(), isMigratingLegacy: false,
  libraryHeadingRef: { current: null }, activeCategory: 'All', activeCustomDeck: ALL_PRACTICE_DECK_SCOPE, filteredCards: [],
  shareCategory: vi.fn(), isSharing: false, startStudy: vi.fn(), currentPage: 1, paginatedCards: [], isPageLoading: false,
  cloudReadUnavailable: false, importProgress: null, groupedCards: {}, deleteCard: vi.fn(), toggleBookmark: vi.fn(),
  customDecks: [], assignDeck: vi.fn(), bulkPatchCards: vi.fn(), updateCard: vi.fn(), totalPages: 1, onPageChange: vi.fn(),
  hasNextCloudPage: false, isGenerating: false, viewMode: 'grid', onViewModeChange: vi.fn(), cards: [], setCurrentPage: vi.fn(),
};

describe('empty library grid action', () => {
  it('opens the create flow, not filter clearing, while a legacy upgrade is pending', () => {
    const onClearFilters = vi.fn();
    const onCreateCard = vi.fn();
    const tree = LibraryCardGrid({
      ...baseProps, legacyCardsPending: 3, libraryCount: 0, setSearchQuery: vi.fn(), onClearFilters, onCreateCard,
    } as never);
    const create = buttons(tree).find(button => text(button).includes('Create your first card'));
    expect(create).toBeDefined();
    (create?.props?.onClick as () => void)();
    expect(onCreateCard).toHaveBeenCalledTimes(1);
    expect(onClearFilters).not.toHaveBeenCalled();
  });

  it('offers to clear the typed search when an empty library is being searched', () => {
    const setSearchQuery = vi.fn();
    const onCreateCard = vi.fn();
    const tree = LibraryCardGrid({
      ...baseProps, legacyCardsPending: 3, libraryCount: 0, searchQuery: 'apple', setSearchQuery, onClearFilters: vi.fn(), onCreateCard,
    } as never);
    const buttonTexts = buttons(tree).map(text);
    expect(buttonTexts).not.toContain('Create your first card');
    const clear = buttons(tree).find(button => text(button).includes('Clear search'));
    (clear?.props?.onClick as () => void)();
    expect(setSearchQuery).toHaveBeenCalledWith('');
    expect(onCreateCard).not.toHaveBeenCalled();
  });

  it('still clears filters when the library has cards but none match', () => {
    const onClearFilters = vi.fn();
    const tree = LibraryCardGrid({
      ...baseProps, legacyCardsPending: 0, libraryCount: 5, setSearchQuery: vi.fn(), onClearFilters, onCreateCard: vi.fn(),
    } as never);
    const clear = buttons(tree).find(button => text(button).includes('Clear filters'));
    (clear?.props?.onClick as () => void)();
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });
});
