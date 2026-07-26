import { describe, expect, it } from 'vitest';
import { mapWithConcurrency } from './asyncPool';

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
});
