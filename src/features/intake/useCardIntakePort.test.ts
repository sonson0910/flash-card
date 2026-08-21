import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import type { CardIntakeCloudStats } from './cardIntakePortContract';
import {
  canContinueIntakeFromLocalLookup,
  compensateOptimisticDuplicateCard,
  createIntakeSessionGuard,
  rethrowIfStaleIntakeSession,
  selectLocalIntakeCards,
  StaleIntakeSessionError,
} from './cardIntakePipeline';

const localCard = (id: string, word: string, libraryEpoch?: number): CardData => ({
  id,
  word,
  normalizedWord: word,
  translation: `translation ${id}`,
  explanation: '',
  phonetic: '',
  emoji: '🧱',
  category: 'Test',
  audioUrl: null,
  imageUrl: null,
  ...(libraryEpoch === undefined ? {} : { libraryEpoch }),
});

describe('Library Replica intake boundary', () => {
  it('keeps persistence imports and acknowledgement out of Card Intake', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./cardIntakePipeline.ts', import.meta.url)),
      'utf8',
    );
    expect(source).not.toMatch(/createCardIfAbsent|acknowledgeDevicePending/);
    expect(source).not.toMatch(/from ['"]\.\.\/\.\.\/lib\/(cardRepository|cardMirror|deviceSync)/);
    expect(source).toContain('libraryReplica');
  });

  it('continues from local data for retryable cloud lookup failures', () => {
    expect(canContinueIntakeFromLocalLookup(
      Object.assign(new Error('Quota limit exceeded.'), { code: 'firestore/resource-exhausted' }),
      false,
    )).toBe(true);
    expect(canContinueIntakeFromLocalLookup(
      Object.assign(new Error('Access denied.'), { code: 'firestore/permission-denied' }),
      false,
    )).toBe(false);
    expect(canContinueIntakeFromLocalLookup(new Error('Network unavailable.'), true)).toBe(true);
  });

  it('keeps active-owner cards while rejecting a cache tagged to another account', () => {
    const currentCard = localCard('owner-b-current', 'current', 2);
    const foreignCard = localCard('owner-a-cache', 'foreign', 2);
    const selected = selectLocalIntakeCards({
      currentCards: [currentCard],
      cachedCards: [foreignCard],
      cachedOwnerId: 'owner-a',
      currentOwnerId: 'owner-b',
      libraryEpoch: 2,
    });
    expect(selected.map(card => card.id)).toEqual([currentCard.id]);
  });

  it('keeps matching-owner cache entries without replacing active cards', () => {
    const currentCard = localCard('owner-b-current', 'shared', 2);
    const staleCachedCopy = localCard('owner-b-stale-copy', 'shared', 2);
    const cachedOnlyCard = localCard('owner-b-cache-only', 'cached only', 2);
    const selected = selectLocalIntakeCards({
      currentCards: [currentCard],
      cachedCards: [staleCachedCopy, cachedOnlyCard],
      cachedOwnerId: 'owner-b',
      currentOwnerId: 'owner-b',
      libraryEpoch: 2,
    });
    expect(selected.map(card => card.id)).toEqual([currentCard.id, cachedOnlyCard.id]);
  });

  it('accepts legacy missing epochs only before the library advances', () => {
    const legacy = localCard('legacy', 'legacy');
    const epochTwo = localCard('epoch-two', 'current', 2);
    const epochOne = localCard('epoch-one', 'old', 1);
    const epochThree = localCard('epoch-three', 'future', 3);
    const selectAtEpoch = (libraryEpoch: number | null) => selectLocalIntakeCards({
      currentCards: [],
      cachedCards: [legacy, epochTwo, epochOne, epochThree],
      cachedOwnerId: 'owner-b',
      currentOwnerId: 'owner-b',
      libraryEpoch,
    }).map(card => card.id);
    expect(selectAtEpoch(null)).toEqual([legacy.id, epochTwo.id, epochOne.id, epochThree.id]);
    expect(selectAtEpoch(0)).toEqual([legacy.id]);
    expect(selectAtEpoch(2)).toEqual([epochTwo.id]);
  });

  it('rolls back exactly one optimistic duplicate from XP, stats and facets', () => {
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
    compensateOptimisticDuplicateCard(localCard('candidate', 'candidate', 2), {
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

  it('does not let a stale lookup fall through a recoverable error', () => {
    const guard = createIntakeSessionGuard('owner-a');
    const startedByA = guard.capture();
    guard.replaceOwner('owner-b');
    expect(() => rethrowIfStaleIntakeSession(
      new Error('replica unavailable'),
      guard.isCurrent(startedByA),
    )).toThrow(StaleIntakeSessionError);
    expect(() => rethrowIfStaleIntakeSession(new Error('replica unavailable'))).not.toThrow();
  });
});
