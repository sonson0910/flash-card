import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DeviceBackupOwnerConflictError,
  type DevicePendingOperation,
} from '../../lib/deviceSync';
import type { CardData } from '../../types/card';
import type { CardIntakeCloudStats } from './cardIntakePortContract';

const mocks = vi.hoisted(() => ({
  deleteDeviceCardBackupIfNotNewerThan: vi.fn(),
  mergeDeviceCardsStrict: vi.fn(),
  deleteMirroredCardIfNotNewerThan: vi.fn(),
  upsertMirroredCardIfNotOlderThan: vi.fn(),
}));

vi.mock('../../lib/deviceSync', async () => {
  const actual = await vi.importActual<typeof import('../../lib/deviceSync')>('../../lib/deviceSync');
  return {
    ...actual,
    deleteDeviceCardBackupIfNotNewerThan: mocks.deleteDeviceCardBackupIfNotNewerThan,
    mergeDeviceCardsStrict: mocks.mergeDeviceCardsStrict,
  };
});

vi.mock('../../lib/cardMirror', async () => {
  const actual = await vi.importActual<typeof import('../../lib/cardMirror')>('../../lib/cardMirror');
  return {
    ...actual,
    deleteMirroredCardIfNotNewerThan: mocks.deleteMirroredCardIfNotNewerThan,
    upsertMirroredCardIfNotOlderThan: mocks.upsertMirroredCardIfNotOlderThan,
  };
});

import {
  canContinueIntakeFromLocalLookup,
  canPublishIntakeSettlement,
  compensateOptimisticDuplicateCard,
  createIntakeSessionGuard,
  rethrowIfStaleIntakeSession,
  selectLocalIntakeCards,
  settleIntakeCloudPersistence,
  StaleIntakeSessionError,
} from './cardIntakePipeline';

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

const createSettlementHarness = (overrides: {
  canPublish?: (card: CardData) => boolean;
} = {}) => ({
  acknowledgeDevicePending: vi.fn(async () => undefined),
  assignExistingDeck: vi.fn(async (card: CardData, deck: string) => ({
    ...card,
    customDeck: deck,
  })),
  canPublish: overrides.canPublish ?? (() => true),
  compensateOptimisticDuplicate: vi.fn(),
  compensatedDuplicateSettlements: new Set<string>(),
  touchExisting: vi.fn(async () => undefined),
  notifyQueued: vi.fn(),
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

describe('intake cloud persistence settlement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.deleteDeviceCardBackupIfNotNewerThan.mockResolvedValue(true);
    mocks.mergeDeviceCardsStrict.mockResolvedValue(undefined);
    mocks.deleteMirroredCardIfNotNewerThan.mockResolvedValue(true);
    mocks.upsertMirroredCardIfNotOlderThan.mockResolvedValue(true);
  });

  it('replaces a different-id optimistic duplicate in both stores before acknowledging it', async () => {
    const candidate = intakeCard('candidate-id', 2, 3);
    const authoritative = intakeCard('authoritative-id', 2, 8);
    const operation = pendingCreate(candidate);
    const harness = createSettlementHarness();
    let deviceCards = [candidate];
    mocks.mergeDeviceCardsStrict.mockImplementation(async ([incoming]: CardData[]) => {
      // The DEV endpoint overlays the still-pending create while it normalizes the backup.
      deviceCards = [candidate, incoming];
    });
    mocks.deleteDeviceCardBackupIfNotNewerThan.mockImplementation(async (
      _userId: string,
      cardId: string,
    ) => {
      deviceCards = deviceCards.filter(card => card.id !== cardId);
      return true;
    });

    await settleIntakeCloudPersistence({
      ownerId: 'user-a',
      activeLibraryEpoch: 2,
      knownLibraryTotal: 7,
      candidate,
      operation,
      result: { card: authoritative, created: false, queued: false },
      ...harness,
      now: () => '2026-08-09T00:00:05.000Z',
    });

    expect(mocks.deleteDeviceCardBackupIfNotNewerThan).toHaveBeenCalledWith(
      'user-a',
      candidate.id,
      { libraryEpoch: 2, revision: 3 },
    );
    expect(mocks.deleteMirroredCardIfNotNewerThan).toHaveBeenCalledWith(
      'user-a',
      candidate.id,
      { libraryEpoch: 2, revision: 3 },
    );
    expect(mocks.mergeDeviceCardsStrict).toHaveBeenCalledWith([authoritative], 7, 'user-a');
    expect(mocks.upsertMirroredCardIfNotOlderThan).toHaveBeenCalledWith(
      'user-a',
      authoritative,
    );
    expect(deviceCards).toEqual([authoritative]);
    expect(harness.acknowledgeDevicePending).toHaveBeenCalledWith([operation]);
    expect(harness.touchExisting).toHaveBeenCalledWith(
      authoritative,
      '2026-08-09T00:00:05.000Z',
    );
    expect(harness.compensateOptimisticDuplicate).toHaveBeenCalledWith(candidate, 'create-candidate-id');
    expect(mocks.mergeDeviceCardsStrict.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteDeviceCardBackupIfNotNewerThan.mock.invocationCallOrder[0],
    );
    expect(mocks.upsertMirroredCardIfNotOlderThan.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.deleteDeviceCardBackupIfNotNewerThan.mock.invocationCallOrder[0],
    );
    expect(mocks.deleteDeviceCardBackupIfNotNewerThan.mock.invocationCallOrder[0]).toBeLessThan(
      harness.acknowledgeDevicePending.mock.invocationCallOrder[0],
    );
    expect(mocks.deleteMirroredCardIfNotNewerThan.mock.invocationCallOrder[0]).toBeLessThan(
      harness.acknowledgeDevicePending.mock.invocationCallOrder[0],
    );

    await settleIntakeCloudPersistence({
      ownerId: 'user-a',
      activeLibraryEpoch: 2,
      knownLibraryTotal: 7,
      candidate,
      operation,
      result: { card: authoritative, created: false, queued: false },
      ...harness,
      now: () => '2026-08-09T00:00:06.000Z',
    });
    expect(harness.compensateOptimisticDuplicate).toHaveBeenCalledTimes(1);
  });

  it('keeps requested deck routing when cloud creation resolves to an existing card', async () => {
    const candidate = { ...intakeCard('candidate-id', 2, 3), customDeck: 'Reading' };
    const authoritative = { ...intakeCard('authoritative-id', 2, 8), customDeck: null };
    const operation = pendingCreate(candidate);
    const harness = createSettlementHarness();

    await settleIntakeCloudPersistence({
      ownerId: 'user-a',
      activeLibraryEpoch: 2,
      knownLibraryTotal: 7,
      candidate,
      operation,
      result: { card: authoritative, created: false, queued: false },
      ...harness,
      now: () => '2026-08-09T00:00:05.000Z',
    });

    expect(harness.assignExistingDeck).toHaveBeenCalledWith(authoritative, 'Reading');
    expect(harness.touchExisting).toHaveBeenCalledWith(
      { ...authoritative, customDeck: 'Reading' },
      '2026-08-09T00:00:05.000Z',
    );
  });

  it('settles cloud persistence when the immutable shared backup belongs to another owner', async () => {
    const candidate = intakeCard('owner-conflict-candidate', 2, 3);
    const authoritative = intakeCard('owner-conflict-authoritative', 2, 8);
    const operation = pendingCreate(candidate);
    const harness = createSettlementHarness();
    mocks.mergeDeviceCardsStrict.mockRejectedValue(new DeviceBackupOwnerConflictError());
    mocks.deleteDeviceCardBackupIfNotNewerThan.mockResolvedValue(false);

    await settleIntakeCloudPersistence({
      ownerId: 'user-a',
      activeLibraryEpoch: 2,
      knownLibraryTotal: 7,
      candidate,
      operation,
      result: { card: authoritative, created: false, queued: false },
      ...harness,
    });

    expect(mocks.upsertMirroredCardIfNotOlderThan).toHaveBeenCalledWith(
      'user-a',
      authoritative,
    );
    expect(mocks.deleteDeviceCardBackupIfNotNewerThan).toHaveBeenCalledWith(
      'user-a',
      candidate.id,
      { libraryEpoch: 2, revision: 3 },
    );
    expect(harness.acknowledgeDevicePending).toHaveBeenCalledWith([operation]);
  });

  it('preserves a newer same-id generation while still acknowledging the settled create', async () => {
    const candidate = intakeCard('stable-id', 2, 3);
    const authoritative = intakeCard('stable-id', 2, 4);
    const newerDeviceCard = intakeCard('stable-id', 3, 1);
    const newerMirroredCard = intakeCard('stable-id', 3, 2);
    const operation = pendingCreate(candidate);
    let deviceCard = newerDeviceCard;
    let mirroredCard = newerMirroredCard;
    mocks.mergeDeviceCardsStrict.mockImplementation(async ([incoming]: CardData[]) => {
      if (
        (incoming.libraryEpoch ?? 0) > (deviceCard.libraryEpoch ?? 0)
        || (
          (incoming.libraryEpoch ?? 0) === (deviceCard.libraryEpoch ?? 0)
          && (incoming.revision ?? 0) >= (deviceCard.revision ?? 0)
        )
      ) deviceCard = incoming;
    });
    mocks.upsertMirroredCardIfNotOlderThan.mockImplementation(async (
      _userId: string,
      incoming: CardData,
    ) => {
      const canWrite = (incoming.libraryEpoch ?? 0) > (mirroredCard.libraryEpoch ?? 0)
        || (
          (incoming.libraryEpoch ?? 0) === (mirroredCard.libraryEpoch ?? 0)
          && (incoming.revision ?? 0) >= (mirroredCard.revision ?? 0)
        );
      if (canWrite) mirroredCard = incoming;
      return canWrite;
    });
    const harness = createSettlementHarness();

    await settleIntakeCloudPersistence({
      ownerId: 'user-a',
      activeLibraryEpoch: 2,
      knownLibraryTotal: 1,
      candidate,
      operation,
      result: { card: authoritative, created: false, queued: false },
      ...harness,
    });

    expect(mocks.deleteDeviceCardBackupIfNotNewerThan).not.toHaveBeenCalled();
    expect(mocks.deleteMirroredCardIfNotNewerThan).not.toHaveBeenCalled();
    expect(deviceCard).toBe(newerDeviceCard);
    expect(mirroredCard).toBe(newerMirroredCard);
    expect(harness.acknowledgeDevicePending).toHaveBeenCalledWith([operation]);
    expect(harness.touchExisting).not.toHaveBeenCalled();
    expect(harness.compensateOptimisticDuplicate).not.toHaveBeenCalled();
  });

  it('keeps the optimistic create pending when guarded cleanup fails', async () => {
    const candidate = intakeCard('candidate-id', 2, 3);
    const authoritative = intakeCard('authoritative-id', 2, 8);
    const operation = pendingCreate(candidate);
    const harness = createSettlementHarness();
    mocks.deleteMirroredCardIfNotNewerThan.mockRejectedValue(
      new Error('IndexedDB cleanup failed'),
    );

    await expect(settleIntakeCloudPersistence({
      ownerId: 'user-a',
      activeLibraryEpoch: 2,
      knownLibraryTotal: 1,
      candidate,
      operation,
      result: { card: authoritative, created: false, queued: false },
      ...harness,
    })).rejects.toThrow('IndexedDB cleanup failed');

    expect(mocks.mergeDeviceCardsStrict).toHaveBeenCalledWith([authoritative], 1, 'user-a');
    expect(mocks.upsertMirroredCardIfNotOlderThan).toHaveBeenCalledWith(
      'user-a',
      authoritative,
    );
    expect(harness.acknowledgeDevicePending).not.toHaveBeenCalled();
    expect(harness.touchExisting).not.toHaveBeenCalled();
    expect(harness.compensateOptimisticDuplicate).not.toHaveBeenCalled();
  });

  it('settles durable persistence for a stale session without running UI side effects', async () => {
    const candidate = intakeCard('candidate-id', 2, 3);
    const authoritative = intakeCard('authoritative-id', 2, 8);
    const operation = pendingCreate(candidate);
    const harness = createSettlementHarness({ canPublish: () => false });

    await settleIntakeCloudPersistence({
      ownerId: 'user-a',
      activeLibraryEpoch: 2,
      knownLibraryTotal: 1,
      candidate,
      operation,
      result: { card: authoritative, created: false, queued: false },
      ...harness,
    });

    expect(mocks.deleteDeviceCardBackupIfNotNewerThan).toHaveBeenCalled();
    expect(mocks.deleteMirroredCardIfNotNewerThan).toHaveBeenCalled();
    expect(mocks.mergeDeviceCardsStrict).toHaveBeenCalled();
    expect(mocks.upsertMirroredCardIfNotOlderThan).toHaveBeenCalled();
    expect(harness.acknowledgeDevicePending).toHaveBeenCalledWith([operation]);
    expect(harness.touchExisting).not.toHaveBeenCalled();
    expect(harness.notifyQueued).not.toHaveBeenCalled();
    expect(harness.compensateOptimisticDuplicate).not.toHaveBeenCalled();
  });

  it('does not publish a queued notification into a stale session', async () => {
    const candidate = intakeCard('candidate-id', 2, 3);
    const operation = pendingCreate(candidate);
    const harness = createSettlementHarness({ canPublish: () => false });

    await settleIntakeCloudPersistence({
      ownerId: 'user-a',
      activeLibraryEpoch: 2,
      knownLibraryTotal: 1,
      candidate,
      operation,
      result: { card: candidate, created: true, queued: true },
      ...harness,
    });

    expect(mocks.mergeDeviceCardsStrict).not.toHaveBeenCalled();
    expect(mocks.upsertMirroredCardIfNotOlderThan).not.toHaveBeenCalled();
    expect(harness.acknowledgeDevicePending).not.toHaveBeenCalled();
    expect(harness.notifyQueued).not.toHaveBeenCalled();
    expect(harness.compensateOptimisticDuplicate).not.toHaveBeenCalled();
  });

  it('blocks UI publication after an epoch advance or a newer same-id revision', () => {
    const authoritative = intakeCard('stable-id', 2, 4);
    const optimisticCard = intakeCard('stable-id', 2, 3);
    const operation = pendingCreate(optimisticCard);
    const baseline = {
      sessionIsCurrent: true,
      ownerId: 'user-a',
      activeLibraryEpoch: 2,
      operation,
      card: authoritative,
      optimisticCard,
      currentOwnerId: 'user-a',
    };

    expect(canPublishIntakeSettlement({
      ...baseline,
      currentLibraryEpoch: 2,
      currentCards: [authoritative],
    })).toBe(true);
    expect(canPublishIntakeSettlement({
      ...baseline,
      currentLibraryEpoch: 3,
      currentCards: [],
    })).toBe(false);
    expect(canPublishIntakeSettlement({
      ...baseline,
      currentLibraryEpoch: 2,
      currentCards: [intakeCard('stable-id', 2, 5)],
    })).toBe(false);
    expect(canPublishIntakeSettlement({
      ...baseline,
      card: intakeCard('authoritative-id', 2, 8),
      currentLibraryEpoch: 2,
      currentCards: [{ ...optimisticCard, revision: 4 }],
    })).toBe(false);
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
    expect(persistence.indexOf('active.publishCards(next)')).toBeLessThan(
      persistence.indexOf('void mapWithConcurrency(cloudSettlements'),
    );
    expect(persistence).toMatch(/created\.forEach\(active\.rememberPromoted\)/);
    expect(persistence).toMatch(/active\.resetCatalog\(\)/);
    expect(persistence).toMatch(
      /settle:\s*\(\)\s*=>\s*persistCardWithMirrorFallback\(/,
    );
    expect(persistence).not.toMatch(/await\s+createInCloud\(\)/);
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
    expect(source).toMatch(/queued:\s*Boolean\(current\.ownerId\)/);
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
