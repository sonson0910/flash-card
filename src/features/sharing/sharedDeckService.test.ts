import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';

const functions = vi.hoisted(() => ({
  getFunctions: vi.fn(),
  httpsCallable: vi.fn(),
  callable: vi.fn(),
  capability: { available: true } as {
    available: boolean;
    reason?: string;
  },
}));

vi.mock('firebase/functions', () => ({
  getFunctions: functions.getFunctions,
  httpsCallable: functions.httpsCallable,
}));

vi.mock('../../lib/firebase', () => ({
  protectedFunctionsCapability: functions.capability,
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
  explanationTranslation: 'Một tình huống thuận lợi.',
  cefrLevel: 'B2',
  exampleSentence: 'This role is a great opportunity.',
  exampleTranslation: 'Vai trò này là một cơ hội tuyệt vời.',
  collocations: ['career opportunity', 'equal opportunity'],
  synonyms: ['chance', 'opening'],
  antonyms: ['obstacle'],
  register: 'neutral',
  commonMistake: 'Do not confuse opportunity with possibility.',
  imageSearchQuery: 'open door opportunity concept',
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
    functions.callable.mockReset();
    functions.capability.available = true;
    delete functions.capability.reason;
    functions.getFunctions.mockReturnValue({ region: 'asia-southeast1' });
    functions.httpsCallable.mockReturnValue(functions.callable);
  });

  it('blocks sharing before creating a callable when App Check is unavailable', async () => {
    functions.capability.available = false;
    functions.capability.reason = 'app-check-initialization-failed';

    await expect(createSharedDeckShare({} as never, 'IELTS', [privateCard]))
      .rejects.toThrow('Deck sharing is unavailable because the protected cloud service could not start securely.');
    expect(functions.getFunctions).not.toHaveBeenCalled();
    expect(functions.httpsCallable).not.toHaveBeenCalled();
  });

  it('shares rich learning content but excludes private study progress', async () => {
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
        explanationTranslation: 'Một tình huống thuận lợi.',
        phonetic: '/ˌɒpəˈtjuːnəti/',
        category: 'IELTS',
        partOfSpeech: 'noun',
        cefrLevel: 'B2',
        exampleSentence: 'This role is a great opportunity.',
        exampleTranslation: 'Vai trò này là một cơ hội tuyệt vời.',
        collocations: ['career opportunity', 'equal opportunity'],
        synonyms: ['chance', 'opening'],
        antonyms: ['obstacle'],
        register: 'neutral',
        commonMistake: 'Do not confuse opportunity with possibility.',
        imageSearchQuery: 'open door opportunity concept',
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

  it('classifies protected-service revocation errors without exposing backend details', async () => {
    functions.callable.mockRejectedValue(Object.assign(
      new Error('backend secret: ownership document path'),
      { code: 'functions/failed-precondition' },
    ));

    const result = revokeSharedDeckShare({} as never, 'share-1').catch(error => error as Error);
    await expect(result).resolves.toMatchObject({
      name: 'ProtectedFunctionError',
      kind: 'configuration',
      retryable: false,
    });
    await expect(result).resolves.toHaveProperty(
      'message',
      'Share revocation cannot run because this app and its cloud deployment are out of sync. Update the deployment configuration before retrying.',
    );
    await expect(result).resolves.not.toHaveProperty(
      'message',
      expect.stringContaining('backend secret'),
    );
  });
});
