import { describe, expect, it, vi } from 'vitest';
import {
  assertProtectedFunctionsAvailable,
  classifyProtectedFunctionError,
  getProtectedFunctionUserMessage,
  resolveProtectedFunctionsCapability,
  runProtectedFunction,
} from './protectedFunctionsCapability';

describe('protected Firebase Functions capability', () => {
  it.each([
    {
      runtime: {
        firebaseConfigured: false,
        firebaseInitialized: false,
        appCheckSiteKeyConfigured: false,
        appCheckInitialized: false,
      },
      reason: 'firebase-unconfigured',
    },
    {
      runtime: {
        firebaseConfigured: true,
        firebaseInitialized: true,
        appCheckSiteKeyConfigured: false,
        appCheckInitialized: false,
      },
      reason: 'app-check-unconfigured',
    },
    {
      runtime: {
        firebaseConfigured: true,
        firebaseInitialized: true,
        appCheckSiteKeyConfigured: true,
        appCheckInitialized: false,
      },
      reason: 'app-check-initialization-failed',
    },
  ] as const)('fails closed when protected functions are unavailable: $reason', ({ runtime, reason }) => {
    expect(resolveProtectedFunctionsCapability(runtime)).toEqual({
      available: false,
      reason,
    });
  });

  it('is available only after Firebase and App Check both initialize', () => {
    expect(resolveProtectedFunctionsCapability({
      firebaseConfigured: true,
      firebaseInitialized: true,
      appCheckSiteKeyConfigured: true,
      appCheckInitialized: true,
    })).toEqual({ available: true });
  });

  it('blocks invocation before a protected callable is created', async () => {
    const invoke = vi.fn();

    await expect(runProtectedFunction(
      { available: false, reason: 'app-check-unconfigured' },
      'Deck sharing',
      invoke,
    )).rejects.toMatchObject({
      name: 'ProtectedFunctionError',
      kind: 'configuration',
      retryable: false,
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it('provides a clear configuration message without weakening App Check', () => {
    expect(() => assertProtectedFunctionsAvailable(
      { available: false, reason: 'app-check-initialization-failed' },
      'AI generation',
    )).toThrow(
      'AI generation is unavailable because the protected cloud service could not start securely. Reload the app; if this continues, the deployment configuration needs administrator attention.',
    );
  });
});

describe('protected Firebase Functions failure classification', () => {
  it.each([
    ['functions/unauthenticated', 'authentication', false, 'Sign in again'],
    ['permission-denied', 'permission', false, 'App Check or access rules'],
    ['functions/not-found', 'configuration', false, 'cloud deployment are out of sync'],
    ['functions/failed-precondition', 'configuration', false, 'cloud deployment are out of sync'],
    ['functions/resource-exhausted', 'quota', false, 'usage limit'],
    ['functions/unavailable', 'network', true, 'Check your connection'],
    ['functions/deadline-exceeded', 'network', true, 'Check your connection'],
  ] as const)('maps %s to a safe %s failure', (code, kind, retryable, message) => {
    const failure = classifyProtectedFunctionError(
      Object.assign(new Error('internal backend detail'), { code }),
      'Story generation',
    );

    expect(failure).toMatchObject({ kind, retryable });
    expect(failure.message).toContain(message);
    expect(failure.message).not.toContain('internal backend detail');
    expect(failure).not.toHaveProperty('cause');
  });

  it('treats browser network failures as retryable without exposing details', () => {
    const failure = classifyProtectedFunctionError(
      new TypeError('https://private-service.example failed'),
      'Translation',
    );

    expect(failure).toMatchObject({ kind: 'network', retryable: true });
    expect(failure.message).not.toContain('private-service.example');
  });

  it('does not automatically retry an unknown protected-service failure', () => {
    const failure = classifyProtectedFunctionError(
      new Error('secret implementation detail'),
      'AI generation',
    );

    expect(failure).toMatchObject({ kind: 'unknown', retryable: false });
    expect(failure.message).toBe(
      'AI generation failed safely. Try again; if it continues, contact the app administrator.',
    );
  });

  it('exposes only messages that have passed protected-service classification', () => {
    const protectedFailure = classifyProtectedFunctionError(
      Object.assign(new Error('private rule detail'), { code: 'permission-denied' }),
      'Deck sharing',
    );

    expect(getProtectedFunctionUserMessage(protectedFailure)).toBe(protectedFailure.message);
    expect(getProtectedFunctionUserMessage(new Error('unclassified private detail'))).toBeNull();
  });
});
