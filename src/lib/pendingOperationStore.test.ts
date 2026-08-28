import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  closePendingOperationStoreForTests,
  loadStoredPendingOperations,
  updateStoredPendingOperations,
} from './pendingOperationStore';

const DATABASE_NAME = 'sonflash-pending-operations';
const LEGACY_STORE = 'pending-by-user';
const OPERATION_STORE = 'pending-operations';

const requestResult = <T>(request: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const deleteDatabase = async () => {
  closePendingOperationStoreForTests();
  await requestResult(indexedDB.deleteDatabase(DATABASE_NAME));
};

const seedLegacyDatabase = async (
  userId: string,
  operations: unknown[],
) => {
  const request = indexedDB.open(DATABASE_NAME, 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore(LEGACY_STORE, { keyPath: 'userId' });
  };
  const database = await requestResult(request);
  const transaction = database.transaction(LEGACY_STORE, 'readwrite');
  transaction.objectStore(LEGACY_STORE).put({ userId, operations });
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
};

describe('IndexedDB pending operation store', () => {
  beforeEach(deleteDatabase);

  it('updates a user-scoped queue atomically without exposing another user', async () => {
    await updateStoredPendingOperations('store-user-a', () => [{ id: 'a' }]);
    await updateStoredPendingOperations('store-user-b', () => [{ id: 'b' }]);
    await updateStoredPendingOperations<{ id: string }>('store-user-a', current => [
      ...current,
      { id: 'a2' },
    ]);

    await expect(loadStoredPendingOperations('store-user-a')).resolves.toEqual([
      { id: 'a' },
      { id: 'a2' },
    ]);
    await expect(loadStoredPendingOperations('store-user-b')).resolves.toEqual([{ id: 'b' }]);
  });

  it('migrates a legacy per-user array exactly once and creates the v2 indexes', async () => {
    const operations = [
      {
        type: 'delete',
        cardId: 'legacy-a',
        updatedAt: '2026-07-01T00:00:00.000Z',
      },
      {
        type: 'delete',
        cardId: 'legacy-b',
        updatedAt: '2026-07-02T00:00:00.000Z',
      },
    ];
    await seedLegacyDatabase('legacy-user', operations);

    await expect(loadStoredPendingOperations('legacy-user')).resolves.toEqual(operations);
    closePendingOperationStoreForTests();
    await expect(loadStoredPendingOperations('legacy-user')).resolves.toEqual(operations);

    const database = await requestResult(indexedDB.open(DATABASE_NAME, 2));
    const transaction = database.transaction(OPERATION_STORE, 'readonly');
    const store = transaction.objectStore(OPERATION_STORE);
    expect([...store.indexNames]).toEqual(expect.arrayContaining([
      'userId',
      'cardId',
      'status',
      'createdAt',
    ]));
    expect(await requestResult(store.index('userId').count('legacy-user'))).toBe(2);
    database.close();
  });

  it('opens a compatible newer queue without deleting or downgrading it after app rollback', async () => {
    const operation = {
      opId: 'future-op',
      cardId: 'future-card',
      updatedAt: '2026-08-27T00:00:00.000Z',
    };
    const request = indexedDB.open(DATABASE_NAME, 3);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(LEGACY_STORE, { keyPath: 'userId' });
      const store = request.result.createObjectStore(OPERATION_STORE, { keyPath: 'recordId' });
      store.createIndex('userId', 'userId');
      store.createIndex('cardId', 'cardId');
      store.createIndex('status', 'status');
      store.createIndex('createdAt', 'createdAt');
    };
    const futureDatabase = await requestResult(request);
    const transaction = futureDatabase.transaction(OPERATION_STORE, 'readwrite');
    transaction.objectStore(OPERATION_STORE).put({
      recordId: 'future-record',
      operationId: operation.opId,
      userId: 'future-user',
      cardId: operation.cardId,
      status: 'pending',
      createdAt: operation.updatedAt,
      position: 0,
      operation,
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    futureDatabase.close();

    await expect(loadStoredPendingOperations('future-user')).resolves.toEqual([operation]);
    closePendingOperationStoreForTests();
    const reopened = await requestResult(indexedDB.open(DATABASE_NAME));
    expect(reopened.version).toBe(3);
    reopened.close();
  });

  it('rejects an incompatible newer queue without mutating it', async () => {
    const request = indexedDB.open(DATABASE_NAME, 3);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(LEGACY_STORE, { keyPath: 'userId' });
      const store = request.result.createObjectStore(OPERATION_STORE, { keyPath: 'id' });
      store.createIndex('userId', 'userId');
      store.createIndex('cardId', 'cardId');
      store.createIndex('status', 'status');
      store.createIndex('createdAt', 'createdAt');
    };
    const futureDatabase = await requestResult(request);
    const transaction = futureDatabase.transaction(OPERATION_STORE, 'readwrite');
    transaction.objectStore(OPERATION_STORE).put({
      id: 'preserved-record',
      userId: 'future-user',
      operation: { opId: 'preserved-op' },
    });
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    futureDatabase.close();

    await expect(loadStoredPendingOperations('future-user')).rejects.toThrow('incompatible schema');
    const reopened = await requestResult(indexedDB.open(DATABASE_NAME));
    const preserved = await requestResult(
      reopened.transaction(OPERATION_STORE).objectStore(OPERATION_STORE).get('preserved-record'),
    );
    expect(preserved).toMatchObject({ id: 'preserved-record' });
    expect(reopened.version).toBe(3);
    reopened.close();
  });

  it('serializes concurrent acknowledge and enqueue updates without losing the new operation', async () => {
    const oldOperation = {
      opId: 'old-op',
      cardId: 'card-a',
      updatedAt: '2026-07-01T00:00:00.000Z',
    };
    const newOperation = {
      opId: 'new-op',
      cardId: 'card-b',
      updatedAt: '2026-07-02T00:00:00.000Z',
    };
    await updateStoredPendingOperations('concurrent-user', () => [oldOperation]);

    await Promise.all([
      updateStoredPendingOperations<typeof oldOperation>('concurrent-user', current =>
        current.filter(operation => operation.opId !== oldOperation.opId)),
      updateStoredPendingOperations('concurrent-user', current => [
        ...current,
        newOperation,
      ]),
    ]);

    await expect(loadStoredPendingOperations('concurrent-user')).resolves.toEqual([newOperation]);
  });

  it('writes only changed operation records instead of rewriting the full user queue', async () => {
    const first = {
      opId: 'op-a',
      cardId: 'card-a',
      updatedAt: '2026-07-01T00:00:00.000Z',
      fields: { bookmarked: false },
    };
    const second = {
      opId: 'op-b',
      cardId: 'card-b',
      updatedAt: '2026-07-02T00:00:00.000Z',
      fields: { bookmarked: false },
    };
    await updateStoredPendingOperations('diff-user', () => [first, second]);
    const putSpy = vi.spyOn(IDBObjectStore.prototype, 'put');

    await updateStoredPendingOperations<typeof first>('diff-user', current =>
      current.map(operation => operation.opId === second.opId
        ? { ...operation, fields: { bookmarked: true } }
        : operation));

    expect(putSpy).toHaveBeenCalledTimes(1);
    await expect(loadStoredPendingOperations('diff-user')).resolves.toEqual([
      first,
      { ...second, fields: { bookmarked: true } },
    ]);
    putSpy.mockRestore();
  });

  it('rejects clearly when another tab blocks the v2 database upgrade', async () => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(LEGACY_STORE, { keyPath: 'userId' });
    };
    const blockingDatabase = await requestResult(request);

    try {
      const opening = loadStoredPendingOperations('blocked-user');
      const result = Promise.race([
        opening,
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => reject(new Error('Timed out waiting for a blocked-upgrade error.')), 50);
        }),
      ]);

      await expect(result).rejects.toThrow(
        'Close other SonFlash tabs, then retry syncing.',
      );
    } finally {
      blockingDatabase.close();
      await new Promise(resolve => setTimeout(resolve, 0));
      closePendingOperationStoreForTests();
    }
  });
});
