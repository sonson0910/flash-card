import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../types/card';
const mocks = vi.hoisted(() => ({
  callable: vi.fn(),
  httpsCallable: vi.fn(),
}));

vi.mock('./firebase', () => ({
  app: { name: 'test-app' },
  isFirebaseConfigured: true,
  protectedFunctionsCapability: {},
  getSonFlashFunctions: () => ({ kind: 'functions' }),
}));

vi.mock('./protectedFunctionsCapability', () => ({
  runProtectedFunction: async (_capability: unknown, _label: string, operation: () => Promise<unknown>) => operation(),
}));

vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({ kind: 'functions' })),
  httpsCallable: mocks.httpsCallable,
}));

import {
  applyReviewViaCallable,
  applyReviewWithConflictRecovery,
  type ReviewCommand,
  type ReviewApplyResult,
} from './cardReviewRepository';

const card: CardData = {
  id: 'word-focus',
  word: 'focus',
  normalizedWord: 'focus',
  translation: 'tập trung',
  explanation: 'to concentrate',
  phonetic: '/ˈfəʊ.kəs/',
  emoji: '🎯',
  category: 'Study',
  audioUrl: null,
  imageUrl: null,
  revision: 3,
  libraryEpoch: 2,
  reviews: 0,
  interval: 0,
  easeFactor: 2.5,
  difficulty: 'unrated',
  reviewHistory: [],
};

const command: ReviewCommand = {
  cardId: card.id,
  opId: 'device-a:review-1',
  baseRevision: 3,
  libraryEpoch: 2,
  rating: 'good',
  reviewedAt: '2026-08-24T00:00:00.000Z',
  fields: { reviewHistory: [] },
  fieldMask: ['reviewHistory'],
};

describe('review conflict recovery', () => {
  it('uses the strict V2 callable for the current client contract', async () => {
    mocks.httpsCallable.mockReturnValue(mocks.callable);
    mocks.callable.mockResolvedValue({ data: {
      applied: true,
      duplicate: false,
      xpAwarded: 2,
      card: { ...card, schemaVersion: 2 },
    } });

    await expect(applyReviewViaCallable({} as never, 'owner-a', command)).resolves.toMatchObject({ applied: true, xpAwarded: 2 });

    expect(mocks.httpsCallable).toHaveBeenCalledWith(expect.anything(), 'reviewCardV2');
    expect(mocks.callable).toHaveBeenCalledWith(expect.objectContaining({ timeZone: expect.any(String) }));
  });

  it('keeps an authoritative gamification outcome and ceremony events from the V2 receipt', async () => {
    mocks.httpsCallable.mockReturnValue(mocks.callable);
    mocks.callable.mockResolvedValue({ data: {
      applied: true,
      duplicate: true,
      xpAwarded: 0,
      card: { ...card, schemaVersion: 2 },
      gamification: {
        xp: 2, level: 1, streak: 1, studyDay: '2026-08-24', events: ['streak'], rewardTimeZone: 'Asia/Saigon',
        reviewActivity: {
          targetLanguage: 'en', coverageStartedOn: '2026-08-24',
          days: { '2026-08-24': { reviewed: 1, again: 0, hard: 0, good: 1, easy: 0 } },
        },
      },
      ceremonyEvents: ['tierup', 'streak'],
    } });

    await expect(applyReviewViaCallable({} as never, 'owner-a', command)).resolves.toMatchObject({
      applied: true,
      duplicate: true,
      xpAwarded: 0,
      gamification: {
        xp: 2, level: 1, streak: 1, studyDay: '2026-08-24', events: ['streak'], rewardTimeZone: 'Asia/Saigon',
        reviewActivity: {
          targetLanguage: 'en', coverageStartedOn: '2026-08-24',
          days: { '2026-08-24': { reviewed: 1, again: 0, hard: 0, good: 1, easy: 0 } },
        },
      },
      ceremonyEvents: ['tierup', 'streak'],
    });
  });

  it.each([
    { targetLanguage: 'en', coverageStartedOn: '2026-02-30', days: {} },
    { targetLanguage: 'language-code-that-is-too-long', coverageStartedOn: '2026-08-24', days: {} },
    {
      targetLanguage: 'en', coverageStartedOn: '2026-08-24',
      days: { '2026-08-24': { reviewed: 1, again: 0, hard: 0, good: 1, easy: 0, extra: 0 } },
    },
  ])('rejects malformed authoritative review activity: %o', async reviewActivity => {
    mocks.httpsCallable.mockReturnValue(mocks.callable);
    mocks.callable.mockResolvedValue({ data: {
      applied: true,
      duplicate: false,
      xpAwarded: 2,
      card: { ...card, schemaVersion: 2 },
      gamification: { xp: 2, level: 1, streak: 1, studyDay: '2026-08-24', events: [], reviewActivity },
    } });

    await expect(applyReviewViaCallable({} as never, 'owner-a', command)).rejects.toThrow('Invalid review response.');
  });

  it('recomputes from the authoritative card and retries exactly once with the same operation', async () => {
    const first: ReviewApplyResult = {
      applied: false,
      reason: 'revision-conflict',
      currentRevision: 4,
      card: { ...card, revision: 4, reviews: 2, reviewHistory: [] },
    };
    const apply = vi.fn<(_: ReviewCommand) => Promise<ReviewApplyResult>>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce({ applied: true, duplicate: false, xpAwarded: 2, card: { ...first.card, revision: 5 } });

    const result = await applyReviewWithConflictRecovery(command, apply);

    expect(result).toMatchObject({ applied: true, card: { revision: 5 } });
    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply.mock.calls[1][0]).toMatchObject({
      opId: command.opId,
      baseRevision: 4,
      rating: command.rating,
      reviewedAt: command.reviewedAt,
    });
    expect(apply.mock.calls[1][0].fields.reviewHistory).toHaveLength(1);
  });

  it('does not retry non-revision failures', async () => {
    const result = await applyReviewWithConflictRecovery(
      command,
      vi.fn(async (): Promise<ReviewApplyResult> => ({ applied: false, reason: 'missing' })),
    );
    expect(result).toEqual({ applied: false, reason: 'missing' });
  });

  it.each([undefined, 1, -1, 3])('rejects an invalid top-level XP award: %o', async xpAwarded => {
    mocks.httpsCallable.mockReturnValue(mocks.callable);
    mocks.callable.mockResolvedValue({ data: {
      applied: true,
      duplicate: false,
      xpAwarded,
      card: { ...card, schemaVersion: 2 },
    } });

    await expect(applyReviewViaCallable({} as never, 'owner-a', command)).rejects.toThrow('Invalid review response.');
  });

  it('does not retry a timestamp that is equal to the authoritative review', async () => {
    const first: ReviewApplyResult = {
      applied: false,
      reason: 'revision-conflict',
      currentRevision: 4,
      card: {
        ...card,
        revision: 4,
        fsrs: {
          due: '2026-08-25T00:00:00.000Z', stability: 1, difficulty: 5,
          elapsedDays: 1, scheduledDays: 1, learningSteps: 0, reps: 1, lapses: 0,
          state: 2, lastReview: command.reviewedAt,
        },
      },
    };
    const apply = vi.fn<(_: ReviewCommand) => Promise<ReviewApplyResult>>().mockResolvedValue(first);

    await expect(applyReviewWithConflictRecovery(command, apply)).resolves.toEqual({
      applied: false,
      reason: 'stale-review',
    });
    expect(apply).toHaveBeenCalledOnce();
  });
});
