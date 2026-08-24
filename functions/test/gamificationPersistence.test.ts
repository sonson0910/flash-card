import type {
  DocumentData,
  DocumentReference,
  DocumentSnapshot,
  Firestore,
  Transaction,
} from 'firebase-admin/firestore';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  applyGamificationForOwner,
  GamificationMigrationRequiredError,
  MAX_PENDING_XP_OPERATIONS,
  MAX_XP_OPERATIONS_PER_SAVE,
  parseGamificationSaveRequest,
  type GamificationSaveRequest,
} from '../src/gamificationPersistence.js';

const snapshot = (exists: boolean, data: DocumentData = {}): DocumentSnapshot => ({
  exists,
  data: () => data,
} as DocumentSnapshot);

const request = (overrides: Partial<GamificationSaveRequest> = {}): GamificationSaveRequest => ({
  snapshot: {
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
  },
  operations: [{
    id: 'xp2:client-a:1',
    clientId: 'client-a',
    sequence: 1,
    delta: 10,
    day: 'Aug 9, 2026',
  }],
  ...overrides,
});

const harness = (documents: Record<string, DocumentData> = {}) => {
  const values = new Map(Object.entries(documents));
  const writes: Array<{ path: string; data: DocumentData }> = [];
  const transaction = {
    get: vi.fn(async (reference: DocumentReference) => {
      const value = values.get(reference.path);
      return snapshot(value !== undefined, value);
    }),
    set: vi.fn((reference: DocumentReference, data: DocumentData) => {
      writes.push({ path: reference.path, data });
      return transaction;
    }),
  } as unknown as Transaction;
  const database = {
    collection: (name: string) => ({
      doc: (ownerId: string) => ({
        collection: (subcollection: string) => ({
          doc: (id: string) => ({ path: `${name}/${ownerId}/${subcollection}/${id}` }),
        }),
        path: `${name}/${ownerId}`,
      }),
    }),
    runTransaction: vi.fn(async (update: (value: Transaction) => Promise<unknown>) => update(transaction)),
  } as unknown as Firestore;
  return { database, values, writes, transaction };
};

describe('gamification persistence', () => {
  it('exposes the region-scoped App Check callable without a client owner field', () => {
    const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    expect(source).toMatch(/export const saveGamification = onCall\(\{[\s\S]*region: REGION,[\s\S]*enforceAppCheck/);
    expect(source).toContain('applyGamificationForOwner(database, userId, input)');
    expect(source).not.toContain('applyGamificationForOwner(database, request.data.ownerId');
  });

  it('rejects unknown, oversized, and malformed request values', () => {
    expect(() => parseGamificationSaveRequest({ ...request(), extra: true })).toThrow();
    expect(() => parseGamificationSaveRequest({
      ...request(),
      operations: Array.from({ length: 129 }, (_, index) => ({
        id: `operation-${index}`,
        delta: 1,
        day: 'Aug 9, 2026',
      })),
    })).toThrow();
    expect(() => parseGamificationSaveRequest({
      ...request(),
      snapshot: {
        ...request().snapshot,
        pendingOperations: Array.from({ length: 2_049 }, (_, index) => ({
          id: `operation-${index}`,
          delta: 1,
          day: 'Aug 9, 2026',
        })),
      },
    })).toThrow();
    expect(() => parseGamificationSaveRequest({
      ...request(),
      operations: [{ id: '../unsafe', delta: 1, day: 'Aug 9, 2026' }],
    })).toThrow();
    expect(() => parseGamificationSaveRequest({
      ...request(),
      operations: [{ id: 'operation', delta: 0, day: 'Aug 9, 2026' }],
    })).toThrow();
    expect(() => parseGamificationSaveRequest({
      ...request(),
      snapshot: { ...request().snapshot, xp: Number.MAX_SAFE_INTEGER + 1 },
    })).toThrow();
    expect(() => parseGamificationSaveRequest({
      ...request(),
      snapshot: { ...request().snapshot, history: JSON.parse('{"__proto__":1}') },
    })).toThrow();
    expect(() => parseGamificationSaveRequest({
      ...request(),
      operations: [{
        id: 'xp2:client-a:1',
        clientId: 'client-a',
        sequence: 2,
        delta: 1,
        day: 'Aug 9, 2026',
        legacyId: 'legacy-1',
        extra: true,
      }],
    })).toThrow();
    const sparse = new Array(1) as unknown[];
    expect(() => parseGamificationSaveRequest({ ...request(), operations: sparse })).toThrow();
  });

  it('applies a first write atomically and returns the authoritative snapshot', async () => {
    const test = harness();
    await expect(applyGamificationForOwner(test.database, 'owner', request())).resolves.toMatchObject({
      snapshot: { xp: 110, history: { 'Aug 9, 2026': 110 } },
      appliedOperationIds: ['xp2:client-a:1'],
    });
    expect(test.writes.map(write => write.path)).toEqual([
      'users/owner/profile/stats',
      'users/owner/profile/xp_history',
      'users/owner/xp_streams/client-a',
    ]);
  });

  it('acknowledges duplicate retries without applying XP twice', async () => {
    const test = harness({
      'users/owner/profile/stats': {
        streak: 2,
        xp: 110,
        lastActive: 'Sun Aug 09 2026',
        appliedXpOperationIds: ['xp2:client-a:1'],
        xpStreamSchemaVersion: 2,
      },
      'users/owner/profile/xp_history': { 'Aug 9, 2026': 110 },
      'users/owner/xp_streams/client-a': {
        schemaVersion: 2,
        clientId: 'client-a',
        sequence: 1,
        retiredAt: null,
      },
    });
    await expect(applyGamificationForOwner(test.database, 'owner', request())).resolves.toMatchObject({
      snapshot: { xp: 110 },
      appliedOperationIds: ['xp2:client-a:1'],
    });
  });

  it('rejects a bootstrap sequence gap before writing', async () => {
    const test = harness();
    await expect(applyGamificationForOwner(test.database, 'owner', request({
      operations: [{
        id: 'xp2:client-a:3',
        clientId: 'client-a',
        sequence: 3,
        delta: 10,
        day: 'Aug 9, 2026',
      }],
      snapshot: {
        ...request().snapshot,
        pendingOperations: [{
          id: 'xp2:client-a:3',
          clientId: 'client-a',
          sequence: 3,
          delta: 10,
          day: 'Aug 9, 2026',
        }],
      },
    }))).rejects.toMatchObject({ clientId: 'client-a', expectedSequence: 1, receivedSequence: 3 });
    expect(test.writes).toEqual([]);
  });

  it('fails closed without writes when stored gamification data is malformed', async () => {
    const validStats = {
      streak: 2,
      xp: 100,
      lastActive: 'Sun Aug 09 2026',
      appliedXpOperationIds: [],
    };
    const cases = [
      {
        stats: { ...validStats, xp: Number.POSITIVE_INFINITY },
        history: { 'Aug 9, 2026': 100 },
      },
      {
        stats: { ...validStats, appliedXpOperationIds: ['not a valid operation id'] },
        history: { 'Aug 9, 2026': 100 },
      },
      {
        stats: validStats,
        history: { 'Aug 9, 2026': 1.5 },
      },
    ];

    for (const stored of cases) {
      const test = harness({
        'users/owner/profile/stats': stored.stats,
        'users/owner/profile/xp_history': stored.history,
      });
      await expect(applyGamificationForOwner(test.database, 'owner', request()))
        .rejects.toBeInstanceOf(GamificationMigrationRequiredError);
      expect(test.writes).toEqual([]);
    }
  });

  it('rejects a bootstrap whose distinct stream writes exceed the transaction budget', async () => {
    const pendingOperations = Array.from(
      { length: MAX_PENDING_XP_OPERATIONS },
      (_, index) => ({
        id: `xp2:bootstrap-client-${index}:1`,
        clientId: `bootstrap-client-${index}`,
        sequence: 1,
        delta: 1,
        day: 'Aug 9, 2026',
      }),
    );
    const test = harness();

    await expect(applyGamificationForOwner(test.database, 'owner', {
      snapshot: {
        streak: 2,
        xp: MAX_PENDING_XP_OPERATIONS,
        lastActive: 'Sun Aug 09 2026',
        history: { 'Aug 9, 2026': MAX_PENDING_XP_OPERATIONS },
        pendingOperations,
      },
      operations: pendingOperations.slice(0, MAX_XP_OPERATIONS_PER_SAVE),
    })).rejects.toThrow();
    expect(test.database.runTransaction).toHaveBeenCalledOnce();
    expect(test.transaction.get).toHaveBeenCalledTimes(2);
    expect(test.writes).toEqual([]);
  });
});
