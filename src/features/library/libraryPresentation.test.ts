import { describe, expect, it, vi } from 'vitest';
import {
  dateLabelToQueryDate,
  existingCardRevealState,
  formatCardDate,
  getCategoryEmoji,
  groupCardsByDate,
  overlayRecentlyPromotedCards,
  promoteExistingCard,
  shouldResetLibraryPageAfterSync,
} from './libraryPresentation';
import type { CardData } from '../../types/card';

describe('library presentation model', () => {
  it('keeps relative date labels and cloud query dates consistent', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-13T08:00:00+07:00'));
    expect(formatCardDate('2026-07-13T01:00:00.000Z')).toBe('Today');
    expect(formatCardDate('2026-07-12T01:00:00.000Z')).toBe('Yesterday');
    expect(dateLabelToQueryDate('Today')).toBe('2026-07-13');
    vi.useRealTimers();
  });

  it('groups cards and provides stable category icons', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-13T08:00:00+07:00'));
    const grouped = groupCardsByDate([
      { id: '1', createdAt: '2026-07-13T01:00:00.000Z' },
      { id: '2', createdAt: '2026-07-12T01:00:00.000Z' },
    ]);
    expect(Object.keys(grouped)).toEqual(['Today', 'Yesterday']);
    expect(getCategoryEmoji('Technology')).toBe('💻');
    vi.useRealTimers();
  });

  it('reveals an existing card on the unfiltered first page instead of searching for it', () => {
    expect(existingCardRevealState()).toEqual({
      search: '',
      category: 'All',
      date: 'All',
      deck: 'All',
      difficulty: 'All',
      partOfSpeech: 'All',
      starred: false,
      page: 1,
    });
  });

  it('promotes an existing card without rewriting its creation timestamp', () => {
    const existing = { id: 'word-quite', word: 'quite', createdAt: '2026-01-01T00:00:00.000Z' };

    expect(promoteExistingCard(existing, '2026-07-23T00:00:00.000Z')).toEqual({
      card: {
        ...existing,
        lastOpenedAt: '2026-07-23T00:00:00.000Z',
        sortTouchedAt: '2026-07-23T00:00:00.000Z',
      },
      fields: {
        lastOpenedAt: '2026-07-23T00:00:00.000Z',
        sortTouchedAt: '2026-07-23T00:00:00.000Z',
      },
    });
    expect(existing.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('preserves pagination for card patches but resets for membership changes', () => {
    expect(shouldResetLibraryPageAfterSync([
      { type: 'patch' },
      { type: 'patch' },
    ])).toBe(false);
    expect(shouldResetLibraryPageAfterSync([{ type: 'upsert' }])).toBe(true);
    expect(shouldResetLibraryPageAfterSync([{ type: 'delete' }])).toBe(true);
  });

  it('keeps a promoted existing card on top when realtime returns an older createdAt page', () => {
    const filters = {
      category: null,
      customDeck: null,
      difficulty: null,
      partOfSpeech: null,
      bookmarkedOnly: false,
      createdDate: null,
      wordPrefix: '',
    };
    const baseCard = {
      translation: '',
      explanation: '',
      phonetic: '',
      emoji: '📘',
      category: 'Other',
      audioUrl: null,
      imageUrl: null,
      difficulty: 'unrated' as const,
      customDeck: null,
      bookmarked: false,
    };
    const promoted = {
      ...baseCard,
      id: 'old-consider',
      word: 'consider',
      normalizedWord: 'consider',
      createdAt: '2026-01-01T00:00:00.000Z',
      sortTouchedAt: '2026-07-28T10:00:00.000Z',
    } satisfies CardData;
    const cloudPage = [{
      ...baseCard,
      id: 'newer-visible',
      word: 'newer visible',
      normalizedWord: 'newer visible',
      createdAt: '2026-07-28T09:00:00.000Z',
    }] satisfies CardData[];

    expect(overlayRecentlyPromotedCards({
      pageCards: cloudPage,
      promotedCards: [promoted],
      filters,
      page: 1,
      pageSize: 9,
    }).map(card => card.id)).toEqual(['old-consider', 'newer-visible']);
  });

  it('does not pin promoted cards into filtered pages they no longer match', () => {
    const promoted = {
      id: 'old-consider',
      word: 'consider',
      normalizedWord: 'consider',
      translation: '',
      explanation: '',
      phonetic: '',
      emoji: '📘',
      category: 'General',
      audioUrl: null,
      imageUrl: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      sortTouchedAt: '2026-07-28T10:00:00.000Z',
    } satisfies CardData;

    expect(overlayRecentlyPromotedCards({
      pageCards: [],
      promotedCards: [promoted],
      filters: {
        category: 'IELTS',
        customDeck: null,
        difficulty: null,
        partOfSpeech: null,
        bookmarkedOnly: false,
        createdDate: null,
        wordPrefix: '',
      },
      page: 1,
      pageSize: 9,
    })).toEqual([]);
  });

  it('does not let a stale promoted copy remove media from the current page copy', () => {
    const filters = {
      category: null,
      customDeck: null,
      difficulty: null,
      partOfSpeech: null,
      bookmarkedOnly: false,
      createdDate: null,
      wordPrefix: '',
    };
    const pageCard = {
      id: 'consider',
      word: 'consider',
      normalizedWord: 'consider',
      translation: '',
      explanation: '',
      phonetic: '',
      emoji: '📘',
      category: 'Other',
      audioUrl: 'https://audio.example/consider.mp3',
      imageUrl: 'https://images.pexels.com/photos/consider.jpeg',
      imageSearchQuery: 'person thinking carefully',
      createdAt: '2026-01-01T00:00:00.000Z',
    } satisfies CardData;
    const stalePromoted = {
      ...pageCard,
      audioUrl: null,
      imageUrl: null,
      imageSearchQuery: '',
      sortTouchedAt: '2026-07-28T10:00:00.000Z',
    } satisfies CardData;

    expect(overlayRecentlyPromotedCards({
      pageCards: [pageCard],
      promotedCards: [stalePromoted],
      filters,
      page: 1,
      pageSize: 9,
    })[0]).toMatchObject({
      id: 'consider',
      imageUrl: 'https://images.pexels.com/photos/consider.jpeg',
      imageSearchQuery: 'person thinking carefully',
      audioUrl: 'https://audio.example/consider.mp3',
      sortTouchedAt: '2026-07-28T10:00:00.000Z',
    });
  });
});
