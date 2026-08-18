import { describe, expect, it } from 'vitest';
import type { CardData } from '../types/card';
import type { CardQueryState } from './cardQuery';
import type { DevicePendingOperation } from './deviceSync';
import { overlayPendingCardsOnPage } from './pendingCardOverlay';

const filters: CardQueryState = {
  category: null,
  customDeck: null,
  difficulty: null,
  partOfSpeech: null,
  bookmarkedOnly: false,
  createdDate: null,
  wordPrefix: '',
};

const card = (id: string, word: string, category = 'General'): CardData => ({
  id,
  word,
  normalizedWord: word.toLocaleLowerCase('en-US'),
  translation: `translation for ${word}`,
  explanation: '',
  phonetic: '',
  emoji: '📚',
  category,
  audioUrl: null,
  imageUrl: null,
  createdAt: '2026-07-19T00:00:00.000Z',
  bookmarked: false,
  difficulty: 'unrated',
  customDeck: null,
});

const upsert = (value: CardData): DevicePendingOperation => ({
  type: 'upsert',
  card: value,
  updatedAt: '2026-07-19T00:01:00.000Z',
  ownerUserId: 'user-a',
});

describe('pending card page overlay', () => {
  it('keeps a locally-created pending card visible on page one after cloud refresh', () => {
    const pendingCard = card('word-as_20soon_20as', 'as soon as');
    const result = overlayPendingCardsOnPage({
      cloudCards: [card('cloud-1', 'ability'), card('cloud-2', 'balance')],
      pendingOperations: [upsert(pendingCard)],
      filters,
      page: 1,
      pageSize: 3,
    });

    expect(result.map(value => value.word)).toEqual(['as soon as', 'ability', 'balance']);
  });

  it('replaces matching cloud content and applies pending deletes without duplicates', () => {
    const updated = { ...card('cloud-1', 'ability'), bookmarked: true };
    const pendingDelete: DevicePendingOperation = {
      type: 'delete',
      cardId: 'cloud-2',
      updatedAt: '2026-07-19T00:02:00.000Z',
      ownerUserId: 'user-a',
    };
    const result = overlayPendingCardsOnPage({
      cloudCards: [card('cloud-1', 'ability'), card('cloud-2', 'balance')],
      pendingOperations: [upsert(updated), pendingDelete],
      filters,
      page: 1,
      pageSize: 9,
    });

    expect(result).toEqual([updated]);
  });

  it('applies field-level patches to cloud cards without erasing unrelated fields', () => {
    const cloudCard = card('cloud-1', 'ability');
    const patch: DevicePendingOperation = {
      type: 'patch',
      cardId: cloudCard.id,
      fields: { bookmarked: true, imageUrl: 'https://images.pexels.com/ability.jpeg' },
      updatedAt: '2026-07-22T00:01:00.000Z',
      ownerUserId: 'user-a',
    };

    const result = overlayPendingCardsOnPage({
      cloudCards: [cloudCard],
      pendingOperations: [patch],
      filters,
      page: 1,
      pageSize: 9,
    });

    expect(result).toEqual([{
      ...cloudCard,
      bookmarked: true,
      imageUrl: 'https://images.pexels.com/ability.jpeg',
    }]);
  });

  it('does not inject a new pending card into later pages or mismatched filters', () => {
    const pendingCard = card('pending-travel', 'airport', 'Travel');
    const pageTwo = overlayPendingCardsOnPage({
      cloudCards: [card('cloud-3', 'culture')],
      pendingOperations: [upsert(pendingCard)],
      filters,
      page: 2,
      pageSize: 9,
    });
    const filteredPageOne = overlayPendingCardsOnPage({
      cloudCards: [card('cloud-3', 'culture', 'Culture')],
      pendingOperations: [upsert(pendingCard)],
      filters: { ...filters, category: 'Culture' },
      page: 1,
      pageSize: 9,
    });

    expect(pageTwo.map(value => value.word)).toEqual(['culture']);
    expect(filteredPageOne.map(value => value.word)).toEqual(['culture']);
  });
});
