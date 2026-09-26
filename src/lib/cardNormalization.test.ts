import { describe, expect, it } from 'vitest';
import type { CardData } from '../types/card';
import { effectiveCardTargetLanguage } from './cardIdentity';
import {
  effectiveCardLanguage,
  effectiveCardLanguagePair,
  effectiveCardTranslationLanguage,
  INVALID_CARD_LANGUAGE_MARKER,
  isValidCardLanguageFields,
  normalizeCardData,
} from './cardNormalization';

describe('normalizeCardData', () => {
  it('upgrades a legacy synced card to the current render schema', () => {
    const card = normalizeCardData({
      word: '  Hesitate  ',
      translation: 'do dự',
      explanation: 'To pause before acting.',
      phonetic: '/ˈhez.ɪ.teɪt/',
      category: 'Action',
    }, 'firestore-document-id');

    expect(card).toMatchObject({
      id: 'firestore-document-id',
      word: 'Hesitate',
      normalizedWord: 'hesitate',
      emoji: '📝',
      difficulty: 'unrated',
      bookmarked: false,
      customDeck: null,
      imageUrl: null,
      audioUrl: null,
    });
  });

  it('preserves current card values', () => {
    const card = normalizeCardData({
      id: 'stored-id',
      word: 'Garment',
      translation: 'quần áo',
      explanation: 'An item of clothing.',
      phonetic: '/ˈɡɑːr.mənt/',
      emoji: '👗',
      category: 'Fashion',
      difficulty: 'good',
      bookmarked: true,
      customDeck: 'IELTS',
      imageUrl: 'https://images.pexels.com/example.jpeg',
      audioUrl: 'https://example.com/audio.mp3',
      imageSearchQuery: 'clothing fashion garment fabric',
      schemaVersion: 2,
      revision: 7,
      libraryEpoch: 3,
      updatedAt: '2026-07-23T01:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastOpenedAt: '2026-07-23T00:00:00.000Z',
      sortTouchedAt: '2026-07-23T00:00:00.000Z',
    }, 'document-id');

    expect(card).toMatchObject({
      id: 'stored-id',
      emoji: '👗',
      difficulty: 'good',
      bookmarked: true,
      customDeck: 'IELTS',
      imageSearchQuery: 'clothing fashion garment fabric',
      schemaVersion: 2,
      revision: 7,
      libraryEpoch: 3,
      updatedAt: '2026-07-23T01:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
      lastOpenedAt: '2026-07-23T00:00:00.000Z',
      sortTouchedAt: '2026-07-23T00:00:00.000Z',
    });
  });

  it('reads legacy omissions as English to Vietnamese without adding fields to the normalized card', () => {
    const source = { word: 'legacy', translation: 'cũ' };
    const card = normalizeCardData(source, 'legacy-card');

    expect(card.language).toBeUndefined();
    expect(card.translationLanguage).toBeUndefined();
    expect(effectiveCardLanguagePair(card)).toEqual({ language: 'en', translationLanguage: 'vi' });
    expect(effectiveCardLanguage(card)).toBe('en');
    expect(effectiveCardTranslationLanguage(card)).toBe('vi');
    expect(source).not.toHaveProperty('language');
    expect(source).not.toHaveProperty('translationLanguage');
  });

  it('preserves independent target and translation language fields for plain cards', () => {
    const card = normalizeCardData({
      word: '안녕',
      translation: 'xin chào',
      language: ' KO ',
      translationLanguage: ' VI ',
    }, 'korean-card');

    expect(card).toMatchObject({ language: 'ko', translationLanguage: 'vi' });
    expect(effectiveCardLanguagePair(card)).toEqual({ language: 'ko', translationLanguage: 'vi' });
    expect(isValidCardLanguageFields(card)).toBe(true);
  });

  it('keeps legacy compatibility when only one valid language field is present', () => {
    const targetOnly = normalizeCardData({ word: '안녕', language: 'ko' }, 'target-only');
    const translationOnly = normalizeCardData({ word: 'hello', translationLanguage: 'en' }, 'translation-only');

    expect(effectiveCardLanguagePair(targetOnly)).toEqual({ language: 'ko', translationLanguage: 'vi' });
    expect(effectiveCardLanguagePair(translationOnly)).toEqual({ language: 'en', translationLanguage: 'en' });
  });

  it('retains malformed explicit language metadata so callers can reject it', () => {
    const card = normalizeCardData({
      word: 'safe',
      language: 'english',
      translationLanguage: 'zh-hant-123456789',
    }, 'malformed-language');

    expect(card.language).toBe('english');
    expect(card.translationLanguage).toBe('zh-hant-123456789');
    expect(isValidCardLanguageFields({ language: 'english' })).toBe(false);
    expect(isValidCardLanguageFields({ translationLanguage: 'fr' })).toBe(false);
    expect(() => effectiveCardLanguagePair({ language: 'english' })).toThrow(/language fields are invalid/i);
    expect(() => effectiveCardLanguagePair(card)).toThrow(/language fields are invalid/i);
  });

  it.each([42, null, ['ko']])('keeps non-string target metadata distinguishable from omission: %o', value => {
    const card = normalizeCardData({
      word: 'safe',
      language: value as unknown as CardData['language'],
      translationLanguage: value as unknown as CardData['translationLanguage'],
    }, `invalid-${String(value)}`);

    expect(card.language).toBe(INVALID_CARD_LANGUAGE_MARKER);
    expect(card.translationLanguage).toBe(INVALID_CARD_LANGUAGE_MARKER);
    expect(effectiveCardTargetLanguage(card)).toBeNull();
    expect(() => effectiveCardLanguagePair(card)).toThrow(/language fields are invalid/i);
  });

  it('preserves only supported immutable content origins', () => {
    expect(normalizeCardData({ word: 'AI', origin: 'ai' }, 'ai-card').origin).toBe('ai');
    expect(normalizeCardData({ word: 'manual', origin: 'manual' }, 'manual-card').origin).toBe('manual');
    expect(normalizeCardData({ word: 'legacy', origin: 'other' as never }, 'legacy-card').origin).toBeUndefined();
  });

  it('drops malformed mutation protocol metadata', () => {
    const card = normalizeCardData({
      word: 'safe',
      schemaVersion: 1 as unknown as 2,
      revision: -1,
      libraryEpoch: Number.POSITIVE_INFINITY,
      updatedAt: 'not-a-date',
    }, 'safe-id');

    expect(card.schemaVersion).toBeUndefined();
    expect(card.revision).toBeUndefined();
    expect(card.libraryEpoch).toBeUndefined();
    expect(card.updatedAt).toBeUndefined();
  });

  it('normalizes a Firestore server timestamp to an ISO string', () => {
    const card = normalizeCardData({
      word: 'server time',
      updatedAt: {
        toDate: () => new Date('2026-07-26T01:02:03.000Z'),
      } as unknown as string,
    }, 'server-time');

    expect(card.updatedAt).toBe('2026-07-26T01:02:03.000Z');
  });

  it('sanitizes optional enrichment fields from external data', () => {
    const raw = {
      word: 'run',
      translation: 'chạy',
      explanation: 'Move quickly on foot.',
      phonetic: '/rʌn/',
      emoji: '🏃',
      category: 'Action',
      collocations: 'run fast' as unknown as string[],
      synonyms: ['sprint', '', 'jog'],
    } as unknown as Parameters<typeof normalizeCardData>[0];
    const card = normalizeCardData(raw, 'run-id') as ReturnType<typeof normalizeCardData> & {
      collocations?: string[];
      synonyms?: string[];
    };

    expect(card.collocations).toEqual([]);
    expect(card.synonyms).toEqual(['sprint', 'jog']);
  });

  it('preserves bounded mnemonic enrichment for later edits', () => {
    const card = normalizeCardData({
      word: 'resilient',
      mnemonic: 'Think of a resilient spring bouncing back.',
      wordFamily: { noun: 'resilience', verb: 'resile', extra: 'drop me' } as unknown as CardData['wordFamily'],
    }, 'resilient-id');

    expect(card.mnemonic).toBe('Think of a resilient spring bouncing back.');
    expect(card.wordFamily).toEqual({ noun: 'resilience', verb: 'resile' });
  });

  it('normalizes part-of-speech labels for indexed filtering', () => {
    expect(normalizeCardData({ word: 'turn up', partOfSpeech: 'Phrasal-Verb' }, 'turn-up').partOfSpeech).toBe('phrasal verb');
  });

  it('drops unsafe media and malformed review history', () => {
    const card = normalizeCardData({
      word: 'safe',
      translation: 'an toàn',
      explanation: 'Not dangerous.',
      phonetic: '/seɪf/',
      emoji: '🛡️',
      category: 'General',
      audioUrl: 'javascript:alert(1)',
      imageUrl: 'https://attacker.example/image.png',
      reviewHistory: 'not-an-array' as unknown as CardData['reviewHistory'],
    }, 'safe-id');

    expect(card.audioUrl).toBeNull();
    expect(card.imageUrl).toBeNull();
    expect(card.reviewHistory).toEqual([]);
  });

  it('bounds every persisted field and removes malformed scheduling data', () => {
    const card = normalizeCardData({
      id: 'x'.repeat(300),
      word: 'w'.repeat(400),
      translation: 't'.repeat(400),
      explanation: 'e'.repeat(3000),
      category: 'c'.repeat(300),
      customDeck: 123 as unknown as string,
      reviews: -2,
      interval: Number.POSITIVE_INFINITY,
      easeFactor: 99,
      nextReviewDate: 'not-a-date',
      fsrs: { due: 'invalid' } as unknown as CardData['fsrs'],
    }, 'safe-document-id');

    expect(card.id.length).toBeLessThanOrEqual(128);
    expect(card.word.length).toBeLessThanOrEqual(256);
    expect(card.translation.length).toBeLessThanOrEqual(256);
    expect(card.explanation.length).toBeLessThanOrEqual(2048);
    expect(card.category.length).toBeLessThanOrEqual(128);
    expect(card.customDeck).toBeNull();
    expect(card.reviews).toBe(0);
    expect(card.interval).toBe(0);
    expect(card.easeFactor).toBe(2.5);
    expect(card.nextReviewDate).toBeUndefined();
    expect(card.fsrs).toBeUndefined();
  });

  it('sanitizes an unsafe fallback document id', () => {
    const card = normalizeCardData({ word: 'safe' }, 'folder/card id');
    expect(card.id).toBe('folder_card_id');
  });
});
