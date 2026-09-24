import { describe, expect, it } from 'vitest';
import type { CardData } from '../../types/card';
import { createEditCardDraft, editCardPatch } from './editCardModel';

const card = { id: 'card-1', word: 'lead', translation: 'chì', explanation: 'A metal.', origin: 'ai', nextReviewDate: '2026-09-24' } as CardData;

describe('card text editing', () => {
  it('patches only changed text and preserves AI origin and scheduling', () => {
    const draft = createEditCardDraft(card);
    draft.translation = 'dẫn đầu';
    draft.exampleSentence = 'She leads the team.';
    expect(editCardPatch(card, draft)).toEqual({ translation: 'dẫn đầu', exampleSentence: 'She leads the team.' });
  });

  it('requires a meaning and enforces normalized card text bounds', () => {
    const draft = createEditCardDraft(card);
    draft.translation = '   ';
    expect(() => editCardPatch(card, draft)).toThrow('Nghĩa tiếng Việt');
    draft.translation = 'x'.repeat(257);
    expect(() => editCardPatch(card, draft)).toThrow('256');
  });
});
