import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type {
  DevicePendingOperation,
  PendingCreateSettlement,
} from '../../lib/deviceSync';
import type { CardData } from '../../types/card';
import type { CardIntakeCloudStats } from './cardIntakePortContract';

import {
  canContinueIntakeFromLocalLookup,
  compensateOptimisticDuplicateCard,
  createCardIntakePipeline,
  createIntakeSessionGuard,
  rethrowIfStaleIntakeSession,
  selectLocalIntakeCards,
  StaleIntakeSessionError,
} from './cardIntakePipeline';
import type { CardIntakePortOptions } from './cardIntakePortContract';

const intakeCard = (id: string, libraryEpoch: number, revision: number): CardData => ({
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
  libraryEpoch,
  revision,
});

const localIntakeCard = (
  id: string,
  word: string,
  libraryEpoch?: number,
): CardData => ({
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

const pendingCreate = (card: CardData): DevicePendingOperation => ({
  type: 'upsert',
  operation: 'create',
  opId: `create-${card.id}`,
  card,
  baseRevision: card.revision ?? 0,
  fieldMask: [],
  libraryEpoch: card.libraryEpoch ?? 0,
  updatedAt: '2026-08-09T00:00:00.000Z',
  ownerUserId: 'user-a',
});

describe('local intake lookup isolation', () => {
  it('continues from the local mirror when Firestore daily reads are exhausted', () => {
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

  it('keeps active-owner cards but rejects a raw cache tagged to another account', () => {
    const currentCard = localIntakeCard('owner-b-current', 'current', 2);
    const ownerACache = localIntakeCard('owner-a-cache', 'foreign', 2);

    const selected = selectLocalIntakeCards({
      currentCards: [currentCard],
      cachedCards: [ownerACache],
      cachedOwnerId: 'owner-a',
      currentOwnerId: 'owner-b',
      libraryEpoch: 2,
    });

    expect(selected.map(card => card.id)).toEqual([currentCard.id]);
  });

  it('uses matching-owner raw cache without letting it replace an active-session card', () => {
    const currentCard = localIntakeCard('owner-b-current', 'shared', 2);
    const staleCachedCopy = localIntakeCard('owner-b-stale-copy', 'shared', 2);
    const cachedOnlyCard = localIntakeCard('owner-b-cache-only', 'cached only', 2);

    const selected = selectLocalIntakeCards({
      currentCards: [currentCard],
      cachedCards: [staleCachedCopy, cachedOnlyCard],
      cachedOwnerId: 'owner-b',
      currentOwnerId: 'owner-b',
      libraryEpoch: 2,
    });

    expect(selected.map(card => card.id)).toEqual([currentCard.id, cachedOnlyCard.id]);
  });

  it('accepts legacy missing epochs only before the library has advanced past epoch zero', () => {
    const legacy = localIntakeCard('legacy', 'legacy');
    const epochTwo = localIntakeCard('epoch-two', 'current', 2);
    const epochOne = localIntakeCard('epoch-one', 'old', 1);
    const epochThree = localIntakeCard('epoch-three', 'future', 3);
    const selectAtEpoch = (libraryEpoch: number | null) => selectLocalIntakeCards({
      currentCards: [],
      cachedCards: [legacy, epochTwo, epochOne, epochThree],
      cachedOwnerId: 'owner-b',
      currentOwnerId: 'owner-b',
      libraryEpoch,
    }).map(card => card.id);

    expect(selectAtEpoch(null)).toEqual([
      legacy.id,
      epochTwo.id,
      epochOne.id,
      epochThree.id,
    ]);
    expect(selectAtEpoch(0)).toEqual([legacy.id]);
    expect(selectAtEpoch(2)).toEqual([epochTwo.id]);
  });
});

describe('intake create settlement', () => {
  const createContext = (
    candidate: CardData,
    operation: Extract<DevicePendingOperation, { type: 'upsert' }>,
  ) => {
    let cards: CardData[] = [];
    let stats: CardIntakeCloudStats = {
      total: 0,
      reviewed: 0,
      easy: 0,
      good: 0,
      hard: 0,
      unrated: 0,
      bookmarked: 0,
      due: 0,
      legacyUnindexed: 0,
    };
    const addXp = vi.fn();
    const updateCategoryFacets = vi.fn(async () => undefined);
    const patchCard = vi.fn(async () => undefined);
    const notify = vi.fn();
    const context: CardIntakePortOptions = {
      ownerId: 'user-a',
      libraryEpoch: 2,
      knownLibraryTotal: 0,
      cloudStats: stats,
      cardsPerPage: 9,
      getCards: () => cards,
      publishCards: next => { cards = next; },
      upsertDeviceCards: vi.fn(async () => [operation]),
      connectPendingCreateSettlement: vi.fn(),
      patchCard,
      hydrateExisting: vi.fn(),
      rememberPromoted: vi.fn(),
      resetCatalog: vi.fn(),
      resetCloudPage: vi.fn(),
      updateCloudStats: update => { stats = update(stats); },
      updateCloudTotal: vi.fn(),
      updateCategoryFacets,
      setCloudUnavailable: vi.fn(),
      notify,
      focusLibrary: vi.fn(),
      addXp,
    };
    return {
      context,
      addXp,
      getCards: () => cards,
      getStats: () => stats,
      notify,
      patchCard,
      updateCategoryFacets,
      candidate,
    };
  };

  it('compensates a current optimistic duplicate exactly once after replica acknowledgement', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const candidate = {
      ...intakeCard('stable-id', 2, 0),
      createdAt: '2026-08-09T00:00:00.000Z',
    };
    const operation = pendingCreate(candidate) as Extract<
      DevicePendingOperation,
      { type: 'upsert' }
    >;
    const authoritative = {
      ...intakeCard('stable-id', 2, 7),
      createdAt: '2026-08-08T00:00:00.000Z',
    };
    const harness = createContext(candidate, operation);
    const pipeline = createCardIntakePipeline({ getContext: () => harness.context });

    await pipeline.persistCards([candidate], 'shared');
    const settlement: PendingCreateSettlement = {
      operation,
      authoritativeCard: authoritative,
      outcome: 'duplicate',
    };
    await pipeline.settlePendingCreate(settlement);
    await pipeline.settlePendingCreate(settlement);

    expect(harness.addXp.mock.calls).toEqual([[10], [-10]]);
    expect(harness.getStats()).toMatchObject({ total: 0, unrated: 0 });
    expect(harness.updateCategoryFacets).toHaveBeenNthCalledWith(1, { Test: 1 });
    expect(harness.updateCategoryFacets).toHaveBeenNthCalledWith(2, { Test: -1 });
    expect(harness.patchCard).toHaveBeenCalledWith(
      authoritative.id,
      expect.objectContaining({ sortTouchedAt: expect.any(String) }),
      expect.objectContaining({ id: authoritative.id }),
    );
    expect(harness.notify).toHaveBeenCalledWith(
      '“shared word” is already in your library. It has been moved to the top of page 1.',
    );
    warn.mockRestore();
  });

  it('does not compensate a replay of the same durable create', async () => {
    const candidate = {
      ...intakeCard('stable-id', 2, 0),
      createdAt: '2026-08-09T00:00:00.000Z',
    };
    const operation = pendingCreate(candidate) as Extract<
      DevicePendingOperation,
      { type: 'upsert' }
    >;
    const harness = createContext(candidate, operation);
    const pipeline = createCardIntakePipeline({ getContext: () => harness.context });

    await pipeline.persistCards([candidate], 'shared');
    await pipeline.settlePendingCreate({
      operation,
      authoritativeCard: { ...candidate, revision: 1 },
      outcome: 'replayed',
    });

    expect(harness.addXp).toHaveBeenCalledOnce();
    expect(harness.addXp).toHaveBeenCalledWith(10);
    expect(harness.getStats()).toMatchObject({ total: 1, unrated: 1 });
    expect(harness.patchCard).not.toHaveBeenCalled();
  });

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

    compensateOptimisticDuplicateCard(intakeCard('candidate-id', 2, 3), {
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
  it('waits briefly for initial media before publishing without waiting for cloud acknowledgement', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./cardIntakePipeline.ts', import.meta.url)),
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

    expect(generation).toMatch(/await\s+waitForInitialMedia/);
    expect(persistence.indexOf('await current.upsertDeviceCards')).toBeLessThan(
      persistence.indexOf('active.publishCards(next)'),
    );
    expect(persistence).toMatch(/pendingCreateSessions\.set\(/);
    expect(persistence).toMatch(/created\.forEach\(active\.rememberPromoted\)/);
    expect(persistence).toMatch(/active\.resetCatalog\(\)/);
    expect(persistence).not.toMatch(/createCardIfAbsent|persistCardWithMirrorFallback|cloudSettlements/);
  });

  it('settles flat-import media fetch and patch work through the best-effort seam', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./cardIntakePipeline.ts', import.meta.url)),
      'utf8',
    );
    const flatGeneration = source.slice(
      source.indexOf('generate: async word =>'),
      source.indexOf('completeFlat:'),
    );

    expect(flatGeneration).toMatch(/settleMediaBestEffort\(/);
    expect(flatGeneration).not.toMatch(/mediaPromise\.then/);
  });

  it('does not block local card generation while the signed-in epoch is awaiting verification', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./cardIntakePipeline.ts', import.meta.url)),
      'utf8',
    );

    expect(source).not.toMatch(/ownerId\s*&&\s*current\.libraryEpoch\s*===\s*null[\s\S]{0,120}throw/);
    expect(source).toMatch(/isFirebaseConfigured\s*&&\s*current\.libraryEpoch\s*!==\s*null/);
    expect(source).toMatch(/current\.notify\('Saved locally; awaiting sync\.'\)/);
    expect(source).toMatch(/selectLocalIntakeCards\(\{/);
    expect(source).toMatch(
      /findCardsByNormalizedWords\([\s\S]{0,180}current\.libraryEpoch/,
    );
  });

  it('uses the protected-service authentication error for signed-out production generation', () => {
    const source = readFileSync(
      fileURLToPath(new URL('./cardIntakePipeline.ts', import.meta.url)),
      'utf8',
    );
    const generation = source.slice(
      source.indexOf('const generateCard:'),
      source.indexOf('const persistCards:'),
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
      new Error('mirror unavailable'),
      guard.isCurrent(startedByA),
    )).toThrow(StaleIntakeSessionError);
    expect(() => rethrowIfStaleIntakeSession(new Error('mirror unavailable'))).not.toThrow();
  });
});
