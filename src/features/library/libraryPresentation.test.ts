import { describe, expect, it, vi } from 'vitest';
import {
  dateLabelToQueryDate,
  existingCardRevealState,
  formatCardDate,
  getCategoryEmoji,
  groupCardsByDate,
  promoteExistingCard,
} from './libraryPresentation';

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

  it('promotes an existing card with a field-only ordering timestamp', () => {
    const existing = { id: 'word-quite', word: 'quite', createdAt: '2026-01-01T00:00:00.000Z' };

    expect(promoteExistingCard(existing, '2026-07-23T00:00:00.000Z')).toEqual({
      card: { ...existing, createdAt: '2026-07-23T00:00:00.000Z' },
      fields: { createdAt: '2026-07-23T00:00:00.000Z' },
    });
    expect(existing.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });
});
