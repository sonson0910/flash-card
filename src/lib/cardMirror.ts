import type { CardData } from '../types/card';
import { normalizeCardData } from './cardNormalization';
import {
  cardWordKey,
  normalizeCardWord,
  preferCardWithLearningProgress,
} from './cardIdentity';
import { cardMatchesQuery, type CardQueryState, type LocalCardPage } from './cardQuery';

const DATABASE_NAME = 'sonflash-card-mirror';
const DATABASE_VERSION = 1;
const CARD_STORE = 'cards';
const META_STORE = 'sync-meta';
const MAX_BATCH_SIZE = 100;

interface MirroredCard extends CardData {
  mirrorKey: string;
  userId: string;
  generation: string;
}

export interface CardMirrorStatus {
  userId: string;
  complete: boolean;
  syncing: boolean;
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
): boolean {
  if (!status?.complete || status.syncing || !status.syncedAt) return false;
  const syncedAt = Date.parse(status.syncedAt);
  return Number.isFinite(syncedAt)
    && now - syncedAt < maxAgeMs
    && status.expectedTotal >= Math.max(0, expectedTotal);
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
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction was aborted.'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
  });
}

function openCardMirror(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB is unavailable.'));
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      const cards = database.createObjectStore(CARD_STORE, { keyPath: 'mirrorKey' });
      cards.createIndex('userId', 'userId');
      cards.createIndex('userNormalizedWord', ['userId', 'normalizedWord']);
      cards.createIndex('userCreatedAt', ['userId', 'createdAt', 'id']);
      database.createObjectStore(META_STORE, { keyPath: 'userId' });
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
      reject(request.error ?? new Error('Could not open the card mirror.'));
    };
  });
  return databasePromise;
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

export async function beginCardMirrorSync(userId: string, expectedTotal: number): Promise<string> {
  const database = await openCardMirror();
  const previous = await readStatus(database, userId);
  const randomPart = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  const generation = `${Date.now().toString(36)}-${randomPart}`;
  const transaction = database.transaction(META_STORE, 'readwrite');
  transaction.objectStore(META_STORE).put({
    userId,
    complete: previous?.complete ?? false,
    syncing: true,
    generation,
    expectedTotal: Math.max(0, Math.floor(expectedTotal)),
    loaded: previous?.loaded ?? 0,
    syncedAt: previous?.syncedAt ?? null,
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
  if (generation !== undefined && status?.generation !== generation) {
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
      mirrorKey: mirrorKey(userId, normalized.id),
      userId,
      generation: activeGeneration,
    } satisfies MirroredCard);
  });
  await done;
  if (generation === undefined) await refreshCompletedMirrorCount(database, userId);
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
  if (generation !== undefined && status?.generation !== generation) {
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

async function cleanupCompletedGeneration(
  database: IDBDatabase,
  userId: string,
  generation: string,
): Promise<number> {
  const transaction = database.transaction(CARD_STORE, 'readwrite');
  const done = transactionDone(transaction);
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
  await done;

  const dedupeTransaction = database.transaction(CARD_STORE, 'readwrite');
  const dedupeDone = transactionDone(dedupeTransaction);
  const dedupeStore = dedupeTransaction.objectStore(CARD_STORE);
  const wordIndex = dedupeStore.index('userNormalizedWord');
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
          dedupeStore.delete(selected.mirrorKey);
          selected = current;
        }
      } else {
        selected = current;
      }
      cursor.continue();
    };
  });
  await dedupeDone;

  return countMirroredCards(database, userId);
}

export async function finishCardMirrorSync(
  userId: string,
  generation: string,
  expectedTotal: number,
): Promise<void> {
  const database = await openCardMirror();
  const status = await readStatus(database, userId);
  if (!status || status.generation !== generation) return;
  const loaded = await cleanupCompletedGeneration(database, userId, generation);
  const transaction = database.transaction(META_STORE, 'readwrite');
  const done = transactionDone(transaction);
  const store = transaction.objectStore(META_STORE);
  const latestStatus = await requestResult(store.get(userId)) as CardMirrorStatus | undefined;
  if (latestStatus?.generation === generation) {
    store.put({
      userId,
      complete: true,
      syncing: false,
      generation,
      expectedTotal: Math.max(expectedTotal, loaded),
      loaded,
      syncedAt: new Date().toISOString(),
    } satisfies CardMirrorStatus);
  }
  await done;
}

function publicCard(value: MirroredCard): CardData {
  const { mirrorKey: _mirrorKey, userId: _userId, generation: _generation, ...card } = value;
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
    && !filters.customDeck
    && !filters.difficulty
    && !filters.partOfSpeech
    && !filters.bookmarkedOnly
    && !filters.createdDate
    && !filters.wordPrefix;
  const unfilteredTotal = isUnfiltered ? await countMirroredCards(database, userId) : null;
  if (unfilteredTotal !== null && start >= unfilteredTotal) return null;
  const transaction = database.transaction(CARD_STORE, 'readonly');
  const done = transactionDone(transaction);
  const index = transaction.objectStore(CARD_STORE).index('userCreatedAt');
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
