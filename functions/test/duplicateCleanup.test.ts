import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { LegacyLibraryInvalidCardsError } from '../src/legacyLibraryMigration.js';
import { canonicalCard } from '../src/cardPersistence.js';
import {
  canonicalCleanupCardId,
  cleanupCardIdentity,
  cleanupIdentityFromKey,
  cleanupIdentityReservation,
  cleanupIdentityStorageKey,
  normalizeCleanupWord,
  planLegacyIdentityGroup,
  planDuplicateGroup,
  summarizeFacetCounts,
} from '../src/duplicateCleanup.js';
import { resolveJapanesePitchAccent } from '../src/japanesePitch.js';

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
        word: 'Quite',
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

  it('keeps the headword as the learner wrote it and every stored card field', () => {
    const stored = {
      origin: 'ai',
      mnemonic: 'Paris rhymes with "embarrass"',
      wordFamily: { noun: 'Parisian', adj: 'Parisian' },
      masteredAt: '2026-05-02T10:00:00.000Z',
      appliedReviewOperationIds: ['review-op-1', 'review-op-2'],
      tags: ['travel', 'cities'],
      learnerDifficulty: 'medium',
      translationAlternatives: ['thủ đô nước Pháp'],
    };
    const plan = planLegacyIdentityGroup([
      card('legacy-paris', { word: ' Paris ', normalizedWord: 'paris', translation: 'Pa-ri', ...stored }),
    ], { jobId: 'job-1', libraryEpoch: 3 });

    expect(plan.normalizedWord).toBe('paris');
    expect(plan.merged).toMatchObject({ word: 'Paris', normalizedWord: 'paris', ...stored });
  });

  it('keeps verified Japanese pitch metadata and drops pitch that does not match the word', () => {
    const japanese = { word: '日本', normalizedWord: '日本', phonetic: 'ニッポン', language: 'ja' };
    const pitch = resolveJapanesePitchAccent('日本', 'ニッポン', 'ja');
    expect(pitch).toBeDefined();

    expect(planLegacyIdentityGroup([
      card('legacy-nippon', { ...japanese, japanesePitchAccent: pitch }),
    ], { jobId: 'job-1', libraryEpoch: 3 }).merged.japanesePitchAccent).toEqual(pitch);
    expect(planLegacyIdentityGroup([
      card('legacy-nippon', { ...japanese, japanesePitchAccent: { ...pitch, downstep: 1 } }),
    ], { jobId: 'job-1', libraryEpoch: 3 }).merged).not.toHaveProperty('japanesePitchAccent');
  });

  it('keeps the review receipts of every duplicate and fills learner notes from weaker copies', () => {
    const plan = planLegacyIdentityGroup([
      card('learned', { reviews: 10, appliedReviewOperationIds: ['op-strong-1', 'op-shared'] }),
      card('noted', {
        reviews: 1,
        appliedReviewOperationIds: ['op-weak-1', 'op-shared'],
        mnemonic: 'quiet without the e moved',
        tags: ['adverbs'],
        wordFamily: { adv: 'quite' },
        learnerDifficulty: 'hard',
      }),
    ], { jobId: 'job-1', libraryEpoch: 3 });

    expect(plan.strongestSourceId).toBe('learned');
    expect(plan.merged.appliedReviewOperationIds).toEqual(['op-weak-1', 'op-strong-1', 'op-shared']);
    expect(plan.merged).toMatchObject({
      mnemonic: 'quiet without the e moved',
      tags: ['adverbs'],
      wordFamily: { adv: 'quite' },
      learnerDifficulty: 'hard',
    });
  });

  it('bounds merged review receipts and leaves malformed optional values out', () => {
    const receipts = (prefix: string) => Array.from({ length: 80 }, (_, index) => `${prefix}-${index}`);
    const plan = planLegacyIdentityGroup([
      card('learned', {
        reviews: 10,
        appliedReviewOperationIds: receipts('strong'),
        origin: 'imported',
        wordFamily: { noun: 'quiteness', slang: 'unsupported' },
        tags: ['dup', 'dup'],
        learnerDifficulty: 'impossible',
        masteredAt: 'not-a-date',
        translationAlternatives: ['only AI cards carry alternatives'],
      }),
      card('weaker', { reviews: 1, appliedReviewOperationIds: receipts('weak') }),
    ], { jobId: 'job-1', libraryEpoch: 3 });

    const merged = plan.merged.appliedReviewOperationIds as string[];
    expect(merged).toHaveLength(100);
    expect(merged.slice(-80)).toEqual(receipts('strong'));
    for (const field of ['origin', 'wordFamily', 'tags', 'learnerDifficulty', 'masteredAt', 'translationAlternatives']) {
      expect(plan.merged).not.toHaveProperty(field);
    }
  });

  it('falls back to the identity when the stored headword spells a different word', () => {
    const plan = planLegacyIdentityGroup([
      card('mismatched', { word: 'Quiet', normalizedWord: 'quite' }),
    ], { jobId: 'job-1', libraryEpoch: 3 });

    expect(plan.merged).toMatchObject({ word: 'quite', normalizedWord: 'quite' });
  });

  it('keeps a photo the learner uploaded to their own files', () => {
    const ownPhoto = 'https://firebasestorage.googleapis.com/v0/b/encoded-hangout-433912-h2.firebasestorage.app/o/users%2Fowner%2Ffiles%2FAbCdEfGhIjKlMnOpQrSt?alt=media&token=0b0f1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
    const context = { jobId: 'job-1', libraryEpoch: 3 };

    expect(planLegacyIdentityGroup([card('pictured', { imageUrl: ownPhoto })], context).merged.imageUrl)
      .toBe(ownPhoto);
    // A weaker copy's photo fills in when the strongest copy has none.
    expect(planLegacyIdentityGroup([
      card('learned', { reviews: 10 }),
      card('pictured', { imageUrl: ownPhoto }),
    ], context).merged.imageUrl).toBe(ownPhoto);
    // Any other address on the storage host is not a learner file.
    for (const imageUrl of [
      `${ownPhoto}&download=1`,
      ownPhoto.replace('users%2Fowner%2Ffiles', 'public'),
      ownPhoto.replace('encoded-hangout-433912-h2.firebasestorage.app', 'another-project.firebasestorage.app'),
    ]) {
      expect(planLegacyIdentityGroup([card('pictured', { imageUrl })], context).merged.imageUrl).toBeNull();
    }
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
    ], { jobId: 'job-1', libraryEpoch: 4 })).toThrow(LegacyLibraryInvalidCardsError);
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

  it('drops legacy FSRS values outside the persistence contract', () => {
    for (const fsrs of [
      { stability: 0, difficulty: 4 },
      { stability: 2, difficulty: 0 },
      { stability: 2, difficulty: 4, elapsedDays: 1.5 },
      { stability: 2, difficulty: 4, reps: 1.5 },
    ]) {
      const plan = planLegacyIdentityGroup([card('invalid-fsrs', {
        fsrs: {
          due: '2026-08-20T00:00:00.000Z',
          elapsedDays: 1, scheduledDays: 2, learningSteps: 0, reps: 1, lapses: 0, state: 2,
          ...fsrs,
        },
      })], { jobId: 'job-1', libraryEpoch: 4 });
      expect(plan.merged).not.toHaveProperty('fsrs');
    }
  });

  it('keeps a language-tagged legacy word readable before and after migration', () => {
    const legacy = card('legacy', { language: 'en', partOfSpeech: 'adjective' });
    expect(cleanupCardIdentity(legacy)).toEqual({ key: 'word:quite', normalizedWord: 'quite' });
    const plan = planLegacyIdentityGroup([legacy], { jobId: 'job-1', libraryEpoch: 4 });
    expect(cleanupCardIdentity({ ...plan.merged, language: 'en' })).toEqual({ key: 'word:quite', normalizedWord: 'quite' });
    for (const incomplete of [{ lexemeId: 'broken' }, { senseKey: 'metal' }, { normalizedLemma: 'quite' }]) {
      expect(cleanupCardIdentity({ ...legacy, ...incomplete })).toBeNull();
    }
  });

  it('gives the same spelling in different target languages separate identities', () => {
    const water = (id: string, language: string) => card(id, { word: '水', normalizedWord: undefined, language });
    const japanese = cleanupCardIdentity(water('ja-water', 'ja'));
    const chinese = cleanupCardIdentity(water('zh-water', 'zh'));

    expect(japanese?.key).not.toBe(chinese?.key);
    expect(japanese).toMatchObject({ normalizedWord: '水', targetLanguage: 'ja' });
    expect(() => planDuplicateGroup([water('ja-water', 'ja'), water('zh-water', 'zh')], { jobId: 'job-1', libraryEpoch: 4 }))
      .toThrow('validated identity');
    // An English word that merely looks like a language-tagged key stays its own identity.
    expect(cleanupCardIdentity(card('lookalike', { word: 'ja:水', normalizedWord: undefined }))?.key)
      .not.toBe(japanese?.key);
  });

  it('migrates a non-English word to the card id and reservation a card create would use', () => {
    for (const [word, language] of [['水', 'ja'], ['물', 'ko'], ['Wasser', 'de'], ['quite', 'en']] as const) {
      const legacy = card('legacy-id', { word, normalizedWord: undefined, language });
      const identity = cleanupCardIdentity(legacy);
      const created = canonicalCard({ word, language });
      expect(identity).not.toBeNull();
      if (!identity) continue;

      expect(planLegacyIdentityGroup([legacy], { jobId: 'job-1', libraryEpoch: 4 }).primaryId).toBe(created.id);
      expect(canonicalCleanupCardId(cleanupIdentityFromKey(identity.key, identity.normalizedWord))).toBe(created.id);
      expect(cleanupIdentityStorageKey(identity)).toBe(
        language === 'en' ? created.normalizedWord : `${language}\u0000${String(created.normalizedWord)}`,
      );
      expect(cleanupIdentityReservation(identity, String(created.id))).toEqual({
        schemaVersion: 1,
        cardId: created.id,
        normalizedWord: created.normalizedWord,
        ...(language === 'en' ? {} : { targetLanguage: language }),
      });
    }
  });

  it('treats a missing or malformed language as English, as the migrated card is written', () => {
    for (const language of [undefined, 'en', 'KO', ' ko ', 42]) {
      expect(cleanupCardIdentity(card('legacy', { language }))).toEqual({ key: 'word:quite', normalizedWord: 'quite' });
    }
  });

  it('keeps valid same-word lexemes separate and preserves their identity tuple', () => {
    const lexemeId = (senseKey: string) => {
      const bytes = Buffer.from(JSON.stringify(['en', 'lead', 'noun', senseKey])).toString('hex');
      const value = `\u0000${bytes}`;
      const slug = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);
      return `lexeme-${slug}-${createHash('sha256').update(value).digest('hex').slice(0, 24)}`;
    };
    const lexeme = (id: string, senseKey: string) => card(id, {
      word: 'lead', normalizedWord: 'lead', language: 'en', normalizedLemma: 'lead',
      partOfSpeech: 'noun', senseKey,
      lexemeId: lexemeId(senseKey),
    });
    // Use a real canonical tuple generated by the public card validator's format.
    const noun = lexeme('noun', 'metal');
    const verb = lexeme('verb', 'guide');
    const migrated = planLegacyIdentityGroup([noun], { jobId: 'job-1', libraryEpoch: 4 }).merged;
    expect(migrated).toMatchObject({ lexemeId: lexemeId('metal'), language: 'en', normalizedLemma: 'lead', partOfSpeech: 'noun', senseKey: 'metal' });
    expect(cleanupCardIdentity(migrated)).toEqual(cleanupCardIdentity(noun));
    expect(() => planDuplicateGroup([noun, verb], { jobId: 'job-1', libraryEpoch: 4 }))
      .toThrow('validated identity');
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
