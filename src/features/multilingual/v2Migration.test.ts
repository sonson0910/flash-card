import { describe, expect, it } from 'vitest';
import { normalizeCardData } from '../../lib/cardNormalization';
import type { CardData } from '../../types/card';
import {
  planV2CardMigration,
  restoreV2Card,
} from './v2Migration';
import { parseLexemeAggregateV3 } from './schemaV3Validation';

const migratedAt = '2026-08-03T12:00:00.000Z';

const completeLegacyCard: CardData = {
  schemaVersion: 2,
  revision: 17,
  libraryEpoch: 4,
  updatedAt: '2026-08-03T11:59:00.000Z',
  id: 'legacy-allocate',
  word: ' Allocate ',
  normalizedWord: 'allocate',
  translation: 'phân bổ',
  explanation: 'To distribute resources for a purpose.',
  explanationTranslation: 'Phân phối nguồn lực cho một mục đích.',
  phonetic: '/ˈæləkeɪt/',
  emoji: '📊',
  category: 'Business',
  audioUrl: 'https://ssl.gstatic.com/dictionary/static/sounds/allocate.mp3',
  imageUrl: 'https://images.pexels.com/photos/3184291/pexels-photo-3184291.jpeg',
  imageSearchQuery: 'business team resource allocation',
  createdAt: '2025-01-02T03:04:05.000Z',
  lastOpenedAt: '2026-08-01T08:00:00.000Z',
  sortTouchedAt: '2026-08-02T09:00:00.000Z',
  bookmarked: true,
  difficulty: 'good',
  customDeck: 'IELTS Writing',
  nextReviewDate: '2026-08-10T00:00:00.000Z',
  reviews: 9,
  interval: 7,
  easeFactor: 2.2,
  fsrs: {
    due: '2026-08-10T00:00:00.000Z',
    stability: 6.25,
    difficulty: 4.5,
    elapsedDays: 3,
    scheduledDays: 7,
    learningSteps: 0,
    reps: 8,
    lapses: 2,
    state: 2,
    lastReview: '2026-08-03T00:00:00.000Z',
  },
  reviewHistory: [
    { rating: 'again', reviewedAt: '2026-07-20T00:00:00.000Z', scheduledDays: 1, elapsedDays: 0 },
    { rating: 'good', reviewedAt: '2026-08-03T00:00:00.000Z', scheduledDays: 7, elapsedDays: 3 },
  ],
  partOfSpeech: 'verb',
  cefrLevel: 'B2',
  exampleSentence: 'We allocate resources carefully.',
  exampleTranslation: 'Chúng tôi phân bổ nguồn lực cẩn thận.',
  collocations: ['allocate resources', 'allocate funds'],
  synonyms: ['assign', 'distribute'],
  antonyms: ['withhold'],
  register: 'formal',
  commonMistake: 'Do not confuse allocate with locate.',
  correctStreak: 5,
};

describe('planV2CardMigration', () => {
  it('preserves every normalized v2 field in a tamper-evident rollback snapshot', () => {
    const normalized = normalizeCardData(completeLegacyCard, 'legacy-document-42');

    const bundle = planV2CardMigration({
      ownerId: 'learner-1',
      sourceDocumentId: 'legacy-document-42',
      card: completeLegacyCard,
      senseKey: 'assign-resources',
      migratedAt,
    });

    expect(bundle.rollback.normalizedCard).toEqual(normalized);
    expect(bundle.rollback.sourceFingerprint).toBe(bundle.source.fingerprint);
    expect(bundle.rollback.snapshotFingerprint).toMatch(/^rollback-[a-z0-9-]+$/);
    expect(restoreV2Card(bundle.rollback)).toEqual(normalized);
    expect(bundle.source).toEqual({
      ownerId: 'learner-1',
      documentId: 'legacy-document-42',
      cardId: normalized.id,
      schemaVersion: 2,
      revision: 17,
      libraryEpoch: 4,
      fingerprint: bundle.source.fingerprint,
    });
    expect(bundle.source.fingerprint).toMatch(/^v2-[a-z0-9-]+$/);
  });

  it('keeps content, placement and independently inconsistent progress in their owning entities', () => {
    const bundle = planV2CardMigration({
      ownerId: 'learner-1',
      sourceDocumentId: 'legacy-document-42',
      card: completeLegacyCard,
      senseKey: 'assign-resources',
      migratedAt,
    });

    expect(bundle.lexeme).toMatchObject({
      schemaVersion: 3,
      language: 'en',
      lemma: 'Allocate',
      normalizedLemma: 'allocate',
      partOfSpeech: 'verb',
      senseKey: 'assign-resources',
      collocations: ['allocate resources', 'allocate funds'],
      media: {
        audioUrl: completeLegacyCard.audioUrl,
        imageUrl: completeLegacyCard.imageUrl,
        imageSearchQuery: completeLegacyCard.imageSearchQuery,
      },
      compatibility: {
        translation: 'phân bổ',
        explanation: 'To distribute resources for a purpose.',
        explanationTranslation: 'Phân phối nguồn lực cho một mục đích.',
        emoji: '📊',
        exampleSentence: 'We allocate resources carefully.',
        exampleTranslation: 'Chúng tôi phân bổ nguồn lực cẩn thận.',
        synonyms: ['assign', 'distribute'],
        antonyms: ['withhold'],
        register: 'formal',
        commonMistake: 'Do not confuse allocate with locate.',
      },
    });
    expect(bundle.memberships).toHaveLength(1);
    expect(bundle.memberships[0]).toMatchObject({
      trackId: 'general',
      topic: 'Business',
      legacyCategory: 'Business',
      cefrLevel: 'B2',
      editorialStatus: 'draft',
    });
    expect(bundle.learningState).toMatchObject({
      ownerId: 'learner-1',
      legacyCardId: 'legacy-allocate',
      bookmarked: true,
      difficulty: 'good',
      customCollections: ['IELTS Writing'],
      nextReviewDate: '2026-08-10T00:00:00.000Z',
      reviews: 9,
      interval: 7,
      easeFactor: 2.2,
      correctStreak: 5,
      revision: 17,
      libraryEpoch: 4,
      createdAt: '2025-01-02T03:04:05.000Z',
      lastOpenedAt: '2026-08-01T08:00:00.000Z',
      sortTouchedAt: '2026-08-02T09:00:00.000Z',
      updatedAt: '2026-08-03T11:59:00.000Z',
    });
    expect(bundle.learningState.reviews).not.toBe(bundle.learningState.fsrs?.reps);
    expect(bundle.learningState.reviewHistory).toEqual(completeLegacyCard.reviewHistory);
    expect(parseLexemeAggregateV3({
      schemaVersion: 3,
      lexeme: bundle.lexeme,
      memberships: bundle.memberships,
      learningState: bundle.learningState,
    }, { expectedOwnerId: 'learner-1' })).toMatchObject({
      lexeme: { id: bundle.lexeme.id },
      learningState: { legacyCardId: 'legacy-allocate' },
    });
  });

  it('is deterministic and idempotent for the same source and migration timestamp', () => {
    const input = {
      ownerId: 'learner-1',
      sourceDocumentId: 'legacy-document-42',
      card: completeLegacyCard,
      migratedAt,
    };

    const first = planV2CardMigration(input);
    const second = planV2CardMigration(input);

    expect(second).toEqual(first);
    expect(second.migrationId).toBe(first.migrationId);
    expect(second.lexeme.id).toBe(first.lexeme.id);
    expect(second.memberships[0].id).toBe(first.memberships[0].id);
  });

  it('keeps case-sensitive source document identities distinct', () => {
    const lower = planV2CardMigration({
      ownerId: 'learner-1', sourceDocumentId: 'Card-A', card: completeLegacyCard, migratedAt,
    });
    const upper = planV2CardMigration({
      ownerId: 'learner-1', sourceDocumentId: 'card-a', card: completeLegacyCard, migratedAt,
    });

    expect(lower.lexeme.senseKey).not.toBe(upper.lexeme.senseKey);
    expect(lower.lexeme.id).not.toBe(upper.lexeme.id);
    expect(lower.rollback.sourceDocumentId).toBe('Card-A');
  });

  it('defaults legacy content to a non-publishable General draft without inferring IELTS from a custom deck', () => {
    const bundle = planV2CardMigration({
      ownerId: 'learner-1',
      sourceDocumentId: 'legacy-document-42',
      card: completeLegacyCard,
      migratedAt,
    });

    expect(bundle.memberships[0].trackId).toBe('general');
    expect(bundle.lexeme.provenance).toEqual({
      source: 'legacy-v2',
      license: 'non-publishable',
      reviewer: 'unreviewed',
      editorialStatus: 'draft',
    });
    expect(bundle.learningState.customCollections).toEqual(['IELTS Writing']);
  });

  it('uses the source document id separately from the normalized card id', () => {
    const bundle = planV2CardMigration({
      ownerId: 'learner-1',
      sourceDocumentId: 'actual-firestore-document',
      card: { ...completeLegacyCard, id: 'legacy-payload-id' },
      migratedAt,
    });

    expect(bundle.source.documentId).toBe('actual-firestore-document');
    expect(bundle.source.cardId).toBe('legacy-payload-id');
    expect(bundle.rollback.sourceDocumentId).toBe('actual-firestore-document');
    expect(bundle.learningState.legacyCardId).toBe('legacy-payload-id');
  });

  it('does not manufacture optional sync metadata or FSRS state for a legacy card', () => {
    const legacyCard: CardData = {
      id: 'legacy-focus',
      word: 'focus',
      translation: 'tập trung',
      explanation: '',
      phonetic: '',
      emoji: '🎯',
      category: 'Other',
      audioUrl: null,
      imageUrl: null,
    };
    const normalized = normalizeCardData(legacyCard, 'legacy-focus-document');

    const bundle = planV2CardMigration({
      ownerId: 'learner-1',
      sourceDocumentId: 'legacy-focus-document',
      card: legacyCard,
      migratedAt,
    });

    expect(bundle.source.schemaVersion).toBeNull();
    expect(bundle.source).not.toHaveProperty('revision');
    expect(bundle.source).not.toHaveProperty('libraryEpoch');
    expect(bundle.learningState).not.toHaveProperty('revision');
    expect(bundle.learningState).not.toHaveProperty('libraryEpoch');
    expect(bundle.learningState).not.toHaveProperty('updatedAt');
    expect(bundle.learningState).not.toHaveProperty('fsrs');
    expect(bundle.lexeme.media.imageSearchQuery).toBe('');
    expect(restoreV2Card(bundle.rollback)).toEqual(normalized);
  });

  it('rejects rollback snapshots whose normalized card was changed', () => {
    const bundle = planV2CardMigration({
      ownerId: 'learner-1',
      sourceDocumentId: 'legacy-document-42',
      card: completeLegacyCard,
      migratedAt,
    });
    const tampered = {
      ...bundle.rollback,
      normalizedCard: { ...bundle.rollback.normalizedCard, reviews: 0 },
    };

    expect(() => restoreV2Card(tampered)).toThrow('rollback snapshot fingerprint does not match');
  });

  it('rejects sources that cannot form a language-aware lexeme identity', () => {
    expect(() => planV2CardMigration({
      ownerId: 'learner-1',
      sourceDocumentId: 'empty-card',
      card: { ...completeLegacyCard, word: '', normalizedWord: '' },
      migratedAt,
    })).toThrow('word is required');

    expect(() => planV2CardMigration({
      ownerId: 'learner-1',
      sourceDocumentId: 'oversized-sense',
      card: completeLegacyCard,
      senseKey: 's'.repeat(129),
      migratedAt,
    })).toThrow('senseKey must not exceed 128 characters');

    expect(() => planV2CardMigration({
      ownerId: 'learner-1',
      sourceDocumentId: 'missing-meaning',
      card: {
        ...completeLegacyCard,
        translation: '',
        explanation: '',
        explanationTranslation: '',
      },
      migratedAt,
    })).toThrow(/at least one meaning/i);
  });
});
