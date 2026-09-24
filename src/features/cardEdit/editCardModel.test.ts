import { describe, expect, it } from 'vitest';
import type { LearningStateOutcome } from '../learning/learningStateController';
import type { CardData } from '../../types/card';
import { createEditCardDraft, editCardPatch, isSuccessfulEditCardSave } from './editCardModel';

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

  it('diffs a draft against the snapshot captured when the dialog opened, not a newer live card', () => {
    const openedCard = { ...card, exampleSentence: 'Old example.' };
    const draft = createEditCardDraft(openedCard);
    draft.translation = 'dẫn đầu';
    // A remote sync changed exampleSentence after the dialog opened; the learner never touched that field.
    const liveCard = { ...openedCard, exampleSentence: 'Synced example.' };

    expect(editCardPatch(openedCard, draft)).toEqual({ translation: 'dẫn đầu' });
    // Diffing against the live card instead would wrongly reintroduce the pre-sync exampleSentence.
    expect(editCardPatch(liveCard, draft)).toEqual({ translation: 'dẫn đầu', exampleSentence: 'Old example.' });
  });
});

describe('isSuccessfulEditCardSave', () => {
  const outcome = (status: LearningStateOutcome['status']): LearningStateOutcome =>
    ({ status, result: {} } as LearningStateOutcome);

  it('treats a published or durably-queued patch as a successful save', () => {
    expect(isSuccessfulEditCardSave(outcome('published'))).toBe(true);
    expect(isSuccessfulEditCardSave(outcome('durably-queued'))).toBe(true);
  });

  it('treats a noop as successful because the live card already matches the request', () => {
    expect(isSuccessfulEditCardSave(outcome('noop'))).toBe(true);
  });

  it('treats a missing card, absent owner, or stale lifecycle as a failed save', () => {
    expect(isSuccessfulEditCardSave(outcome('missing-card'))).toBe(false);
    expect(isSuccessfulEditCardSave(outcome('no-active-owner'))).toBe(false);
    expect(isSuccessfulEditCardSave(outcome('stale-owner'))).toBe(false);
  });

  it('treats an absent outcome as successful, matching a caller that does not report one', () => {
    expect(isSuccessfulEditCardSave(undefined)).toBe(true);
  });
});
