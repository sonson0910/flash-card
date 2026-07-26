const DATABASE_NAME = 'sonflash-pending-operations';
const DATABASE_VERSION = 1;
const PENDING_STORE = 'pending-by-user';

interface StoredPendingOperations<T> {
  userId: string;
  operations: T[];
}

let databasePromise: Promise<IDBDatabase> | null = null;

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('Pending operation transaction was aborted.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('Pending operation transaction failed.'));
  });
}

function openPendingOperationStore(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is unavailable; pending changes could not be stored safely.'));
  }
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(PENDING_STORE, { keyPath: 'userId' });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => {
        request.result.close();
        databasePromise = null;
      };
      resolve(request.result);
    };
    request.onerror = () => {
      databasePromise = null;
      reject(request.error ?? new Error('Could not open the pending operation store.'));
    };
  });
  return databasePromise;
}

export async function loadStoredPendingOperations<T = unknown>(userId: string): Promise<T[]> {
  const database = await openPendingOperationStore();
  const transaction = database.transaction(PENDING_STORE, 'readonly');
  const done = transactionDone(transaction);
  const record = await requestResult(
    transaction.objectStore(PENDING_STORE).get(userId),
  ) as StoredPendingOperations<T> | undefined;
  await done;
  return Array.isArray(record?.operations) ? record.operations : [];
}

export async function updateStoredPendingOperations<T>(
  userId: string,
  update: (current: T[]) => T[],
): Promise<T[]> {
  const database = await openPendingOperationStore();
  const transaction = database.transaction(PENDING_STORE, 'readwrite');
  const done = transactionDone(transaction);
  const store = transaction.objectStore(PENDING_STORE);
  const record = await requestResult(store.get(userId)) as StoredPendingOperations<T> | undefined;
  const next = update(Array.isArray(record?.operations) ? record.operations : []);
  if (next.length > 0) store.put({ userId, operations: next } satisfies StoredPendingOperations<T>);
  else store.delete(userId);
  await done;
  return next;
}
