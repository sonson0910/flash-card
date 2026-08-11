import { describe, expect, it } from 'vitest';
import { resolveAiGenerationAccess } from './aiGenerationAccess';

describe('AI generation access', () => {
  it('requires authentication for the protected production service', () => {
    expect(resolveAiGenerationAccess({
      runtime: 'protected-production',
      isAuthenticated: false,
    })).toEqual({
      available: false,
      reason: 'authentication-required',
      message: 'Sign in to generate smart cards.',
    });
  });

  it('allows an authenticated production user', () => {
    expect(resolveAiGenerationAccess({
      runtime: 'protected-production',
      isAuthenticated: true,
    })).toEqual({ available: true });
  });

  it('preserves direct development generation without cloud authentication', () => {
    expect(resolveAiGenerationAccess({
      runtime: 'direct-development',
      isAuthenticated: false,
    })).toEqual({ available: true });
  });
});
