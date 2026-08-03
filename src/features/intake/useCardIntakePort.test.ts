import { describe, expect, it } from 'vitest';
import {
  createIntakeSessionGuard,
  rethrowIfStaleIntakeSession,
  StaleIntakeSessionError,
} from './useCardIntakePort';

describe('intake session ownership guard', () => {
  it('invalidates an A operation after switching to B', () => {
    const guard = createIntakeSessionGuard('owner-a');
    const startedByA = guard.capture();

    guard.replaceOwner('owner-b');

    expect(guard.isCurrent(startedByA)).toBe(false);
    expect(guard.capture()).toEqual({ ownerId: 'owner-b', generation: 1 });
  });

  it('does not revive an A operation after an A-to-B-to-A switch', () => {
    const guard = createIntakeSessionGuard('owner-a');
    const firstASession = guard.capture();

    guard.replaceOwner('owner-b');
    guard.replaceOwner('owner-a');

    expect(guard.capture()).toEqual({ ownerId: 'owner-a', generation: 2 });
    expect(guard.isCurrent(firstASession)).toBe(false);
  });

  it('never lets a stale A lookup fall through a recoverable lookup catch after switching to B', () => {
    const guard = createIntakeSessionGuard('owner-a');
    const startedByA = guard.capture();
    guard.replaceOwner('owner-b');

    const lookupFailure = guard.isCurrent(startedByA)
      ? new Error('ordinary lookup failure')
      : new StaleIntakeSessionError();

    expect(() => rethrowIfStaleIntakeSession(lookupFailure)).toThrow(lookupFailure);
    expect(() => rethrowIfStaleIntakeSession(new Error('mirror unavailable'))).not.toThrow();
  });
});
