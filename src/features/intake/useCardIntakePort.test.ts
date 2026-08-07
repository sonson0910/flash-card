import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createIntakeSessionGuard,
  rethrowIfStaleIntakeSession,
  StaleIntakeSessionError,
} from './useCardIntakePort';

describe('intake session ownership guard', () => {
  it('publishes generated cards without waiting for media or cloud acknowledgement', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./useCardIntakePort.ts', import.meta.url)),
      'utf8',
    );
    const generation = source.slice(
      source.indexOf("const generateCard:"),
      source.indexOf("const persistCards:"),
    );
    const persistence = source.slice(
      source.indexOf("const persistCards:"),
      source.indexOf("persistStructured:"),
    );

    expect(generation).not.toMatch(/await\s+waitForInitialMedia/);
    expect(persistence.indexOf('active.publishCards(next)')).toBeLessThan(
      persistence.indexOf('cloudSettlements.forEach'),
    );
    expect(persistence).toMatch(/created\.forEach\(active\.rememberPromoted\)/);
    expect(persistence).toMatch(/active\.resetCatalog\(\)/);
  });

  it('does not block local card generation while the signed-in epoch is awaiting verification', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./useCardIntakePort.ts', import.meta.url)),
      'utf8',
    );

    expect(source).not.toMatch(/ownerId\s*&&\s*current\.libraryEpoch\s*===\s*null[\s\S]{0,120}throw/);
    expect(source).toMatch(/isFirebaseConfigured\s*&&\s*current\.libraryEpoch\s*!==\s*null/);
    expect(source).toMatch(/queued:\s*Boolean\(current\.ownerId\s*&&\s*current\.libraryEpoch\s*===\s*null\)/);
  });
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
