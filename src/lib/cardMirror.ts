import type { CardData } from '../types/card';
import { normalizeCardData } from './cardNormalization';
import {
  cardWordKey,
  normalizeCardWord,
  preferCardWithLearningProgress,
} from './cardIdentity';
import { cardActivityTimestamp, cardMatchesQuery, type CardQueryState, type LocalCardPage } from './cardQuery';

const DATABASE_NAME = 'sonflash-card-mirror';
const DATABASE_VERSION = 2;
const CARD_STORE = 'cards';
const META_STORE = 'sync-meta';
const MAX_BATCH_SIZE = 100;
const CARD_MIRROR_OPEN_TIMEOUT_MS = 10_000;
const cardMirrorBlockedMessage = 'The local card mirror is blocked by another SonFlash tab. Close other SonFlash tabs and retry.';
const cardMirrorOpenTimeoutMessage = 'The local card mirror did not open in time. Close other SonFlash tabs and retry.';

interface MirroredCard extends CardData {
  mirrorKey: string;
  userId: string;
  generation: string;
  activityAt: string;
}

export interface CardMirrorStatus {
  userId: string;
  complete: boolean;
  syncing: boolean;
  libraryEpoch?: number;
  generation: string;
  expectedTotal: number;
  loaded: number;
  syncedAt: string | null;
}

/** Identity captured from a complete mirror before serving it as an offline fallback. */
export interface CardMirrorQueryExpectation {
  complete: true;
  syncing: boolean;
  generation: string;
  libraryEpoch: number;
}

/** Indicates that metadata changed after a fallback snapshot was captured. */
export const CARD_MIRROR_SNAPSHOT_INVALIDATED = Symbol('card-mirror-snapshot-invalidated');
export type CardMirrorQueryResult = LocalCardPage | null | typeof CARD_MIRROR_SNAPSHOT_INVALIDATED;

export function isCardMirrorFresh(
  status: CardMirrorStatus | null,
  expectedTotal: number,
  now = Date.now(),
  maxAgeMs = 15 * 60 * 1000,
  expectedLibraryEpoch?: number,
): boolean {
  if (!status?.complete || status.syncing || !status.syncedAt) return false;
  if (expectedLibraryEpoch !== undefined) {
    const statusEpoch = Number.isSafeInteger(status.libraryEpoch)
      && Number(status.libraryEpoch) >= 0
      ? Number(status.libraryEpoch)
      : 0;
    const expectedEpoch = Number.isSafeInteger(expectedLibraryEpoch)
      && expectedLibraryEpoch >= 0
      ? expectedLibraryEpoch
      : 0;
    if (statusEpoch !== expectedEpoch) return false;
  }
  const syncedAt = Date.parse(status.syncedAt);
  return Number.isFinite(syncedAt)
    && now - syncedAt < maxAgeMs
    && status.expectedTotal >= Math.max(0, expectedTotal);
}

let databasePromise: Promise<IDBDatabase> | null = null;
let activeDatabase: IDBDatabase | null = null;

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction was aborted.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
  });
}

function registerCardMirrorDatabase(database: IDBDatabase): IDBDatabase {
  activeDatabase = database;
  database.onversionchange = () => {
    database.close();
    if (activeDatabase === database) activeDatabase = null;
    databasePromise = null;
  };
  return database;
}

function assertCompatibleCardMirrorSchema(database: IDBDatabase): void {
  if (
    !database.objectStoreNames.contains(CARD_STORE)
    || !database.objectStoreNames.contains(META_STORE)
  ) {
    throw new Error('The existing card mirror uses an incompatible schema.');
  }
  const transaction = database.transaction(CARD_STORE, 'readonly');
  const indexes = transaction.objectStore(CARD_STORE).indexNames;
  for (const index of ['userId', 'userNormalizedWord', 'userActivityAt']) {
    if (!indexes.contains(index)) {
      throw new Error('The existing card mirror uses an incompatible schema.');
    }
  }
}

function openCardMirrorDatabase(
  version: number | undefined,
  onUpgrade?: (request: IDBOpenDBRequest, event: IDBVersionChangeEvent) => void,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let deadline: ReturnType<typeof setTimeout> | null = null;
    const clearDeadline = () => {
      if (deadline !== null) clearTimeout(deadline);
    };
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      clearDeadline();
      reject(error);
    };
    const resolveOnce = (database: IDBDatabase) => {
      if (settled) return;
      settled = true;
      clearDeadline();
      resolve(database);
    };

    try {
      const request = version === undefined
        ? indexedDB.open(DATABASE_NAME)
        : indexedDB.open(DATABASE_NAME, version);
      deadline = setTimeout(
        () => rejectOnce(new Error(cardMirrorOpenTimeoutMessage)),
        CARD_MIRROR_OPEN_TIMEOUT_MS,
      );
      request.onblocked = () => rejectOnce(new Error(cardMirrorBlockedMessage));
      request.onerror = () => rejectOnce(request.error ?? new Error('Could not open the card mirror.'));
      request.onsuccess = () => {
        if (settled) {
          request.result.close();
          return;
        }
        resolveOnce(request.result);
      };
      if (onUpgrade) request.onupgradeneeded = event => onUpgrade(request, event);
    } catch (cause) {
      rejectOnce(cause instanceof Error ? cause : new Error('Could not open the card mirror.'));
    }
  });
}

function openForwardCompatibleCardMirror(): Promise<IDBDatabase> {
  return openCardMirrorDatabase(undefined).then(database => {
    try {
      assertCompatibleCardMirrorSchema(database);
      return registerCardMirrorDatabase(database);
    } catch (cause) {
      database.close();
      throw cause;
    }
  });
}

function backfillCardActivityIndex(cards: IDBObjectStore): void {
  const cursorRequest = cards.openCursor();
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) return;
    const value = cursor.value as Partial<MirroredCard>;
    const activityAt = cardActivityTimestamp({
      createdAt: value.createdAt,
      lastOpenedAt: value.lastOpenedAt,
      sortTouchedAt: value.sortTouchedAt,
    });
    if (value.activityAt !== activityAt) cursor.update({ ...value, activityAt });
    cursor.continue();
  };
}

function openCardMirror(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB is unavailable.'));
  const opening = openCardMirrorDatabase(DATABASE_VERSION, (request, event) => {
    const database = request.result;
    const cards = database.objectStoreNames.contains(CARD_STORE)
      ? request.transaction?.objectStore(CARD_STORE)
      : database.createObjectStore(CARD_STORE, { keyPath: 'mirrorKey' });
    if (!cards) return;
    if (!cards.indexNames.contains('userId')) cards.createIndex('userId', 'userId');
    if (!cards.indexNames.contains('userNormalizedWord')) cards.createIndex('userNormalizedWord', ['userId', 'normalizedWord']);
    if (!cards.indexNames.contains('userCreatedAt')) cards.createIndex('userCreatedAt', ['userId', 'createdAt', 'id']);
    if (!cards.indexNames.contains('userActivityAt')) cards.createIndex('userActivityAt', ['userId', 'activityAt', 'id']);
    if (!database.objectStoreNames.contains(META_STORE)) database.createObjectStore(META_STORE, { keyPath: 'userId' });
    if (event.oldVersion < 2) backfillCardActivityIndex(cards);
  }).then(registerCardMirrorDatabase).catch(error => {
    if (error instanceof Error && error.name === 'VersionError') {
      return openForwardCompatibleCardMirror();
    }
    throw error;
  });
  databasePromise = opening;
  void opening.catch(() => {
    if (databasePromise === opening) databasePromise = null;
  });
  return opening;
}

/** Test-only lifecycle seam. Production connections close on versionchange. */
export function closeCardMirrorForTests(): void {
  activeDatabase?.close();
  activeDatabase = null;
  databasePromise = null;
}

const mirrorKey = (userId: string, cardId: string) => JSON.stringify([userId, cardId]);

async function readStatus(database: IDBDatabase, userId: string): Promise<CardMirrorStatus | null> {
  const transaction = database.transaction(META_STORE, 'readonly');
  const done = transactionDone(transaction);
  const result = await requestResult(transaction.objectStore(META_STORE).get(userId));
  await done;
  return result ? result as CardMirrorStatus : null;
}

export async function getCardMirrorStatus(userId: string): Promise<CardMirrorStatus | null> {
  return readStatus(await openCardMirror(), userId);
}

export async function beginCardMirrorSync(
  userId: string,
  expectedTotal: number,
  libraryEpoch?: number,
): Promise<string> {
  const database = await openCardMirror();
  const previous = await readStatus(database, userId);
  const randomPart = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  const generation = `${Date.now().toString(36)}-${randomPart}`;
  const safeLibraryEpoch = libraryEpoch === undefined
    ? undefined
    : safeProtocolNumber(libraryEpoch);
  const previousEpoch = safeProtocolNumber(previous?.libraryEpoch);
  const sameLibraryEpoch = safeLibraryEpoch === undefined || previousEpoch === safeLibraryEpoch;
  const retainsLastKnownCompleteMirror = sameLibraryEpoch && previous?.complete === true;
  const transaction = database.transaction(META_STORE, 'readwrite');
  transaction.objectStore(META_STORE).put({
    userId,
    // An in-place refresh retains a complete same-epoch snapshot until cleanup succeeds.
    // Partial writes can safely add or update same-epoch cards, but never remove old cards.
    complete: retainsLastKnownCompleteMirror,
    syncing: true,
    ...(safeLibraryEpoch !== undefined
      ? { libraryEpoch: safeLibraryEpoch }
      : previous?.libraryEpoch !== undefined
        ? { libraryEpoch: previous.libraryEpoch }
        : {}),
    generation,
    expectedTotal: retainsLastKnownCompleteMirror
      ? previous.expectedTotal
      : Math.max(0, Math.floor(expectedTotal)),
    loaded: retainsLastKnownCompleteMirror ? previous.loaded : 0,
    syncedAt: retainsLastKnownCompleteMirror ? previous.syncedAt : null,
  } satisfies CardMirrorStatus);
  await transactionDone(transaction);
  return generation;
}

export async function upsertMirroredCardBatch(
  userId: string,
  cards: readonly CardData[],
  generation?: string,
): Promise<void> {
  if (cards.length === 0) return;
  if (cards.length > MAX_BATCH_SIZE) throw new Error(`A mirror batch may contain at most ${MAX_BATCH_SIZE} cards.`);
  const database = await openCardMirror();
  const transaction = database.transaction([CARD_STORE, META_STORE], 'readwrite');
  const done = transactionDone(transaction);
  const status = await requestResult(transaction.objectStore(META_STORE).get(userId)) as CardMirrorStatus | undefined;
  if (generation !== undefined && (
    status?.generation !== generation || status.syncing !== true
  )) {
    await done;
    return;
  }
  const activeGeneration = generation ?? status?.generation ?? 'local';
  const store = transaction.objectStore(CARD_STORE);
  cards.forEach(card => {
    const normalized = normalizeCardData(card, card.id);
    store.put({
      ...normalized,
      normalizedWord: normalizeCardWord(normalized.normalizedWord || normalized.word),
      createdAt: normalized.createdAt || new Date(0).toISOString(),
      activityAt: cardActivityTimestamp(normalized),
      mirrorKey: mirrorKey(userId, normalized.id),
      userId,
      generation: activeGeneration,
    } satisfies MirroredCard);
  });
  await done;
  if (generation === undefined) await refreshCompletedMirrorCount(database, userId);
}

export async function upsertMirroredCardIfNotOlderThan(
  userId: string,
  card: CardData,
): Promise<boolean> {
  const database = await openCardMirror();
  const transaction = database.transaction([CARD_STORE, META_STORE], 'readwrite');
  const done = transactionDone(transaction);
  const metaStore = transaction.objectStore(META_STORE);
  const store = transaction.objectStore(CARD_STORE);
  const key = mirrorKey(userId, card.id);
  const normalized = normalizeCardData(card, card.id);
  const normalizedWord = normalizeCardWord(normalized.normalizedWord || normalized.word);
  const [status, existing, sameWordCards] = await Promise.all([
    requestResult(metaStore.get(userId)) as Promise<CardMirrorStatus | undefined>,
    requestResult(store.get(key)) as Promise<MirroredCard | undefined>,
    normalizedWord
      ? requestResult(
          store.index('userNormalizedWord').getAll(IDBKeyRange.only([userId, normalizedWord])),
        ) as Promise<MirroredCard[]>
      : Promise.resolve([] as MirroredCard[]),
  ]);
  const activeGeneration = status?.generation ?? existing?.generation ?? 'local';
  if (existing && isCardVersionNewer(existing, normalized)) {
    const existingIsFromNewerEpoch = status?.syncing === true
      && status.libraryEpoch !== undefined
      && safeProtocolNumber(existing.libraryEpoch) > safeProtocolNumber(status.libraryEpoch);
    if (existingIsFromNewerEpoch) {
      metaStore.put({
        ...status,
        complete: false,
        syncing: false,
        syncedAt: null,
      } satisfies CardMirrorStatus);
    } else if (existing.generation !== activeGeneration) {
      store.put({ ...existing, generation: activeGeneration } satisfies MirroredCard);
    }
    await done;
    return false;
  }

  const incomingEpoch = safeProtocolNumber(normalized.libraryEpoch);
  const futureWordCards = sameWordCards.filter(candidate =>
    candidate.id !== normalized.id
    && safeProtocolNumber(candidate.libraryEpoch) > incomingEpoch);
  if (futureWordCards.length > 0) {
    const highestEpoch = Math.max(
      ...futureWordCards.map(candidate => safeProtocolNumber(candidate.libraryEpoch)),
    );
    const preferredFuture = futureWordCards
      .filter(candidate => safeProtocolNumber(candidate.libraryEpoch) === highestEpoch)
      .reduce(preferCardWithLearningProgress);
    let deletedDuplicate = false;
    sameWordCards.forEach(candidate => {
      if (candidate.mirrorKey === preferredFuture.mirrorKey) return;
      store.delete(candidate.mirrorKey);
      deletedDuplicate = true;
    });
    if (status?.syncing === true && safeProtocolNumber(status.libraryEpoch) < highestEpoch) {
      metaStore.put({
        ...status,
        complete: false,
        syncing: false,
        syncedAt: null,
      } satisfies CardMirrorStatus);
    }
    await done;
    if (deletedDuplicate) await refreshCompletedMirrorCount(database, userId);
    return false;
  }

  sameWordCards.forEach(candidate => {
    if (candidate.id !== normalized.id) store.delete(candidate.mirrorKey);
  });
  store.put({
    ...normalized,
    normalizedWord,
    createdAt: normalized.createdAt || new Date(0).toISOString(),
    activityAt: cardActivityTimestamp(normalized),
    mirrorKey: key,
    userId,
    generation: activeGeneration,
  } satisfies MirroredCard);
  await done;
  await refreshCompletedMirrorCount(database, userId);
  return true;
}

export async function patchMirroredCardBatch(
  userId: string,
  patches: readonly { cardId: string; fields: Partial<CardData> }[],
  generation?: string,
): Promise<void> {
  if (patches.length === 0) return;
  if (patches.length > MAX_BATCH_SIZE) throw new Error(`A mirror patch batch may contain at most ${MAX_BATCH_SIZE} cards.`);
  const database = await openCardMirror();
  const transaction = database.transaction([CARD_STORE, META_STORE], 'readwrite');
  const done = transactionDone(transaction);
  const status = await requestResult(transaction.objectStore(META_STORE).get(userId)) as CardMirrorStatus | undefined;
  if (generation !== undefined && (
    status?.generation !== generation || status.syncing !== true
  )) {
    await done;
    return;
  }
  const activeGeneration = generation ?? status?.generation ?? 'local';
  const store = transaction.objectStore(CARD_STORE);
  await Promise.all(patches.map(async ({ cardId, fields }) => {
    const existing = await requestResult(store.get(mirrorKey(userId, cardId))) as MirroredCard | undefined;
    if (!existing) return;
    const normalized = normalizeCardData({ ...existing, ...fields, id: existing.id }, existing.id);
    store.put({
      ...normalized,
      mirrorKey: existing.mirrorKey,
      userId,
      generation: activeGeneration,
      activityAt: cardActivityTimestamp(normalized),
    } satisfies MirroredCard);
  }));
  await done;
}

function isCardCompatibleWithLibraryEpoch(
  card: Pick<CardData, 'libraryEpoch'>,
  expectedLibraryEpoch: number | undefined,
): boolean {
  if (expectedLibraryEpoch === undefined) return true;
  if (card.libraryEpoch === undefined) return true;
  return Number.isSafeInteger(card.libraryEpoch)
    && Number(card.libraryEpoch) === expectedLibraryEpoch;
}

async function countMirroredCardsInStore(
  cards: IDBObjectStore,
  userId: string,
  expectedLibraryEpoch?: number,
): Promise<number> {
  const userIndex = cards.index('userId');
  if (expectedLibraryEpoch === undefined) {
    return requestResult(userIndex.count(IDBKeyRange.only(userId)));
  }
  const cursorRequest = userIndex.openCursor(IDBKeyRange.only(userId));
  let count = 0;
  await new Promise<void>((resolve, reject) => {
    cursorRequest.onerror = () => reject(cursorRequest.error ?? new Error('Could not count mirrored cards.'));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) {
        resolve();
        return;
      }
      if (isCardCompatibleWithLibraryEpoch(cursor.value as MirroredCard, expectedLibraryEpoch)) count += 1;
      cursor.continue();
    };
  });
  return count;
}

async function countMirroredCards(
  database: IDBDatabase,
  userId: string,
  expectedLibraryEpoch?: number,
): Promise<number> {
  const transaction = database.transaction(CARD_STORE, 'readonly');
  const done = transactionDone(transaction);
  const count = await countMirroredCardsInStore(
    transaction.objectStore(CARD_STORE),
    userId,
    expectedLibraryEpoch,
  );
  await done;
  return count;
}

function statusLibraryEpoch(status: CardMirrorStatus): number {
  return Number.isSafeInteger(status.libraryEpoch) && Number(status.libraryEpoch) >= 0
    ? Number(status.libraryEpoch)
    : 0;
}

async function refreshCompletedMirrorCount(database: IDBDatabase, userId: string): Promise<void> {
  const status = await readStatus(database, userId);
  if (!status?.complete || status.syncing) return;
  const count = await countMirroredCards(database, userId, statusLibraryEpoch(status));
  const transaction = database.transaction(META_STORE, 'readwrite');
  const done = transactionDone(transaction);
  const store = transaction.objectStore(META_STORE);
  const latestStatus = await requestResult(store.get(userId)) as CardMirrorStatus | undefined;
  if (
    latestStatus?.complete
    && !latestStatus.syncing
    && latestStatus.generation === status.generation
    && latestStatus.libraryEpoch === status.libraryEpoch
  ) {
    const localCountDelta = count - latestStatus.loaded;
    store.put({
      ...latestStatus,
      expectedTotal: Math.max(0, latestStatus.expectedTotal + localCountDelta),
      loaded: count,
    } satisfies CardMirrorStatus);
  }
  await done;
}

async function cleanupCompletedGeneration(
  transaction: IDBTransaction,
  userId: string,
  generation: string,
  expectedLibraryEpoch?: number,
): Promise<number> {
  const store = transaction.objectStore(CARD_STORE);
  const userIndex = store.index('userId');
  const cursorRequest = userIndex.openCursor(IDBKeyRange.only(userId));
  await new Promise<void>((resolve, reject) => {
    cursorRequest.onerror = () => reject(cursorRequest.error);
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) {
        resolve();
        return;
      }
      if ((cursor.value as MirroredCard).generation !== generation) cursor.delete();
      cursor.continue();
    };
  });

  const wordIndex = store.index('userNormalizedWord');
  const range = IDBKeyRange.bound([userId, ''], [userId, '\uffff']);
  const wordCursorRequest = wordIndex.openCursor(range);
  let selected: MirroredCard | null = null;
  await new Promise<void>((resolve, reject) => {
    wordCursorRequest.onerror = () => reject(wordCursorRequest.error);
    wordCursorRequest.onsuccess = () => {
      const cursor = wordCursorRequest.result;
      if (!cursor) {
        resolve();
        return;
      }
      const current = cursor.value as MirroredCard;
      if (selected && cardWordKey(selected) === cardWordKey(current)) {
        const preferred = preferCardWithLearningProgress(selected, current);
        if (preferred.mirrorKey === selected.mirrorKey) cursor.delete();
        else {
          store.delete(selected.mirrorKey);
          selected = current;
        }
      } else {
        selected = current;
      }
      cursor.continue();
    };
  });

  return countMirroredCardsInStore(store, userId, expectedLibraryEpoch);
}

export async function finishCardMirrorSync(
  userId: string,
  generation: string,
  expectedTotal: number,
  observedTotal = expectedTotal,
): Promise<boolean> {
  // The caller's captured cloud total is authoritative for this generation. The metadata can
  // intentionally retain an older complete snapshot's total until this cleanup succeeds.
  const authoritativeExpectedTotal = Math.max(0, Math.floor(expectedTotal));
  if (Math.max(0, Math.floor(observedTotal)) < authoritativeExpectedTotal) return false;

  const database = await openCardMirror();
  const transaction = database.transaction([META_STORE, CARD_STORE], 'readwrite');
  const done = transactionDone(transaction);
  const metadata = transaction.objectStore(META_STORE);
  const status = await requestResult(metadata.get(userId)) as CardMirrorStatus | undefined;
  const finished = status?.generation === generation && status.syncing === true;
  if (finished && status) {
    const loaded = await cleanupCompletedGeneration(
      transaction,
      userId,
      generation,
      statusLibraryEpoch(status),
    );
    metadata.put({
      userId,
      complete: true,
      syncing: false,
      ...(status.libraryEpoch !== undefined
        ? { libraryEpoch: status.libraryEpoch }
        : {}),
      generation,
      expectedTotal: authoritativeExpectedTotal,
      loaded,
      syncedAt: new Date().toISOString(),
    } satisfies CardMirrorStatus);
  }
  await done;
  return finished;
}

export async function invalidateCardMirrorGeneration(
  userId: string,
  generation: string,
  retainLastKnownComplete = true,
): Promise<boolean> {
  const database = await openCardMirror();
  const transaction = database.transaction(META_STORE, 'readwrite');
  const done = transactionDone(transaction);
  const store = transaction.objectStore(META_STORE);
  const status = await requestResult(store.get(userId)) as CardMirrorStatus | undefined;
  const invalidated = status?.generation === generation;
  if (invalidated && status) {
    store.put({
      ...status,
      // Keep an in-place same-epoch refresh's last known complete snapshot only when the
      // caller has not observed an epoch change. Clearing syncedAt schedules a retry.
      complete: retainLastKnownComplete && status.complete,
      syncing: false,
      syncedAt: null,
    } satisfies CardMirrorStatus);
  }
  await done;
  return invalidated;
}

function publicCard(value: MirroredCard): CardData {
  const { mirrorKey: _mirrorKey, userId: _userId, generation: _generation, activityAt: _activityAt, ...card } = value;
  return card;
}

export async function queryMirroredCardPage(
  userId: string,
  filters: CardQueryState,
  page: number,
  pageSize: number,
  expectation?: CardMirrorQueryExpectation,
): Promise<CardMirrorQueryResult> {
  const database = await openCardMirror();
  const safePage = Math.max(1, Math.floor(page) || 1);
  const safePageSize = Math.max(1, Math.floor(pageSize) || 1);
  const start = (safePage - 1) * safePageSize;
  const isUnfiltered = !filters.category
    && !filters.customDeck
    && !filters.difficulty
    && !filters.partOfSpeech
    && !filters.bookmarkedOnly
    && !filters.createdDate
    && !filters.wordPrefix;
  const transaction = database.transaction([CARD_STORE, META_STORE], 'readonly');
  const done = transactionDone(transaction);
  const metaStore = transaction.objectStore(META_STORE);
  const cards = transaction.objectStore(CARD_STORE);
  const status = expectation
    ? await requestResult(metaStore.get(userId)) as CardMirrorStatus | undefined
    : undefined;
  if (expectation && (
    status?.complete !== expectation.complete
    || status?.syncing !== expectation.syncing
    || status?.generation !== expectation.generation
    || (status ? statusLibraryEpoch(status) : undefined) !== expectation.libraryEpoch
  )) {
    await done;
    return CARD_MIRROR_SNAPSHOT_INVALIDATED;
  }

  const expectedLibraryEpoch = expectation?.libraryEpoch;
  const unfilteredTotal = isUnfiltered
    ? await countMirroredCardsInStore(cards, userId, expectedLibraryEpoch)
    : null;
  if (unfilteredTotal !== null && start >= unfilteredTotal) {
    await done;
    return null;
  }
  const index = cards.index('userActivityAt');
  const range = IDBKeyRange.bound([userId, ''], [userId, '\uffff', '\uffff']);
  const cursorRequest = index.openCursor(range, 'prev');
  const items: CardData[] = [];
  let total = 0;
  let advancedToStart = start === 0;
  await new Promise<void>((resolve, reject) => {
    cursorRequest.onerror = () => reject(cursorRequest.error ?? new Error('Could not query mirrored cards.'));
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) {
        resolve();
        return;
      }
      if (isUnfiltered && !expectation) {
        if (!advancedToStart) {
          advancedToStart = true;
          cursor.advance(start);
          return;
        }
        items.push(publicCard(cursor.value as MirroredCard));
        if (items.length >= safePageSize) {
          resolve();
          return;
        }
        cursor.continue();
        return;
      }
      const mirrored = cursor.value as MirroredCard;
      if (!isCardCompatibleWithLibraryEpoch(mirrored, expectedLibraryEpoch)) {
        cursor.continue();
        return;
      }
      const card = publicCard(mirrored);
      if (isUnfiltered || cardMatchesQuery(card, filters)) {
        if (total >= start && items.length < safePageSize) items.push(card);
        total += 1;
        if (isUnfiltered && items.length >= safePageSize) {
          resolve();
          return;
        }
      }
      cursor.continue();
    };
  });
  await done;
  if (items.length === 0) return null;
  const pageTotal = unfilteredTotal ?? total;
  return {
    items,
    total: pageTotal,
    hasNext: start + items.length < pageTotal,
  };
}

export async function findMirroredCardByWord(userId: string, word: string): Promise<CardData | null> {
  const normalizedWord = normalizeCardWord(word);
  if (!normalizedWord) return null;
  const database = await openCardMirror();
  const transaction = database.transaction(CARD_STORE, 'readonly');
  const done = transactionDone(transaction);
  const values = await requestResult(
    transaction.objectStore(CARD_STORE)
      .index('userNormalizedWord')
      .getAll(IDBKeyRange.only([userId, normalizedWord])),
  ) as MirroredCard[];
  await done;
  if (values.length === 0) return null;
  return publicCard(values.reduce(preferCardWithLearningProgress));
}

export async function deleteMirroredCard(userId: string, cardId: string): Promise<void> {
  const database = await openCardMirror();
  const transaction = database.transaction(CARD_STORE, 'readwrite');
  transaction.objectStore(CARD_STORE).delete(mirrorKey(userId, cardId));
  await transactionDone(transaction);
  await refreshCompletedMirrorCount(database, userId);
}

async function deleteMirroredCardWhen(
  userId: string,
  cardId: string,
  shouldDelete: (card: MirroredCard) => boolean,
): Promise<boolean> {
  const database = await openCardMirror();
  const transaction = database.transaction(CARD_STORE, 'readwrite');
  const store = transaction.objectStore(CARD_STORE);
  const existing = await requestResult(store.get(mirrorKey(userId, cardId))) as MirroredCard | undefined;
  const deleted = Boolean(existing && shouldDelete(existing));
  if (deleted) store.delete(mirrorKey(userId, cardId));
  await transactionDone(transaction);
  if (deleted) await refreshCompletedMirrorCount(database, userId);
  return deleted;
}

const safeProtocolNumber = (value: unknown): number =>
  Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;

const isCardVersionNewer = (left: CardData, right: CardData): boolean => {
  const leftEpoch = safeProtocolNumber(left.libraryEpoch);
  const rightEpoch = safeProtocolNumber(right.libraryEpoch);
  return leftEpoch > rightEpoch
    || (leftEpoch === rightEpoch
      && safeProtocolNumber(left.revision) > safeProtocolNumber(right.revision));
};

export function deleteMirroredCardIfOlderThan(
  userId: string,
  cardId: string,
  activeLibraryEpoch: number,
): Promise<boolean> {
  const safeActiveEpoch = safeProtocolNumber(activeLibraryEpoch);
  return deleteMirroredCardWhen(
    userId,
    cardId,
    card => safeProtocolNumber(card.libraryEpoch) < safeActiveEpoch,
  );
}

export function deleteMirroredCardIfNotNewerThan(
  userId: string,
  cardId: string,
  maximum: { libraryEpoch: number; revision: number },
): Promise<boolean> {
  const maximumEpoch = safeProtocolNumber(maximum.libraryEpoch);
  const maximumRevision = safeProtocolNumber(maximum.revision);
  return deleteMirroredCardWhen(userId, cardId, card => {
    const cardEpoch = safeProtocolNumber(card.libraryEpoch);
    return cardEpoch < maximumEpoch
      || (cardEpoch === maximumEpoch && safeProtocolNumber(card.revision) <= maximumRevision);
  });
}

export async function clearMirroredCards(userId: string): Promise<void> {
  const database = await openCardMirror();
  const transaction = database.transaction([CARD_STORE, META_STORE], 'readwrite');
  const done = transactionDone(transaction);
  const store = transaction.objectStore(CARD_STORE);
  const cursorRequest = store.index('userId').openCursor(IDBKeyRange.only(userId));
  await new Promise<void>((resolve, reject) => {
    cursorRequest.onerror = () => reject(cursorRequest.error);
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) {
        resolve();
        return;
      }
      cursor.delete();
      cursor.continue();
    };
  });
  transaction.objectStore(META_STORE).delete(userId);
  await done;
}
