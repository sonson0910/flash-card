import { describe, expect, it } from 'vitest';
import type { LearningStateV3 } from '../multilingual/schemaV3';
import {
  CATALOG_PROGRESS_MEMBERSHIP_LIMIT,
  aggregateCatalogProgress,
  classifyCatalogLearningState,
} from './catalogProgress';

const state = (
  lexemeId: string,
  overrides: Partial<LearningStateV3> = {},
): LearningStateV3 => ({
  schemaVersion: 3,
  ownerId: 'owner-1',
  lexemeId,
  legacyCardId: `legacy-${lexemeId}`,
  reviewHistory: [],
  bookmarked: false,
  difficulty: 'unrated',
  correctStreak: 0,
  customCollections: [],
  createdAt: '2026-08-04T00:00:00.000Z',
  ...overrides,
});

describe('catalog progress', () => {
  it('does not infer progress from installed memberships or bookmarks', () => {
    expect(classifyCatalogLearningState(null)).toBe('not-started');
    expect(classifyCatalogLearningState(state('lexeme-1', { bookmarked: true })))
      .toBe('not-started');

    const result = aggregateCatalogProgress([
      { membershipId: 'm1', lexemeId: 'lexeme-1', trackId: 'ielts', tier: 'foundation' },
    ], new Map());

    expect(result.tracks.ielts).toMatchObject({ total: 1, started: 0, mastered: 0 });
    expect(result.tracks.ielts?.tiers.foundation?.status).toBe('not-started');
  });

  it('uses review evidence for started and explicit mastery for mastered', () => {
    const reviewed = state('lexeme-1', {
      reviews: 1,
      reviewHistory: [{
        rating: 'good',
        reviewedAt: '2026-08-04T01:00:00.000Z',
        scheduledDays: 1,
        elapsedDays: 0,
      }],
    });
    const mastered = state('lexeme-2', { mastery: 0.8 });

    expect(classifyCatalogLearningState(reviewed)).toBe('started');
    expect(classifyCatalogLearningState(mastered)).toBe('mastered');
  });

  it('projects one lexeme state into each membership without duplicating learning state', () => {
    const memberships = [
      { membershipId: 'm1', lexemeId: 'shared', trackId: 'ielts', tier: 'foundation' },
      { membershipId: 'm2', lexemeId: 'shared', trackId: 'toeic', tier: 'core' },
      { membershipId: 'm3', lexemeId: 'new', trackId: 'ielts', tier: 'foundation' },
    ];
    const result = aggregateCatalogProgress(
      memberships,
      new Map([['shared', state('shared', { mastery: 1 })]]),
    );

    expect(result).toMatchObject({
      totalMemberships: 3,
      uniqueLexemes: 2,
      tracks: {
        ielts: { total: 2, started: 1, mastered: 1, percentMastered: 50 },
        toeic: { total: 1, started: 1, mastered: 1, percentMastered: 100 },
      },
    });
    expect(result.tracks.ielts?.tiers.foundation?.status).toBe('in-progress');
    expect(result.tracks.toeic?.tiers.core?.status).toBe('completed');
  });

  it('rejects duplicate membership identities and mismatched state keys', () => {
    const duplicate = [
      { membershipId: 'm1', lexemeId: 'one', trackId: 'ielts', tier: 'foundation' },
      { membershipId: 'm1', lexemeId: 'two', trackId: 'ielts', tier: 'core' },
    ];
    expect(() => aggregateCatalogProgress(duplicate, new Map())).toThrow(/duplicate/i);
    expect(() => aggregateCatalogProgress(
      [{ membershipId: 'm2', lexemeId: 'one', trackId: 'ielts', tier: 'foundation' }],
      new Map([['one', state('different')]]),
    )).toThrow(/does not match/i);
  });

  it('enforces the catalog-wide structural bound', () => {
    const memberships = Array.from({ length: CATALOG_PROGRESS_MEMBERSHIP_LIMIT + 1 }, (_, index) => ({
      membershipId: `m-${index}`,
      lexemeId: `l-${index}`,
      trackId: 'general',
      tier: 'foundation',
    }));

    expect(() => aggregateCatalogProgress(memberships, new Map())).toThrow(/10,000/);
  });
});
