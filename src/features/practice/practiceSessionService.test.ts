import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  callable: vi.fn(),
  httpsCallable: vi.fn(),
  getSonFlashFunctions: vi.fn(async () => ({ region: 'asia-southeast1' })),
}));

vi.mock('../../lib/firebase', () => ({
  app: { name: 'test-app' },
  isFirebaseConfigured: true,
  protectedFunctionsCapability: { available: true },
  getSonFlashFunctions: runtime.getSonFlashFunctions,
}));
vi.mock('../../lib/protectedFunctionsCapability', () => ({
  ProtectedFunctionError: class ProtectedFunctionError extends Error {},
  runProtectedFunction: (_capability: unknown, _label: string, operation: () => unknown) => operation(),
}));
vi.mock('firebase/functions', () => ({ httpsCallable: runtime.httpsCallable }));

import { firebasePracticeSessionService } from './practiceSessionService';

describe('firebasePracticeSessionService', () => {
  beforeEach(() => {
    runtime.callable.mockReset();
    runtime.httpsCallable.mockReset().mockReturnValue(runtime.callable);
  });

  it('uses only the start callable and preserves the operation ID', async () => {
    runtime.callable.mockResolvedValue({ data: {
      sessionId: 'practice-quiz-a', game: 'quiz',
      challenge: { kind: 'quiz', questions: [{ cardId: 'card-a', prompt: 'apple', options: ['táo'] }] },
      expiresAt: '2026-09-27T00:00:00.000Z',
    } });

    await expect(firebasePracticeSessionService.start({
      opId: 'practice-quiz-a', game: 'quiz', cardIds: ['card-a', 'card-b', 'card-c', 'card-d'],
    })).resolves.toMatchObject({ sessionId: 'practice-quiz-a', game: 'quiz', challenge: { questions: [{ prompt: 'apple' }] } });

    expect(runtime.httpsCallable).toHaveBeenCalledWith({ region: 'asia-southeast1' }, 'startPracticeSessionV1');
    expect(runtime.callable).toHaveBeenCalledWith({
      opId: 'practice-quiz-a', game: 'quiz', cardIds: ['card-a', 'card-b', 'card-c', 'card-d'],
    });
  });

  it('forwards server-verifiable pair answers and parses the authoritative outcome', async () => {
    runtime.callable.mockResolvedValue({ data: {
      sessionId: 'practice-match-a', correct: 4, total: 4, awardedXp: 20,
      outcome: { xp: 20, level: 1, streak: 0, studyDay: '2026-09-27', events: ['levelup'] },
    } });
    const request = {
      sessionId: 'practice-match-a', completionId: 'practice-complete-a',
      answers: { pairs: [{ cardId: 'card-a', word: 'apple', translation: 'táo' }] }, timeZone: 'Asia/Ho_Chi_Minh',
    };

    await expect(firebasePracticeSessionService.complete(request)).resolves.toMatchObject({ awardedXp: 20, outcome: { xp: 20 } });
    expect(runtime.httpsCallable).toHaveBeenCalledWith({ region: 'asia-southeast1' }, 'completePracticeSessionV1');
    expect(runtime.callable).toHaveBeenCalledWith(request);
  });
});
