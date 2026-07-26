import { afterEach, describe, expect, it, vi } from 'vitest';
import { OperationTimeoutError, withTimeout } from './async';

afterEach(() => {
  vi.useRealTimers();
});

describe('withTimeout', () => {
  it('rejects a dependency that never settles and runs cancellation cleanup', async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const result = withTimeout(new Promise<string>(() => undefined), 1_000, 'timed out', cancel);
    const rejection = expect(result).rejects.toEqual(expect.objectContaining({
      name: 'OperationTimeoutError',
      message: 'timed out',
    }));

    await vi.advanceTimersByTimeAsync(1_000);

    await rejection;
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('passes through a result that arrives before the deadline', async () => {
    await expect(withTimeout(Promise.resolve('ready'), 1_000)).resolves.toBe('ready');
  });

  it('exposes a distinct timeout error type for retry policies', () => {
    expect(new OperationTimeoutError('slow')).toBeInstanceOf(Error);
  });
});
