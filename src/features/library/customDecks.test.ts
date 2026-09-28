import { describe, expect, it } from 'vitest';
import {
  MAX_CUSTOM_DECKS,
  MAX_CUSTOM_DECK_NAME_LENGTH,
  customDeckCoverKey,
  defaultCoverPreset,
  deckMonogram,
  normalizeCustomDeckProfile,
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

  it('uses an encoded key for punctuation and reserved-looking deck names', () => {
    const name = '__system__.Café / nâng cao';

    expect(customDeckCoverKey(name)).toMatch(/^d_[A-Za-z0-9_-]+$/);
    expect(customDeckCoverKey(name)).not.toContain('.');
  });

  it('repairs a truncated surrogate before using it in the deck and cover key', () => {
    const name = `${'a'.repeat(MAX_CUSTOM_DECK_NAME_LENGTH - 1)}😀`;
    const normalized = normalizeCustomDeckName(name);

    expect(normalized.endsWith('\uFFFD')).toBe(true);
    expect(new TextEncoder().encode(normalized)).toBeTruthy();
    expect(customDeckCoverKey(name)).toBe(customDeckCoverKey(normalized));
  });

  it('keeps presets only for active names and defaults missing values', () => {
    const deck = 'Travel';
    const key = customDeckCoverKey(deck);
    expect(normalizeCustomDeckProfile({
      decks: [deck],
      coverPresets: { [key]: 'violet', orphan: 'moss' },
    })).toEqual({ decks: [deck], coverPresets: { [key]: 'violet' } });
    expect(defaultCoverPreset).toBe('aurora');
  });

  it('uses a full Unicode code point for deck monograms', () => {
    expect(deckMonogram('😀 Travel')).toBe('😀');
  });
});
