import { describe, expect, it } from 'vitest';
import { retainCardsForSession } from './sessionCards';

describe('retainCardsForSession', () => {
  it('bounds the visible cards to the page size', () => {
    const cards = Array.from({ length: 12 }, (_, index) => ({ id: `card-${index}` }));
    expect(retainCardsForSession(cards, 9)).toEqual(cards.slice(0, 9));
  });

  it('never returns a negative-length slice for an invalid page size', () => {
    const cards = [{ id: 'card-0' }];
    expect(retainCardsForSession(cards, -1)).toEqual([]);
  });
});
