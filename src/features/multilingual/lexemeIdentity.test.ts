import { describe, expect, it } from 'vitest';
import {
  createLexemeId,
  createTrackMembershipId,
} from './lexemeIdentity';

describe('createLexemeId', () => {
  it('separates identical normalized lemmas in different languages', () => {
    const english = createLexemeId({
      language: 'en',
      normalizedLemma: 'gift',
      partOfSpeech: 'noun',
      senseKey: 'present',
    });
    const german = createLexemeId({
      language: 'de',
      normalizedLemma: 'gift',
      partOfSpeech: 'noun',
      senseKey: 'present',
    });

    expect(english).not.toBe(german);
  });

  it('separates senses of the same lemma and part of speech', () => {
    const financialBank = createLexemeId({
      language: 'en',
      normalizedLemma: 'bank',
      partOfSpeech: 'noun',
      senseKey: 'financial-institution',
    });
    const riverBank = createLexemeId({
      language: 'en',
      normalizedLemma: 'bank',
      partOfSpeech: 'noun',
      senseKey: 'river-edge',
    });

    expect(financialBank).not.toBe(riverBank);
  });

  it('includes part of speech and normalizes equivalent non-lemma identity components', () => {
    const noun = createLexemeId({
      language: ' EN ',
      normalizedLemma: '  fullwidth ａｐｐｌｅ  ',
      partOfSpeech: ' NOUN ',
      senseKey: ' Fruit ',
    });
    const equivalentNoun = createLexemeId({
      language: 'en',
      normalizedLemma: 'fullwidth apple',
      partOfSpeech: 'noun',
      senseKey: 'fruit',
    });
    const verb = createLexemeId({
      language: 'en',
      normalizedLemma: 'fullwidth apple',
      partOfSpeech: 'verb',
      senseKey: 'fruit',
    });

    expect(noun).toBe(equivalentNoun);
    expect(noun).not.toBe(verb);
  });

  it('preserves language-adapter casing in the normalized lemma identity', () => {
    const lower = createLexemeId({
      language: 'tr', normalizedLemma: 'istanbul', partOfSpeech: 'noun', senseKey: 'city',
    });
    const upper = createLexemeId({
      language: 'tr', normalizedLemma: 'Istanbul', partOfSpeech: 'noun', senseKey: 'city',
    });

    expect(lower).not.toBe(upper);
  });

  it('creates deterministic Firestore-safe ids bounded to 128 characters', () => {
    const input = {
      language: 'ja',
      normalizedLemma: '語'.repeat(512),
      partOfSpeech: 'noun',
      senseKey: '意味'.repeat(256),
    };

    const first = createLexemeId(input);
    const second = createLexemeId(input);

    expect(first).toBe(second);
    expect(first).toMatch(/^lexeme-[a-z0-9-]+$/);
    expect(first.length).toBeLessThanOrEqual(128);
  });
});

describe('createTrackMembershipId', () => {
  it('uses both track and lexeme identity', () => {
    const lexemeId = createLexemeId({
      language: 'en',
      normalizedLemma: 'allocate',
      partOfSpeech: 'verb',
      senseKey: 'assign-resource',
    });

    const ielts = createTrackMembershipId({ trackId: 'ielts', lexemeId });
    const toeic = createTrackMembershipId({ trackId: 'toeic', lexemeId });
    const otherLexeme = createLexemeId({
      language: 'en',
      normalizedLemma: 'allocation',
      partOfSpeech: 'noun',
      senseKey: 'assigned-resource',
    });
    const otherIeltsMembership = createTrackMembershipId({
      trackId: 'ielts',
      lexemeId: otherLexeme,
    });

    expect(ielts).not.toBe(toeic);
    expect(ielts).not.toBe(otherIeltsMembership);
    expect(createTrackMembershipId({ trackId: ' IELTS ', lexemeId })).toBe(ielts);
    expect(ielts).toMatch(/^membership-[a-z0-9-]+$/);
    expect(ielts.length).toBeLessThanOrEqual(128);
  });
});
