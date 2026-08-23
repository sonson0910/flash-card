import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_APPLIED_XP_OPERATION_IDS,
  MAX_GAMIFICATION_HISTORY_ENTRIES,
  MAX_PENDING_XP_OPERATIONS,
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
const functions = vi.hoisted(() => ({
  getFunctions: vi.fn(),
  httpsCallable: vi.fn(),
}));

vi.mock('firebase/firestore', () => firestore);
vi.mock('firebase/functions', () => functions);
vi.mock('../../lib/firebase', () => ({
  app: {},
  db: null,
  isFirebaseConfigured: false,
  protectedFunctionsCapability: { available: true },
}));

import {
  createFirebaseGamificationStore,
  XpStreamMigrationRequiredError,
  XpSequenceGapError,
} from './firebaseGamificationStore';
import { createGamificationStoreController } from './gamificationStore';
import { applyGamificationForOwner } from '../../../functions/src/gamificationPersistence';

const fallback: StoredGamificationSnapshot = {
  streak: 2,
  xp: 120,
  lastActive: 'Sat Aug 08 2026',
  history: { 'Aug 8, 2026': 120 },
};

const documents = new Map<string, Record<string, unknown>>();
let transactionTail: Promise<void>;
const adminDatabase = {
  collection: (name: string) => ({
    doc: (ownerId: string) => ({
      collection: (subcollection: string) => ({
        doc: (id: string) => ({ path: `${name}/${ownerId}/${subcollection}/${id}` }),
      }),
      path: `${name}/${ownerId}`,
    }),
  }),
  runTransaction: vi.fn(async (update: (transaction: {
    get(reference: DocumentReference): Promise<ReturnType<typeof adminSnapshotAt>>;
    set(reference: DocumentReference, value: Record<string, unknown>): void;
  }) => Promise<unknown>) => {
    const writes: Array<{ reference: DocumentReference; value: Record<string, unknown> }> = [];
    const result = await update({
      get: async reference => adminSnapshotAt(reference),
      set: (reference, value) => writes.push({ reference, value }),
    });
    for (const write of writes) documents.set(write.reference.path, { ...write.value });
    return result;
  }),
};

const snapshotAt = (reference: DocumentReference) => {
  const value = documents.get(reference.path);
  return {
    exists: () => value !== undefined,
    data: () => ({ ...(value ?? {}) }),
  };
};

const adminSnapshotAt = (reference: DocumentReference) => {
  const value = documents.get(reference.path);
  return {
    exists: value !== undefined,
    data: () => ({ ...(value ?? {}) }),
  };
};

const installFirestoreHarness = () => {
  transactionTail = Promise.resolve();
  firestore.getDoc.mockImplementation(async (reference: DocumentReference) => snapshotAt(reference));
  functions.getFunctions.mockReturnValue({});
  functions.httpsCallable.mockImplementation(() => async (request: unknown) => ({
    data: await applyGamificationForOwner(adminDatabase as never, 'user-a', request as never),
  }));
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

  it('routes saves through the protected callable and never a client write transaction', async () => {
    const store = createFirebaseGamificationStore({} as never);

    await store.save('user-a', fallback);

    expect(functions.getFunctions).toHaveBeenCalledWith({}, 'asia-southeast1');
    expect(functions.httpsCallable).toHaveBeenCalledWith(expect.anything(), 'saveGamification');
    expect(firestore.runTransaction).not.toHaveBeenCalled();
  });

  it('fails closed on callable response surprises and maps protected stream errors', async () => {
    functions.httpsCallable.mockImplementationOnce(() => async () => ({
      data: {
        snapshot: {
          streak: 1,
          xp: 1,
          lastActive: { toDate: () => new Date() },
          history: {},
          appliedOperationIds: [],
        },
        appliedOperationIds: [],
      },
    }));
    const store = createFirebaseGamificationStore({} as never);
    await expect(store.save('user-a', fallback)).rejects.toThrow();

    functions.httpsCallable.mockImplementationOnce(() => async () => {
      throw {
        code: 'functions/failed-precondition',
        details: { reason: 'xp-sequence-gap', clientId: 'client-a', expectedSequence: 1, receivedSequence: 3 },
      };
    });
    await expect(store.save('user-a', fallback)).rejects.toBeInstanceOf(XpSequenceGapError);
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

  it('loads stats and history from one consistent read-only transaction', async () => {
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
      xpStreamSchemaVersion: 2,
    });
    expect(documents.get('users/user-a/xp_streams/client-a')).toMatchObject({ sequence: 1 });
    expect(documents.get('users/user-a/xp_streams/client-b')).toMatchObject({ sequence: 1 });
    expect(documents.get(historyPath)).toEqual({ 'Aug 9, 2026': 90 });
    expect(firestore.runTransaction).not.toHaveBeenCalled();
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
      xpStreamSchemaVersion: 2,
    });
    expect(documents.get('users/user-a/xp_streams/client-a')).toMatchObject({ sequence: 41 });
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

  it('migrates a legacy account with more than sixteen streams and syncs stream seventeen', async () => {
    const appliedXpSequenceByClient = Object.fromEntries(Array.from(
      { length: 17 },
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
        id: 'xp2:client-16:2',
        clientId: 'client-16',
        sequence: 2,
        delta: 10,
        day: 'Aug 9, 2026',
      }],
    })).resolves.toMatchObject({
      snapshot: { xp: 110 },
      appliedOperationIds: ['xp2:client-16:2'],
    });
    expect(documents.get(statsPath)).toMatchObject({
      xp: 110,
      xpStreamSchemaVersion: 2,
    });
    expect(documents.get(statsPath)).not.toHaveProperty('appliedXpSequenceByClient');
    expect(documents.get('users/user-a/xp_streams/client-0')).toMatchObject({ sequence: 1 });
    expect(documents.get('users/user-a/xp_streams/client-16')).toMatchObject({ sequence: 2 });
    expect(documents.get(historyPath)).toEqual({ 'Aug 9, 2026': 110 });
  });

  it('never lowers a watermark when resuming a partially materialized legacy migration', async () => {
    documents.set(statsPath, {
      streak: 2,
      xp: 100,
      lastActive: 'Sun Aug 09 2026',
      appliedXpOperationIds: [],
      appliedXpSequenceByClient: { 'already-migrated': 1, 'new-stream': 1 },
    });
    documents.set(historyPath, { 'Aug 9, 2026': 100 });
    documents.set('users/user-a/xp_streams/already-migrated', {
      schemaVersion: 2,
      clientId: 'already-migrated',
      sequence: 7,
      retiredAt: '2026-08-10T00:00:00.000Z',
    });
    const store = createFirebaseGamificationStore({} as never);

    await expect(store.save('user-a', {
      ...fallback,
      pendingOperations: [{
        id: 'xp2:new-stream:2',
        clientId: 'new-stream',
        sequence: 2,
        delta: 10,
        day: 'Aug 9, 2026',
      }],
    })).resolves.toMatchObject({ snapshot: { xp: 110 } });

    expect(documents.get('users/user-a/xp_streams/already-migrated')).toMatchObject({
      sequence: 7,
      retiredAt: '2026-08-10T00:00:00.000Z',
    });
  });

  it('never lowers a legacy watermark when a partial stream document is behind it', async () => {
    documents.set(statsPath, {
      streak: 2,
      xp: 100,
      lastActive: 'Sun Aug 09 2026',
      appliedXpOperationIds: [],
      appliedXpSequenceByClient: { 'partially-migrated': 7 },
    });
    documents.set(historyPath, { 'Aug 9, 2026': 100 });
    documents.set('users/user-a/xp_streams/partially-migrated', {
      schemaVersion: 2,
      clientId: 'partially-migrated',
      sequence: 3,
      retiredAt: null,
    });
    const store = createFirebaseGamificationStore({} as never);

    await expect(store.save('user-a', {
      ...fallback,
      pendingOperations: [],
    })).resolves.toMatchObject({ snapshot: { xp: 100 } });

    expect(documents.get('users/user-a/xp_streams/partially-migrated')).toMatchObject({
      sequence: 7,
    });
  });

  it('materializes all sixty-four valid legacy streams without a boundary slice', async () => {
    const appliedXpSequenceByClient = Object.fromEntries(Array.from(
      { length: 64 },
      (_, index) => [`legacy-${index}`, index + 1],
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
      pendingOperations: [],
    })).resolves.toMatchObject({ snapshot: { xp: 100 } });

    expect(Array.from(documents.keys()).filter(path => path.includes('/xp_streams/')))
      .toHaveLength(64);
    expect(documents.get('users/user-a/xp_streams/legacy-63')).toMatchObject({ sequence: 64 });
    expect(documents.get(statsPath)).not.toHaveProperty('appliedXpSequenceByClient');
  });

  it('acknowledges a retired stream retry without applying XP twice', async () => {
    documents.set(statsPath, {
      streak: 2,
      xp: 100,
      lastActive: 'Sun Aug 09 2026',
      appliedXpOperationIds: [],
      xpStreamSchemaVersion: 2,
    });
    documents.set(historyPath, { 'Aug 9, 2026': 100 });
    documents.set('users/user-a/xp_streams/retired-client', {
      schemaVersion: 2,
      clientId: 'retired-client',
      sequence: 1,
      retiredAt: '2026-08-10T00:00:00.000Z',
    });
    const store = createFirebaseGamificationStore({} as never);

    await expect(store.save('user-a', {
      ...fallback,
      pendingOperations: [{
        id: 'xp2:retired-client:1',
        clientId: 'retired-client',
        sequence: 1,
        delta: 10,
        day: 'Aug 9, 2026',
      }],
    })).resolves.toMatchObject({
      snapshot: { xp: 100 },
      appliedOperationIds: ['xp2:retired-client:1'],
    });
    expect(documents.get(historyPath)).toEqual({ 'Aug 9, 2026': 100 });
  });

  it('loads stream watermarks so an evicted operation ID cannot remain pending locally', async () => {
    documents.set(statsPath, {
      streak: 2,
      xp: 100,
      lastActive: 'Sun Aug 09 2026',
      appliedXpOperationIds: [],
      xpStreamSchemaVersion: 2,
    });
    documents.set(historyPath, { 'Aug 9, 2026': 100 });
    documents.set('users/user-a/xp_streams/stream-seventeen', {
      schemaVersion: 2,
      clientId: 'stream-seventeen',
      sequence: 17,
      retiredAt: null,
    });
    const store = createFirebaseGamificationStore({} as never);

    await expect(store.load('user-a', {
      ...fallback,
      pendingOperations: [{
        id: 'xp2:stream-seventeen:17',
        clientId: 'stream-seventeen',
        sequence: 17,
        delta: 10,
        day: 'Aug 9, 2026',
      }],
    })).resolves.toMatchObject({
      source: 'cloud',
      snapshot: {
        xp: 100,
        appliedOperationSequenceByClient: { 'stream-seventeen': 17 },
      },
    });
  });

  it('fails closed when a referenced stream document has invalid metadata', async () => {
    documents.set(statsPath, {
      streak: 2,
      xp: 100,
      lastActive: 'Sun Aug 09 2026',
      appliedXpOperationIds: [],
      xpStreamSchemaVersion: 2,
    });
    documents.set(historyPath, { 'Aug 9, 2026': 100 });
    documents.set('users/user-a/xp_streams/stream-invalid', {
      schemaVersion: 2,
      clientId: 'stream-invalid',
      sequence: 17,
      retiredAt: null,
      extra: true,
    });
    const store = createFirebaseGamificationStore({} as never);

    await expect(store.load('user-a', {
      ...fallback,
      pendingOperations: [{
        id: 'xp2:stream-invalid:17',
        clientId: 'stream-invalid',
        sequence: 17,
        delta: 10,
        day: 'Aug 9, 2026',
      }],
    })).rejects.toBeInstanceOf(XpStreamMigrationRequiredError);
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
