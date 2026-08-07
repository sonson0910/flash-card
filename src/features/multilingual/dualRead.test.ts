import { describe, expect, it } from 'vitest';
import { normalizeCardData } from '../../lib/cardNormalization';
import type { CardData } from '../../types/card';
import { readCardDocumentV2V3 } from './dualRead';
import { createTrackMembershipId } from './lexemeIdentity';
import { planV2CardMigration } from './v2Migration';

const legacy: CardData = {
  schemaVersion: 2,
  revision: 8,
  libraryEpoch: 2,
  id: 'word-allocate',
  word: 'allocate',
  normalizedWord: 'allocate',
  translation: 'phân bổ',
  explanation: 'Distribute resources.',
  explanationTranslation: 'Phân phối nguồn lực.',
  phonetic: '/ˈæləkeɪt/',
  emoji: '📊',
  category: 'Business',
  audioUrl: null,
  imageUrl: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  bookmarked: true,
  difficulty: 'good',
  customDeck: 'Work',
  reviews: 3,
  interval: 4,
  easeFactor: 2.3,
  partOfSpeech: 'verb',
  cefrLevel: 'B2',
  reviewHistory: [],
  correctStreak: 2,
};

describe('readCardDocumentV2V3', () => {
  it('keeps legacy v2 reads on the normalized compatibility path', () => {
    const result = readCardDocumentV2V3(legacy, 'legacy-document');

    expect(result.sourceVersion).toBe('v2');
    expect(result.card).toEqual(normalizeCardData(legacy, 'legacy-document'));
  });

  it('validates and projects a migrated v3 aggregate without losing normalized v2 state', () => {
    const bundle = planV2CardMigration({
      ownerId: 'learner-1',
      sourceDocumentId: 'legacy-document',
      card: legacy,
      senseKey: 'assign-resources',
      migratedAt: '2026-08-03T00:00:00.000Z',
    });
    const result = readCardDocumentV2V3({
      schemaVersion: 3,
      lexeme: bundle.lexeme,
      memberships: bundle.memberships,
      learningState: bundle.learningState,
    }, 'ignored-v3-document', { expectedOwnerId: 'learner-1' });

    expect(result.sourceVersion).toBe('v3');
    expect(result.card).toEqual(normalizeCardData(legacy, 'legacy-document'));
  });

  it('selects an explicit track instead of depending on membership array order', () => {
    const bundle = planV2CardMigration({
      ownerId: 'learner-1', sourceDocumentId: 'legacy-document', card: legacy,
      migratedAt: '2026-08-03T00:00:00.000Z',
    });
    const ielts = {
      ...bundle.memberships[0],
      id: createTrackMembershipId({ trackId: 'ielts', lexemeId: bundle.lexeme.id }),
      trackId: 'ielts' as const,
      legacyCategory: 'IELTS',
    };
    const result = readCardDocumentV2V3({
      schemaVersion: 3,
      lexeme: bundle.lexeme,
      memberships: [bundle.memberships[0], ielts],
      learningState: bundle.learningState,
    }, 'aggregate', { expectedOwnerId: 'learner-1', trackId: 'ielts' });

    expect(result.card.category).toBe('IELTS');
  });

  it('rejects unknown versions and owner-library aggregates without learning state', () => {
    expect(() => readCardDocumentV2V3({ schemaVersion: 4 }, 'future')).toThrow(/unsupported/i);

    const bundle = planV2CardMigration({
      ownerId: 'learner-1', sourceDocumentId: 'legacy-document', card: legacy,
      migratedAt: '2026-08-03T00:00:00.000Z',
    });
    expect(() => readCardDocumentV2V3({
      schemaVersion: 3,
      lexeme: bundle.lexeme,
      memberships: bundle.memberships,
      learningState: bundle.learningState,
    }, 'aggregate')).toThrow(/expectedOwnerId/i);
    expect(() => readCardDocumentV2V3({
      schemaVersion: 3,
      lexeme: bundle.lexeme,
      memberships: bundle.memberships,
      learningState: null,
    }, 'aggregate', { expectedOwnerId: 'learner-1' })).toThrow(/learning state/i);
  });
});
