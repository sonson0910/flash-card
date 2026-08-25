import { describe, expect, it } from 'vitest';
import {
  MAX_CUSTOM_DECKS,
  MAX_CUSTOM_DECK_NAME_LENGTH,
  normalizeAssignedDeckName,
  normalizeCustomDeckCollection,
  normalizeCustomDeckName,
  planCustomDeckCreation,
} from './customDecks';

describe('custom deck boundaries', () => {
  it('trims and bounds a new deck name before storing it', () => {
    const plan = planCustomDeckCreation([], `  ${'a'.repeat(MAX_CUSTOM_DECK_NAME_LENGTH + 20)}  `);

    expect(plan.status).toBe('created');
    expect(plan.name).toHaveLength(MAX_CUSTOM_DECK_NAME_LENGTH);
    expect(plan.decks).toEqual([plan.name]);
  });

  it('does not create more than the profile limit', () => {
    const decks = Array.from({ length: MAX_CUSTOM_DECKS }, (_, index) => `Deck ${index}`);

    expect(planCustomDeckCreation(decks, 'One more')).toMatchObject({ status: 'limit', decks });
  });

  it('normalizes loaded collections and removes duplicates after truncation', () => {
    const longName = 'a'.repeat(MAX_CUSTOM_DECK_NAME_LENGTH + 5);

    expect(normalizeCustomDeckCollection([longName, longName.slice(0, MAX_CUSTOM_DECK_NAME_LENGTH), '', 3])).toEqual([
      'a'.repeat(MAX_CUSTOM_DECK_NAME_LENGTH),
    ]);
  });

  it('uses the same bounded value for card assignment', () => {
    expect(normalizeAssignedDeckName(` ${'b'.repeat(MAX_CUSTOM_DECK_NAME_LENGTH + 1)} `)).toBe(
      'b'.repeat(MAX_CUSTOM_DECK_NAME_LENGTH),
    );
    expect(normalizeAssignedDeckName('   ')).toBeNull();
    expect(normalizeAssignedDeckName(null)).toBeNull();
  });

  it('replaces the Firestore profile delimiter without rejecting normal punctuation', () => {
    expect(normalizeCustomDeckName(`  Grammar\u001f& Punctuation!  `)).toBe('Grammar & Punctuation!');
    expect(normalizeCustomDeckName('Café — nâng cao')).toBe('Café — nâng cao');
  });

  it('retains exactly the maximum number of bounded deck names', () => {
    const decks = Array.from({ length: MAX_CUSTOM_DECKS }, (_, index) => `Deck ${index}`);

    expect(normalizeCustomDeckCollection(decks)).toEqual(decks);
    expect(normalizeCustomDeckCollection([...decks, 'ignored'])).toEqual(decks);
  });
});
