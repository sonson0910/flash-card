import { describe, expect, it } from 'vitest';
import type {
  LearningStateV3,
  LexemeAggregateV3,
  LexemeV3,
  TrackMembershipV3,
} from './schemaV3';
import { SCHEMA_V3_LIMITS } from './schemaV3';

describe('schema v3 domain contracts', () => {
  it('keeps shared content and track placement separate from one learner state', () => {
    const lexeme: LexemeV3 = {
      schemaVersion: 3,
      id: 'lexeme-allocate',
      language: 'en',
      lemma: 'allocate',
      normalizedLemma: 'allocate',
      partOfSpeech: 'verb',
      senseKey: 'assign-resource',
      definitions: [{ language: 'vi', text: 'phân bổ' }],
      phonetics: ['/\u02C8æləkeɪt/'],
      examples: [{ text: 'We allocate resources carefully.', translations: [{ language: 'vi', text: 'Chúng tôi phân bổ nguồn lực cẩn thận.' }] }],
      collocations: ['allocate resources'],
      wordFamily: ['allocation'],
      media: { audioUrl: null, imageUrl: null },
      compatibility: {
        translation: 'phân bổ',
        explanation: '',
        explanationTranslation: '',
        emoji: '📊',
        exampleSentence: 'We allocate resources carefully.',
        exampleTranslation: 'Chúng tôi phân bổ nguồn lực cẩn thận.',
        synonyms: [],
        antonyms: [],
        register: '',
        commonMistake: '',
      },
      provenance: {
        source: 'editorial-pilot',
        license: 'internal-review',
        reviewer: 'reviewer-1',
        editorialStatus: 'reviewed',
      },
      contentVersion: 1,
      createdAt: '2026-08-03T00:00:00.000Z',
      updatedAt: '2026-08-03T00:00:00.000Z',
    };
    const memberships: readonly TrackMembershipV3[] = [
      {
        schemaVersion: 3,
        id: 'membership-ielts-allocate',
        lexemeId: lexeme.id,
        trackId: 'ielts',
        tier: 'core',
        cefrLevel: 'B2',
        topic: 'education',
        legacyCategory: 'IELTS',
        skills: ['reading', 'writing'],
        rank: 10,
        lessonGroup: 'academic-resources',
        contentVersion: 1,
      },
      {
        schemaVersion: 3,
        id: 'membership-toeic-allocate',
        lexemeId: lexeme.id,
        trackId: 'toeic',
        tier: 'intermediate',
        cefrLevel: 'B2',
        topic: 'office',
        legacyCategory: 'Business',
        skills: ['reading'],
        rank: 20,
        lessonGroup: 'resource-planning',
        contentVersion: 1,
      },
    ];
    const learningState: LearningStateV3 = {
      schemaVersion: 3,
      ownerId: 'learner-1',
      lexemeId: lexeme.id,
      legacyCardId: 'word-allocate',
      bookmarked: true,
      difficulty: 'good',
      customCollections: ['work'],
      correctStreak: 3,
      reviewHistory: [],
      revision: 4,
      libraryEpoch: 2,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-03T00:00:00.000Z',
    };
    const aggregate: LexemeAggregateV3 = {
      schemaVersion: 3,
      lexeme,
      memberships,
      learningState,
    };

    expect(aggregate.memberships.map(item => item.lexemeId)).toEqual([
      aggregate.lexeme.id,
      aggregate.lexeme.id,
    ]);
    expect(aggregate.learningState?.lexemeId).toBe(aggregate.lexeme.id);
  });

  it('publishes finite limits for every externally supplied collection', () => {
    expect(SCHEMA_V3_LIMITS.id).toBe(128);
    expect(SCHEMA_V3_LIMITS.lemma).toBeGreaterThan(0);
    expect(SCHEMA_V3_LIMITS.definitions).toBeGreaterThan(0);
    expect(SCHEMA_V3_LIMITS.reviewHistory).toBeGreaterThan(0);
    expect(SCHEMA_V3_LIMITS.longText).toBe(2_048);
    expect(SCHEMA_V3_LIMITS.reviewHistory).toBe(100);
    expect(SCHEMA_V3_LIMITS.customCollections).toBe(1);
    expect(Object.isFrozen(SCHEMA_V3_LIMITS)).toBe(true);
  });
});
