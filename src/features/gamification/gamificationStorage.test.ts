import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  acknowledgeStoredGamificationSave,
  addXpToStoredGamification,
  gamificationStorageKeys,
  PendingXpQueueFullError,
  readGamificationSnapshot,
  writeGamificationSnapshot,
} from './gamificationStorage';
import {
  MAX_PENDING_XP_OPERATIONS,
  rebaseGamificationSnapshots,
} from './gamificationModel';

class MemoryStorage {
  private values = new Map<string, string>();
  private failNextWrite = false;

  constructor(values: Iterable<readonly [string, string]> = []) {
    this.values = new Map(values);
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    }
    this.values.set(key, value);
  }

  failOnce() {
    this.failNextWrite = true;
  }

  clone() {
    return new MemoryStorage(this.values);
  }
}

describe('UID-scoped gamification storage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses separate keys for anonymous sessions and each account', () => {
    expect(gamificationStorageKeys(null).xp).not.toBe(gamificationStorageKeys('user-a').xp);
    expect(gamificationStorageKeys('user-a').xp).not.toBe(gamificationStorageKeys('user-b').xp);
  });

  it('does not expose one account snapshot to another account', () => {
    const storage = new MemoryStorage();
    writeGamificationSnapshot(storage, 'user-a', {
      streak: 4,
      xp: 850,
      lastActive: 'Mon Jul 13 2026',
      history: { 'Jul 13, 2026': 850 },
    });

    expect(readGamificationSnapshot(storage, 'user-b')).toEqual({
      streak: 0,
      xp: 0,
      lastActive: null,
      history: {},
    });
  });

  it('keeps the previous complete snapshot when a persistence write fails', () => {
    const storage = new MemoryStorage();
    const previous = {
      streak: 2,
      xp: 120,
      lastActive: 'Sat Aug 08 2026',
      history: { 'Aug 8, 2026': 120 },
    };
    writeGamificationSnapshot(storage, 'user-a', previous);
    storage.failOnce();

    addXpToStoredGamification(
      storage,
      'user-a',
      previous,
      15,
      new Date('2026-08-09T08:00:00+07:00'),
      'operation-failed-write',
    );

    expect(readGamificationSnapshot(storage, 'user-a')).toEqual(previous);
  });

  it('migrates legacy multi-key state into one authoritative snapshot', () => {
    const storage = new MemoryStorage();
    const keys = gamificationStorageKeys('legacy-user');
    storage.setItem(keys.streak, '2');
    storage.setItem(keys.xp, '120');
    storage.setItem(keys.lastActive, 'Sat Aug 08 2026');
    storage.setItem(keys.history, JSON.stringify({ 'Aug 8, 2026': 120 }));
    storage.setItem(keys.pendingOperations, '[]');

    expect(readGamificationSnapshot(storage, 'legacy-user')).toEqual({
      streak: 2,
      xp: 120,
      lastActive: 'Sat Aug 08 2026',
      history: { 'Aug 8, 2026': 120 },
    });

    storage.setItem(keys.xp, '999');
    storage.setItem(keys.history, JSON.stringify({ 'Aug 8, 2026': 999 }));

    expect(readGamificationSnapshot(storage, 'legacy-user')).toEqual({
      streak: 2,
      xp: 120,
      lastActive: 'Sat Aug 08 2026',
      history: { 'Aug 8, 2026': 120 },
    });
  });

  it('ignores legacy global keys because their owner cannot be proven', () => {
    const storage = new MemoryStorage();
    storage.setItem('lingoflash_xp', '999');
    storage.setItem('lingoflash_xp_history', JSON.stringify({ 'Jul 12, 2026': 999 }));

    expect(readGamificationSnapshot(storage, 'new-user').xp).toBe(0);
    expect(readGamificationSnapshot(storage, 'new-user').history).toEqual({});
  });

  it('degrades to an empty in-memory snapshot when storage reads are denied', () => {
    const deniedStorage = {
      getItem: () => { throw new DOMException('Access denied', 'SecurityError'); },
      setItem: () => { throw new DOMException('Access denied', 'SecurityError'); },
    };

    expect(readGamificationSnapshot(deniedStorage, 'user-a')).toEqual({
      streak: 0,
      xp: 0,
      lastActive: null,
      history: {},
    });
  });

  it('keeps the in-memory session usable when storage is full', () => {
    const fullStorage = {
      getItem: () => null,
      setItem: () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); },
    };

    expect(() => writeGamificationSnapshot(fullStorage, 'user-a', {
      streak: 2,
      xp: 120,
      lastActive: 'Tue Aug 04 2026',
      history: { 'Aug 4, 2026': 120 },
    })).not.toThrow();
  });

  it.each([
    ['denied', {
      getItem: () => { throw new DOMException('Access denied', 'SecurityError'); },
      setItem: () => { throw new DOMException('Access denied', 'SecurityError'); },
    }],
    ['full', {
      getItem: () => null,
      setItem: () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); },
    }],
  ])('returns the updated in-memory XP snapshot when storage is %s', (_label, unavailableStorage) => {
    const next = addXpToStoredGamification(unavailableStorage, 'user-a', {
      streak: 2,
      xp: 120,
      lastActive: 'Sat Aug 08 2026',
      history: { 'Aug 8, 2026': 120 },
    }, 15, new Date('2026-08-09T08:00:00+07:00'), 'operation-storage');

    expect(next).toEqual({
      streak: 2,
      xp: 135,
      lastActive: 'Sun Aug 09 2026',
      history: { 'Aug 8, 2026': 120, 'Aug 9, 2026': 15 },
      pendingOperations: [{
        id: 'operation-storage',
        delta: 15,
        day: 'Aug 9, 2026',
      }],
    });
  });

  it('allocates a stable client stream and contiguous sequence for new XP operations', () => {
    const storage = new MemoryStorage();
    const first = addXpToStoredGamification(storage, 'sequence-user', {
      streak: 1,
      xp: 0,
      lastActive: null,
      history: {},
    }, 5, new Date('2026-08-09T08:00:00+07:00'));
    const second = addXpToStoredGamification(
      storage,
      'sequence-user',
      first,
      10,
      new Date('2026-08-09T08:01:00+07:00'),
    );

    const [firstOperation, secondOperation] = second.pendingOperations ?? [];
    expect(firstOperation.clientId).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);
    expect(firstOperation).toMatchObject({ sequence: 1 });
    expect(secondOperation).toMatchObject({
      clientId: firstOperation.clientId,
      sequence: 2,
    });
    expect(firstOperation.id).toBe(`xp2:${firstOperation.clientId}:1`);
    expect(secondOperation.id).toBe(`xp2:${firstOperation.clientId}:2`);
  });

  it('upgrades persisted legacy operations to a sequenced stream without losing their old ID', () => {
    const storage = new MemoryStorage();
    writeGamificationSnapshot(storage, 'legacy-user', {
      streak: 1,
      xp: 10,
      lastActive: 'Sun Aug 09 2026',
      history: { 'Aug 9, 2026': 10 },
      pendingOperations: [{ id: 'legacy-operation', delta: 10, day: 'Aug 9, 2026' }],
    });

    const [operation] = readGamificationSnapshot(storage, 'legacy-user').pendingOperations ?? [];
    expect(operation).toMatchObject({
      legacyId: 'legacy-operation',
      sequence: 1,
      delta: 10,
      day: 'Aug 9, 2026',
    });
    expect(operation.id).toBe(`xp2:${operation.clientId}:1`);
  });

  it('acknowledges only captured operations and rebases a mutation created during save', () => {
    const storage = new MemoryStorage();
    const first = addXpToStoredGamification(storage, 'user-a', {
      streak: 1,
      xp: 100,
      lastActive: null,
      history: {},
    }, -10, new Date('2026-08-09T08:00:00+07:00'), 'operation-1');
    const second = addXpToStoredGamification(
      storage,
      'user-a',
      first,
      5,
      new Date('2026-08-09T08:01:00+07:00'),
      'operation-2',
    );

    const acknowledged = acknowledgeStoredGamificationSave(
      storage,
      'user-a',
      first,
      {
        streak: 1,
        xp: 190,
        lastActive: 'Sun Aug 09 2026',
        history: { 'Aug 9, 2026': 90 },
        appliedOperationIds: ['operation-1'],
      },
      ['operation-1'],
    );

    expect(acknowledged).toMatchObject({
      xp: 195,
      history: { 'Aug 9, 2026': 95 },
      pendingOperations: [{
        legacyId: 'operation-2',
        delta: 5,
        day: 'Aug 9, 2026',
      }],
    });
    expect(second.pendingOperations).toHaveLength(2);
  });

  it('filters acknowledgements before bounding merged current and persisted operations', () => {
    const storage = new MemoryStorage();
    const clientId = 'acknowledge-bound-client';
    const operations = Array.from({ length: 2060 }, (_, index) => ({
      id: `xp2:${clientId}:${index + 1}`,
      clientId,
      sequence: index + 1,
      delta: 1,
      day: 'Aug 9, 2026',
    }));
    const currentOperations = operations.slice(0, 2040);
    const persistedOperations = operations.slice(2040);
    writeGamificationSnapshot(storage, 'acknowledge-bound-user', {
      streak: 1,
      xp: persistedOperations.length,
      lastActive: 'Sun Aug 09 2026',
      history: { 'Aug 9, 2026': persistedOperations.length },
      pendingOperations: persistedOperations,
    });

    const acknowledged = acknowledgeStoredGamificationSave(
      storage,
      'acknowledge-bound-user',
      {
        streak: 1,
        xp: currentOperations.length,
        lastActive: 'Sun Aug 09 2026',
        history: { 'Aug 9, 2026': currentOperations.length },
        pendingOperations: currentOperations,
      },
      {
        streak: 1,
        xp: 128,
        lastActive: 'Sun Aug 09 2026',
        history: { 'Aug 9, 2026': 128 },
      },
      operations.slice(0, 128).map(operation => operation.id),
    );

    expect(acknowledged.pendingOperations).toHaveLength(1932);
    expect(acknowledged.pendingOperations?.map(operation => operation.id)).toEqual(
      operations.slice(128).map(operation => operation.id),
    );
  });

  it('fails without overwriting persisted operations when too many remain after acknowledgement', () => {
    const storage = new MemoryStorage();
    const clientId = 'acknowledge-overflow-client';
    const operations = Array.from({ length: 2068 }, (_, index) => ({
      id: `xp2:${clientId}:${index + 1}`,
      clientId,
      sequence: index + 1,
      delta: 1,
      day: 'Aug 9, 2026',
    }));
    const currentOperations = operations.slice(0, MAX_PENDING_XP_OPERATIONS);
    const persistedOperations = operations.slice(MAX_PENDING_XP_OPERATIONS);
    writeGamificationSnapshot(storage, 'acknowledge-overflow-user', {
      streak: 1,
      xp: persistedOperations.length,
      lastActive: 'Sun Aug 09 2026',
      history: { 'Aug 9, 2026': persistedOperations.length },
      pendingOperations: persistedOperations,
    });
    const persistedBeforeAcknowledgement = readGamificationSnapshot(
      storage,
      'acknowledge-overflow-user',
    );

    expect(() => acknowledgeStoredGamificationSave(
      storage,
      'acknowledge-overflow-user',
      {
        streak: 1,
        xp: currentOperations.length,
        lastActive: 'Sun Aug 09 2026',
        history: { 'Aug 9, 2026': currentOperations.length },
        pendingOperations: currentOperations,
      },
      {
        streak: 1,
        xp: 10,
        lastActive: 'Sun Aug 09 2026',
        history: { 'Aug 9, 2026': 10 },
      },
      operations.slice(0, 10).map(operation => operation.id),
    )).toThrow(PendingXpQueueFullError);
    expect(readGamificationSnapshot(storage, 'acknowledge-overflow-user'))
      .toEqual(persistedBeforeAcknowledgement);
  });

  it('forks a cloned tab stream but keeps that stream stable across reloads', async () => {
    const sharedStorage = new MemoryStorage();
    const tabASessionStorage = new MemoryStorage();
    vi.stubGlobal('sessionStorage', tabASessionStorage);
    vi.stubGlobal('window', {
      opener: null,
      performance: { getEntriesByType: () => [{ type: 'navigate' }] },
    });
    vi.resetModules();
    const tabAStorageModule = await import('./gamificationStorage');
    const initialSnapshot = {
      streak: 1,
      xp: 0,
      lastActive: null,
      history: {},
    };
    const tabAFirst = tabAStorageModule.addXpToStoredGamification(
      sharedStorage,
      'cloned-tab-user',
      initialSnapshot,
      5,
      new Date('2026-08-09T08:00:00+07:00'),
    );
    const tabBSessionStorage = tabASessionStorage.clone();
    const tabASecond = tabAStorageModule.addXpToStoredGamification(
      sharedStorage,
      'cloned-tab-user',
      tabAFirst,
      10,
      new Date('2026-08-09T08:01:00+07:00'),
    );
    const tabASecondOperation = tabASecond.pendingOperations?.at(-1);

    vi.stubGlobal('sessionStorage', tabBSessionStorage);
    vi.stubGlobal('window', {
      opener: null,
      performance: { getEntriesByType: () => [{ type: 'navigate' }] },
    });
    vi.resetModules();
    const tabBStorageModule = await import('./gamificationStorage');
    const tabBFirst = tabBStorageModule.addXpToStoredGamification(
      sharedStorage,
      'cloned-tab-user',
      tabAFirst,
      20,
      new Date('2026-08-09T08:02:00+07:00'),
    );
    const tabBFirstOperation = tabBFirst.pendingOperations?.at(-1);

    expect(tabBFirstOperation?.id).not.toBe(tabASecondOperation?.id);
    expect(tabBFirstOperation?.clientId).not.toBe(tabASecondOperation?.clientId);
    expect(tabBFirstOperation?.sequence).toBe(1);

    vi.stubGlobal('window', {
      opener: null,
      performance: { getEntriesByType: () => [{ type: 'reload' }] },
    });
    vi.resetModules();
    const reloadedTabBStorageModule = await import('./gamificationStorage');
    const tabBAfterReload = reloadedTabBStorageModule.addXpToStoredGamification(
      sharedStorage,
      'cloned-tab-user',
      tabBFirst,
      30,
      new Date('2026-08-09T08:03:00+07:00'),
    );
    const tabBAfterReloadOperation = tabBAfterReload.pendingOperations?.at(-1);

    expect(tabBAfterReloadOperation).toMatchObject({
      clientId: tabBFirstOperation?.clientId,
      sequence: 2,
    });
  });

  it('merges operations already persisted by another tab before adding XP', () => {
    const storage = new MemoryStorage();
    const staleTabSnapshot = {
      streak: 1,
      xp: 100,
      lastActive: 'Sun Aug 09 2026',
      history: { 'Aug 9, 2026': 100 },
    };
    addXpToStoredGamification(
      storage,
      'user-a',
      staleTabSnapshot,
      10,
      new Date('2026-08-09T08:00:00+07:00'),
      'operation-tab-a',
    );

    const tabB = addXpToStoredGamification(
      storage,
      'user-a',
      staleTabSnapshot,
      -5,
      new Date('2026-08-09T08:01:00+07:00'),
      'operation-tab-b',
    );

    expect(tabB).toMatchObject({
      xp: 105,
      history: { 'Aug 9, 2026': 105 },
      pendingOperations: [
        expect.objectContaining({
          legacyId: 'operation-tab-a',
          delta: 10,
          day: 'Aug 9, 2026',
        }),
        { id: 'operation-tab-b', delta: -5, day: 'Aug 9, 2026' },
      ],
    });
    expect(readGamificationSnapshot(storage, 'user-a')).toMatchObject({ xp: 105 });
  });

  it('fails explicitly without mutating XP when the pending queue reaches its bound', () => {
    const storage = new MemoryStorage();
    const pendingOperations = Array.from(
      { length: MAX_PENDING_XP_OPERATIONS },
      (_, index) => ({
        id: `operation-full-${index}`,
        delta: 1,
        day: 'Aug 9, 2026',
      }),
    );
    const fullSnapshot = {
      streak: 2,
      xp: MAX_PENDING_XP_OPERATIONS,
      lastActive: 'Sun Aug 09 2026',
      history: { 'Aug 9, 2026': MAX_PENDING_XP_OPERATIONS },
      pendingOperations,
    };
    writeGamificationSnapshot(storage, 'user-a', fullSnapshot);

    expect(() => addXpToStoredGamification(
      storage,
      'user-a',
      fullSnapshot,
      5,
      new Date('2026-08-09T08:02:00+07:00'),
      'operation-overflow',
    )).toThrow(PendingXpQueueFullError);
    const migratedFullSnapshot = readGamificationSnapshot(storage, 'user-a');
    expect(migratedFullSnapshot).toMatchObject({
      streak: fullSnapshot.streak,
      xp: fullSnapshot.xp,
      lastActive: fullSnapshot.lastActive,
      history: fullSnapshot.history,
    });
    expect(migratedFullSnapshot.pendingOperations).toHaveLength(MAX_PENDING_XP_OPERATIONS);
    expect(migratedFullSnapshot.pendingOperations?.[0]?.legacyId).toBe('operation-full-0');
    const lastMigratedOperation = migratedFullSnapshot.pendingOperations?.at(-1);
    expect(lastMigratedOperation?.legacyId).toBe(
      `operation-full-${MAX_PENDING_XP_OPERATIONS - 1}`,
    );

    const retryBase = { ...migratedFullSnapshot, pendingOperations: [] };
    writeGamificationSnapshot(storage, 'user-a', retryBase);
    const retried = addXpToStoredGamification(
      storage,
      'user-a',
      retryBase,
      5,
      new Date('2026-08-09T08:03:00+07:00'),
    );
    expect(retried.pendingOperations?.[0]).toMatchObject({
      clientId: lastMigratedOperation?.clientId,
      sequence: (lastMigratedOperation?.sequence ?? 0) + 1,
    });
  });

  it('rebases an unapplied negative operation on top of newer cloud XP', () => {
    expect(rebaseGamificationSnapshots({
      streak: 2,
      xp: 110,
      lastActive: 'Sun Aug 09 2026',
      history: { 'Aug 9, 2026': 110 },
      pendingOperations: [{ id: 'operation-negative', delta: -10, day: 'Aug 9, 2026' }],
    }, {
      streak: 3,
      xp: 200,
      lastActive: 'Sun Aug 09 2026',
      history: { 'Aug 9, 2026': 200 },
      appliedOperationIds: [],
    })).toEqual({
      streak: 3,
      xp: 190,
      lastActive: 'Sun Aug 09 2026',
      history: { 'Aug 9, 2026': 190 },
      pendingOperations: [{ id: 'operation-negative', delta: -10, day: 'Aug 9, 2026' }],
      appliedOperationIds: [],
    });
  });
});
