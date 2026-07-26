import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../types/card';
import {
  CardUniquenessCheckError,
  resolveExistingCard,
} from './cardUniqueness';

const card = (id: string, word: string): CardData => ({
  id,
  word,
  normalizedWord: word.trim().toLocaleLowerCase('en-US'),
  translation: `translation for ${word}`,
  explanation: '',
  phonetic: '',
  emoji: '',
  category: 'Test',
  audioUrl: null,
  imageUrl: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  bookmarked: false,
  difficulty: 'unrated',
  customDeck: null,
});

describe('resolveExistingCard', () => {
  it('returns a card from the complete device cache even when it is not in the visible page', async () => {
    const hiddenCard = card('hidden', 'resemblance');
    const verifyRemote = vi.fn<() => Promise<CardData | null>>();

    await expect(resolveExistingCard({
      word: '  RESEMBLANCE ',
      visibleCards: [card('visible', 'ability')],
      cachedCards: [hiddenCard],
      requireRemoteVerification: true,
      verifyRemote,
    })).resolves.toEqual(hiddenCard);
    expect(verifyRemote).not.toHaveBeenCalled();
  });

  it('returns the remote card when it has not been loaded into the current page or cache', async () => {
    const remoteCard = card('remote', 'opportunity');

    await expect(resolveExistingCard({
      word: 'Opportunity',
      visibleCards: [],
      cachedCards: [],
      requireRemoteVerification: true,
      verifyRemote: async () => remoteCard,
    })).resolves.toEqual(remoteCard);
  });

  it('fails closed when the complete cloud library cannot be verified', async () => {
    await expect(resolveExistingCard({
      word: 'confidential',
      visibleCards: [],
      cachedCards: [],
      requireRemoteVerification: true,
      verifyRemote: async () => {
        throw new Error('Firebase unavailable');
      },
    })).rejects.toBeInstanceOf(CardUniquenessCheckError);
  });

  it('stops waiting when the remote lookup never settles', async () => {
    const outcome = await Promise.race([
      resolveExistingCard({
        word: 'reasonable',
        visibleCards: [],
        cachedCards: [],
        requireRemoteVerification: true,
        remoteTimeoutMs: 10,
        verifyRemote: () => new Promise<CardData | null>(() => undefined),
      }).then(
        () => 'resolved',
        error => error instanceof CardUniquenessCheckError ? 'rejected-safely' : 'unexpected-error',
      ),
      new Promise<string>(resolve => setTimeout(() => resolve('still-hanging'), 80)),
    ]);

    expect(outcome).toBe('rejected-safely');
  });
});
