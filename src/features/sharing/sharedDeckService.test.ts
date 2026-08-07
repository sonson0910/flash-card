import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';

const functions = vi.hoisted(() => ({
  getFunctions: vi.fn(),
  httpsCallable: vi.fn(),
  callable: vi.fn(),
}));

vi.mock('firebase/functions', () => ({
  getFunctions: functions.getFunctions,
  httpsCallable: functions.httpsCallable,
}));

import { createSharedDeckShare, revokeSharedDeckShare } from './sharedDeckService';

const privateCard: CardData = {
  id: 'private-id',
  word: 'opportunity',
  translation: 'cơ hội',
  explanation: 'A favorable situation.',
  phonetic: '/ˌɒpəˈtjuːnəti/',
  emoji: '✨',
  category: 'IELTS',
  partOfSpeech: 'noun',
  audioUrl: 'https://media.example/audio.mp3',
  imageUrl: 'https://media.example/image.webp',
  bookmarked: true,
  difficulty: 'hard',
  revision: 9,
  libraryEpoch: 3,
  reviews: 12,
  nextReviewDate: '2026-08-10T00:00:00.000Z',
  reviewHistory: [{ rating: 'good', reviewedAt: '2026-08-01T00:00:00.000Z', scheduledDays: 4, elapsedDays: 2 }],
  fsrs: {
    due: '2026-08-10T00:00:00.000Z', stability: 2, difficulty: 4, elapsedDays: 2,
    scheduledDays: 4, learningSteps: 0, reps: 2, lapses: 0, state: 2,
  },
};

describe('sharedDeckService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    functions.getFunctions.mockReturnValue({ region: 'asia-southeast1' });
    functions.httpsCallable.mockReturnValue(functions.callable);
  });

  it('shares only the public card projection', async () => {
    functions.callable.mockResolvedValue({
      data: { shareId: 'share-1', expiresAt: '2026-08-10T00:00:00.000Z' },
    });

    await createSharedDeckShare({} as never, 'IELTS', [privateCard]);

    expect(functions.callable).toHaveBeenCalledWith({
      category: 'IELTS',
      cards: [{
        word: 'opportunity',
        translation: 'cơ hội',
        explanation: 'A favorable situation.',
        phonetic: '/ˌɒpəˈtjuːnəti/',
        category: 'IELTS',
        partOfSpeech: 'noun',
        emoji: '✨',
        audioUrl: 'https://media.example/audio.mp3',
        imageUrl: 'https://media.example/image.webp',
      }],
    });
  });

  it.each([
    { shareId: '', expiresAt: '2026-08-10T00:00:00.000Z' },
    { shareId: '   ', expiresAt: '2026-08-10T00:00:00.000Z' },
    { shareId: 'share-1' },
    { shareId: 'share-1', expiresAt: 123 },
    { shareId: 'share-1', expiresAt: 'not-a-date' },
  ])('rejects a malformed create response: %o', async data => {
    functions.callable.mockResolvedValue({ data });

    await expect(createSharedDeckShare({} as never, 'IELTS', [privateCard]))
      .rejects.toThrow('Shared-deck service returned an invalid response.');
  });

  it('sends the share id to the regional revoke callable', async () => {
    functions.callable.mockResolvedValue({ data: { revoked: true } });

    await revokeSharedDeckShare({} as never, 'share-1');

    expect(functions.getFunctions).toHaveBeenCalledWith({}, 'asia-southeast1');
    expect(functions.httpsCallable).toHaveBeenCalledWith({ region: 'asia-southeast1' }, 'revokeSharedDeck');
    expect(functions.callable).toHaveBeenCalledWith({ shareId: 'share-1' });
  });

  it('rejects a revoke response that does not confirm revocation', async () => {
    functions.callable.mockResolvedValue({ data: { revoked: false } });

    await expect(revokeSharedDeckShare({} as never, 'share-1'))
      .rejects.toThrow('Shared-deck service did not confirm revocation.');
  });
});
