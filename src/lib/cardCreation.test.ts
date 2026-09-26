import { describe, expect, it } from 'vitest';
import type { CardData } from '../types/card';
import { applySuccessfulPatchMetadata } from './cardCreation';

const card: CardData = {
  id: 'word-resilient',
  word: 'resilient',
  normalizedWord: 'resilient',
  translation: 'kiên cường',
  explanation: '',
  phonetic: '',
  emoji: '🌱',
  category: 'Test',
  audioUrl: null,
  imageUrl: null,
  createdAt: '2026-07-19T00:00:00.000Z',
  bookmarked: false,
  difficulty: 'unrated',
  customDeck: null,
};

describe('applySuccessfulPatchMetadata', () => {
  it('advances local revision metadata so the next sequential patch uses the new base', () => {
    const first = applySuccessfulPatchMetadata(
      { ...card, revision: 1, libraryEpoch: 3 },
      { bookmarked: true },
      { revision: 2, libraryEpoch: 3, updatedAt: '2026-07-26T01:00:00.000Z' },
    );
    const second = applySuccessfulPatchMetadata(
      first,
      { imageUrl: 'https://images.pexels.com/resilient.jpeg' },
      { revision: 3, libraryEpoch: 3, updatedAt: '2026-07-26T01:01:00.000Z' },
    );

    expect(first).toMatchObject({ bookmarked: true, revision: 2 });
    expect(second).toMatchObject({
      bookmarked: true,
      imageUrl: 'https://images.pexels.com/resilient.jpeg',
      revision: 3,
      libraryEpoch: 3,
    });
  });

  it('does not copy stale fields outside the successful patch field mask into the local mirror', () => {
    const updated = applySuccessfulPatchMetadata(
      {
        ...card,
        translation: 'cloud translation',
        bookmarked: false,
        revision: 8,
        libraryEpoch: 3,
      },
      {
        translation: 'stale local translation',
        bookmarked: true,
      },
      {
        revision: 9,
        libraryEpoch: 3,
        updatedAt: '2026-07-26T01:00:00.000Z',
      },
      ['bookmarked'],
    );

    expect(updated).toMatchObject({
      translation: 'cloud translation',
      bookmarked: true,
      revision: 9,
      libraryEpoch: 3,
    });
  });
});
