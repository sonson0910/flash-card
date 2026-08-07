import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import {
  DAILY_PRACTICE_POOL_LIMIT,
  createDailyPracticePoolRuntime,
} from './dailyPracticePoolRuntime';

const card = (id: string): CardData => ({
  id,
  word: `word-${id}`,
  translation: `translation-${id}`,
  explanation: '',
  phonetic: '',
  emoji: '',
  category: 'General',
  audioUrl: null,
  imageUrl: null,
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
};

describe('daily Practice Pool runtime', () => {
  it('uses one bounded Practice Pool read and trims an oversized port result', async () => {
    const loadPracticePool = vi.fn(async () => (
      Array.from({ length: 75 }, (_, index) => card(String(index)))
    ));
    const runtime = createDailyPracticePoolRuntime({
      activeOwner: () => 'owner-a',
      loadPracticePool,
    });

    const result = await runtime.load();

    expect(loadPracticePool).toHaveBeenCalledTimes(1);
    expect(loadPracticePool).toHaveBeenCalledWith(DAILY_PRACTICE_POOL_LIMIT, true);
    expect(result).toEqual({
      status: 'loaded',
      ownerId: 'owner-a',
      cards: expect.arrayContaining([expect.objectContaining({ id: '0' })]),
    });
    if (result.status === 'loaded') expect(result.cards).toHaveLength(DAILY_PRACTICE_POOL_LIMIT);
  });

  it('rejects non-positive and over-limit request sizes before reading the port', async () => {
    const loadPracticePool = vi.fn(async () => []);
    const runtime = createDailyPracticePoolRuntime({ activeOwner: () => null, loadPracticePool });

    await expect(runtime.load(0)).rejects.toThrow(/between 1 and 50/i);
    await expect(runtime.load(51)).rejects.toThrow(/between 1 and 50/i);
    expect(loadPracticePool).not.toHaveBeenCalled();
  });

  it('marks a late result stale after the owner changes', async () => {
    let ownerId: string | null = 'owner-a';
    const pending = deferred<CardData[]>();
    const runtime = createDailyPracticePoolRuntime({
      activeOwner: () => ownerId,
      loadPracticePool: vi.fn(() => pending.promise),
    });

    const result = runtime.load(15);
    ownerId = 'owner-b';
    runtime.ownerChanged();
    pending.resolve([card('private-a')]);

    await expect(result).resolves.toEqual({ status: 'stale' });
  });

  it('allows only the latest request generation to publish', async () => {
    const first = deferred<CardData[]>();
    const second = deferred<CardData[]>();
    const loadPracticePool = vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const runtime = createDailyPracticePoolRuntime({
      activeOwner: () => 'owner-a',
      loadPracticePool,
    });

    const oldResult = runtime.load(10);
    const latestResult = runtime.load(10);
    second.resolve([card('latest')]);
    await expect(latestResult).resolves.toMatchObject({ status: 'loaded', cards: [{ id: 'latest' }] });
    first.resolve([card('old')]);
    await expect(oldResult).resolves.toEqual({ status: 'stale' });
  });

  it('suppresses an obsolete request failure after the owner changes', async () => {
    let ownerId: string | null = 'owner-a';
    const pending = deferred<CardData[]>();
    const runtime = createDailyPracticePoolRuntime({
      activeOwner: () => ownerId,
      loadPracticePool: vi.fn(() => pending.promise),
    });
    const oldResult = runtime.load();

    ownerId = 'owner-b';
    runtime.ownerChanged();
    pending.reject(new Error('owner-a cloud failure'));

    await expect(oldResult).resolves.toEqual({ status: 'stale' });
  });
});
