import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  publishPendingMutationSettlement,
  type DevicePendingOperation,
  type PendingMutationDisposition,
  type PendingMutationSettlement,
} from '../../lib/deviceSync';
import {
  GAMIFICATION_PENDING_CAPACITY_RELEASED_EVENT,
  PendingXpQueueFullError,
} from '../gamification/gamificationStorage';
import type { CardData } from '../../types/card';
import type { LearningPersistenceOptions, LearningPersistenceStats } from './learningPersistencePort';
import type { LearningStateMutation } from './learningStateController';
import type { LearningStatePersistencePort } from './useLearningState';

const mocks = vi.hoisted(() => ({
  acquireDevicePendingFlush: vi.fn(),
  clearDevicePending: vi.fn(),
  deleteAllCards: vi.fn(),
  incrementLibraryEpoch: vi.fn(),
  clearMirroredCards: vi.fn(),
  releaseDevicePendingFlush: vi.fn(),
  saveDeviceCards: vi.fn(),
  loadPendingMutationSettlements: vi.fn(),
  acknowledgePendingMutationSettlements: vi.fn(),
  settlements: [] as PendingMutationSettlement[],
}));

vi.mock('../../lib/deviceSync', async () => ({
  ...await vi.importActual<typeof import('../../lib/deviceSync')>('../../lib/deviceSync'),
  acquireDevicePendingFlush: mocks.acquireDevicePendingFlush,
  clearDevicePending: mocks.clearDevicePending,
  releaseDevicePendingFlush: mocks.releaseDevicePendingFlush,
  saveDeviceCards: mocks.saveDeviceCards,
  loadPendingMutationSettlements: mocks.loadPendingMutationSettlements,
  acknowledgePendingMutationSettlements: mocks.acknowledgePendingMutationSettlements,
}));
vi.mock('../../lib/cardRepository', () => ({
  deleteAllCards: mocks.deleteAllCards,
  incrementLibraryEpoch: mocks.incrementLibraryEpoch,
}));
vi.mock('../../lib/cardMirror', () => ({ clearMirroredCards: mocks.clearMirroredCards }));
vi.mock('../../lib/firebase', () => ({ db: { kind: 'database' }, isFirebaseConfigured: true }));
vi.mock('firebase/firestore', () => ({ doc: vi.fn(), setDoc: vi.fn() }));

import { useLearningStatePersistence } from './useLearningStatePersistence';

const card: CardData = {
  id: 'word-focus',
  word: 'focus',
  normalizedWord: 'focus',
  translation: 'tập trung',
  explanation: '',
  phonetic: '',
  emoji: '🎯',
  category: 'Study',
  audioUrl: null,
  imageUrl: null,
  bookmarked: false,
  difficulty: 'unrated',
  reviews: 0,
  revision: 3,
  libraryEpoch: 2,
};

const reviewAccounting = { version: 1, xp: { delta: 2 } } as const;
const settlementTime = '2026-08-09T00:00:02.000Z';
const pendingPatch: DevicePendingOperation = {
  type: 'patch', operation: 'patch', opId: 'review-1', cardId: card.id,
  fields: { difficulty: 'hard', reviews: 1 }, fieldMask: ['difficulty', 'reviews'],
  logicalOperations: [{ id: 'review-1', kind: 'patch', accounting: reviewAccounting }],
  baseRevision: 3, libraryEpoch: 2, updatedAt: '2026-08-09T00:00:00.000Z', ownerUserId: 'user-a',
};
const pendingDelete: DevicePendingOperation = {
  type: 'delete', operation: 'delete', opId: 'cleanup-1', cardId: card.id, fieldMask: [],
  logicalOperations: [{ id: 'cleanup-1', kind: 'delete' }],
  baseRevision: 3, libraryEpoch: 2, updatedAt: '2026-08-09T00:00:01.000Z', ownerUserId: 'user-a',
};
const reviewMutation: LearningStateMutation = {
  ownerKey: 'user-a', operationId: 'review-1', operation: 'review', intent: 'review', cardId: card.id,
  fields: { difficulty: 'hard', reviews: 1 }, fieldMask: ['difficulty', 'reviews'],
  baseRevision: 3, libraryEpoch: 2,
  publication: { kind: 'patch', cardId: card.id, fields: { difficulty: 'hard', reviews: 1 } },
};
const deleteMutation: LearningStateMutation = {
  ownerKey: 'user-a', operationId: 'cleanup-1', operation: 'delete', intent: 'delete', cardId: card.id,
  baseRevision: 3, libraryEpoch: 2, publication: { kind: 'delete', cardId: card.id },
};
const clearMutation: LearningStateMutation = {
  ownerKey: 'user-a', operationId: 'clear-1', operation: 'clear', intent: 'clear',
  publication: { kind: 'clear' },
};

function createHarness({
  verifiedEpoch = 2,
  sourceCard = card,
  patchOperations = [pendingPatch],
  deleteOperations = [pendingDelete],
  flushDeviceCards = vi.fn(async () => 'applied' as const),
  addXp = vi.fn(() => true),
}: {
  verifiedEpoch?: number | null;
  sourceCard?: CardData;
  patchOperations?: DevicePendingOperation[];
  deleteOperations?: DevicePendingOperation[];
  flushDeviceCards?: LearningPersistenceOptions['flushDeviceCards'];
  addXp?: LearningPersistenceOptions['addXp'];
} = {}) {
  const updateCloudStats = vi.fn<(update: (current: LearningPersistenceStats) => LearningPersistenceStats) => void>();
  const stageSettlement = (
    logicalOperationId: string,
    outcome: Exclude<PendingMutationDisposition, 'deferred'>,
  ): void => {
    const operation = [...patchOperations, ...deleteOperations].find(candidate =>
      candidate.logicalOperations?.some(logical => logical.id === logicalOperationId));
    const logical = operation?.logicalOperations?.find(candidate => candidate.id === logicalOperationId);
    if (!operation || !logical || !operation.ownerUserId) return;
    mocks.settlements.push({
      ownerUserId: operation.ownerUserId,
      logicalOperationId,
      kind: logical.kind,
      cardId: operation.type === 'upsert' ? operation.card.id : operation.cardId,
      outcome,
      settledAt: settlementTime,
      ...(logical.accounting ? { accounting: logical.accounting } : {}),
    });
  };
  const options: LearningPersistenceOptions = {
    ownerId: 'user-a', verifiedEpoch, knownLibraryTotal: 1,
    findCard: cardId => cardId === sourceCard.id ? sourceCard : undefined,
    canPublishPatch: () => true,
    patchDeviceCards: vi.fn(async () => patchOperations),
    removeDeviceCard: vi.fn(async () => deleteOperations),
    flushDeviceCards: vi.fn(async logicalOperationId => {
      const outcome = await flushDeviceCards(logicalOperationId);
      if (outcome !== 'deferred') stageSettlement(logicalOperationId, outcome);
      return outcome;
    }),
    acknowledgeDevicePending: vi.fn(async () => undefined),
    acceptVerifiedEpoch: vi.fn(), updateCloudStats,
    resetCloudState: vi.fn(), resetCloudPage: vi.fn(), refreshCloud: vi.fn(),
    setCloudUnavailable: vi.fn(), setMutationPending: vi.fn(), reportError: vi.fn(),
    addXp,
  };
  const captured: { persistence?: LearningStatePersistencePort } = {};
  function Harness() {
    captured.persistence = useLearningStatePersistence(options);
    return null;
  }
  renderToStaticMarkup(<Harness />);
  if (!captured.persistence) throw new Error('Persistence hook did not initialize.');
  return { persistence: captured.persistence, options, updateCloudStats };
}

const installMinimalReactDom = () => {
  const documentLike: Record<string, unknown> = {
    nodeType: 9,
    activeElement: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    defaultView: globalThis,
  };
  const container = {
    nodeType: 1,
    ownerDocument: documentLike,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    nodeName: 'DIV',
    tagName: 'DIV',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
  };
  documentLike.documentElement = container;
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('addEventListener', vi.fn());
  vi.stubGlobal('removeEventListener', vi.fn());
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', documentLike);
  vi.stubGlobal('HTMLIFrameElement', class HTMLIFrameElement {});
  vi.stubGlobal('HTMLElement', class HTMLElement {});
  vi.stubGlobal('Node', class Node {});
  vi.stubGlobal('BroadcastChannel', class BroadcastChannel {
    addEventListener() {}
    postMessage() {}
    close() {}
  });
  return container as unknown as Element;
};

async function createMountedHarness(
  input: Parameters<typeof createHarness>[0] = {},
) {
  const setup = createHarness(input);
  const captured: { persistence?: LearningStatePersistencePort } = {};
  function Harness() {
    captured.persistence = useLearningStatePersistence(setup.options);
    return null;
  }
  const root = createRoot(installMinimalReactDom());
  await act(async () => root.render(<Harness />));
  if (!captured.persistence) throw new Error('Mounted persistence hook did not initialize.');
  return {
    ...setup,
    persistence: captured.persistence,
    unmount: () => act(async () => root.unmount()),
  };
}

function publishDurableSettlement(settlement: PendingMutationSettlement): void {
  const existing = mocks.settlements.findIndex(candidate =>
    candidate.ownerUserId === settlement.ownerUserId
    && candidate.logicalOperationId === settlement.logicalOperationId);
  if (existing >= 0) mocks.settlements[existing] = settlement;
  else mocks.settlements.push(settlement);
  publishPendingMutationSettlement(settlement);
}

describe('useLearningStatePersistence replica coordination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.acquireDevicePendingFlush.mockResolvedValue(true);
    mocks.clearDevicePending.mockResolvedValue(undefined);
    mocks.clearMirroredCards.mockResolvedValue(undefined);
    mocks.releaseDevicePendingFlush.mockResolvedValue(undefined);
    mocks.saveDeviceCards.mockResolvedValue(undefined);
    mocks.settlements.length = 0;
    mocks.loadPendingMutationSettlements.mockImplementation(async (
      ownerId: string,
      maximum = 128,
    ) => mocks.settlements
      .filter(settlement => settlement.ownerUserId === ownerId)
      .slice(0, maximum));
    mocks.acknowledgePendingMutationSettlements.mockImplementation(async (
      ownerId: string,
      logicalOperationIds: readonly string[],
    ) => {
      const acknowledged = new Set(logicalOperationIds);
      const remaining = mocks.settlements.filter(settlement =>
        settlement.ownerUserId !== ownerId
        || !acknowledged.has(settlement.logicalOperationId));
      mocks.settlements.splice(0, mocks.settlements.length, ...remaining);
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the owner replica as the only browser patch and delete writer', () => {
    const source = readFileSync(fileURLToPath(new URL('./useLearningStatePersistence.ts', import.meta.url)), 'utf8');
    expect(source).toContain('flushDeviceCards');
    expect(source).not.toMatch(/applyCardPatchIfCurrent|deleteCardWithTombstone/);
    expect(source).not.toMatch(/applyCardPatchWithConflictRecovery|deleteCardWithConflictRecovery/);
  });

  it('stages a review before requesting the serialized replica flush', async () => {
    let releaseFlush: (() => void) | undefined;
    const flushDeviceCards = vi.fn(() => new Promise<PendingMutationDisposition>(resolve => {
      releaseFlush = () => resolve('applied');
    }));
    const harness = createHarness({ flushDeviceCards });

    const persistence = harness.persistence.persist(reviewMutation);
    await vi.waitFor(() => expect(flushDeviceCards).toHaveBeenCalledOnce());
    expect(harness.options.patchDeviceCards).toHaveBeenCalledWith(
      [{ card: { ...card, difficulty: 'hard', reviews: 1 }, fields: reviewMutation.fields }],
      1,
      'review-1',
      reviewAccounting,
    );
    expect(harness.updateCloudStats).not.toHaveBeenCalled();
    releaseFlush?.();

    await expect(persistence).resolves.toEqual({
      ownerKey: 'user-a', operationId: 'review-1', publication: reviewMutation.publication,
    });
    expect(harness.updateCloudStats).not.toHaveBeenCalled();
    expect(harness.options.refreshCloud).toHaveBeenCalledOnce();
    expect(harness.options.addXp).toHaveBeenCalledWith(2, {
      operationId: 'review-1',
      settledAt: settlementTime,
    });
    expect(mocks.acknowledgePendingMutationSettlements).toHaveBeenCalledWith(
      'user-a',
      ['review-1'],
    );
  });

  it('does not replay a staged patch after the coordinated flush and a newer remote write', async () => {
    const remoteWrites: string[] = [];
    const flushDeviceCards = vi.fn(async () => {
      remoteWrites.push('staged-X-acknowledged');
      remoteWrites.push('newer-Y-applied');
      return 'applied' as const;
    });
    const harness = createHarness({ flushDeviceCards });

    await harness.persistence.persist(reviewMutation);

    expect(remoteWrites).toEqual(['staged-X-acknowledged', 'newer-Y-applied']);
    expect(harness.options.patchDeviceCards).toHaveBeenCalledOnce();
    expect(flushDeviceCards).toHaveBeenCalledOnce();
  });

  it('routes revision-zero media through the replica so create reconciliation runs first', async () => {
    const localCard = { ...card, revision: 0 };
    const mutation: LearningStateMutation = {
      ownerKey: 'user-a', operationId: 'media-1', operation: 'patch', intent: 'patch', cardId: card.id,
      fields: { imageUrl: 'https://images.pexels.com/focus.jpeg' }, fieldMask: ['imageUrl'],
      baseRevision: 0, libraryEpoch: 2,
      publication: { kind: 'patch', cardId: card.id, fields: { imageUrl: 'https://images.pexels.com/focus.jpeg' } },
    };
    const flushDeviceCards = vi.fn(async () => 'applied' as const);
    const harness = createHarness({ sourceCard: localCard, flushDeviceCards });

    await expect(harness.persistence.persist(mutation)).resolves.toMatchObject({ publication: mutation.publication });
    expect(flushDeviceCards).toHaveBeenCalledOnce();
  });

  it('leaves staged patches for later sync until the signed-in epoch is verified', async () => {
    const flushDeviceCards = vi.fn(async () => 'applied' as const);
    const harness = createHarness({ verifiedEpoch: null, flushDeviceCards });

    await expect(harness.persistence.persist(reviewMutation)).resolves.toMatchObject({
      publication: reviewMutation.publication,
    });
    expect(flushDeviceCards).not.toHaveBeenCalled();
  });

  it('rejects a patch that durable staging did not return', async () => {
    const harness = createHarness({ patchOperations: [] });
    await expect(harness.persistence.persist(reviewMutation)).rejects.toThrow('could not be queued safely');
    expect(harness.options.flushDeviceCards).not.toHaveBeenCalled();
  });

  it.each([
    'discarded-stale-library-epoch',
    'discarded-missing',
    'discarded-superseded',
  ] as const)('suppresses review accounting after an immediate %s settlement', async outcome => {
    const harness = createHarness({
      flushDeviceCards: vi.fn(async () => outcome),
    });

    await expect(harness.persistence.persist(reviewMutation)).resolves.toEqual({
      ownerKey: 'user-a',
      operationId: 'review-1',
      publication: { kind: 'patch', cardId: card.id, fields: {} },
    });
    expect(harness.updateCloudStats).not.toHaveBeenCalled();
    expect(harness.options.addXp).not.toHaveBeenCalled();
  });

  it('applies deferred review accounting when another replica tab settles the logical operation', async () => {
    const harness = await createMountedHarness({
      flushDeviceCards: vi.fn(async () => 'deferred' as const),
    });
    try {
      await expect(harness.persistence.persist(reviewMutation)).resolves.toMatchObject({
        publication: reviewMutation.publication,
      });
      expect(harness.updateCloudStats).not.toHaveBeenCalled();
      expect(harness.options.addXp).not.toHaveBeenCalled();

      const settlement: PendingMutationSettlement = {
        ownerUserId: 'user-a',
        logicalOperationId: 'review-1',
        kind: 'patch',
        cardId: 'canonical-focus',
        outcome: 'applied',
        settledAt: settlementTime,
        accounting: reviewAccounting,
      };
      await act(async () => {
        publishDurableSettlement(settlement);
      });

      expect(harness.updateCloudStats).not.toHaveBeenCalled();
      expect(harness.options.refreshCloud).toHaveBeenCalledOnce();
      expect(harness.options.addXp).toHaveBeenCalledOnce();
      publishPendingMutationSettlement(settlement);
      await act(async () => undefined);
      expect(harness.options.addXp).toHaveBeenCalledOnce();
    } finally {
      await harness.unmount();
    }
  });

  it('drains a durable review settlement that already exists when the owner mounts', async () => {
    const settlement: PendingMutationSettlement = {
      ownerUserId: 'user-a',
      logicalOperationId: 'review-before-mount',
      kind: 'patch',
      cardId: card.id,
      outcome: 'applied',
      settledAt: settlementTime,
      accounting: reviewAccounting,
    };
    mocks.settlements.push(settlement);

    const harness = await createMountedHarness();
    try {
      await vi.waitFor(() => expect(harness.options.addXp).toHaveBeenCalledWith(2, {
        operationId: 'review-before-mount',
        settledAt: settlementTime,
      }));
      expect(harness.options.refreshCloud).toHaveBeenCalledOnce();
      expect(mocks.acknowledgePendingMutationSettlements).toHaveBeenCalledWith(
        'user-a',
        ['review-before-mount'],
      );
      expect(mocks.settlements).toEqual([]);
    } finally {
      await harness.unmount();
    }
  });

  it('acknowledges a settlement batch with one durable update', async () => {
    mocks.settlements.push(
      {
        ownerUserId: 'user-a', logicalOperationId: 'review-batch-1', kind: 'patch',
        cardId: card.id, outcome: 'applied', settledAt: settlementTime,
        accounting: reviewAccounting,
      },
      {
        ownerUserId: 'user-a', logicalOperationId: 'delete-batch-2', kind: 'delete',
        cardId: card.id, outcome: 'discarded-missing', settledAt: settlementTime,
      },
      {
        ownerUserId: 'user-a', logicalOperationId: 'review-batch-3', kind: 'patch',
        cardId: card.id, outcome: 'applied', settledAt: settlementTime,
        accounting: reviewAccounting,
      },
    );

    const harness = await createMountedHarness();
    try {
      await vi.waitFor(() => expect(mocks.settlements).toEqual([]));
      expect(harness.options.addXp).toHaveBeenCalledTimes(2);
      expect(mocks.acknowledgePendingMutationSettlements).toHaveBeenCalledOnce();
      expect(mocks.acknowledgePendingMutationSettlements).toHaveBeenCalledWith(
        'user-a',
        ['review-batch-1', 'delete-batch-2', 'review-batch-3'],
      );
    } finally {
      await harness.unmount();
    }
  });

  it('drains retained settlements in bounded pages', async () => {
    mocks.settlements.push(...Array.from({ length: 130 }, (_, index) => ({
      ownerUserId: 'user-a',
      logicalOperationId: `paged-delete-${index}`,
      kind: 'delete' as const,
      cardId: card.id,
      outcome: 'discarded-missing' as const,
      settledAt: new Date(index + 1).toISOString(),
    })));

    const harness = await createMountedHarness();
    try {
      await vi.waitFor(() => expect(mocks.settlements).toEqual([]));
      expect(mocks.acknowledgePendingMutationSettlements).toHaveBeenCalledTimes(2);
      expect(mocks.acknowledgePendingMutationSettlements.mock.calls[0]?.[1]).toHaveLength(128);
      expect(mocks.acknowledgePendingMutationSettlements.mock.calls[1]?.[1]).toHaveLength(2);
    } finally {
      await harness.unmount();
    }
  });

  it('acknowledges only the durable prefix when XP storage fails', async () => {
    const prefix: PendingMutationSettlement = {
      ownerUserId: 'user-a', logicalOperationId: 'delete-prefix', kind: 'delete',
      cardId: card.id, outcome: 'discarded-missing', settledAt: settlementTime,
    };
    const blocked: PendingMutationSettlement = {
      ownerUserId: 'user-a', logicalOperationId: 'review-blocked', kind: 'patch',
      cardId: card.id, outcome: 'applied', settledAt: settlementTime,
      accounting: reviewAccounting,
    };
    const later: PendingMutationSettlement = {
      ownerUserId: 'user-a', logicalOperationId: 'delete-later', kind: 'delete',
      cardId: card.id, outcome: 'discarded-missing', settledAt: settlementTime,
    };
    mocks.settlements.push(prefix, blocked, later);

    const harness = await createMountedHarness({ addXp: vi.fn(() => false) });
    try {
      await vi.waitFor(() => expect(harness.options.reportError).toHaveBeenCalledWith(
        'A synced review reward is waiting for safe browser storage. Free browser storage or reload to retry.',
      ));
      expect(mocks.acknowledgePendingMutationSettlements).toHaveBeenCalledOnce();
      expect(mocks.acknowledgePendingMutationSettlements).toHaveBeenCalledWith(
        'user-a',
        ['delete-prefix'],
      );
      expect(mocks.settlements).toEqual([blocked, later]);
    } finally {
      await harness.unmount();
    }
  });

  it('acknowledges the durable prefix when XP capacity blocks a later settlement', async () => {
    const first: PendingMutationSettlement = {
      ownerUserId: 'user-a', logicalOperationId: 'review-capacity-prefix', kind: 'patch',
      cardId: card.id, outcome: 'applied', settledAt: settlementTime,
      accounting: reviewAccounting,
    };
    const blocked: PendingMutationSettlement = {
      ...first,
      logicalOperationId: 'review-capacity-blocked',
    };
    const later: PendingMutationSettlement = {
      ownerUserId: 'user-a', logicalOperationId: 'delete-capacity-later', kind: 'delete',
      cardId: card.id, outcome: 'discarded-missing', settledAt: settlementTime,
    };
    mocks.settlements.push(first, blocked, later);
    const addXp = vi.fn()
      .mockReturnValueOnce(true)
      .mockImplementationOnce(() => { throw new PendingXpQueueFullError(); });

    const harness = await createMountedHarness({ addXp });
    try {
      await vi.waitFor(() => expect(harness.options.reportError).toHaveBeenCalledWith(
        'Synced review rewards are waiting for XP sync capacity. They remain safe and will retry after queued XP is stored.',
      ));
      expect(mocks.acknowledgePendingMutationSettlements).toHaveBeenCalledWith(
        'user-a',
        ['review-capacity-prefix'],
      );
      expect(mocks.settlements).toEqual([blocked, later]);

      addXp.mockReturnValue(true);
      const capacityListener = vi.mocked(globalThis.addEventListener).mock.calls.find(
        ([eventName]) => eventName === GAMIFICATION_PENDING_CAPACITY_RELEASED_EVENT,
      )?.[1] as EventListener | undefined;
      expect(capacityListener).toBeDefined();
      await act(async () => {
        capacityListener?.({ detail: { ownerId: 'user-a' } } as unknown as Event);
      });
      await vi.waitFor(() => expect(mocks.settlements).toEqual([]));
      expect(mocks.acknowledgePendingMutationSettlements).toHaveBeenLastCalledWith(
        'user-a',
        ['review-capacity-blocked', 'delete-capacity-later'],
      );
    } finally {
      await harness.unmount();
    }
  });

  it('ignores settlement wake-ups for another owner', async () => {
    const harness = await createMountedHarness();
    try {
      await act(async () => undefined);
      vi.clearAllMocks();
      await act(async () => {
        publishDurableSettlement({
          ownerUserId: 'user-b',
          logicalOperationId: 'review-other-owner',
          kind: 'patch',
          cardId: card.id,
          outcome: 'applied',
          settledAt: settlementTime,
          accounting: reviewAccounting,
        });
      });

      expect(harness.options.refreshCloud).not.toHaveBeenCalled();
      expect(harness.options.addXp).not.toHaveBeenCalled();
      expect(mocks.acknowledgePendingMutationSettlements).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  it('keeps a settlement durable until keyed XP storage succeeds, then retries idempotently', async () => {
    const harness = await createMountedHarness();
    vi.mocked(harness.options.addXp).mockReturnValue(false);
    const settlement: PendingMutationSettlement = {
      ownerUserId: 'user-a',
      logicalOperationId: 'review-storage-retry',
      kind: 'patch',
      cardId: card.id,
      outcome: 'applied',
      settledAt: settlementTime,
      accounting: reviewAccounting,
    };
    try {
      await act(async () => {
        publishDurableSettlement(settlement);
      });
      await vi.waitFor(() => expect(harness.options.reportError).toHaveBeenCalledWith(
        'A synced review reward is waiting for safe browser storage. Free browser storage or reload to retry.',
      ));
      expect(mocks.acknowledgePendingMutationSettlements).not.toHaveBeenCalled();
      expect(mocks.settlements).toEqual([settlement]);

      vi.mocked(harness.options.addXp).mockReturnValue(true);
      await act(async () => {
        publishPendingMutationSettlement(settlement);
      });
      await vi.waitFor(() => expect(mocks.acknowledgePendingMutationSettlements).toHaveBeenCalledWith(
        'user-a',
        ['review-storage-retry'],
      ));
      expect(harness.options.addXp).toHaveBeenCalledTimes(2);
      expect(harness.options.addXp).toHaveBeenNthCalledWith(1, 2, {
        operationId: 'review-storage-retry',
        settledAt: settlementTime,
      });
      expect(harness.options.addXp).toHaveBeenNthCalledWith(2, 2, {
        operationId: 'review-storage-retry',
        settledAt: settlementTime,
      });
      expect(mocks.settlements).toEqual([]);
    } finally {
      await harness.unmount();
    }
  });

  it('does not apply deferred review accounting after a terminal settlement from another tab', async () => {
    const harness = await createMountedHarness({
      flushDeviceCards: vi.fn(async () => 'deferred' as const),
    });
    try {
      await harness.persistence.persist(reviewMutation);
      await act(async () => {
        publishDurableSettlement({
          ownerUserId: 'user-a',
          logicalOperationId: 'review-1',
          kind: 'patch',
          cardId: card.id,
          outcome: 'discarded-stale-library-epoch',
          settledAt: settlementTime,
          accounting: reviewAccounting,
        });
      });
      expect(harness.updateCloudStats).not.toHaveBeenCalled();
      expect(harness.options.addXp).not.toHaveBeenCalled();
      expect(mocks.acknowledgePendingMutationSettlements).toHaveBeenCalledWith('user-a', ['review-1']);
    } finally {
      await harness.unmount();
    }
  });

  it('consumes a settlement that arrives before deferred accounting registration', async () => {
    const harness = await createMountedHarness({
      flushDeviceCards: vi.fn(async operationId => {
        publishDurableSettlement({
          ownerUserId: 'user-a',
          logicalOperationId: operationId,
          kind: 'patch',
          cardId: card.id,
          outcome: 'applied',
          settledAt: settlementTime,
          accounting: reviewAccounting,
        });
        return 'deferred' as const;
      }),
    });
    try {
      await harness.persistence.persist(reviewMutation);
      await vi.waitFor(() => expect(harness.options.addXp).toHaveBeenCalledOnce());
      expect(harness.updateCloudStats).not.toHaveBeenCalled();
    } finally {
      await harness.unmount();
    }
  });

  it('stages deletes, flushes through the replica, and applies optimistic aggregate effects once', async () => {
    const harness = createHarness();
    await expect(harness.persistence.persist(deleteMutation)).resolves.toEqual({
      ownerKey: 'user-a', operationId: 'cleanup-1', publication: deleteMutation.publication,
    });
    expect(harness.options.removeDeviceCard).toHaveBeenCalledWith(card.id, {
      libraryEpoch: 2,
      baseRevisions: { [card.id]: 3 },
      logicalOperationId: 'cleanup-1',
    });
    expect(harness.options.flushDeviceCards).toHaveBeenCalledOnce();
    expect(harness.updateCloudStats).not.toHaveBeenCalled();
    expect(harness.options.refreshCloud).toHaveBeenCalledOnce();
    expect(mocks.acknowledgePendingMutationSettlements).toHaveBeenCalledWith('user-a', ['cleanup-1']);
  });

  it('suppresses delete aggregates after an immediate stale-library settlement', async () => {
    const harness = createHarness({
      flushDeviceCards: vi.fn(async () => 'discarded-stale-library-epoch' as const),
    });

    await expect(harness.persistence.persist(deleteMutation)).resolves.toEqual({
      ownerKey: 'user-a',
      operationId: 'cleanup-1',
      publication: { kind: 'patch', cardId: card.id, fields: {} },
    });
    expect(harness.updateCloudStats).not.toHaveBeenCalled();
    expect(harness.options.addXp).not.toHaveBeenCalled();
    expect(mocks.acknowledgePendingMutationSettlements).toHaveBeenCalledWith('user-a', ['cleanup-1']);
  });

  it('passes the advanced epoch to card deletion during a cloud clear', async () => {
    mocks.incrementLibraryEpoch.mockResolvedValue(4);
    const harness = createHarness();
    await expect(harness.persistence.persist(clearMutation)).resolves.toEqual({
      ownerKey: 'user-a', operationId: 'clear-1', publication: clearMutation.publication,
    });
    expect(mocks.clearDevicePending).toHaveBeenCalledWith('user-a');
    expect(mocks.deleteAllCards).toHaveBeenCalledWith(expect.anything(), 'user-a', 4);
    expect(mocks.releaseDevicePendingFlush).toHaveBeenCalledWith('user-a');
  });
});
