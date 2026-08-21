import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../types/card';
import { hydrateMissingCardImage } from './cardImageHydration';

const card: CardData = {
  id: 'legacy-bank',
  word: 'bank',
  normalizedWord: 'bank',
  translation: 'ngân hàng',
  explanation: 'A financial institution that accepts money deposits.',
  phonetic: '',
  emoji: '🏦',
  category: 'Finance',
  partOfSpeech: 'noun',
  audioUrl: null,
  imageUrl: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  bookmarked: false,
  difficulty: 'unrated',
  customDeck: null,
};

describe('missing image hydration', () => {
  it('fetches, persists and returns a trusted image update for an existing card', async () => {
    const persistUpdate = vi.fn();
    const updates = await hydrateMissingCardImage({
      card,
      attemptedCardIds: new Set(),
      inFlightRequests: new Map(),
      fetchImage: async () => 'https://images.pexels.com/bank.jpeg',
      persistUpdate,
    });

    expect(updates).toEqual({
      imageUrl: 'https://images.pexels.com/bank.jpeg',
      imageSearchQuery: 'bank financial institution accepts money deposits',
    });
    expect(persistUpdate).toHaveBeenCalledWith(card, updates);
  });

  it('does not search again when the card already has an image', async () => {
    const fetchImage = vi.fn();
    const persistUpdate = vi.fn();

    await expect(hydrateMissingCardImage({
      card: { ...card, imageUrl: 'https://images.pexels.com/existing.jpeg' },
      attemptedCardIds: new Set(),
      inFlightRequests: new Map(),
      fetchImage,
      persistUpdate,
    })).resolves.toBeNull();
    expect(fetchImage).not.toHaveBeenCalled();
    expect(persistUpdate).not.toHaveBeenCalled();
  });

  it('allows an explicit word lookup to retry a previous failed image attempt', async () => {
    const attemptedCardIds = new Set([card.id]);
    const fetchImage = vi.fn().mockResolvedValue('https://images.unsplash.com/bank');

    await expect(hydrateMissingCardImage({
      card,
      force: true,
      attemptedCardIds,
      inFlightRequests: new Map(),
      fetchImage,
      persistUpdate: vi.fn(),
    })).resolves.toMatchObject({ imageUrl: 'https://images.unsplash.com/bank' });
    expect(fetchImage).toHaveBeenCalledOnce();
  });

  it('does not persist an image after the card lifecycle is cancelled', async () => {
    const persistUpdate = vi.fn();

    await expect(hydrateMissingCardImage({
      card,
      attemptedCardIds: new Set(),
      inFlightRequests: new Map(),
      fetchImage: async () => 'https://images.pexels.com/bank.jpeg',
      canPersist: () => false,
      persistUpdate,
    })).resolves.toBeNull();

    expect(persistUpdate).not.toHaveBeenCalled();
  });

  it('keeps attempt and in-flight state isolated by auth scope', async () => {
    const attemptedCardIds = new Set([`user-a:${card.id}`]);
    const fetchImage = vi.fn().mockResolvedValue('https://images.pexels.com/bank.jpeg');

    await expect(hydrateMissingCardImage({
      card,
      scopeKey: 'user-b',
      attemptedCardIds,
      inFlightRequests: new Map(),
      fetchImage,
      persistUpdate: vi.fn(),
    })).resolves.toMatchObject({ imageUrl: 'https://images.pexels.com/bank.jpeg' });

    expect(fetchImage).toHaveBeenCalledOnce();
    expect(attemptedCardIds).toContain(`user-b:${card.id}`);
    expect(attemptedCardIds).not.toContain(card.id);
  });

  it('lets an explicit lookup wait for an automatic attempt and retry when it found no image', async () => {
    let finishAutomaticAttempt!: (value: string | null) => void;
    const automaticResult = new Promise<string | null>(resolve => {
      finishAutomaticAttempt = resolve;
    });
    const fetchImage = vi.fn()
      .mockReturnValueOnce(automaticResult)
      .mockResolvedValueOnce('https://images.pexels.com/bank-retry.jpeg');
    const persistUpdate = vi.fn();
    const inFlightRequests = new Map<string, Promise<Partial<CardData> | null>>();

    const automaticHydration = hydrateMissingCardImage({
      card,
      attemptedCardIds: new Set(),
      inFlightRequests,
      fetchImage,
      persistUpdate,
    });
    const explicitHydration = hydrateMissingCardImage({
      card,
      force: true,
      attemptedCardIds: new Set(),
      inFlightRequests,
      fetchImage,
      persistUpdate,
    });
    finishAutomaticAttempt(null);

    await expect(automaticHydration).resolves.toBeNull();
    await expect(explicitHydration).resolves.toMatchObject({
      imageUrl: 'https://images.pexels.com/bank-retry.jpeg',
    });
    expect(fetchImage).toHaveBeenCalledTimes(2);
    expect(persistUpdate).toHaveBeenCalledOnce();
  });
});
