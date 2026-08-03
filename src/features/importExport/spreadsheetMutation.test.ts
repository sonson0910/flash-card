import { describe, expect, it } from 'vitest';
import type { CardData } from '../../types/card';
import { planStructuredImportMutation } from './spreadsheetMutation';

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
        normalizedWord: 'serendipity',
        createdAt: '2026-07-26T00:00:00.000Z',
        lastOpenedAt: '2026-07-26T00:00:00.000Z',
      },
    });
  });
});
