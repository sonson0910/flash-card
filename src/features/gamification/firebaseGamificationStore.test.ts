import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_APPLIED_XP_OPERATION_IDS,
  MAX_GAMIFICATION_HISTORY_ENTRIES,
  MAX_PENDING_XP_OPERATIONS,
  MAX_XP_CLIENT_STREAMS,
  MAX_XP_OPERATIONS_PER_SAVE,
} from './gamificationModel';
import type { StoredGamificationSnapshot } from './gamificationStorage';

interface DocumentReference {
  path: string;
}

const firestore = vi.hoisted(() => ({
  doc: vi.fn((_database: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
  getDoc: vi.fn(),
  runTransaction: vi.fn(),
}));

vi.mock('firebase/firestore', () => firestore);
vi.mock('../../lib/firebase', () => ({ db: null, isFirebaseConfigured: false }));

import {
  createFirebaseGamificationStore,
  XpClientStreamLimitError,
  XpSequenceGapError,
} from './firebaseGamificationStore';
import { createGamificationStoreController } from './gamificationStore';

const fallback: StoredGamificationSnapshot = {
  streak: 2,
  xp: 120,
  lastActive: 'Sat Aug 08 2026',
  history: { 'Aug 8, 2026': 120 },
};

const documents = new Map<string, Record<string, unknown>>();
let transactionTail: Promise<void>;

const snapshotAt = (reference: DocumentReference) => {
  const value = documents.get(reference.path);
  return {
    exists: () => value !== undefined,
    data: () => ({ ...(value ?? {}) }),
  };
};

const installFirestoreHarness = () => {
  transactionTail = Promise.resolve();
  firestore.getDoc.mockImplementation(async (reference: DocumentReference) => snapshotAt(reference));
  firestore.runTransaction.mockImplementation((
    _database: unknown,
    update: (transaction: {
      get(reference: DocumentReference): Promise<ReturnType<typeof snapshotAt>>;
      set(
        reference: DocumentReference,
        value: Record<string, unknown>,
        options?: { merge?: boolean },
      ): void;
    }) => Promise<unknown>,
  ) => {
    let resolveResult!: (value: unknown) => void;
    let rejectResult!: (reason: unknown) => void;
    const result = new Promise((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    const run = transactionTail.then(async () => {
      const writes: Array<{
        reference: DocumentReference;
        value: Record<string, unknown>;
        merge: boolean;
      }> = [];
      const committed = await update({
        get: async reference => snapshotAt(reference),
        set: (reference, value, options) => {
          writes.push({ reference, value, merge: options?.merge === true });
        },
      });
      for (const write of writes) {
        const previous = documents.get(write.reference.path) ?? {};
        documents.set(
          write.reference.path,
          write.merge ? { ...previous, ...write.value } : { ...write.value },
        );
      }
      resolveResult(committed);
    }).catch(rejectResult);
    transactionTail = run.then(() => undefined, () => undefined);
    return result;
  });
};

const statsPath = 'users/user-a/profile/stats';
const historyPath = 'users/user-a/profile/xp_history';

describe('Firebase gamification store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    documents.clear();
    installFirestoreHarness();
  });

  it('loads missing documents as a pure local fallback without seeding cloud', async () => {
    const store = createFirebaseGamificationStore({} as never);

    await expect(store.load('user-b', fallback)).resolves.toEqual({
      source: 'local-fallback',
      snapshot: fallback,
    });

    expect(firestore.getDoc).not.toHaveBeenCalled();
    expect(firestore.runTransaction).toHaveBeenCalledTimes(1);
    expect(documents).toHaveLength(0);
  });

  it('preserves local history when the cloud stats document survives alone', async () => {
    documents.set(statsPath, {
      streak: 7,
      xp: 640,
      lastActive: 'Sun Aug 09 2026',
      appliedXpOperationIds: ['operation-cloud'],
    });
    const store = createFirebaseGamificationStore({} as never);

    await expect(store.load('user-a', fallback)).resolves.toEqual({
      source: 'cloud',
      cloudDocuments: { stats: true, history: false },
      snapshot: {
        streak: 7,
        xp: 640,
        lastActive: 'Sun Aug 09 2026',
        history: fallback.history,
        appliedOperationIds: ['operation-cloud'],
      },
    });
  });

  it('preserves cloud history when the cloud history document survives alone', async () => {
    documents.set(historyPath, {
      'Aug 7, 2026': 80,
      'Aug 8, 2026': 160,
    });
    const store = createFirebaseGamificationStore({} as never);

    await expect(store.load('user-a', fallback)).resolves.toEqual({
      source: 'cloud',
      cloudDocuments: { stats: false, history: true },
      snapshot: {
        streak: fallback.streak,
        xp: fallback.xp,
        lastActive: fallback.lastActive,
        history: {
          'Aug 7, 2026': 80,
          'Aug 8, 2026': 160,
        },
        appliedOperationIds: [],
      },
    });
  });

  it('loads stats and history from one consistent cloud snapshot', async () => {
    documents.set(statsPath, {
      streak: 2,
      xp: 100,
      lastActive: 'Sun Aug 09 2026',
      appliedXpOperationIds: [],
    });
    documents.set(historyPath, { 'Aug 9, 2026': 100 });
    firestore.getDoc.mockImplementation(async (reference: DocumentReference) => {
      const snapshot = snapshotAt(reference);
      if (reference.path === statsPath) {
        documents.set(statsPath, {
          streak: 3,
          xp: 200,
          lastActive: 'Mon Aug 10 2026',
          appliedXpOperationIds: [],
        });
        documents.set(historyPath, { 'Aug 10, 2026': 200 });
      }
      return snapshot;
    });
    const store = createFirebaseGamificationStore({} as never);

    await expect(store.load('user-a', fallback)).resolves.toMatchObject({
      source: 'cloud',
      snapshot: {
        xp: 100,
        history: { 'Aug 9, 2026': 100 },
      },
    });
  });

  it('validates numeric, history, date, and applied-operation metadata from Firestore', async () => {
    documents.set(statsPath, {
      streak: Number.POSITIVE_INFINITY,
      xp: Number.POSITIVE_INFINITY,
      lastActive: 'not-a-date',
      appliedXpOperationIds: ['valid-id', '', 7, 'x'.repeat(200)],
    });
    documents.set(historyPath, {
      'Aug 8, 2026': Number.POSITIVE_INFINITY,
      'Aug 9, 2026': 5,
      __proto__: 9,
    });
    const store = createFirebaseGamificationStore({} as never);

    await expect(store.load('user-a', fallback)).resolves.toEqual({
      source: 'cloud',
      snapshot: {
        streak: 0,
        xp: 0,
        lastActive: null,
        history: { 'Aug 9, 2026': 5 },
        appliedOperationIds: ['valid-id'],
      },
    });
  });

  it('accumulates positive and negative operations from two independent controllers', async () => {
    documents.set(statsPath, {
      streak: 2,
      xp: 100,
      lastActive: 'Sun Aug 09 2026',
      appliedXpOperationIds: [],
    });
    documents.set(historyPath, { 'Aug 9, 2026': 100 });
    const store = createFirebaseGamificationStore({} as never);
    const controllerA = createGamificationStoreController({
      store,
      activeOwner: () => 'user-a',
    });
    const controllerB = createGamificationStoreController({
      store,
      activeOwner: () => 'user-a',
    });

    const [savedA, savedB] = await Promise.all([
      controllerA.save('user-a', {
        streak: 2,
        xp: 110,
        lastActive: 'Sun Aug 09 2026',
        history: { 'Aug 9, 2026': 110 },
        pendingOperations: [{
          id: 'xp2:client-a:1',
          clientId: 'client-a',
          sequence: 1,
          delta: 10,
          day: 'Aug 9, 2026',
        }],
      }),
      controllerB.save('user-a', {
        streak: 2,
        xp: 80,
        lastActive: 'Sun Aug 09 2026',
        history: { 'Aug 9, 2026': 80 },
        pendingOperations: [{
          id: 'xp2:client-b:1',
          clientId: 'client-b',
          sequence: 1,
          delta: -20,
          day: 'Aug 9, 2026',
        }],
      }),
    ]);

    expect(savedA.status).toBe('saved');
    expect(savedB).toMatchObject({
      status: 'saved',
      snapshot: { xp: 90, history: { 'Aug 9, 2026': 90 } },
    });
    expect(documents.get(statsPath)).toMatchObject({
      xp: 90,
      appliedXpOperationIds: ['xp2:client-a:1', 'xp2:client-b:1'],
      appliedXpSequenceByClient: { 'client-a': 1, 'client-b': 1 },
    });
    expect(documents.get(historyPath)).toEqual({ 'Aug 9, 2026': 90 });
    expect(firestore.runTransaction).toHaveBeenCalledTimes(2);
  });

  it('persists at most 730 history entries when a pending operation adds a new day', async () => {
    const cloudHistory = Object.fromEntries(Array.from(
      { length: MAX_GAMIFICATION_HISTORY_ENTRIES },
      (_, index) => [`day-${index.toString().padStart(4, '0')}`, index + 1],
    ));
    documents.set(statsPath, {
      streak: 2,
      xp: 100,
      lastActive: 'Sun Aug 09 2026',
      appliedXpOperationIds: [],
    });
    documents.set(historyPath, cloudHistory);
    const store = createFirebaseGamificationStore({} as never);

    const saved = await store.save('user-a', {
      streak: 2,
      xp: 105,
      lastActive: 'Sun Aug 09 2026',
      history: cloudHistory,
      pendingOperations: [{ id: 'operation-new-day', delta: 5, day: 'day-0730' }],
    });

    const persistedHistory = documents.get(historyPath);
    expect(Object.keys(saved.snapshot.history)).toHaveLength(MAX_GAMIFICATION_HISTORY_ENTRIES);
    expect(Object.keys(persistedHistory ?? {})).toHaveLength(MAX_GAMIFICATION_HISTORY_ENTRIES);
    expect(persistedHistory).not.toHaveProperty('day-0000');
    expect(Object.keys(persistedHistory ?? {})[0]).toBe('day-0001');
    expect(persistedHistory).toHaveProperty('day-0730', 5);
  });

  it('seeds missing cloud history from the materialized local history without double-applying XP', async () => {
    documents.set(statsPath, {
      streak: 2,
      xp: 100,
      lastActive: 'Sun Aug 09 2026',
      appliedXpOperationIds: [],
      appliedXpSequenceByClient: {},
    });
    const store = createFirebaseGamificationStore({} as never);

    await expect(store.save('user-a', {
      streak: 2,
      xp: 110,
      lastActive: 'Sun Aug 09 2026',
      history: { 'Aug 8, 2026': 40, 'Aug 9, 2026': 70 },
      pendingOperations: [{
        id: 'xp2:client-a:1',
        clientId: 'client-a',
        sequence: 1,
        delta: 10,
        day: 'Aug 9, 2026',
      }],
    })).resolves.toMatchObject({
      snapshot: {
        xp: 110,
        history: { 'Aug 8, 2026': 40, 'Aug 9, 2026': 70 },
      },
    });
    expect(documents.get(historyPath)).toEqual({
      'Aug 8, 2026': 40,
      'Aug 9, 2026': 70,
    });
  });

  it('preserves surviving cloud history when seeding missing stats from a stale local snapshot', async () => {
    documents.set(historyPath, {
      'Aug 8, 2026': 120,
      'Aug 9, 2026': 80,
    });
    const store = createFirebaseGamificationStore({} as never);

    await expect(store.save('user-a', {
      streak: 2,
      xp: 120,
      lastActive: 'Sat Aug 08 2026',
      history: { 'Aug 8, 2026': 20 },
    })).resolves.toMatchObject({
      snapshot: {
        xp: 120,
        history: {
          'Aug 8, 2026': 120,
          'Aug 9, 2026': 80,
        },
      },
    });
    expect(documents.get(historyPath)).toEqual({
      'Aug 8, 2026': 120,
      'Aug 9, 2026': 80,
    });
  });

  it('adds pending XP to surviving cloud history when seeding missing stats', async () => {
    documents.set(historyPath, { 'Aug 9, 2026': 100 });
    const store = createFirebaseGamificationStore({} as never);

    await expect(store.save('user-a', {
      streak: 2,
      xp: 110,
      lastActive: 'Sun Aug 09 2026',
      history: { 'Aug 9, 2026': 10 },
      pendingOperations: [{
        id: 'xp2:client-a:1',
        clientId: 'client-a',
        sequence: 1,
        delta: 10,
        day: 'Aug 9, 2026',
      }],
    })).resolves.toMatchObject({
      snapshot: {
        xp: 110,
        history: { 'Aug 9, 2026': 110 },
      },
      appliedOperationIds: ['xp2:client-a:1'],
    });
    expect(documents.get(historyPath)).toEqual({ 'Aug 9, 2026': 110 });
  });

  it('makes retrying the same operation idempotent and bounds applied operation IDs', async () => {
    const oldIds = Array.from(
      { length: MAX_APPLIED_XP_OPERATION_IDS },
      (_, index) => `old-operation-${index}`,
    );
    documents.set(statsPath, {
      streak: 2,
      xp: 100,
      lastActive: 'Sun Aug 09 2026',
      appliedXpOperationIds: oldIds,
    });
    documents.set(historyPath, { 'Aug 9, 2026': 100 });
    const store = createFirebaseGamificationStore({} as never);
    const request: StoredGamificationSnapshot = {
      streak: 2,
      xp: 110,
      lastActive: 'Sun Aug 09 2026',
      history: { 'Aug 9, 2026': 110 },
      pendingOperations: [{ id: 'operation-retry', delta: 10, day: 'Aug 9, 2026' }],
    };

    await expect(store.save('user-a', request)).resolves.toMatchObject({
      snapshot: { xp: 110 },
      appliedOperationIds: ['operation-retry'],
    });
    await expect(store.save('user-a', request)).resolves.toMatchObject({
      snapshot: { xp: 110 },
      appliedOperationIds: ['operation-retry'],
    });

    const appliedIds = documents.get(statsPath)?.appliedXpOperationIds as string[];
    expect(appliedIds).toHaveLength(MAX_APPLIED_XP_OPERATION_IDS);
    expect(appliedIds).not.toContain('old-operation-0');
    expect(appliedIds.at(-1)).toBe('operation-retry');
    expect(documents.get(historyPath)).toEqual({ 'Aug 9, 2026': 110 });
  });

  it('rejects a delayed structured operation after its recent ID has been evicted', async () => {
    const recentIds = Array.from(
      { length: MAX_APPLIED_XP_OPERATION_IDS },
      (_, index) => `recent-operation-${index}`,
    );
    documents.set(statsPath, {
      streak: 2,
      xp: 100,
      lastActive: 'Sun Aug 09 2026',
      appliedXpOperationIds: recentIds,
      appliedXpSequenceByClient: { 'client-a': 41 },
    });
    documents.set(historyPath, { 'Aug 9, 2026': 100 });
    const store = createFirebaseGamificationStore({} as never);
    const delayed: StoredGamificationSnapshot = {
      streak: 2,
      xp: 110,
      lastActive: 'Sun Aug 09 2026',
      history: { 'Aug 9, 2026': 110 },
      pendingOperations: [{
        id: 'xp2:client-a:41',
        clientId: 'client-a',
        sequence: 41,
        delta: 10,
        day: 'Aug 9, 2026',
      }],
    };

    await expect(store.save('user-a', delayed)).resolves.toMatchObject({
      snapshot: {
        xp: 100,
        appliedOperationSequenceByClient: { 'client-a': 41 },
      },
      appliedOperationIds: ['xp2:client-a:41'],
    });

    expect(documents.get(statsPath)).toMatchObject({
      xp: 100,
      appliedXpSequenceByClient: { 'client-a': 41 },
    });
    expect(documents.get(historyPath)).toEqual({ 'Aug 9, 2026': 100 });
  });

  it('migrates a recently applied legacy operation without replaying its delta', async () => {
    documents.set(statsPath, {
      streak: 2,
      xp: 100,
      lastActive: 'Sun Aug 09 2026',
      appliedXpOperationIds: ['legacy-operation'],
      appliedXpSequenceByClient: {},
    });
    documents.set(historyPath, { 'Aug 9, 2026': 100 });
    const store = createFirebaseGamificationStore({} as never);

    await expect(store.save('user-a', {
      ...fallback,
      pendingOperations: [{
        id: 'xp2:migration-client:1',
        clientId: 'migration-client',
        sequence: 1,
        legacyId: 'legacy-operation',
        delta: 10,
        day: 'Aug 9, 2026',
      }],
    })).resolves.toMatchObject({
      snapshot: {
        xp: 100,
        appliedOperationSequenceByClient: { 'migration-client': 1 },
      },
      appliedOperationIds: ['xp2:migration-client:1'],
    });
    expect(documents.get(historyPath)).toEqual({ 'Aug 9, 2026': 100 });
  });

  it('keeps a sequence gap pending until every earlier operation is applied', async () => {
    documents.set(statsPath, {
      streak: 2,
      xp: 100,
      lastActive: 'Sun Aug 09 2026',
      appliedXpOperationIds: ['xp2:client-a:1'],
      appliedXpSequenceByClient: { 'client-a': 1 },
    });
    documents.set(historyPath, { 'Aug 9, 2026': 100 });
    const store = createFirebaseGamificationStore({} as never);
    const sequenceTwo = {
      id: 'xp2:client-a:2',
      clientId: 'client-a',
      sequence: 2,
      delta: 20,
      day: 'Aug 9, 2026',
    };
    const sequenceThree = {
      id: 'xp2:client-a:3',
      clientId: 'client-a',
      sequence: 3,
      delta: 30,
      day: 'Aug 9, 2026',
    };

    await expect(store.save('user-a', {
      ...fallback,
      pendingOperations: [sequenceThree, sequenceTwo],
    })).resolves.toMatchObject({
      snapshot: { xp: 120, appliedOperationSequenceByClient: { 'client-a': 2 } },
      appliedOperationIds: ['xp2:client-a:2'],
    });
    await expect(store.save('user-a', {
      ...fallback,
      pendingOperations: [sequenceThree],
    })).resolves.toMatchObject({
      snapshot: { xp: 150, appliedOperationSequenceByClient: { 'client-a': 3 } },
      appliedOperationIds: ['xp2:client-a:3'],
    });
  });

  it('rejects a bootstrap sequence gap without creating either cloud document', async () => {
    const store = createFirebaseGamificationStore({} as never);

    await expect(store.save('user-a', {
      streak: 2,
      xp: 130,
      lastActive: 'Sun Aug 09 2026',
      history: { 'Aug 9, 2026': 130 },
      pendingOperations: [{
        id: 'xp2:client-a:3',
        clientId: 'client-a',
        sequence: 3,
        delta: 10,
        day: 'Aug 9, 2026',
      }],
    })).rejects.toBeInstanceOf(XpSequenceGapError);

    expect(documents.has(statsPath)).toBe(false);
    expect(documents.has(historyPath)).toBe(false);
  });

  it('bootstraps after a delayed predecessor closes an out-of-order sequence gap', async () => {
    const store = createFirebaseGamificationStore({} as never);
    const sequenceOne = {
      id: 'xp2:client-a:1',
      clientId: 'client-a',
      sequence: 1,
      delta: 10,
      day: 'Aug 9, 2026',
    };
    const sequenceTwo = {
      id: 'xp2:client-a:2',
      clientId: 'client-a',
      sequence: 2,
      delta: 20,
      day: 'Aug 9, 2026',
    };
    const sequenceThree = {
      id: 'xp2:client-a:3',
      clientId: 'client-a',
      sequence: 3,
      delta: 30,
      day: 'Aug 9, 2026',
    };

    await expect(store.save('user-a', {
      streak: 2,
      xp: 140,
      lastActive: 'Sun Aug 09 2026',
      history: { 'Aug 9, 2026': 140 },
      pendingOperations: [sequenceOne, sequenceThree],
    })).rejects.toBeInstanceOf(XpSequenceGapError);

    await expect(store.save('user-a', {
      streak: 2,
      xp: 160,
      lastActive: 'Sun Aug 09 2026',
      history: { 'Aug 9, 2026': 160 },
      pendingOperations: [sequenceOne, sequenceThree, sequenceTwo],
    })).resolves.toMatchObject({
      snapshot: {
        xp: 160,
        appliedOperationSequenceByClient: { 'client-a': 3 },
      },
      appliedOperationIds: [
        'xp2:client-a:1',
        'xp2:client-a:2',
        'xp2:client-a:3',
      ],
    });
    expect(documents.get(historyPath)).toEqual({ 'Aug 9, 2026': 160 });
  });

  it('fails without acknowledging an operation when the client stream map is full', async () => {
    const appliedXpSequenceByClient = Object.fromEntries(Array.from(
      { length: MAX_XP_CLIENT_STREAMS },
      (_, index) => [`client-${index}`, 1],
    ));
    documents.set(statsPath, {
      streak: 2,
      xp: 100,
      lastActive: 'Sun Aug 09 2026',
      appliedXpOperationIds: [],
      appliedXpSequenceByClient,
    });
    documents.set(historyPath, { 'Aug 9, 2026': 100 });
    const store = createFirebaseGamificationStore({} as never);

    await expect(store.save('user-a', {
      ...fallback,
      pendingOperations: [{
        id: 'xp2:new-client:1',
        clientId: 'new-client',
        sequence: 1,
        delta: 10,
        day: 'Aug 9, 2026',
      }],
    })).rejects.toBeInstanceOf(XpClientStreamLimitError);
    expect(documents.get(statsPath)?.xp).toBe(100);
    expect(documents.get(historyPath)).toEqual({ 'Aug 9, 2026': 100 });
  });

  it('seeds a missing stats document from the materialized local snapshot once', async () => {
    const store = createFirebaseGamificationStore({} as never);
    const request: StoredGamificationSnapshot = {
      streak: 2,
      xp: 90,
      lastActive: 'Sun Aug 09 2026',
      history: { 'Aug 9, 2026': 90 },
      pendingOperations: [{ id: 'operation-seed', delta: -10, day: 'Aug 9, 2026' }],
    };

    await store.save('user-a', request);
    await store.save('user-a', request);

    expect(documents.get(statsPath)).toMatchObject({
      xp: 90,
      appliedXpOperationIds: ['operation-seed'],
    });
    expect(documents.get(historyPath)).toEqual({ 'Aug 9, 2026': 90 });
  });

  it('acknowledges every pending operation already materialized by a bootstrap save', async () => {
    expect(MAX_APPLIED_XP_OPERATION_IDS).toBeGreaterThanOrEqual(MAX_PENDING_XP_OPERATIONS);
    const operationCount = MAX_XP_OPERATIONS_PER_SAVE + 1;
    const pendingOperations = Array.from({ length: operationCount }, (_, index) => ({
      id: `operation-bootstrap-${index}`,
      delta: 1,
      day: 'Aug 9, 2026',
    }));
    const request: StoredGamificationSnapshot = {
      streak: 2,
      xp: operationCount,
      lastActive: 'Sun Aug 09 2026',
      history: { 'Aug 9, 2026': operationCount },
      pendingOperations,
    };
    const store = createFirebaseGamificationStore({} as never);

    await expect(store.save('user-a', request)).resolves.toMatchObject({
      snapshot: {
        xp: operationCount,
        appliedOperationIds: pendingOperations.map(operation => operation.id),
      },
      appliedOperationIds: pendingOperations.map(operation => operation.id),
    });
    await expect(store.save('user-a', request)).resolves.toMatchObject({
      snapshot: { xp: operationCount },
    });

    expect(documents.get(statsPath)?.xp).toBe(operationCount);
    expect(new Set(documents.get(statsPath)?.appliedXpOperationIds as string[])).toEqual(
      new Set(pendingOperations.map(operation => operation.id)),
    );
    expect(documents.get(historyPath)).toEqual({ 'Aug 9, 2026': operationCount });
  });
});
