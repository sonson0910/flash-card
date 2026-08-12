import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { createPracticeSessionLifecycle } from './practiceSessionLifecycle';

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(settle => { resolve = settle; });
  return { promise, resolve };
};

describe('practice session lifecycle', () => {
  it('uses monotonic generations to invalidate late A work across A -> B -> A', async () => {
    const lifecycle = createPracticeSessionLifecycle('owner-a');
    const ownerAPool = deferred<readonly string[]>();
    const pending = lifecycle.prepare('study', () => ownerAPool.promise);
    const firstToken = lifecycle.currentToken();

    lifecycle.replaceOwner('owner-b');
    lifecycle.replaceOwner('owner-a');
    ownerAPool.resolve(['stale-card']);

    await expect(pending).resolves.toEqual({ status: 'stale' });
    expect(lifecycle.currentToken()).toBeGreaterThan(firstToken);
    expect(lifecycle.activate('study', firstToken)).toBe(false);
  });

  it('keeps preparation single-flight across every practice mode', async () => {
    const lifecycle = createPracticeSessionLifecycle('owner-a');
    const pool = deferred<readonly string[]>();
    const loadStudy = vi.fn(() => pool.promise);
    const loadQuiz = vi.fn(async () => ['quiz-card']);

    const study = lifecycle.prepare('study', loadStudy);
    await expect(lifecycle.prepare('quiz', loadQuiz)).resolves.toEqual({ status: 'busy' });
    expect(loadStudy).toHaveBeenCalledTimes(1);
    expect(loadQuiz).not.toHaveBeenCalled();

    pool.resolve(['study-card']);
    await expect(study).resolves.toMatchObject({
      status: 'ready',
      value: ['study-card'],
    });
  });

  it('exposes a cancellation scope so cleared work skips downstream adapters', async () => {
    const lifecycle = createPracticeSessionLifecycle('owner-a');
    const pool = deferred<readonly string[]>();
    const callProtectedAdapter = vi.fn();
    const preparation = lifecycle.prepare('story', async scope => {
      const cards = await pool.promise;
      if (scope.isCurrent()) callProtectedAdapter(cards);
      return cards;
    });

    lifecycle.clear('story');
    pool.resolve(['owner-a-card']);

    await expect(preparation).resolves.toEqual({ status: 'stale' });
    expect(callProtectedAdapter).not.toHaveBeenCalled();
  });

  it('releases preparation when the start publisher throws', async () => {
    const lifecycle = createPracticeSessionLifecycle('owner-a');

    await expect(lifecycle.prepare(
      'study',
      async () => ['card'],
      () => { throw new Error('publisher failed'); },
    )).resolves.toMatchObject({ status: 'failed', error: expect.any(Error) });
    await expect(lifecycle.prepare('quiz', async () => ['card'])).resolves.toMatchObject({
      status: 'ready',
    });
  });

  it('grants interaction authority to exactly one active mode', async () => {
    const lifecycle = createPracticeSessionLifecycle('owner-a');
    const study = await lifecycle.prepare('study', async () => ['card']);
    if (study.status !== 'ready') throw new Error('Expected ready study preparation.');

    expect(lifecycle.activate('study', study.sessionToken)).toBe(true);
    expect(lifecycle.isActive('study')).toBe(true);
    expect(lifecycle.isActive('quiz')).toBe(false);

    const quiz = await lifecycle.prepare('quiz', async () => ['card']);
    if (quiz.status !== 'ready') throw new Error('Expected ready quiz preparation.');
    expect(lifecycle.activate('quiz', quiz.sessionToken)).toBe(true);
    expect(lifecycle.isActive('study')).toBe(false);
    expect(lifecycle.isActive('quiz')).toBe(true);
  });

  it('claims reviews once, releases failures for retry and retains saved claims', async () => {
    const lifecycle = createPracticeSessionLifecycle('owner-a');
    const study = await lifecycle.prepare('study', async () => ['card-1']);
    if (study.status !== 'ready') throw new Error('Expected ready study preparation.');
    lifecycle.activate('study', study.sessionToken);

    expect(lifecycle.claimReview('card-1')).toBe(true);
    expect(lifecycle.claimReview('card-1')).toBe(false);
    expect(lifecycle.settleReview('card-1', 'retry')).toBe(true);
    expect(lifecycle.claimReview('card-1')).toBe(true);
    expect(lifecycle.settleReview('card-1', 'saved')).toBe(true);
    expect(lifecycle.isReviewed('card-1')).toBe(true);
    expect(lifecycle.claimReview('card-1')).toBe(false);
  });

  it('does not settle a stale review after an owner A -> B -> A transition', async () => {
    const lifecycle = createPracticeSessionLifecycle('owner-a');
    const study = await lifecycle.prepare('study', async () => ['card-1']);
    if (study.status !== 'ready') throw new Error('Expected ready study preparation.');
    lifecycle.activate('study', study.sessionToken);
    expect(lifecycle.claimReview('card-1')).toBe(true);

    lifecycle.replaceOwner('owner-b');
    lifecycle.replaceOwner('owner-a');

    expect(lifecycle.settleReview('card-1', 'saved')).toBe(false);
    expect(lifecycle.isReviewed('card-1')).toBe(false);
  });

  it('keeps public method identities stable and React adapters free of parallel lifecycle stores', () => {
    const lifecycle = createPracticeSessionLifecycle('owner-a');
    const identities = {
      replaceOwner: lifecycle.replaceOwner,
      prepare: lifecycle.prepare,
      activate: lifecycle.activate,
      claimReview: lifecycle.claimReview,
    };

    lifecycle.replaceOwner('owner-b');

    expect(lifecycle.replaceOwner).toBe(identities.replaceOwner);
    expect(lifecycle.prepare).toBe(identities.prepare);
    expect(lifecycle.activate).toBe(identities.activate);
    expect(lifecycle.claimReview).toBe(identities.claimReview);

    const lifecycleSource = readFileSync(fileURLToPath(new URL('./practiceSessionLifecycle.ts', import.meta.url)), 'utf8');
    const sessionHookSource = readFileSync(fileURLToPath(new URL('./usePracticeSession.ts', import.meta.url)), 'utf8');
    const gamesHookSource = readFileSync(fileURLToPath(new URL('./usePracticeGames.ts', import.meta.url)), 'utf8');

    expect(lifecycleSource).not.toMatch(/from ['"]react['"]/);
    expect(lifecycleSource).not.toMatch(/firebase|Firestore|indexedDB|localStorage/);
    expect(sessionHookSource).toContain('createPracticeSessionLifecycle');
    expect(sessionHookSource).not.toMatch(/ownerSessionRef|studySessionRef|pendingReviewIdsRef|reviewedCardIdsRef|studyPreparationRef/);
    expect(gamesHookSource).not.toMatch(/quizSessionRef|spellingSessionRef|preparationRef/);
  });
});
