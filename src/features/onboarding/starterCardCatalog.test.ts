import { describe, expect, it } from 'vitest';
import { COURSE_NATIVE_LANGUAGES, COURSE_TARGET_LANGUAGES } from '../courses/courseModel';
import { starterCardsFor } from './starterCardCatalog';

describe('starterCardsFor', () => {
  it('returns five distinct real words for every supported target/native pair, except a target equal to its own native', () => {
    for (const target of COURSE_TARGET_LANGUAGES) {
      for (const native of COURSE_NATIVE_LANGUAGES) {
        const cards = starterCardsFor(target, native);
        if (target === native) {
          expect(cards).toHaveLength(0);
          continue;
        }
        expect(cards).toHaveLength(5);
        const words = new Set(cards.map(card => card.word));
        expect(words.size).toBe(5);
        for (const card of cards) {
          expect(card.word.trim().length).toBeGreaterThan(0);
          expect(card.translation.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });
});
