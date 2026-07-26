import { afterEach, describe, expect, it, vi } from 'vitest';
import { withNetworkRetry } from './gemini';

afterEach(() => {
  vi.useRealTimers();
});

describe('Gemini retry budget', () => {
  it('stops retrying when the AI request never settles', async () => {
    vi.useFakeTimers();
    const operation = vi.fn(() => new Promise<string>(() => undefined));
    const result = withNetworkRetry(operation);
    const rejection = expect(result).rejects.toThrow('The AI service took too long to respond');

    await vi.runAllTimersAsync();

    await rejection;
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
