import { describe, expect, it, vi } from 'vitest';
import type { CardData } from '../../types/card';
import {
  createLibraryReplica,
} from '../librarySession/libraryReplica';
import { createCardIntakePipeline } from './cardIntakePipeline';
import type { CardIntakePortOptions } from './cardIntakePortContract';

const mocks = vi.hoisted(() => ({
  loadDevicePending: vi.fn(),
  queueDeviceUpserts: vi.fn(),
  upsertMirroredCardBatch: vi.fn(),
}));

vi.mock('../../lib/firebase', () => ({ db: null, isFirebaseConfigured: false }));

vi.mock('../../lib/deviceSync', async () => {
  const actual = await vi.importActual<typeof import('../../lib/deviceSync')>('../../lib/deviceSync');
  return {
    ...actual,
    loadDevicePending: mocks.loadDevicePending,
    queueDeviceUpserts: mocks.queueDeviceUpserts,
  };
});

vi.mock('../../lib/cardMirror', async () => {
  const actual = await vi.importActual<typeof import('../../lib/cardMirror')>('../../lib/cardMirror');
  return {
    ...actual,
    upsertMirroredCardBatch: mocks.upsertMirroredCardBatch,
  };
});

const card = (id: string): CardData => ({
  id,
  word: id,
  normalizedWord: id,
  translation: `${id}-vi`,
  explanation: '',
  phonetic: '',
  emoji: '📝',
  category: 'General',
  audioUrl: null,
  imageUrl: null,
  revision: 1,
  libraryEpoch: 3,
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
};

const createContext = (
  libraryReplica: CardIntakePortOptions['libraryReplica'],
): CardIntakePortOptions => ({
  ownerId: 'owner-a',
  libraryEpoch: 3,
  knownLibraryTotal: 0,
  cloudStats: {
    total: 0,
    reviewed: 0,
    easy: 0,
    good: 0,
    hard: 0,
    unrated: 0,
    bookmarked: 0,
    due: 0,
    legacyUnindexed: 0,
  },
  cardsPerPage: 9,
  getCards: () => [],
  publishCards: vi.fn(),
  libraryReplica,
  patchCard: vi.fn(async () => undefined),
  hydrateExisting: vi.fn(),
  rememberPromoted: vi.fn(),
  resetCatalog: vi.fn(),
  resetCloudPage: vi.fn(),
  updateCloudStats: vi.fn(),
  updateCloudTotal: vi.fn(),
  updateCategoryFacets: vi.fn(async () => undefined),
  setCloudUnavailable: vi.fn(),
  notify: vi.fn(),
  focusLibrary: vi.fn(),
  addXp: vi.fn(),
});

describe('Card Intake + Library Replica integration', () => {
  it('drops a stale replica receipt before optimistic publication or XP', async () => {
    const mirrorWrite = deferred<void>();
    let replicaEpoch = 3;
    mocks.loadDevicePending.mockResolvedValue([]);
    mocks.queueDeviceUpserts.mockResolvedValue([]);
    mocks.upsertMirroredCardBatch.mockReturnValue(mirrorWrite.promise);
    const replica = createLibraryReplica({
      ownerId: 'owner-a',
      getEpoch: () => ({ userId: 'owner-a', value: replicaEpoch }),
      getCards: () => [],
      getEvents: () => ({
        advanceCard: vi.fn(),
        removeCard: vi.fn(),
        findPracticeCard: vi.fn(),
        advancePracticeCard: vi.fn(),
        removePracticeCard: vi.fn(),
        resetPage: vi.fn(),
        refreshCloud: vi.fn(),
        setCloudAvailable: vi.fn(),
        setCloudTotal: vi.fn(),
        reportError: vi.fn(),
        notify: vi.fn(),
        verifyEpoch: vi.fn(),
      }),
      getMirrorTotals: () => ({ cloudTotal: 0, cloudStatsTotal: 0 }),
      isOwnerCurrent: () => true,
      onError: vi.fn(),
      onPendingCount: vi.fn(),
      onSyncing: vi.fn(),
    });
    const context = createContext(replica);
    const pipeline = createCardIntakePipeline({ getContext: () => context });
    const persistence = pipeline.persistCards([card('stale-integrated')], 'generate');

    await vi.waitFor(() => expect(mocks.upsertMirroredCardBatch).toHaveBeenCalledOnce());
    replicaEpoch = 4;
    mirrorWrite.resolve();

    await expect(persistence).resolves.toEqual([]);
    expect(context.publishCards).not.toHaveBeenCalled();
    expect(context.addXp).not.toHaveBeenCalled();
    expect(mocks.queueDeviceUpserts).not.toHaveBeenCalled();
  });
});
