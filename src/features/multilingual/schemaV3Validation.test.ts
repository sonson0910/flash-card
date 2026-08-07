import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createLexemeId, createTrackMembershipId } from './lexemeIdentity';
import { SCHEMA_V3_LIMITS } from './schemaV3';
import { parseLearningStateV3, parseLexemeAggregateV3 } from './schemaV3Validation';

const validAggregate = () => {
  const lexemeId = createLexemeId({
    language: 'en',
    normalizedLemma: 'allocate',
    partOfSpeech: 'verb',
    senseKey: 'assign-resource',
  });
  const membershipId = createTrackMembershipId({ trackId: 'ielts', lexemeId });
  return {
    schemaVersion: 3,
    lexeme: {
      schemaVersion: 3,
      id: lexemeId,
      language: 'en',
      lemma: 'allocate',
      normalizedLemma: 'allocate',
      partOfSpeech: 'verb',
      senseKey: 'assign-resource',
      definitions: [{ language: 'vi', text: 'phân bổ' }],
      phonetics: ['/\u02C8æləkeɪt/'],
      examples: [{
        text: 'We allocate resources.',
        translations: [{ language: 'vi', text: 'Chúng tôi phân bổ nguồn lực.' }],
      }],
      collocations: ['allocate resources'],
      wordFamily: ['allocation'],
      media: { audioUrl: null, imageUrl: null, imageSearchQuery: 'resource allocation' },
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
      provenance: {
        source: 'editorial-pilot',
        license: 'internal-review',
        reviewer: 'reviewer-1',
        editorialStatus: 'reviewed',
      },
      contentVersion: 1,
      createdAt: '2026-08-03T00:00:00.000Z',
      updatedAt: '2026-08-03T01:00:00.000Z',
    },
    memberships: [{
      schemaVersion: 3,
      id: membershipId,
      lexemeId,
      trackId: 'ielts',
      tier: 'core',
      cefrLevel: 'B2',
      topic: 'education',
      legacyCategory: 'Academic',
      skills: ['reading', 'writing'],
      rank: 10,
      lessonGroup: 'academic-resources',
      editorialStatus: 'reviewed',
      contentVersion: 1,
    }],
    learningState: {
      schemaVersion: 3,
      ownerId: 'learner-1',
      lexemeId,
      legacyCardId: 'word-allocate',
      fsrs: {
        due: '2026-08-04T00:00:00.000Z',
        stability: 2.5,
        difficulty: 4.5,
        elapsedDays: 1,
        scheduledDays: 2,
        learningSteps: 1,
        reps: 4,
        lapses: 1,
        state: 2,
        lastReview: '2026-08-02T00:00:00.000Z',
      },
      reviewHistory: [{
        rating: 'good',
        reviewedAt: '2026-08-02T00:00:00.000Z',
        scheduledDays: 2,
        elapsedDays: 1,
      }],
      bookmarked: true,
      difficulty: 'good',
      mastery: 0.6,
      correctStreak: 3,
      lastActivityAt: '2026-08-02T00:00:00.000Z',
      customCollections: ['work'],
      nextReviewDate: '2026-08-04T00:00:00.000Z',
      reviews: 4,
      interval: 2,
      easeFactor: 2.5,
      revision: 4,
      libraryEpoch: 2,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-03T00:00:00.000Z',
    },
  };
};

describe('parseLexemeAggregateV3', () => {
  it('parses a strict bounded aggregate and preserves its values', () => {
    const input = validAggregate();

    expect(parseLexemeAggregateV3(input, { expectedOwnerId: 'learner-1' })).toEqual(input);
  });

  it.each([
    ['schema mismatch', (input: ReturnType<typeof validAggregate>) => ({ ...input, schemaVersion: 2 })],
    ['unknown field', (input: ReturnType<typeof validAggregate>) => ({ ...input, injected: true })],
    ['nested unknown field', (input: ReturnType<typeof validAggregate>) => ({
      ...input,
      lexeme: { ...input.lexeme, media: { ...input.lexeme.media, injected: true } },
    })],
    ['oversized lemma', (input: ReturnType<typeof validAggregate>) => ({
      ...input,
      lexeme: { ...input.lexeme, lemma: 'a'.repeat(SCHEMA_V3_LIMITS.lemma + 1) },
    })],
    ['non-finite number', (input: ReturnType<typeof validAggregate>) => ({
      ...input,
      learningState: { ...input.learningState, mastery: Number.NaN },
    })],
    ['invalid ISO timestamp', (input: ReturnType<typeof validAggregate>) => ({
      ...input,
      lexeme: { ...input.lexeme, updatedAt: 'yesterday' },
    })],
  ])('rejects %s', (_name, mutate) => {
    expect(() => parseLexemeAggregateV3(mutate(validAggregate()))).toThrow();
  });

  it('preserves finite fractional FSRS day and learning-step values from v2', () => {
    const input = validAggregate();
    input.learningState.fsrs.elapsedDays = 0.5;
    input.learningState.fsrs.scheduledDays = 1.5;
    input.learningState.fsrs.learningSteps = 0.25;

    expect(parseLexemeAggregateV3(input).learningState?.fsrs).toMatchObject({
      elapsedDays: 0.5,
      scheduledDays: 1.5,
      learningSteps: 0.25,
    });
  });

  it('preserves finite fractional review-history day values from v2', () => {
    const input = validAggregate();
    input.learningState.reviewHistory[0].elapsedDays = 0.5;
    input.learningState.reviewHistory[0].scheduledDays = 1.5;

    expect(parseLexemeAggregateV3(input).learningState?.reviewHistory[0]).toMatchObject({
      elapsedDays: 0.5,
      scheduledDays: 1.5,
    });
  });

  it.each([
    ['language case', (input: ReturnType<typeof validAggregate>) => { input.lexeme.language = 'EN'; }],
    ['normalized lemma whitespace', (input: ReturnType<typeof validAggregate>) => { input.lexeme.normalizedLemma = ' allocate '; }],
    ['normalized lemma compatibility form', (input: ReturnType<typeof validAggregate>) => { input.lexeme.normalizedLemma = 'ａｌｌｏｃａｔｅ'; }],
    ['part-of-speech case', (input: ReturnType<typeof validAggregate>) => { input.lexeme.partOfSpeech = 'Verb'; }],
    ['sense whitespace', (input: ReturnType<typeof validAggregate>) => { input.lexeme.senseKey = ' assign-resource '; }],
    ['track case', (input: ReturnType<typeof validAggregate>) => { input.memberships[0].trackId = 'IELTS'; }],
  ])('rejects noncanonical %s even when its derived id still matches', (_name, mutate) => {
    const input = validAggregate();
    mutate(input);
    expect(() => parseLexemeAggregateV3(input)).toThrow(/canonical/i);
  });

  it.each([
    ['FSRS difficulty above 10', (input: ReturnType<typeof validAggregate>) => {
      input.learningState.fsrs.difficulty = 10.01;
    }],
    ['FSRS state above 3', (input: ReturnType<typeof validAggregate>) => {
      input.learningState.fsrs.state = 4;
    }],
    ['ease factor above 5', (input: ReturnType<typeof validAggregate>) => {
      input.learningState.easeFactor = 5.01;
    }],
  ])('rejects %s', (_name, mutate) => {
    const input = validAggregate();
    mutate(input);
    expect(() => parseLexemeAggregateV3(input)).toThrow();
  });

  it.each([
    ['audio URL', { audioUrl: 'https://evil.example/audio.mp3' }],
    ['protocol-relative audio URL', { audioUrl: '//ssl.gstatic.com/dictionary/audio.mp3' }],
    ['image URL', { imageUrl: 'https://evil.example/image.jpg' }],
  ])('rejects an unsupported %s', (_name, mediaPatch) => {
    const input = validAggregate();
    Object.assign(input.lexeme.media, mediaPatch);
    expect(() => parseLexemeAggregateV3(input)).toThrow(/media/i);
  });

  it.each([
    ['translation', (input: ReturnType<typeof validAggregate>) => { input.lexeme.compatibility.translation = 'a'.repeat(257); }],
    ['emoji', (input: ReturnType<typeof validAggregate>) => { input.lexeme.compatibility.emoji = 'a'.repeat(65); }],
    ['register', (input: ReturnType<typeof validAggregate>) => { input.lexeme.compatibility.register = 'a'.repeat(65); }],
    ['synonym count', (input: ReturnType<typeof validAggregate>) => { input.lexeme.compatibility.synonyms = ['a', 'b', 'c', 'd', 'e']; }],
    ['antonym item', (input: ReturnType<typeof validAggregate>) => { input.lexeme.compatibility.antonyms = ['a'.repeat(101)]; }],
  ])('enforces the v2 compatibility bound for %s', (_name, mutate) => {
    const input = validAggregate();
    mutate(input);
    expect(() => parseLexemeAggregateV3(input)).toThrow(/compatibility/i);
  });

  it('rejects a legacy card id that is unsafe for a Firestore document path', () => {
    const input = validAggregate();
    input.learningState.legacyCardId = 'cards/allocate';
    expect(() => parseLexemeAggregateV3(input)).toThrow(/legacyCardId/i);
  });

  it('rejects collection names that Firestore Rules cannot store', () => {
    const input = validAggregate();
    input.learningState.customCollections = ['a'.repeat(129)];
    expect(() => parseLexemeAggregateV3(input)).toThrow(/customCollections/i);
  });

  it('rejects ISO-shaped timestamps with impossible calendar dates', () => {
    const input = validAggregate();
    input.learningState.createdAt = '2026-02-31T00:00:00.000Z';
    expect(() => parseLexemeAggregateV3(input)).toThrow(/createdAt/i);
  });

  it('rejects a lexeme id that does not match its logical identity', () => {
    const input = validAggregate();
    input.lexeme.id = 'lexeme-wrong';

    expect(() => parseLexemeAggregateV3(input)).toThrow(/lexeme\.id/i);
  });

  it('rejects membership reference and identity mismatches', () => {
    const wrongReference = validAggregate();
    wrongReference.memberships[0].lexemeId = 'lexeme-other';
    const wrongIdentity = validAggregate();
    wrongIdentity.memberships[0].id = 'membership-wrong';

    expect(() => parseLexemeAggregateV3(wrongReference)).toThrow(/membership.*lexemeId/i);
    expect(() => parseLexemeAggregateV3(wrongIdentity)).toThrow(/membership.*id/i);
  });

  it('rejects learning-state reference and expected-owner mismatches', () => {
    const wrongReference = validAggregate();
    wrongReference.learningState.lexemeId = 'lexeme-other';

    expect(() => parseLexemeAggregateV3(wrongReference)).toThrow(/learningState\.lexemeId/i);
    expect(() => parseLexemeAggregateV3(validAggregate(), { expectedOwnerId: 'learner-2' }))
      .toThrow(/learningState\.ownerId/i);
  });
});

describe('schema v3 dependency boundary', () => {
  it('uses a vendor-free leaf policy for media URL validation', () => {
    const validatorSource = readFileSync(new URL('./schemaV3Validation.ts', import.meta.url), 'utf8');
    const policySource = readFileSync(new URL('../../lib/mediaUrlPolicy.ts', import.meta.url), 'utf8');

    expect(validatorSource).toMatch(/from ['"]\.\.\/\.\.\/lib\/mediaUrlPolicy['"]/);
    expect(validatorSource).not.toMatch(/from ['"]\.\.\/\.\.\/lib\/(?:images|audio|firebase)['"]/);
    expect(policySource).not.toMatch(/firebase|react/i);
  });
});

describe('parseLearningStateV3', () => {
  it('parses a reusable owner- and lexeme-bound learning-state document', () => {
    const input = validAggregate();
    expect(parseLearningStateV3(input.learningState, {
      expectedOwnerId: 'learner-1',
      expectedLexemeId: input.lexeme.id,
    })).toEqual(input.learningState);
  });

  it('rejects owner and lexeme mismatches at the storage seam', () => {
    const input = validAggregate();
    expect(() => parseLearningStateV3(input.learningState, {
      expectedOwnerId: 'learner-2',
      expectedLexemeId: input.lexeme.id,
    })).toThrow(/ownerId/i);
    expect(() => parseLearningStateV3(input.learningState, {
      expectedOwnerId: 'learner-1',
      expectedLexemeId: 'lexeme-other',
    })).toThrow(/lexemeId/i);
  });
});
