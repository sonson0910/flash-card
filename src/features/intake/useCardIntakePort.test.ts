import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { CardIntakeCloudStats } from './cardIntakePortContract';
import {
  canContinueIntakeFromLocalLookup,
  compensateOptimisticDuplicateCard,
  createIntakeSessionGuard,
  rethrowIfStaleIntakeSession,
  StaleIntakeSessionError,
} from './cardIntakePipeline';
import type { CardData } from '../../types/card';

const intakeCard = (id: string): CardData => ({
  id,
  word: 'shared word',
  normalizedWord: 'shared word',
  translation: `translation ${id}`,
  explanation: '',
  phonetic: '',
  emoji: '🧱',
  category: 'Test',
  audioUrl: null,
  imageUrl: null,
});

describe('local intake lookup isolation', () => {
  it('continues from the local library when Firestore daily reads are exhausted', () => {
    const quotaError = Object.assign(new Error('Quota limit exceeded.'), {
      code: 'firestore/resource-exhausted',
    });

    expect(canContinueIntakeFromLocalLookup(quotaError, false)).toBe(true);
  });

  it.each([
    [
      'Firestore is unavailable',
      Object.assign(new Error('Service unavailable.'), { code: 'firestore/unavailable' }),
    ],
    [
      'the Firestore deadline expires',
      Object.assign(new Error('Lookup timed out.'), { code: 'deadline-exceeded' }),
    ],
    [
      'the Firebase client reports a network failure',
      Object.assign(new Error('Network request failed.'), { code: 'firestore/network-request-failed' }),
    ],
    ['fetch fails before receiving a response', new TypeError('Failed to fetch')],
  ])('continues generation from local data when %s', (_label, error) => {
    expect(canContinueIntakeFromLocalLookup(error, false)).toBe(true);
  });

  it('does not hide a non-quota lookup failure when a local match is missing', () => {
    expect(canContinueIntakeFromLocalLookup(
      Object.assign(new Error('Access denied.'), { code: 'firestore/permission-denied' }),
      false,
    )).toBe(false);
  });

  it('uses a complete local match even when the redundant cloud lookup fails', () => {
    expect(canContinueIntakeFromLocalLookup(new Error('Network unavailable.'), true)).toBe(true);
  });
});

describe('duplicate rollback', () => {
  it('rolls back exactly one optimistic card from XP, stats, and category facets', () => {
    let stats: CardIntakeCloudStats = {
      total: 5,
      reviewed: 2,
      easy: 1,
      good: 1,
      hard: 0,
      unrated: 3,
      bookmarked: 1,
      due: 0,
      legacyUnindexed: 0,
    };
    const addXp = vi.fn();
    const resetCloudPage = vi.fn();
    const updateCategoryFacets = vi.fn(async () => undefined);

    compensateOptimisticDuplicateCard(intakeCard('candidate-id'), {
      addXp,
      resetCloudPage,
      updateCategoryFacets,
      updateCloudStats: update => { stats = update(stats); },
    });

    expect(addXp).toHaveBeenCalledWith(-10);
    expect(stats).toMatchObject({ total: 4, unrated: 2, reviewed: 2, bookmarked: 1 });
    expect(updateCategoryFacets).toHaveBeenCalledWith({ Test: -1 });
    expect(resetCloudPage).toHaveBeenCalledOnce();
  });
});

describe('intake session ownership guard', () => {
  it('uses the protected-service authentication error for signed-out production generation', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./cardIntakePipeline.ts', import.meta.url)),
      'utf8',
    );
    const generation = source.slice(
      source.indexOf('const generateCard:'),
      source.indexOf('const persistCardsInternal:'),
    );

    expect(generation).toMatch(/classifyProtectedFunctionError\([\s\S]{0,120}unauthenticated[\s\S]{0,120}AI generation/);
    expect(generation).not.toContain("throw new Error('Sign in to generate AI cards.')");
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

    expect(() => rethrowIfStaleIntakeSession(
      new Error('cloud lookup unavailable'),
      guard.isCurrent(startedByA),
    )).toThrow(StaleIntakeSessionError);
    expect(() => rethrowIfStaleIntakeSession(new Error('cloud lookup unavailable'))).not.toThrow();
  });
});
