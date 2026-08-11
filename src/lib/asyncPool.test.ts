import { describe, expect, it } from 'vitest';
import { mapWithConcurrency, mapWithConcurrencyUntilFailure } from './asyncPool';

describe('mapWithConcurrency', () => {
  it('processes every item while limiting simultaneous work', async () => {
    let active = 0;
    let peak = 0;
    const completed: number[] = [];

    const results = await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7], 3, async value => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      completed.push(value);
      active -= 1;
      return value * 2;
    });

    expect(peak).toBeLessThanOrEqual(3);
    expect(completed.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(results).toEqual([2, 4, 6, 8, 10, 12, 14]);
  });

  it('stops scheduling new work and aborts in-flight work after the first failure', async () => {
    const started: number[] = [];
    const aborted: number[] = [];

    const pending = mapWithConcurrencyUntilFailure(
      [1, 2, 3, 4, 5, 6, 7, 8],
      3,
      async (value, _index, signal) => {
        started.push(value);
        if (value === 1) throw new Error('first failure');

        await new Promise<never>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            aborted.push(value);
            reject(signal.reason);
          }, { once: true });
        });
      },
    );

    await expect(pending).rejects.toThrow('first failure');
    expect(started).toEqual([1, 2, 3]);
    expect(aborted.sort((left, right) => left - right)).toEqual([2, 3]);
  });

  it('waits for aborted workers to finish cleanup before rejecting', async () => {
    let releaseCleanup!: () => void;
    const cleanupGate = new Promise<void>(resolve => { releaseCleanup = resolve; });
    let cleanupFinished = false;
    let settled = false;
    let rejection: unknown;

    const pending = mapWithConcurrencyUntilFailure([1, 2, 3], 2, async (value, _index, signal) => {
      if (value === 1) throw new Error('first failure');
      await new Promise<void>(resolve => {
        signal.addEventListener('abort', () => {
          void cleanupGate.then(() => {
            cleanupFinished = true;
            resolve();
          });
        }, { once: true });
      });
      return value;
    });
    const observed = pending.catch(error => {
      settled = true;
      rejection = error;
    });

    await new Promise(resolve => setTimeout(resolve, 0));
    const settledBeforeCleanup = settled;
    releaseCleanup();
    await observed;

    expect(settledBeforeCleanup).toBe(false);
    expect(cleanupFinished).toBe(true);
    expect(rejection).toEqual(new Error('first failure'));
  });
});
