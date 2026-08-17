import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  app: { kind: 'firebase-app' },
  auth: { currentUser: { uid: 'owner-1' } as { uid: string } | null },
  capability: { available: true } as {
    available: boolean;
    reason?: string;
  },
  getFunctions: vi.fn(),
  httpsCallable: vi.fn(),
  callable: vi.fn(),
}));

vi.mock('./firebase', () => ({
  app: runtime.app,
  auth: runtime.auth,
  protectedFunctionsCapability: runtime.capability,
}));

vi.mock('firebase/functions', () => ({
  getFunctions: runtime.getFunctions,
  httpsCallable: runtime.httpsCallable,
}));

import {
  generateStoryContext,
  generateWordInfo,
  translateText,
  withNetworkRetry,
} from './gemini';

beforeEach(() => {
  vi.clearAllMocks();
  runtime.callable.mockReset();
  runtime.auth.currentUser = { uid: 'owner-1' };
  runtime.capability.available = true;
  delete runtime.capability.reason;
  runtime.getFunctions.mockReturnValue({ region: 'asia-southeast1' });
  runtime.httpsCallable.mockReturnValue(runtime.callable);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('Gemini retry budget', () => {
  it('retries a settled retryable failure', async () => {
    vi.useFakeTimers();
    const operation = vi.fn<() => Promise<string>>()
      .mockRejectedValueOnce(new TypeError('Network unavailable'))
      .mockResolvedValueOnce('generated content');

    const result = withNetworkRetry(operation);
    await vi.runAllTimersAsync();

    await expect(result).resolves.toBe('generated content');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('does not retry a timed-out direct SDK operation by default', async () => {
    vi.useFakeTimers();
    const operation = vi.fn<() => Promise<string>>(() => new Promise(() => undefined));

    const result = withNetworkRetry(operation);
    const rejection = expect(result).rejects.toThrow('The AI service took too long to respond');

    await vi.waitFor(() => expect(operation).toHaveBeenCalledTimes(1));
    await vi.runAllTimersAsync();

    await rejection;
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('retries a timed-out operation only when explicitly enabled', async () => {
    vi.useFakeTimers();
    const operation = vi.fn<() => Promise<string>>(() => new Promise(() => undefined));

    const result = withNetworkRetry(operation, { retryOnTimeout: true });
    const rejection = expect(result).rejects.toThrow('The AI service took too long to respond');

    await vi.waitFor(() => expect(operation).toHaveBeenCalledTimes(1));
    await vi.runAllTimersAsync();

    await rejection;
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('retries a Firebase callable after a settled retryable failure', async () => {
    vi.useFakeTimers();
    vi.stubEnv('DEV', false);
    runtime.callable
      .mockRejectedValueOnce(new TypeError('Network unavailable'))
      .mockResolvedValueOnce({ data: { result: 'Tình huống thuận lợi.' } });

    const result = translateText('A favorable situation.');
    const resolution = expect(result).resolves.toBe('Tình huống thuận lợi.');

    await vi.waitFor(() => expect(runtime.callable).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(500);
    await vi.waitFor(() => expect(runtime.callable).toHaveBeenCalledTimes(2));

    await resolution;
    expect(runtime.callable).toHaveBeenCalledTimes(2);
  });

  it('does not retry a timed-out Firebase callable request', async () => {
    vi.useFakeTimers();
    vi.stubEnv('DEV', false);
    runtime.callable.mockImplementation(() => new Promise(() => undefined));

    const result = generateWordInfo('opportunity');
    const rejection = expect(result).rejects.toThrow('The AI service took too long to respond');

    await vi.waitFor(() => expect(runtime.callable).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(10_000);

    await rejection;
    expect(runtime.callable).toHaveBeenCalledTimes(1);
  });
});

describe('production AI protected-service capability', () => {
  it('rejects signed-out generation with a typed non-retryable authentication error', async () => {
    vi.stubEnv('DEV', false);
    runtime.auth.currentUser = null;

    await expect(generateWordInfo('opportunity')).rejects.toMatchObject({
      name: 'ProtectedFunctionError',
      kind: 'authentication',
      code: 'unauthenticated',
      retryable: false,
      message: 'AI generation needs a current sign-in. Sign in again, then retry.',
    });
    expect(runtime.getFunctions).not.toHaveBeenCalled();
    expect(runtime.httpsCallable).not.toHaveBeenCalled();
    expect(runtime.callable).not.toHaveBeenCalled();
  });

  it('fails before creating a callable when App Check is not configured', async () => {
    vi.stubEnv('DEV', false);
    runtime.capability.available = false;
    runtime.capability.reason = 'app-check-unconfigured';

    await expect(generateWordInfo('opportunity')).rejects.toThrow(
      'AI generation is unavailable because App Check is not configured for this build.',
    );
    expect(runtime.getFunctions).not.toHaveBeenCalled();
    expect(runtime.httpsCallable).not.toHaveBeenCalled();
  });

  it.each([
    ['Story generation', () => generateStoryContext(['opportunity'])],
    ['Translation', () => translateText('A favorable situation.')],
  ] as const)('guards %s with the same protected runtime capability', async (operation, invoke) => {
    vi.stubEnv('DEV', false);
    runtime.capability.available = false;
    runtime.capability.reason = 'app-check-unconfigured';

    await expect(invoke()).rejects.toThrow(
      `${operation} is unavailable because App Check is not configured for this build.`,
    );
    expect(runtime.getFunctions).not.toHaveBeenCalled();
  });

  it('returns a safe actionable message for a protected-service rejection', async () => {
    vi.stubEnv('DEV', false);
    runtime.callable.mockRejectedValue(Object.assign(
      new Error('backend secret: rules implementation detail'),
      { code: 'functions/permission-denied' },
    ));

    const rejection = expect(generateWordInfo('opportunity')).rejects;
    await rejection.toThrow('App Check or access rules need administrator attention.');
    await rejection.not.toThrow('backend secret');
    expect(runtime.callable).toHaveBeenCalledTimes(1);
  });
});
