import type { CardData } from '../types/card';
import { ALL_PRACTICE_DECK_SCOPE } from './practiceScope';
import { normalizeCardData } from './cardNormalization';
import {
  cardLogicalKey,
  normalizeCardWord,
  preferCardWithLearningProgress,
} from './cardIdentity';
import { cardActivityTimestamp, cardMatchesQuery, type CardQueryState, type LocalCardPage } from './cardQuery';

const DATABASE_NAME = 'sonflash-card-mirror';
const DATABASE_VERSION = 2;
const CARD_STORE = 'cards';
const META_STORE = 'sync-meta';
const MAX_BATCH_SIZE = 100;
const OPEN_TIMEOUT_MS = 5_000;

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
let databaseAttempt = 0;

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

function openDatabaseRequest(version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = version === undefined
      ? indexedDB.open(DATABASE_NAME)
      : indexedDB.open(DATABASE_NAME, version);
    let settled = false;
    const timeout = setTimeout(() => settleReject(new Error('Timed out while opening the card mirror.')), OPEN_TIMEOUT_MS);
    const settleReject = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    };
    request.onblocked = () => settleReject(new Error('Opening the card mirror was blocked by another tab.'));
    request.onerror = () => settleReject(request.error ?? new Error('Could not open the card mirror.'));
    request.onsuccess = () => {
      const database = request.result;
      if (settled) {
        database.close();
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(database);
    };
  });
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
  const attempt = ++databaseAttempt;
  let promise: Promise<IDBDatabase>;
  const openVersioned = () => new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    let settled = false;
    const timeout = setTimeout(() => fail(new Error('Timed out while opening the card mirror.')), OPEN_TIMEOUT_MS);
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    };
    request.onblocked = () => fail(new Error('Opening the card mirror was blocked by another tab.'));
    request.onupgradeneeded = event => {
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
      if ((event as IDBVersionChangeEvent).oldVersion < 2) backfillCardActivityIndex(cards);
    };
    request.onerror = () => fail(request.error ?? new Error('Could not open the card mirror.'));
    request.onsuccess = () => {
      const database = request.result;
      if (settled) {
        database.close();
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(database);
    };
  });
  promise = openVersioned()
    .catch(error => error.name === 'VersionError' ? openDatabaseRequest() : Promise.reject(error))
    .then(database => {
      if (attempt !== databaseAttempt || databasePromise !== promise) {
        database.close();
        throw new Error('A newer card mirror open attempt replaced this one.');
      }
      try {
        assertCompatibleCardMirrorSchema(database);
        return registerCardMirrorDatabase(database);
      } catch (error) {
        database.close();
        throw error;
      }
    })
    .catch(error => {
      if (attempt === databaseAttempt && databasePromise === promise) databasePromise = null;
      throw error;
    });
  databasePromise = promise;
  return promise;
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
  const transaction = database.transaction(META_STORE, 'readwrite');
  transaction.objectStore(META_STORE).put({
    userId,
    complete: sameLibraryEpoch ? previous?.complete ?? false : false,
    syncing: true,
    ...(safeLibraryEpoch !== undefined
      ? { libraryEpoch: safeLibraryEpoch }
      : previous?.libraryEpoch !== undefined
        ? { libraryEpoch: previous.libraryEpoch }
        : {}),
    generation,
    expectedTotal: Math.max(0, Math.floor(expectedTotal)),
    loaded: sameLibraryEpoch ? previous?.loaded ?? 0 : 0,
    syncedAt: sameLibraryEpoch ? previous?.syncedAt ?? null : null,
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
  const existingCards = await Promise.all(cards.map(card =>
    requestResult(store.get(mirrorKey(userId, card.id))) as Promise<MirroredCard | undefined>,
  ));
  let newerCardBlockedGeneration = false;
  cards.forEach((card, index) => {
    const normalized = normalizeCardData(card, card.id);
    const existing = existingCards[index];
    if (existing && isCardVersionNewer(existing, normalized)) {
      const existingIsFromNewerEpoch = generation !== undefined
        && status?.syncing === true
        && safeProtocolNumber(existing.libraryEpoch) > safeProtocolNumber(status.libraryEpoch);
      newerCardBlockedGeneration ||= existingIsFromNewerEpoch;
      if (!existingIsFromNewerEpoch && existing.generation !== activeGeneration) {
        store.put({ ...existing, generation: activeGeneration } satisfies MirroredCard);
      }
      return;
    }
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
  if (newerCardBlockedGeneration && status) {
    transaction.objectStore(META_STORE).put({
      ...status,
      complete: false,
      syncing: false,
      syncedAt: null,
    } satisfies CardMirrorStatus);
  }
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
  const logicalKey = cardLogicalKey(normalized);
  const sameLogicalCards = sameWordCards.filter(candidate => cardLogicalKey(candidate) === logicalKey);
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
  const futureLogicalCards = sameLogicalCards.filter(candidate =>
    candidate.id !== normalized.id
    && safeProtocolNumber(candidate.libraryEpoch) > incomingEpoch);
  if (futureLogicalCards.length > 0) {
    const highestEpoch = Math.max(
      ...futureLogicalCards.map(candidate => safeProtocolNumber(candidate.libraryEpoch)),
    );
    const preferredFuture = futureLogicalCards
      .filter(candidate => safeProtocolNumber(candidate.libraryEpoch) === highestEpoch)
      .reduce(preferCardWithLearningProgress);
    let deletedDuplicate = false;
    sameLogicalCards.forEach(candidate => {
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

  sameLogicalCards.forEach(candidate => {
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
    if (isCardVersionNewer(existing, normalized)) return;
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

async function countMirroredCards(database: IDBDatabase, userId: string): Promise<number> {
  const transaction = database.transaction(CARD_STORE, 'readonly');
  const done = transactionDone(transaction);
  const count = await requestResult(
    transaction.objectStore(CARD_STORE).index('userId').count(IDBKeyRange.only(userId)),
  );
  await done;
  return count;
}

async function refreshCompletedMirrorCount(database: IDBDatabase, userId: string): Promise<void> {
  const count = await countMirroredCards(database, userId);
  const transaction = database.transaction(META_STORE, 'readwrite');
  const done = transactionDone(transaction);
  const store = transaction.objectStore(META_STORE);
  const status = await requestResult(store.get(userId)) as CardMirrorStatus | undefined;
  if (status?.complete && !status.syncing) {
    const localCountDelta = count - status.loaded;
    store.put({
      ...status,
      expectedTotal: Math.max(0, status.expectedTotal + localCountDelta),
      loaded: count,
    } satisfies CardMirrorStatus);
  }
  await done;
}

async function finishGenerationInTransaction(
  database: IDBDatabase,
  userId: string,
  generation: string,
  expectedTotal: number,
): Promise<boolean> {
  const transaction = database.transaction([CARD_STORE, META_STORE], 'readwrite');
  const done = transactionDone(transaction);
  const store = transaction.objectStore(CARD_STORE);
  const metaStore = transaction.objectStore(META_STORE);
  const status = await requestResult(metaStore.get(userId)) as CardMirrorStatus | undefined;
  if (!status || status.generation !== generation || status.syncing !== true) {
    await done;
    return false;
  }
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
      const card = cursor.value as MirroredCard;
      if (card.generation !== generation
        && safeProtocolNumber(card.libraryEpoch) <= safeProtocolNumber(status.libraryEpoch)) cursor.delete();
      cursor.continue();
    };
  });
  const wordIndex = store.index('userNormalizedWord');
  const range = IDBKeyRange.bound([userId, ''], [userId, '\uffff']);
  const wordCursorRequest = wordIndex.openCursor(range);
  const selected = new Map<string, MirroredCard>();
  await new Promise<void>((resolve, reject) => {
    wordCursorRequest.onerror = () => reject(wordCursorRequest.error);
    wordCursorRequest.onsuccess = () => {
      const cursor = wordCursorRequest.result;
      if (!cursor) {
        resolve();
        return;
      }
      const current = cursor.value as MirroredCard;
      const logicalKey = cardLogicalKey(current);
      const previous = selected.get(logicalKey);
      if (previous) {
        const preferred = preferCardWithLearningProgress(previous, current);
        if (preferred.mirrorKey === previous.mirrorKey) cursor.delete();
        else {
          store.delete(previous.mirrorKey);
          selected.set(logicalKey, current);
        }
      } else {
        selected.set(logicalKey, current);
      }
      cursor.continue();
    };
  });
  const loaded = await requestResult(userIndex.count(IDBKeyRange.only(userId)));
  metaStore.put({
    userId,
    complete: true,
    syncing: false,
    ...(status.libraryEpoch !== undefined ? { libraryEpoch: status.libraryEpoch } : {}),
    generation,
    expectedTotal: Math.max(expectedTotal, loaded),
    loaded,
    syncedAt: new Date().toISOString(),
  } satisfies CardMirrorStatus);
  await done;
  return true;
}

export async function finishCardMirrorSync(
  userId: string,
  generation: string,
  expectedTotal: number,
): Promise<boolean> {
  const database = await openCardMirror();
  return finishGenerationInTransaction(database, userId, generation, expectedTotal);
}

export async function invalidateCardMirrorGeneration(
  userId: string,
  generation: string,
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
      complete: false,
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
): Promise<LocalCardPage | null> {
  const database = await openCardMirror();
  const safePage = Math.max(1, Math.floor(page) || 1);
  const safePageSize = Math.max(1, Math.floor(pageSize) || 1);
  const start = (safePage - 1) * safePageSize;
  const isUnfiltered = !filters.category
    && (filters.customDeck?.kind ?? 'all') === ALL_PRACTICE_DECK_SCOPE.kind
    && !filters.difficulty
    && !filters.partOfSpeech
    && !filters.bookmarkedOnly
    && !filters.createdDate
    && !filters.wordPrefix;
  const unfilteredTotal = isUnfiltered ? await countMirroredCards(database, userId) : null;
  if (unfilteredTotal !== null && start >= unfilteredTotal) return null;
  const transaction = database.transaction(CARD_STORE, 'readonly');
  const done = transactionDone(transaction);
  const index = transaction.objectStore(CARD_STORE).index('userActivityAt');
  const range = IDBKeyRange.bound([userId, ''], [userId, '\uffff', '\uffff']);
  const cursorRequest = index.openCursor(range, 'prev');
  const items: CardData[] = [];
  let total = 0;
  let advancedToStart = start === 0;
  await new Promise<void>((resolve, reject) => {
    cursorRequest.onerror = () => reject(cursorRequest.error);
    cursorRequest.onsuccess = () => {
      const cursor = cursorRequest.result;
      if (!cursor) {
        resolve();
        return;
      }
      if (unfilteredTotal !== null) {
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
      const card = publicCard(cursor.value as MirroredCard);
      if (cardMatchesQuery(card, filters)) {
        if (total >= start && items.length < safePageSize) items.push(card);
        total += 1;
      }
      cursor.continue();
    };
  });
  await done;
  if (unfilteredTotal !== null) {
    return items.length === 0 ? null : {
      items,
      total: unfilteredTotal,
      hasNext: start + items.length < unfilteredTotal,
    };
  }
  if (total === 0 || items.length === 0) return null;
  return { items, total, hasNext: start + items.length < total };
}

export async function findMirroredCardByWord(
  userId: string,
  word: string | Pick<CardData, 'word' | 'normalizedWord' | 'lexemeId' | 'language' | 'senseKey' | 'partOfSpeech' | 'normalizedLemma'>,
): Promise<CardData | null> {
  const requested = typeof word === 'string' ? null : word;
  const normalizedWord = normalizeCardWord(typeof word === 'string' ? word : word.normalizedWord || word.word);
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
  const matches = requested?.lexemeId
    ? values.filter(card => cardLogicalKey(card) === `lexeme:${requested.lexemeId}`)
    : values;
  if (matches.length === 0) return null;
  return publicCard(matches.reduce(preferCardWithLearningProgress));
}

export async function deleteMirroredCard(userId: string, cardId: string): Promise<void> {
  const database = await openCardMirror();
  const transaction = database.transaction(CARD_STORE, 'readwrite');
  transaction.objectStore(CARD_STORE).delete(mirrorKey(userId, cardId));
  await transactionDone(transaction);
  await refreshCompletedMirrorCount(database, userId);
}

/** Deletes a pending overlay only while its sync generation remains active. */
export async function deleteMirroredCardForGeneration(
  userId: string,
  cardId: string,
  generation: string,
): Promise<boolean> {
  const database = await openCardMirror();
  const transaction = database.transaction([CARD_STORE, META_STORE], 'readwrite');
  const done = transactionDone(transaction);
  const metaStore = transaction.objectStore(META_STORE);
  const status = await requestResult(metaStore.get(userId)) as CardMirrorStatus | undefined;
  const active = status?.generation === generation && status.syncing === true;
  if (active) transaction.objectStore(CARD_STORE).delete(mirrorKey(userId, cardId));
  await done;
  return active;
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
