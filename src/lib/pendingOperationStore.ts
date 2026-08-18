const DATABASE_NAME = 'sonflash-pending-operations';
const DATABASE_VERSION = 2;
const LEGACY_PENDING_STORE = 'pending-by-user';
const PENDING_OPERATION_STORE = 'pending-operations';

interface StoredPendingOperations<T> {
  userId: string;
  operations: T[];
}

interface StoredPendingOperation<T> {
  recordId: string;
  operationId: string;
  userId: string;
  cardId: string;
  status: 'pending';
  createdAt: string;
  position: number;
  operation: T;
}

let databasePromise: Promise<IDBDatabase> | null = null;
let activeDatabase: IDBDatabase | null = null;

const blockedUpgradeMessage = 'Another SonFlash tab is blocking local sync storage. Close other SonFlash tabs, then retry syncing. Your changes remain safe on this device.';

class PendingOperationStoreBlockedError extends Error {
  constructor() {
    super(blockedUpgradeMessage);
    this.name = 'PendingOperationStoreBlockedError';
  }
}

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

function operationSource(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function operationCardId(operation: unknown): string {
  const source = operationSource(operation);
  if (!source) return '';
  if (typeof source.cardId === 'string') return source.cardId;
  if (source.card && typeof source.card === 'object' && !Array.isArray(source.card)) {
    const cardId = (source.card as Record<string, unknown>).id;
    if (typeof cardId === 'string') return cardId;
  }
  return typeof source.id === 'string' ? source.id : '';
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function operationIdentity(operation: unknown, position: number): string {
  const source = operationSource(operation);
  if (typeof source?.opId === 'string' && source.opId) return source.opId;
  if (typeof source?.id === 'string' && source.id) return source.id;
  let serialized = '';
  try {
    serialized = JSON.stringify(operation) ?? '';
  } catch {
    serialized = String(operation);
  }
  return `legacy-${stableHash(serialized)}-${position}`;
}

function operationCreatedAt(operation: unknown, position: number): string {
  const value = operationSource(operation)?.updatedAt;
  if (typeof value === 'string' && !Number.isNaN(new Date(value).getTime())) {
    return new Date(value).toISOString();
  }
  return new Date(position).toISOString();
}

function operationRecord<T>(
  userId: string,
  operation: T,
  position: number,
): StoredPendingOperation<T> {
  const operationId = operationIdentity(operation, position);
  const cardId = operationCardId(operation);
  return {
    recordId: [
      encodeURIComponent(userId),
      encodeURIComponent(operationId),
      encodeURIComponent(cardId),
    ].join(':'),
    operationId,
    userId,
    cardId,
    status: 'pending',
    createdAt: operationCreatedAt(operation, position),
    position,
    operation,
  };
}

function createOperationStore(database: IDBDatabase): IDBObjectStore {
  const store = database.createObjectStore(PENDING_OPERATION_STORE, { keyPath: 'recordId' });
  store.createIndex('userId', 'userId', { unique: false });
  store.createIndex('cardId', 'cardId', { unique: false });
  store.createIndex('status', 'status', { unique: false });
  store.createIndex('createdAt', 'createdAt', { unique: false });
  return store;
}

function migrateLegacyRecords(
  transaction: IDBTransaction,
  operationStore: IDBObjectStore,
): void {
  const legacyStore = transaction.objectStore(LEGACY_PENDING_STORE);
  const cursorRequest = legacyStore.openCursor();
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) return;
    const legacy = cursor.value as StoredPendingOperations<unknown>;
    if (typeof legacy?.userId === 'string' && Array.isArray(legacy.operations)) {
      legacy.operations.forEach((operation, position) => {
        operationStore.put(operationRecord(legacy.userId, operation, position));
      });
    }
    cursor.continue();
  };
}

function openPendingOperationStore(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is unavailable; pending changes could not be stored safely.'));
  }
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    let settled = false;
    const rejectOpen = (cause: Error) => {
      if (settled) return;
      settled = true;
      activeDatabase = null;
      databasePromise = null;
      reject(cause);
    };
    request.onupgradeneeded = event => {
      const database = request.result;
      const transaction = request.transaction;
      if (!transaction) throw new Error('Pending operation migration transaction is unavailable.');
      if (!database.objectStoreNames.contains(LEGACY_PENDING_STORE)) {
        database.createObjectStore(LEGACY_PENDING_STORE, { keyPath: 'userId' });
      }
      const operationStore = database.objectStoreNames.contains(PENDING_OPERATION_STORE)
        ? transaction.objectStore(PENDING_OPERATION_STORE)
        : createOperationStore(database);
      if ((event as IDBVersionChangeEvent).oldVersion < 2) {
        migrateLegacyRecords(transaction, operationStore);
      }
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      activeDatabase = request.result;
      request.result.onversionchange = () => {
        request.result.close();
        if (activeDatabase === request.result) activeDatabase = null;
        databasePromise = null;
      };
      resolve(request.result);
    };
    request.onblocked = () => rejectOpen(new PendingOperationStoreBlockedError());
    request.onerror = () => {
      rejectOpen(request.error ?? new Error('Could not open the pending operation store.'));
    };
  });
  return databasePromise;
}

async function loadUserRecords<T>(
  store: IDBObjectStore,
  userId: string,
): Promise<StoredPendingOperation<T>[]> {
  const records = await requestResult(
    store.index('userId').getAll(IDBKeyRange.only(userId)),
  ) as StoredPendingOperation<T>[];
  return records.sort((left, right) => left.position - right.position);
}

export async function loadStoredPendingOperations<T = unknown>(userId: string): Promise<T[]> {
  const database = await openPendingOperationStore();
  const transaction = database.transaction(PENDING_OPERATION_STORE, 'readonly');
  const done = transactionDone(transaction);
  const records = await loadUserRecords<T>(transaction.objectStore(PENDING_OPERATION_STORE), userId);
  await done;
  return records.map(record => record.operation);
}

export async function updateStoredPendingOperations<T>(
  userId: string,
  update: (current: T[]) => T[],
): Promise<T[]> {
  const database = await openPendingOperationStore();
  const transaction = database.transaction(PENDING_OPERATION_STORE, 'readwrite');
  const done = transactionDone(transaction);
  const store = transaction.objectStore(PENDING_OPERATION_STORE);
  const currentRecords = await loadUserRecords<T>(store, userId);
  const current = currentRecords.map(record => record.operation);
  const next = update(current);
  const nextRecords = next.map((operation, position) => operationRecord(userId, operation, position));
  const currentById = new Map(currentRecords.map(record => [record.recordId, record]));
  const nextIds = new Set(nextRecords.map(record => record.recordId));

  currentRecords.forEach(record => {
    if (!nextIds.has(record.recordId)) store.delete(record.recordId);
  });
  nextRecords.forEach(record => {
    const existing = currentById.get(record.recordId);
    if (
      !existing
      || existing.position !== record.position
      || existing.cardId !== record.cardId
      || JSON.stringify(existing.operation) !== JSON.stringify(record.operation)
    ) {
      store.put(record);
    }
  });
  await done;
  return next;
}

/**
 * Test-only lifecycle seam. Production connections are closed by versionchange.
 */
export function closePendingOperationStoreForTests(): void {
  activeDatabase?.close();
  activeDatabase = null;
  databasePromise = null;
}
