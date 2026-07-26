import { describe, expect, it } from 'vitest';
import type { CardData } from '../types/card';
import { normalizeCardData } from './cardNormalization';

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
    }, 'document-id');

    expect(card).toMatchObject({
      id: 'stored-id',
      emoji: '👗',
      difficulty: 'good',
      bookmarked: true,
      customDeck: 'IELTS',
      imageSearchQuery: 'clothing fashion garment fabric',
    });
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
