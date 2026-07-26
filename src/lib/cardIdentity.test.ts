import { describe, expect, it } from 'vitest';
import {
  createWordCardId,
  dedupeCardsByNormalizedWord,
  normalizeCardWord,
} from './cardIdentity';

describe('card identity', () => {
  it('normalizes case, Unicode width and repeated whitespace into one identity', () => {
    expect(normalizeCardWord('  ＡBILITY \n test  ')).toBe('ability test');
  });

  it('creates the same collision-free document id for equivalent words', () => {
    expect(createWordCardId('  Turn   Up ')).toBe(createWordCardId('turn up'));
    expect(createWordCardId('turn/up')).not.toBe(createWordCardId('turn up'));
  });

  it('preserves legacy-safe simple word ids', () => {
    expect(createWordCardId('Ability')).toBe('word-ability');
    expect(createWordCardId('turn_up')).toBe('word-turn_up');
  });

  it('creates bounded Firestore-safe ids for phrases, apostrophes, Unicode and long words', () => {
    const values = [
      'as soon as',
      "don't",
      'café 学习',
      'a'.repeat(256),
    ];

    values.forEach(value => {
      const id = createWordCardId(value);
      expect(id).toMatch(/^[a-zA-Z0-9_-]+$/);
      expect(id.length).toBeLessThanOrEqual(128);
    });
    expect(createWordCardId('turn/up')).not.toBe(createWordCardId('turn up'));
    expect(createWordCardId('resume')).not.toBe(createWordCardId('résumé'));
    expect(createWordCardId('as soon as')).toBe('word-as-soon-as-959be42f385efb549f15407e');
  });

  it('keeps one card per normalized word and preserves the card with learning progress', () => {
    const untouchedOriginal = {
      id: 'original',
      word: 'Chance',
      normalizedWord: 'chance',
      createdAt: '2026-01-01T00:00:00.000Z',
      difficulty: 'unrated',
      reviewHistory: [],
    };
    const reviewedDuplicate = {
      id: 'duplicate',
      word: ' chance ',
      createdAt: '2026-02-01T00:00:00.000Z',
      difficulty: 'good',
      reviewHistory: [{ reviewedAt: '2026-02-02T00:00:00.000Z' }],
    };

    expect(dedupeCardsByNormalizedWord([untouchedOriginal, reviewedDuplicate])).toEqual([
      reviewedDuplicate,
    ]);
  });
});
