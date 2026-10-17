import { describe, expect, it } from 'vitest';
import type { CardData } from '../../types/card';
import { groupWebWordsByArticle, webWordsDayFromCard, webWordsSiteFromUrl } from './webWordsGrouping';

const card = (overrides: Partial<CardData> = {}): CardData => ({
  id: overrides.id ?? 'card-1',
  word: 'word',
  translation: 'meaning',
  language: 'en',
  createdAt: '2026-09-27T08:00:00.000Z',
  reviews: 0,
  ...overrides,
} as CardData);

describe('webWordsSiteFromUrl', () => {
  it('strips a leading www. and returns the bare hostname', () => {
    expect(webWordsSiteFromUrl('https://www.example.com/article?x=1')).toBe('example.com');
  });

  it('returns null for a missing url', () => {
    expect(webWordsSiteFromUrl(undefined)).toBeNull();
    expect(webWordsSiteFromUrl(null)).toBeNull();
  });

  it('returns null for a non-http(s) scheme, guarding against a javascript: or data: url slipping into a link', () => {
    expect(webWordsSiteFromUrl('javascript:alert(1)')).toBeNull();
    expect(webWordsSiteFromUrl('not a url')).toBeNull();
  });
});

describe('webWordsDayFromCard', () => {
  it('reuses the exact library day bucketing so both surfaces agree on "Today"/"Yesterday"', () => {
    const now = new Date();
    const today = card({ source: { capturedAt: now.toISOString() } });
    expect(webWordsDayFromCard(today)).toBe('Today');
  });

  it('falls back to createdAt when source.capturedAt is absent', () => {
    const fallback = card({ createdAt: '2020-01-01T00:00:00.000Z', source: { url: 'https://example.com' } });
    expect(webWordsDayFromCard(fallback)).toBe('Jan 1, 2020');
  });
});

describe('groupWebWordsByArticle', () => {
  it('groups cards captured from the same url into one article group, newest article first', () => {
    const older = card({
      id: 'a', createdAt: '2026-09-20T00:00:00.000Z',
      source: { url: 'https://example.com/piece', title: 'Piece', capturedAt: '2026-09-20T00:00:00.000Z' },
    });
    const newer = card({
      id: 'b', createdAt: '2026-09-25T00:00:00.000Z',
      source: { url: 'https://example.com/piece', title: 'Piece', capturedAt: '2026-09-25T00:00:00.000Z' },
    });
    const otherArticle = card({
      id: 'c', createdAt: '2026-09-10T00:00:00.000Z',
      source: { url: 'https://other.example/story', title: 'Story', capturedAt: '2026-09-10T00:00:00.000Z' },
    });

    const groups = groupWebWordsByArticle([older, otherArticle, newer]);

    expect(groups).toHaveLength(2);
    expect(groups[0].url).toBe('https://example.com/piece');
    expect(groups[0].site).toBe('example.com');
    expect(groups[0].cards.map(c => c.id)).toEqual(['b', 'a']); // newest capture first inside the group
    expect(groups[1].url).toBe('https://other.example/story');
  });

  it('excludes a card with no source field entirely, never inventing an "unknown article" bucket for it', () => {
    const sourced = card({ id: 'sourced', source: { url: 'https://example.com', capturedAt: '2026-09-27T00:00:00.000Z' } });
    const unsourced = card({ id: 'unsourced' });

    const groups = groupWebWordsByArticle([sourced, unsourced]);

    expect(groups).toHaveLength(1);
    expect(groups[0].cards.map(c => c.id)).toEqual(['sourced']);
  });

  it('falls back to a per-card key when a source has neither url nor title, so two such cards do not collapse into one group', () => {
    const first = card({ id: 'first', source: { capturedAt: '2026-09-27T00:00:00.000Z' } });
    const second = card({ id: 'second', source: { capturedAt: '2026-09-26T00:00:00.000Z' } });

    const groups = groupWebWordsByArticle([first, second]);

    expect(groups).toHaveLength(2);
  });
});
