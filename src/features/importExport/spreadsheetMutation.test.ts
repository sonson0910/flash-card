import { describe, expect, it } from 'vitest';
import { createTargetAwareCardId } from '../../lib/cardIdentity';
import type { CardData } from '../../types/card';
import { planStructuredImportMutation, resolveImportedDeck } from './spreadsheetMutation';

const existingCard: CardData = {
  id: 'word-quite',
  word: 'quite',
  normalizedWord: 'quite',
  translation: 'khá',
  explanation: '',
  phonetic: '',
  emoji: '📝',
  category: 'General',
  audioUrl: null,
  imageUrl: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  partOfSpeech: 'adverb',
};

describe('structured spreadsheet mutation planning', () => {
  it('keeps the original creation date when an imported word already exists', () => {
    const plan = planStructuredImportMutation({
      word: 'quite',
      translation: 'khá',
      explanation: '',
      phonetic: '',
      partOfSpeech: 'predeterminer',
      category: 'General',
      emoji: '📝',
      audioUrl: null,
      imageUrl: null,
    }, existingCard, '2026-07-26T00:00:00.000Z');

    expect(plan.kind).toBe('patch');
    if (plan.kind !== 'patch') throw new Error('Expected an existing-card patch.');
    expect(plan.card.createdAt).toBe('2026-01-01T00:00:00.000Z');
    expect(plan.fields).toEqual({
      lastOpenedAt: '2026-07-26T00:00:00.000Z',
      partOfSpeech: 'predeterminer',
    });
  });

  it('plans a stable create for a genuinely new word', () => {
    const plan = planStructuredImportMutation({
      word: 'serendipity',
      translation: 'sự tình cờ may mắn',
      explanation: '',
      phonetic: '',
      partOfSpeech: 'noun',
      category: 'General',
      emoji: '📝',
      audioUrl: null,
      imageUrl: null,
    }, null, '2026-07-26T00:00:00.000Z');

    expect(plan).toMatchObject({
      kind: 'create',
      card: {
        id: 'word-serendipity',
        origin: 'manual',
        normalizedWord: 'serendipity',
        createdAt: '2026-07-26T00:00:00.000Z',
        lastOpenedAt: '2026-07-26T00:00:00.000Z',
      },
    });
  });

  it('retains an imported explicit language pair on a new ordinary card', () => {
    const plan = planStructuredImportMutation({
      word: '안녕', translation: 'xin chào', explanation: '', phonetic: '', partOfSpeech: 'interjection',
      category: 'General', emoji: '📝', audioUrl: null, imageUrl: null,
      language: 'ko', translationLanguage: 'vi',
    }, null, '2026-07-26T00:00:00.000Z');

    expect(plan).toMatchObject({
      kind: 'create',
      card: { id: createTargetAwareCardId('안녕', 'ko'), language: 'ko', translationLanguage: 'vi' },
    });
  });

  it('gives a new card its deck, tags, star and difficulty and reports an unknown deck', () => {
    const row = {
      word: 'levee', translation: 'đê', explanation: '', phonetic: '', partOfSpeech: 'noun',
      category: 'Nature', emoji: '🌊', audioUrl: null, imageUrl: null,
      tags: ['flood'], bookmarked: true, learnerDifficulty: 'hard' as const,
    };
    const known = planStructuredImportMutation({ ...row, deck: 'IELTS' }, null, '2026-07-26T00:00:00.000Z', { deckNames: ['IELTS'] });
    expect(known).toMatchObject({
      kind: 'create', deckUnassigned: false,
      card: { customDeck: 'IELTS', tags: ['flood'], bookmarked: true, learnerDifficulty: 'hard', difficulty: 'unrated' },
    });
    expect(known.card).not.toHaveProperty('deck');

    const unknown = planStructuredImportMutation({ ...row, deck: 'ielts' }, null, '2026-07-26T00:00:00.000Z', { deckNames: ['IELTS'] });
    expect(unknown).toMatchObject({ kind: 'create', deckUnassigned: true, card: { customDeck: null } });

    const plain = planStructuredImportMutation({ ...row, tags: undefined, bookmarked: undefined, learnerDifficulty: undefined }, null);
    expect(plain).toMatchObject({ kind: 'create', deckUnassigned: false, card: { customDeck: null, bookmarked: false } });
  });

  it('leaves the deck, tags, star and difficulty of an existing word untouched', () => {
    const plan = planStructuredImportMutation({
      word: 'quite', translation: 'khá', explanation: '', phonetic: '', partOfSpeech: 'adverb',
      category: 'General', emoji: '📝', audioUrl: null, imageUrl: null,
      deck: 'IELTS', tags: ['new'], bookmarked: true, learnerDifficulty: 'easy',
    }, { ...existingCard, customDeck: 'Daily', tags: ['old'], bookmarked: false, learnerDifficulty: 'hard' },
    '2026-07-26T00:00:00.000Z', { deckNames: ['IELTS', 'Daily'] });

    expect(plan.kind).toBe('patch');
    if (plan.kind !== 'patch') throw new Error('Expected an existing-card patch.');
    expect(plan.fields).toEqual({ lastOpenedAt: '2026-07-26T00:00:00.000Z', partOfSpeech: 'adverb' });
    expect(plan.card).toMatchObject({ customDeck: 'Daily', tags: ['old'], bookmarked: false, learnerDifficulty: 'hard' });
  });

  it('treats a blank or reserved deck name as a deliberate Unassigned', () => {
    expect(resolveImportedDeck(undefined, ['IELTS'])).toEqual({ customDeck: null, unknown: false });
    expect(resolveImportedDeck('   ', ['IELTS'])).toEqual({ customDeck: null, unknown: false });
    expect(resolveImportedDeck('Unassigned', ['IELTS'])).toEqual({ customDeck: null, unknown: false });
    expect(resolveImportedDeck('All', ['All'])).toEqual({ customDeck: null, unknown: false });
    expect(resolveImportedDeck('  IELTS ', ['IELTS'])).toEqual({ customDeck: 'IELTS', unknown: false });
    expect(resolveImportedDeck('Travel', [])).toEqual({ customDeck: null, unknown: true });
  });
});
