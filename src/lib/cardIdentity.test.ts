import { describe, expect, it } from 'vitest';
import {
  createCardIdentityReservation,
  createCardIdentityReservationId,
  createWordCardId,
  cardLogicalKey,
  dedupeCardsByNormalizedWord,
  isCardIdentityReservationForWord,
  normalizeCardWord,
} from './cardIdentity';
import { createLexemeId } from '../features/multilingual/lexemeIdentity';

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

  it('builds one immutable reservation identity for equivalent card words', () => {
    expect(createCardIdentityReservation('  Turn   Up ')).toEqual({
      schemaVersion: 1,
      cardId: createWordCardId('turn up'),
      normalizedWord: 'turn up',
    });
    expect(createCardIdentityReservation('ＴＵＲＮ　ＵＰ'))
      .toEqual(createCardIdentityReservation('turn up'));
  });

  it('uses the full normalized-word SHA-256 as the reservation document id', () => {
    expect(createCardIdentityReservationId(' Chance ')).toBe(
      '6cb09fe72a3471a776f9dbb8509fa5befe73e878f23dd71be79d24ec90c1b9db',
    );
    expect(createCardIdentityReservationId('ＴＵＲＮ ＵＰ')).toBe(
      createCardIdentityReservationId('turn up'),
    );
    expect(createCardIdentityReservationId('turn up')).toHaveLength(64);
    expect(createCardIdentityReservationId('a'.repeat(256))).toBe(
      '02d7160d77e18c6447be80c2e355c7ed4388545271702c50253b0914c65ce5fe',
    );
  });

  it('accepts an existing safe card id as the immutable owner of a word claim', () => {
    expect(isCardIdentityReservationForWord({
      schemaVersion: 1,
      cardId: 'legacy-card-id',
      normalizedWord: 'chance',
    }, 'chance')).toBe(true);
    expect(isCardIdentityReservationForWord({
      schemaVersion: 1,
      cardId: 'unsafe/card-id',
      normalizedWord: 'chance',
    }, 'chance')).toBe(false);
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

  it('uses a verified V3 tuple but keeps malformed metadata on the explicit legacy fallback', () => {
    const lexemeId = createLexemeId({ language: 'en', normalizedLemma: 'lead', partOfSpeech: 'noun', senseKey: 'metal' });
    const noun = { id: lexemeId, word: 'lead', normalizedWord: 'lead', language: 'en', partOfSpeech: 'noun', senseKey: 'metal', lexemeId };
    const forged = { ...noun, id: 'forged', lexemeId: 'lexeme-forged' };
    expect(cardLogicalKey(noun)).toBe(`lexeme:${lexemeId}`);
    expect(cardLogicalKey(forged)).toBe('lead');
  });

  it('uses the Functions/rules-compatible canonical lexeme vector without a module cycle', () => {
    expect(createLexemeId({ language: ' EN ', normalizedLemma: 'Lead', partOfSpeech: 'NOUN', senseKey: 'Metal' }))
      .toBe('lexeme-5b22656e222c224c656164222c226e6f756e222c226d6574616c225d-67bd6f4a508c4ef3e53e5c56');
  });
});
