import { describe, expect, it } from 'vitest';
import {
  normalizeCleanupWord,
  planLegacyIdentityGroup,
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
  it('upgrades one non-canonical legacy card to the stable canonical identity', () => {
    const plan = planLegacyIdentityGroup([
      card('legacy-random', {
        word: '  Quite ',
        normalizedWord: undefined,
        schemaVersion: undefined,
        revision: undefined,
        difficulty: undefined,
        bookmarked: undefined,
        customDeck: undefined,
        imageUrl: 'https://tracker.example/pixel.png',
        privateLegacyField: 'must not survive',
      }),
    ], { jobId: 'job-1', libraryEpoch: 3 });

    expect(plan).toMatchObject({
      normalizedWord: 'quite',
      primaryId: 'word-quite',
      strongestSourceId: 'legacy-random',
      loserIds: ['legacy-random'],
      merged: {
        id: 'word-quite',
        word: 'quite',
        normalizedWord: 'quite',
        schemaVersion: 2,
        revision: 1,
        libraryEpoch: 3,
        difficulty: 'unrated',
        bookmarked: false,
        customDeck: null,
      },
    });
    expect(plan?.merged).not.toHaveProperty('privateLegacyField');
    expect(plan?.merged.imageUrl).toBeNull();
    expect(plan?.tombstones).toHaveLength(1);
  });

  it('uses a revision newer than every duplicate source', () => {
    const plan = planLegacyIdentityGroup([
      card('learned', { reviews: 10, revision: 2 }),
      card('newer-revision', { reviews: 1, revision: 40 }),
    ], { jobId: 'job-1', libraryEpoch: 4 });

    expect(plan?.strongestSourceId).toBe('learned');
    expect(plan?.merged.revision).toBe(41);
  });

  it('keeps migrated card and tombstone revisions within the safe counter ceiling', () => {
    const plan = planLegacyIdentityGroup([
      card('legacy-max-safe', { revision: Number.MAX_SAFE_INTEGER - 1 }),
    ], { jobId: 'job-1', libraryEpoch: 4 });

    expect(plan.merged.revision).toBe(Number.MAX_SAFE_INTEGER);
    expect(plan.tombstones[0]?.revision).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('rejects a migrated card or tombstone revision beyond the safe counter ceiling', () => {
    expect(() => planLegacyIdentityGroup([
      card('legacy-overflow', { revision: Number.MAX_SAFE_INTEGER }),
    ], { jobId: 'job-1', libraryEpoch: 4 })).toThrow(/revision.*maximum safe integer/i);
  });

  it('keeps only valid bounded learning history and normalizes timestamp-like dates', () => {
    const due = { toDate: () => new Date('2026-08-20T00:00:00.000Z') };
    const reviewedAt = { toDate: () => new Date('2026-08-10T00:00:00.000Z') };
    const plan = planLegacyIdentityGroup([
      card('learned', {
        reviews: 8,
        nextReviewDate: due,
        reviewHistory: [
          { rating: 'good', reviewedAt, scheduledDays: 2, elapsedDays: 1 },
          { rating: 'forged', reviewedAt: 'not-a-date', scheduledDays: -1, elapsedDays: 1 },
        ],
        fsrs: {
          due,
          stability: 2,
          difficulty: 4,
          elapsedDays: 1,
          scheduledDays: 2,
          learningSteps: 0,
          reps: 8,
          lapses: 1,
          state: 2,
        },
      }),
    ], { jobId: 'job-1', libraryEpoch: 4 });

    expect(plan.merged.nextReviewDate).toBe('2026-08-20T00:00:00.000Z');
    expect(plan.merged.reviewHistory).toEqual([{
      rating: 'good',
      reviewedAt: '2026-08-10T00:00:00.000Z',
      scheduledDays: 2,
      elapsedDays: 1,
    }]);
    expect(plan.merged.fsrs).toMatchObject({
      due: '2026-08-20T00:00:00.000Z',
      reps: 8,
      state: 2,
    });
  });

  it('rejects an empty or mixed identity group instead of dropping cards', () => {
    expect(() => planLegacyIdentityGroup([
      card('empty', { word: ' ', normalizedWord: '' }),
    ], { jobId: 'job-1', libraryEpoch: 0 })).toThrow('valid normalized word');
    expect(() => planLegacyIdentityGroup([
      card('oversized', { word: 'a'.repeat(257), normalizedWord: undefined }),
    ], { jobId: 'job-1', libraryEpoch: 0 })).toThrow('valid normalized word');
    expect(() => planLegacyIdentityGroup([
      card('one'),
      card('two', { word: 'other', normalizedWord: 'other' }),
    ], { jobId: 'job-1', libraryEpoch: 0 })).toThrow('more than one normalized word');
  });

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

  it('counts object-prototype category names as ordinary facet values', () => {
    const facets = summarizeFacetCounts([
      card('one', { category: '__proto__' }),
      card('two', { category: 'constructor' }),
    ]);

    expect(Object.prototype.hasOwnProperty.call(facets, '__proto__')).toBe(true);
    expect(facets).toEqual(Object.fromEntries([
      ['__proto__', 1],
      ['constructor', 1],
    ]));
  });
});
