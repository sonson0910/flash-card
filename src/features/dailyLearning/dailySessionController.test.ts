import { describe, expect, it, vi } from 'vitest';
import type { Exercise } from './exerciseEngine';
import { createDailySessionController } from './dailySessionController';

const exercise = (cardId: string): Exercise => ({
  cardId,
  mode: 'active-recall',
  prompt: `meaning-${cardId}`,
  promptLanguage: 'en',
  answerLanguage: 'en',
  instruction: 'Type the word',
  answer: `word-${cardId}`,
  scoringPolicy: 'latin',
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
};

describe('daily session controller', () => {
  it('uses collision-resistant operation ids across controller instances', async () => {
    const operationIds: string[] = [];
    const reviewCard = vi.fn(async (_cardId: string, _rating: string, operationId: string) => { operationIds.push(operationId); });
    for (let index = 0; index < 2; index += 1) {
      const controller = createDailySessionController({ reviewCard });
      controller.start([exercise(`card-${index}`)]);
      controller.submit(`word-card-${index}`);
      await controller.rate('good');
    }
    expect(new Set(operationIds).size).toBe(2);
  });
  it('uses the lesson reducer and does not persist before feedback and a learner rating', async () => {
    const reviewCard = vi.fn(async () => undefined);
    const controller = createDailySessionController({ reviewCard, createOperationId: () => 'op-a' });
    controller.start([exercise('card-a'), exercise('card-b')]);

    await expect(controller.rate('good')).resolves.toEqual({ status: 'not-ready' });
    expect(controller.submit('word-card-a')).toBe(true);
    expect(controller.getSnapshot()).toMatchObject({ phase: 'feedback', index: 0 });
    expect(reviewCard).not.toHaveBeenCalled();

    await expect(controller.rate('good')).resolves.toEqual({ status: 'advanced' });
    expect(reviewCard).toHaveBeenCalledWith('card-a', 'good', 'op-a');
    expect(controller.getSnapshot()).toMatchObject({ phase: 'answering', index: 1 });
  });

  it('coalesces duplicate ratings by operation ID and advances only after persistence succeeds', async () => {
    const pending = deferred<void>();
    const reviewCard = vi.fn(() => pending.promise);
    const controller = createDailySessionController({ reviewCard, createOperationId: () => 'stable-op' });
    controller.start([exercise('card-a'), exercise('card-b')]);
    controller.submit('word-card-a');

    const first = controller.rate('easy');
    const duplicate = controller.rate('hard');
    expect(reviewCard).toHaveBeenCalledTimes(1);
    expect(reviewCard).toHaveBeenCalledWith('card-a', 'easy', 'stable-op');
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'persisting', index: 0,
      pendingReview: { itemId: 'card-a', operationId: 'stable-op', rating: 'easy' },
    });
    pending.resolve();

    await expect(first).resolves.toEqual({ status: 'advanced' });
    await expect(duplicate).resolves.toEqual({ status: 'advanced' });
    expect(controller.getSnapshot()).toMatchObject({ phase: 'answering', index: 1 });
  });

  it('retains the same operation ID on a retry and advances only after the retry succeeds', async () => {
    const reviewCard = vi.fn()
      .mockRejectedValueOnce(new Error('offline write failed'))
      .mockResolvedValueOnce(undefined);
    const createOperationId = vi.fn(() => 'retry-safe-op');
    const controller = createDailySessionController({ reviewCard, createOperationId });
    controller.start([exercise('card-a')]);
    controller.submit('word-card-a');

    await expect(controller.rate('hard')).resolves.toEqual({
      status: 'failed', error: 'offline write failed',
    });
    expect(controller.getSnapshot()).toMatchObject({
      phase: 'save-error', index: 0,
      pendingReview: { itemId: 'card-a', operationId: 'retry-safe-op', rating: 'hard' },
    });

    await expect(controller.retry()).resolves.toEqual({ status: 'completed' });
    expect(createOperationId).toHaveBeenCalledTimes(1);
    expect(reviewCard).toHaveBeenCalledTimes(2);
    expect(reviewCard).toHaveBeenNthCalledWith(1, 'card-a', 'hard', 'retry-safe-op');
    expect(reviewCard).toHaveBeenNthCalledWith(2, 'card-a', 'hard', 'retry-safe-op');
    expect(controller.getSnapshot()).toMatchObject({ phase: 'completed', index: 1 });
  });

  it('never acknowledges an old persistence request into a replacement session', async () => {
    const pending = deferred<void>();
    const controller = createDailySessionController({
      reviewCard: vi.fn(() => pending.promise),
      createOperationId: () => 'old-op',
    });
    controller.start([exercise('old')]);
    controller.submit('word-old');
    const oldRating = controller.rate('good');

    controller.start([exercise('new')]);
    pending.resolve();

    await expect(oldRating).resolves.toEqual({ status: 'stale-session' });
    expect(controller.getSnapshot()).toMatchObject({ phase: 'answering', index: 0 });
    expect(controller.getSnapshot()?.exercises[0].cardId).toBe('new');
  });

  it('closes a session without letting a late request restore it', async () => {
    const pending = deferred<void>();
    const controller = createDailySessionController({
      reviewCard: vi.fn(() => pending.promise), createOperationId: () => 'op-close',
    });
    controller.start([exercise('card-a')]);
    controller.submit('word-card-a');
    const rating = controller.rate('good');
    controller.close();
    pending.resolve();

    await expect(rating).resolves.toEqual({ status: 'stale-session' });
    expect(controller.getSnapshot()).toBeNull();
  });
});
