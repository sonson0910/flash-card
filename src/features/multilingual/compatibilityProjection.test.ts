import { describe, expect, it } from 'vitest';
import type { LexemeAggregateV3 } from './schemaV3';
import { projectLexemeAggregateV3ToCardData } from './compatibilityProjection';

const aggregate = (): LexemeAggregateV3 => ({
  schemaVersion: 3,
  lexeme: {
    schemaVersion: 3,
    id: 'lexeme-1',
    language: 'en',
    lemma: 'allocate',
    normalizedLemma: 'allocate',
    partOfSpeech: 'verb',
    senseKey: 'assign-resource',
    definitions: [
      { language: 'vi', text: 'phân bổ' },
      { language: 'en', text: 'to assign resources' },
    ],
    phonetics: ['/\u02C8æləkeɪt/'],
    examples: [{
      text: 'We allocate resources.',
      translations: [{ language: 'vi', text: 'Chúng tôi phân bổ nguồn lực.' }],
    }],
    collocations: ['allocate resources'],
    wordFamily: ['allocation'],
    media: { audioUrl: 'https://example.test/audio.mp3', imageUrl: null, imageSearchQuery: 'allocation' },
    compatibility: {
      legacyPartOfSpeech: 'verb',
      translation: 'phân bổ',
      explanation: 'to assign resources',
      explanationTranslation: 'giao tài nguyên cho một mục đích',
      emoji: '📦',
      exampleSentence: 'We allocate resources.',
      exampleTranslation: 'Chúng tôi phân bổ nguồn lực.',
      synonyms: ['assign'],
      antonyms: ['withhold'],
      register: 'formal',
      commonMistake: 'Do not confuse allocate with locate.',
    },
    provenance: { source: 'pilot', license: 'review', reviewer: 'r1', editorialStatus: 'reviewed' },
    contentVersion: 1,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-02T00:00:00.000Z',
  },
  memberships: [
    {
      schemaVersion: 3,
      id: 'membership-z-general',
      lexemeId: 'lexeme-1',
      trackId: 'general',
      tier: 'foundation',
      cefrLevel: 'B1',
      topic: 'daily life',
      legacyCategory: 'General',
      skills: ['reading'],
      rank: 5,
      lessonGroup: 'resources',
      editorialStatus: 'reviewed',
      contentVersion: 1,
    },
    {
      schemaVersion: 3,
      id: 'membership-a-ielts',
      lexemeId: 'lexeme-1',
      trackId: 'ielts',
      tier: 'core',
      cefrLevel: 'B2',
      topic: 'education',
      legacyCategory: 'Academic',
      skills: ['writing'],
      rank: 10,
      lessonGroup: 'academic-resources',
      editorialStatus: 'reviewed',
      contentVersion: 1,
    },
  ],
  learningState: {
    schemaVersion: 3,
    ownerId: 'learner-1',
    lexemeId: 'lexeme-1',
    legacyCardId: 'word-allocate',
    fsrs: {
      due: '2026-08-04T00:00:00.000Z', stability: 2, difficulty: 4,
      elapsedDays: 1, scheduledDays: 2, learningSteps: 1, reps: 3, lapses: 0, state: 2,
    },
    reviewHistory: [{ rating: 'good', reviewedAt: '2026-08-02T00:00:00.000Z', scheduledDays: 2, elapsedDays: 1 }],
    bookmarked: true,
    difficulty: 'good',
    correctStreak: 3,
    customCollections: ['work'],
    nextReviewDate: '2026-08-04T00:00:00.000Z',
    reviews: 3,
    interval: 2,
    easeFactor: 2.5,
    revision: 4,
    libraryEpoch: 2,
    createdAt: '2026-08-01T00:00:00.000Z',
    lastOpenedAt: '2026-08-02T12:00:00.000Z',
    sortTouchedAt: '2026-08-02T13:00:00.000Z',
    updatedAt: '2026-08-03T00:00:00.000Z',
  },
});

describe('projectLexemeAggregateV3ToCardData', () => {
  it('maps shared content and learner progress without losing compatibility fields', () => {
    const card = projectLexemeAggregateV3ToCardData(aggregate(), { trackId: 'general' });

    expect(card).toMatchObject({
      id: 'word-allocate',
      word: 'allocate',
      normalizedWord: 'allocate',
      translation: 'phân bổ',
      explanation: 'to assign resources',
      explanationTranslation: 'giao tài nguyên cho một mục đích',
      emoji: '📦',
      phonetic: '/\u02C8æləkeɪt/',
      category: 'General',
      audioUrl: 'https://example.test/audio.mp3',
      imageUrl: null,
      imageSearchQuery: 'allocation',
      partOfSpeech: 'verb',
      cefrLevel: 'B1',
      exampleSentence: 'We allocate resources.',
      exampleTranslation: 'Chúng tôi phân bổ nguồn lực.',
      collocations: ['allocate resources'],
      synonyms: ['assign'],
      antonyms: ['withhold'],
      register: 'formal',
      commonMistake: 'Do not confuse allocate with locate.',
      bookmarked: true,
      difficulty: 'good',
      customDeck: 'work',
      correctStreak: 3,
      revision: 4,
      libraryEpoch: 2,
      updatedAt: '2026-08-03T00:00:00.000Z',
      createdAt: '2026-08-01T00:00:00.000Z',
      lastOpenedAt: '2026-08-02T12:00:00.000Z',
      sortTouchedAt: '2026-08-02T13:00:00.000Z',
    });
    expect(card.fsrs).toEqual(aggregate().learningState?.fsrs);
    expect(card.reviewHistory).toEqual(aggregate().learningState?.reviewHistory);
  });

  it('uses membership id order as the stable fallback', () => {
    const input = aggregate();
    const forward = projectLexemeAggregateV3ToCardData(input);
    const reverse = projectLexemeAggregateV3ToCardData({ ...input, memberships: [...input.memberships].reverse() });

    expect(forward.category).toBe('Academic');
    expect(reverse.category).toBe('Academic');
  });

  it('does not manufacture progress when learning state is absent', () => {
    const input = { ...aggregate(), learningState: null };
    const card = projectLexemeAggregateV3ToCardData(input);

    expect(card).not.toHaveProperty('bookmarked');
    expect(card).not.toHaveProperty('difficulty');
    expect(card).not.toHaveProperty('reviewHistory');
    expect(() => projectLexemeAggregateV3ToCardData(input, { requireLearningState: true }))
      .toThrow(/learning state/i);
  });

  it('rejects an explicitly requested track that is not present', () => {
    expect(() => projectLexemeAggregateV3ToCardData(aggregate(), { trackId: 'toeic' }))
      .toThrow(/track/i);
  });

  it('projects a stable empty image search query when catalog media omits it', () => {
    const input = aggregate();
    const { imageSearchQuery: _omitted, ...media } = input.lexeme.media;
    const card = projectLexemeAggregateV3ToCardData({
      ...input,
      lexeme: { ...input.lexeme, media },
    });

    expect(card).toHaveProperty('imageSearchQuery', '');
  });
});
