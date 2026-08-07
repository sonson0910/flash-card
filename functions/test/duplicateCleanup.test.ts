import { describe, expect, it } from 'vitest';
import {
  normalizeCleanupWord,
  planDuplicateGroup,
  summarizeFacetCounts,
} from '../src/duplicateCleanup.js';

const card = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  word: 'Quite',
  normalizedWord: 'quite',
  translation: 'khá',
  category: 'General',
  createdAt: '2026-07-20T00:00:00.000Z',
  reviews: 0,
  reviewHistory: [],
  imageUrl: null,
  audioUrl: null,
  revision: 1,
  ...overrides,
});

describe('duplicate cleanup planner', () => {
  it('normalizes Unicode, casing and whitespace deterministically', () => {
    expect(normalizeCleanupWord('  CAFÉ   Au\u00a0Lait ')).toBe('café au lait');
  });

  it('selects the primary with the strongest learning progress', () => {
    const plan = planDuplicateGroup([
      card('older', { createdAt: '2026-01-01T00:00:00.000Z', reviews: 2 }),
      card('learned', {
        createdAt: '2026-06-01T00:00:00.000Z',
        reviews: 8,
        fsrs: { reps: 12, stability: 9 },
      }),
    ], { jobId: 'job-1', libraryEpoch: 4 });

    expect(plan?.primaryId).toBe('word-quite');
    expect(plan?.strongestSourceId).toBe('learned');
    expect(plan?.loserIds).toEqual(['learned', 'older']);
  });

  it('preserves earliest creation time and fills missing media from losers', () => {
    const plan = planDuplicateGroup([
      card('word-quite', { reviews: 10, createdAt: '2026-07-01T00:00:00.000Z' }),
      card('media', {
        reviews: 1,
        createdAt: '2025-01-01T00:00:00.000Z',
        imageUrl: 'https://images.pexels.com/photo.jpeg',
        audioUrl: 'https://api.dictionaryapi.dev/media.mp3',
        imageSearchQuery: 'quiet peaceful landscape',
      }),
    ], { jobId: 'job-1', libraryEpoch: 7 });

    expect(plan?.merged).toMatchObject({
      id: 'word-quite',
      normalizedWord: 'quite',
      createdAt: '2025-01-01T00:00:00.000Z',
      imageUrl: 'https://images.pexels.com/photo.jpeg',
      audioUrl: 'https://api.dictionaryapi.dev/media.mp3',
      imageSearchQuery: 'quiet peaceful landscape',
      schemaVersion: 2,
      libraryEpoch: 7,
      revision: 2,
    });
    expect(plan?.tombstones).toEqual([{
      cardId: 'media',
      opId: 'duplicate-cleanup-job-1-media',
      libraryEpoch: 7,
      revision: 2,
      deletedAt: null,
    }]);
  });

  it('is deterministic when progress ties', () => {
    const leftFirst = planDuplicateGroup([
      card('z-card'),
      card('a-card'),
    ], { jobId: 'job-1', libraryEpoch: 0 });
    const rightFirst = planDuplicateGroup([
      card('a-card'),
      card('z-card'),
    ], { jobId: 'job-1', libraryEpoch: 0 });

    expect(leftFirst?.primaryId).toBe('word-quite');
    expect(rightFirst?.primaryId).toBe('word-quite');
    expect(leftFirst?.strongestSourceId).toBe('a-card');
    expect(rightFirst?.strongestSourceId).toBe('a-card');
  });

  it('always targets the canonical stable word id to prevent future recreation duplicates', () => {
    const plan = planDuplicateGroup([
      card('legacy-random', { reviews: 100 }),
      card('word-quite', { reviews: 1 }),
    ], { jobId: 'job-1', libraryEpoch: 2 });

    expect(plan?.primaryId).toBe('word-quite');
    expect(plan?.strongestSourceId).toBe('legacy-random');
    expect(plan?.merged.id).toBe('word-quite');
    expect(plan?.loserIds).toEqual(['legacy-random']);
  });

  it('returns no mutation for a singleton and builds bounded facets', () => {
    expect(planDuplicateGroup([card('only')], { jobId: 'job-1', libraryEpoch: 0 })).toBeNull();
    expect(summarizeFacetCounts([
      card('1', { category: 'General' }),
      card('2', { category: 'General' }),
      card('3', { category: 'Travel' }),
    ])).toEqual({ General: 2, Travel: 1 });
  });
});
