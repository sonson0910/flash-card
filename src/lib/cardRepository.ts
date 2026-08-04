import {
  collection,
  doc,
  documentId,
  endAt,
  getCountFromServer as getCount,
  getDocs,
  getDocsFromServer,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  startAfter,
  startAt,
  where,
  writeBatch,
  type DocumentSnapshot,
  type Firestore,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import type { CardData } from '../types/card';
import { mapWithConcurrency } from './asyncPool';
import {
  CLOUD_PAGE_SIZE,
  createDailyPracticePivot,
  createPage,
  normalizePrefixSearch,
  prioritizePracticeCards,
  type CardQueryState,
} from './cardQuery';
import { normalizeCardData } from './cardNormalization';
import {
  cardWordKey,
  createWordCardId,
  dedupeCardsByNormalizedWord,
  preferCardWithLearningProgress,
} from './cardIdentity';
import type { RealtimeChangeType } from './realtimeSync';
import {
  cardAlreadyHasPatch,
  buildCardTombstone,
  normalizeCardOperationId,
  prepareCardForCreate,
  selectMutableCardPatch,
  type CardTombstone,
} from './cardMutationProtocol';

export interface CardPage {
  items: CardData[];
  firstCursor: QueryDocumentSnapshot | null;
  lastCursor: QueryDocumentSnapshot | null;
  hasNext: boolean;
}

export interface RealtimeCardPage extends CardPage {
  changeTypes: RealtimeChangeType[];
  fromCache: boolean;
  hasPendingWrites: boolean;
}

export interface FetchCardPageOptions {
  db: Firestore;
  userId: string;
  filters: CardQueryState;
  cursor?: DocumentSnapshot | null;
  pageSize?: number;
}

export interface LibraryStats {
  total: number;
  reviewed: number;
  easy: number;
  good: number;
  hard: number;
  unrated: number;
  bookmarked: number;
  due: number;
  legacyUnindexed: number;
}

export interface LibraryFacets {
  categories: Record<string, number>;
  complete: boolean;
}

export interface LegacyMigrationResult {
  migrated: number;
  scanned: number;
  complete: boolean;
}

export interface PracticeCardOptions {
  includeFuture?: boolean;
  now?: Date;
}

const EMPTY_FILTERS: CardQueryState = {
  category: null,
  customDeck: null,
  difficulty: null,
  partOfSpeech: null,
  bookmarkedOnly: false,
  createdDate: null,
  wordPrefix: '',
};

function cardsCollection(db: Firestore, userId: string) {
  return collection(db, 'users', userId, 'cards');
}

async function repairNormalizedWord(
  db: Firestore,
  userId: string,
  cardDocument: QueryDocumentSnapshot,
  normalizedWord: string,
): Promise<void> {
  const storedValue = (cardDocument.data() as Partial<CardData>).normalizedWord;
  if (storedValue === normalizedWord) return;
  try {
    const card = cardDocument.data() as Partial<CardData>;
    const libraryEpoch = await getLibraryEpoch(db, userId);
    await applyCardPatchIfCurrent(db, userId, {
      cardId: cardDocument.id,
      fields: { normalizedWord },
      fieldMask: ['normalizedWord'],
      baseRevision: normalizedLibraryEpoch(card.revision),
      libraryEpoch,
    });
  } catch (error) {
    console.warn('A legacy card was found but its search identity could not be repaired.', error);
  }
}

function dateRange(date: string): { start: string; end: string } | null {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  const next = new Date(parsed);
  next.setDate(next.getDate() + 1);
  return { start: parsed.toISOString(), end: next.toISOString() };
}

function filterConstraints(filters: CardQueryState): QueryConstraint[] {
  const constraints: QueryConstraint[] = [];
  if (filters.category) constraints.push(where('category', '==', filters.category));
  if (filters.partOfSpeech) constraints.push(where('partOfSpeech', '==', filters.partOfSpeech));
  if (filters.customDeck === 'unassigned') constraints.push(where('customDeck', '==', null));
  else if (filters.customDeck) constraints.push(where('customDeck', '==', filters.customDeck));
  if (filters.difficulty && filters.difficulty !== 'due') {
    constraints.push(where('difficulty', '==', filters.difficulty));
  }
  if (filters.difficulty === 'due') {
    constraints.push(where('nextReviewDate', '<=', new Date().toISOString()));
  }
  if (filters.bookmarkedOnly) constraints.push(where('bookmarked', '==', true));
  const range = filters.createdDate ? dateRange(filters.createdDate) : null;
  if (range) {
    constraints.push(where('createdAt', '>=', range.start), where('createdAt', '<', range.end));
  }
  return constraints;
}

function orderedConstraints(filters: CardQueryState, cursor: DocumentSnapshot | null): QueryConstraint[] {
  const prefix = normalizePrefixSearch(filters.wordPrefix);
  if (prefix) {
    return [
      orderBy('normalizedWord', 'asc'),
      orderBy(documentId(), 'asc'),
      ...(cursor ? [startAfter(cursor)] : [startAt(prefix)]),
      endAt(`${prefix}\uf8ff`),
    ];
  }
  if (filters.difficulty === 'due') {
    return [
      orderBy('nextReviewDate', 'asc'),
      orderBy(documentId(), 'asc'),
      ...(cursor ? [startAfter(cursor)] : []),
    ];
  }
  return [
    orderBy('createdAt', 'desc'),
    orderBy(documentId(), 'desc'),
    ...(cursor ? [startAfter(cursor)] : []),
  ];
}

function buildCardsQuery(
  db: Firestore,
  userId: string,
  filters: CardQueryState,
  cursor: DocumentSnapshot | null,
  extra: QueryConstraint[] = [],
) {
  return query(
    cardsCollection(db, userId),
    ...filterConstraints(filters),
    ...orderedConstraints(filters, cursor),
    ...extra,
  );
}

export async function fetchCardPage({
  db,
  userId,
  filters,
  cursor = null,
  pageSize = CLOUD_PAGE_SIZE,
}: FetchCardPageOptions): Promise<CardPage> {
  const snapshot = await getDocs(buildCardsQuery(db, userId, filters, cursor, [
    limit(pageSize + 1),
  ]));
  const visible = createPage(snapshot.docs, pageSize);
  return {
    items: dedupeCardsByNormalizedWord(
      visible.items.map(card => normalizeCardData(card.data() as Partial<CardData>, card.id)),
    ),
    firstCursor: visible.items[0] ?? null,
    lastCursor: visible.items[visible.items.length - 1] ?? null,
    hasNext: visible.hasNext,
  };
}

export function subscribeCardPage(
  { db, userId, filters, cursor = null, pageSize = CLOUD_PAGE_SIZE }: FetchCardPageOptions,
  onPage: (page: RealtimeCardPage) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onSnapshot(buildCardsQuery(db, userId, filters, cursor, [
    limit(pageSize + 1),
  ]), snapshot => {
    const visible = createPage(snapshot.docs, pageSize);
    onPage({
      items: dedupeCardsByNormalizedWord(
        visible.items.map(card => normalizeCardData(card.data() as Partial<CardData>, card.id)),
      ),
      firstCursor: visible.items[0] ?? null,
      lastCursor: visible.items[visible.items.length - 1] ?? null,
      hasNext: visible.hasNext,
      changeTypes: snapshot.docChanges().map(change => change.type),
      fromCache: snapshot.metadata.fromCache,
      hasPendingWrites: snapshot.metadata.hasPendingWrites,
    });
  }, onError);
}

export async function countCards(db: Firestore, userId: string, filters: CardQueryState): Promise<number> {
  const prefix = normalizePrefixSearch(filters.wordPrefix);
  const prefixConstraints: QueryConstraint[] = prefix ? [
    orderBy('normalizedWord', 'asc'),
    startAt(prefix),
    endAt(`${prefix}\uf8ff`),
  ] : [];
  const snapshot = await getCount(query(
    cardsCollection(db, userId),
    ...filterConstraints(filters),
    ...prefixConstraints,
  ));
  return snapshot.data().count;
}

export async function countPageableCards(db: Firestore, userId: string): Promise<number> {
  const snapshot = await getCount(query(
    cardsCollection(db, userId),
    orderBy('createdAt', 'desc'),
  ));
  return snapshot.data().count;
}

export async function migrateLegacyCardQueryFields(
  db: Firestore,
  userId: string,
  requestedBatchSize = 100,
): Promise<LegacyMigrationResult> {
  const batchSize = Math.max(1, Math.min(200, Math.floor(requestedBatchSize)));
  const progressRef = doc(db, 'users', userId, 'profile', 'query_migration');
  const progressSnapshot = await getDoc(progressRef);
  const progress = progressSnapshot.exists() ? progressSnapshot.data() : {};
  if (progress.complete === true) return { migrated: 0, scanned: 0, complete: true };

  const lastDocumentId = typeof progress.lastDocumentId === 'string' ? progress.lastDocumentId : null;
  const snapshot = await getDocs(query(
    cardsCollection(db, userId),
    orderBy(documentId(), 'asc'),
    ...(lastDocumentId ? [startAfter(lastDocumentId)] : []),
    limit(batchSize),
  ));

  if (snapshot.empty) {
    await setDoc(progressRef, { complete: true, updatedAt: new Date().toISOString() }, { merge: true });
    return { migrated: 0, scanned: 0, complete: true };
  }

  const libraryEpoch = await getLibraryEpoch(db, userId);
  const migrationResults = await mapWithConcurrency(snapshot.docs, 8, async cardDocument => {
    const card = cardDocument.data() as Partial<CardData>;
    const updates: Partial<CardData> = {};
    if (!card.normalizedWord && card.word) updates.normalizedWord = normalizePrefixSearch(card.word);
    if (card.customDeck === undefined) updates.customDeck = null;
    if (!card.difficulty) updates.difficulty = 'unrated';
    if (card.bookmarked === undefined) updates.bookmarked = false;
    const requiresProtocolUpgrade = card.id !== cardDocument.id
      || card.schemaVersion !== 2
      || normalizedLibraryEpoch(card.libraryEpoch) !== libraryEpoch
      || !Number.isSafeInteger(card.revision)
      || !card.createdAt;
    if (!requiresProtocolUpgrade && Object.keys(updates).length === 0) return false;
    const result = await applyCardPatchIfCurrent(db, userId, {
      cardId: cardDocument.id,
      fields: updates,
      fieldMask: Object.keys(updates) as Array<keyof CardData>,
      baseRevision: normalizedLibraryEpoch(card.revision),
      libraryEpoch,
    });
    return result.applied;
  });
  const migrated = migrationResults.filter(Boolean).length;

  const complete = snapshot.docs.length < batchSize;
  await setDoc(progressRef, {
    lastDocumentId: snapshot.docs[snapshot.docs.length - 1].id,
    complete,
    scanned: Number(progress.scanned || 0) + snapshot.docs.length,
    updatedAt: new Date().toISOString(),
  }, { merge: true });
  return { migrated, scanned: snapshot.docs.length, complete };
}

export async function loadLibraryFacets(db: Firestore, userId: string): Promise<LibraryFacets> {
  const facetsRef = doc(db, 'users', userId, 'profile', 'library_facets');
  const existing = await getDoc(facetsRef);
  if (existing.exists()) {
    const categories = existing.data().categories;
    if (categories && typeof categories === 'object' && !Array.isArray(categories)) {
      return {
        categories: categories as Record<string, number>,
        complete: existing.data().complete === true,
      };
    }
  }

  // A cache miss must not turn initial rendering into a full-collection scan.
  // New mutations maintain this document incrementally; legacy rebuilds remain explicit.
  return { categories: {}, complete: false };
}

export async function applyCategoryDeltas(
  db: Firestore,
  userId: string,
  deltas: Record<string, number>,
): Promise<LibraryFacets> {
  const facetsRef = doc(db, 'users', userId, 'profile', 'library_facets');
  return runTransaction(db, async transaction => {
    const snapshot = await transaction.get(facetsRef);
    const current = snapshot.exists() && snapshot.data().categories && typeof snapshot.data().categories === 'object'
      ? snapshot.data().categories as Record<string, number>
      : {};
    const categories = { ...current };
    Object.entries(deltas).forEach(([category, delta]) => {
      const next = Math.max(0, (categories[category] || 0) + delta);
      if (next === 0) delete categories[category];
      else categories[category] = next;
    });
    const complete = snapshot.exists() && snapshot.data().complete === true;
    transaction.set(facetsRef, {
      categories,
      complete,
      version: 1,
      updatedAt: new Date().toISOString(),
    });
    return { categories, complete };
  });
}

export async function fetchLibraryStats(db: Firestore, userId: string): Promise<LibraryStats> {
  const [total, reviewedSnapshot, easy, good, hard, explicitlyUnrated, bookmarked, due] = await Promise.all([
    countCards(db, userId, EMPTY_FILTERS),
    getCount(query(cardsCollection(db, userId), where('reviews', '>', 0))),
    countCards(db, userId, { ...EMPTY_FILTERS, difficulty: 'easy' }),
    countCards(db, userId, { ...EMPTY_FILTERS, difficulty: 'good' }),
    countCards(db, userId, { ...EMPTY_FILTERS, difficulty: 'hard' }),
    countCards(db, userId, { ...EMPTY_FILTERS, difficulty: 'unrated' }),
    countCards(db, userId, { ...EMPTY_FILTERS, bookmarkedOnly: true }),
    countCards(db, userId, { ...EMPTY_FILTERS, difficulty: 'due' }),
  ]);
  const legacyUnindexed = Math.max(0, total - easy - good - hard - explicitlyUnrated);
  const unrated = explicitlyUnrated + legacyUnindexed;
  return { total, reviewed: reviewedSnapshot.data().count, easy, good, hard, unrated, bookmarked, due, legacyUnindexed };
}

export async function fetchPracticeCards(
  db: Firestore,
  userId: string,
  maximum = 50,
  options: PracticeCardOptions = {},
): Promise<CardData[]> {
  const maximumCards = Math.max(1, Math.min(100, Math.floor(maximum)));
  const now = options.now ?? new Date();
  let dueCards: CardData[] = [];
  let queueError: unknown;
  try {
    const dueSnapshot = await getDocs(query(
      cardsCollection(db, userId),
      where('nextReviewDate', '<=', now.toISOString()),
      orderBy('nextReviewDate', 'asc'),
      limit(maximumCards),
    ));
    dueCards = dueSnapshot.docs.map(card => normalizeCardData(card.data() as Partial<CardData>, card.id));
  } catch (error) {
    queueError = error;
    console.warn('Due-card query unavailable; using the bounded fallback pool.', error);
  }

  let newCards: CardData[] = [];
  if (dueCards.length < maximumCards) {
    try {
      const newSnapshot = await getDocs(query(
        cardsCollection(db, userId),
        where('difficulty', '==', 'unrated'),
        orderBy('createdAt', 'desc'),
        limit(maximumCards - dueCards.length),
      ));
      newCards = newSnapshot.docs.map(card => normalizeCardData(card.data() as Partial<CardData>, card.id));
    } catch (error) {
      queueError = error;
      console.warn('New-card query unavailable; continuing with due cards only.', error);
    }
  }

  const scheduledCards = prioritizePracticeCards(dueCards, newCards, maximumCards);
  if (options.includeFuture === false) {
    if (scheduledCards.length === 0 && queueError) throw queueError;
    return scheduledCards;
  }
  if (scheduledCards.length >= maximumCards) return scheduledCards;

  const sampleSize = Math.min(100, Math.max(maximumCards, (maximumCards - scheduledCards.length) * 2));
  const pivot = createDailyPracticePivot(userId, now);
  const rotatedSnapshot = await getDocs(query(
    cardsCollection(db, userId),
    orderBy(documentId(), 'asc'),
    startAt(pivot),
    limit(sampleSize),
  ));
  const rotatedCards = rotatedSnapshot.docs.map(card => normalizeCardData(card.data() as Partial<CardData>, card.id));

  if (rotatedCards.length < sampleSize) {
    const wrappedSnapshot = await getDocs(query(
      cardsCollection(db, userId),
      orderBy(documentId(), 'asc'),
      limit(sampleSize - rotatedCards.length),
    ));
    rotatedCards.push(...wrappedSnapshot.docs.map(card => normalizeCardData(card.data() as Partial<CardData>, card.id)));
  }

  return prioritizePracticeCards(scheduledCards, rotatedCards, maximumCards);
}

function legacyWordVariants(word: string): string[] {
  const preservedCase = word.normalize('NFKC').trim().replace(/\s+/g, ' ');
  const normalized = normalizePrefixSearch(preservedCase);
  if (!normalized) return [];
  const titleCase = normalized.charAt(0).toLocaleUpperCase('en-US') + normalized.slice(1);
  return [...new Set([
    preservedCase,
    normalized,
    titleCase,
    normalized.toLocaleUpperCase('en-US'),
  ].filter(Boolean))];
}

export async function findCardByNormalizedWord(
  db: Firestore,
  userId: string,
  word: string,
): Promise<CardData | null> {
  const normalizedWord = normalizePrefixSearch(word);
  const normalizedSnapshot = await getDocsFromServer(query(
    cardsCollection(db, userId),
    where('normalizedWord', '==', normalizedWord),
    limit(20),
  ));
  if (!normalizedSnapshot.empty) {
    return normalizedSnapshot.docs
      .map(card => normalizeCardData(card.data() as Partial<CardData>, card.id))
      .reduce(preferCardWithLearningProgress);
  }

  const exactWordSnapshot = await getDocsFromServer(query(
    cardsCollection(db, userId),
    where('word', 'in', legacyWordVariants(word)),
    limit(20),
  ));
  if (!exactWordSnapshot.empty) {
    await Promise.all(exactWordSnapshot.docs.map(card =>
      repairNormalizedWord(db, userId, card, normalizedWord)));
    return exactWordSnapshot.docs
      .map(card => normalizeCardData(card.data() as Partial<CardData>, card.id))
      .reduce(preferCardWithLearningProgress);
  }

  return null;
}

export async function findCardsByNormalizedWords(
  db: Firestore,
  userId: string,
  words: string[],
): Promise<Map<string, CardData>> {
  const normalizedWords = [...new Set(words.map(normalizePrefixSearch).filter(Boolean))];
  const requestedWords = new Set(normalizedWords);
  const matches = new Map<string, CardData>();
  const remember = (card: CardData) => {
    const key = cardWordKey(card);
    if (!requestedWords.has(key)) return;
    const existing = matches.get(key);
    matches.set(key, existing ? preferCardWithLearningProgress(existing, card) : card);
  };
  for (let offset = 0; offset < normalizedWords.length; offset += 30) {
    const chunk = normalizedWords.slice(offset, offset + 30);
    const snapshot = await getDocs(query(
      cardsCollection(db, userId),
      where('normalizedWord', 'in', chunk),
    ));
    snapshot.docs.forEach(card => {
      const data = normalizeCardData(card.data() as Partial<CardData>, card.id);
      remember(data);
    });
  }

  const missingWords = new Set(normalizedWords.filter(word => !matches.has(word)));
  const legacyVariants = [...new Set(words.flatMap(legacyWordVariants))]
    .filter(word => missingWords.has(normalizePrefixSearch(word)));
  for (let offset = 0; offset < legacyVariants.length; offset += 30) {
    const chunk = legacyVariants.slice(offset, offset + 30);
    const snapshot = await getDocs(query(
      cardsCollection(db, userId),
      where('word', 'in', chunk),
    ));
    await Promise.all(snapshot.docs.map(async card => {
      const normalizedWord = normalizePrefixSearch(String((card.data() as Partial<CardData>).word ?? ''));
      await repairNormalizedWord(db, userId, card, normalizedWord);
      remember(normalizeCardData(card.data() as Partial<CardData>, card.id));
    }));
  }
  return matches;
}

export interface CreateCardIfAbsentResult {
  card: CardData;
  created: boolean;
}

export interface CreateCardIfAbsentOptions {
  libraryEpoch?: number;
  baseRevision?: number;
  opId?: string;
}

export class CardMutationPreconditionError extends Error {
  constructor(public readonly reason: 'stale-library-epoch' | 'future-library-epoch' | 'deleted') {
    super(`Card mutation rejected: ${reason}.`);
    this.name = 'CardMutationPreconditionError';
  }
}

const normalizedLibraryEpoch = (value: unknown): number =>
  Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;

const normalizeCardForMutation = (
  card: Partial<CardData>,
  cardId: string,
): CardData => Object.fromEntries(
  Object.entries(normalizeCardData(card, cardId))
    .filter(([, value]) => value !== undefined),
) as unknown as CardData;

const libraryStateRef = (db: Firestore, userId: string) =>
  doc(db, 'users', userId, 'profile', 'library_state');

const cardTombstoneRef = (db: Firestore, userId: string, cardId: string) =>
  doc(db, 'users', userId, 'card_tombstones', cardId);

/**
 * Reads the server-owned library generation. Missing v1 state is epoch zero.
 */
export async function getLibraryEpoch(db: Firestore, userId: string): Promise<number> {
  const snapshot = await getDoc(libraryStateRef(db, userId));
  return snapshot.exists()
    ? normalizedLibraryEpoch((snapshot.data() as Record<string, unknown>).libraryEpoch)
    : 0;
}

/**
 * Atomically advances the library generation before a destructive reset.
 * Flushers can reject every pending operation carrying an older epoch.
 */
export async function incrementLibraryEpoch(db: Firestore, userId: string): Promise<number> {
  const stateRef = libraryStateRef(db, userId);
  return runTransaction(db, async transaction => {
    const snapshot = await transaction.get(stateRef);
    const current = snapshot.exists()
      ? normalizedLibraryEpoch((snapshot.data() as Record<string, unknown>).libraryEpoch)
      : 0;
    const next = current + 1;
    transaction.set(
      stateRef,
      { libraryEpoch: next, schemaVersion: 2 },
      { merge: true },
    );
    return next;
  });
}

export type ApplyCardPatchResult =
  | { applied: true; revision: number }
  | { applied: false; reason: 'stale-library-epoch' | 'future-library-epoch' | 'missing' }
  | { applied: false; reason: 'revision-conflict'; currentRevision: number };

export async function applyCardPatchIfCurrent(
  db: Firestore,
  userId: string,
  command: {
    cardId: string;
    fields: Partial<CardData>;
    fieldMask: readonly (keyof CardData)[];
    baseRevision: number;
    libraryEpoch: number;
  },
): Promise<ApplyCardPatchResult> {
  const stateRef = libraryStateRef(db, userId);
  const cardRef = doc(db, 'users', userId, 'cards', command.cardId);
  return runTransaction(db, async transaction => {
    const stateSnapshot = await transaction.get(stateRef);
    const serverEpoch = stateSnapshot.exists()
      ? normalizedLibraryEpoch((stateSnapshot.data() as Record<string, unknown>).libraryEpoch)
      : 0;
    if (command.libraryEpoch < serverEpoch) return { applied: false, reason: 'stale-library-epoch' };
    if (command.libraryEpoch > serverEpoch) return { applied: false, reason: 'future-library-epoch' };

    const cardSnapshot = await transaction.get(cardRef);
    if (!cardSnapshot.exists()) return { applied: false, reason: 'missing' };
    const storedCard = cardSnapshot.data() as Partial<CardData>;
    const currentRevision = normalizedLibraryEpoch(storedCard.revision);
    if (command.baseRevision !== currentRevision) {
      if (cardAlreadyHasPatch(storedCard, command.fields, command.fieldMask)) {
        return { applied: true, revision: currentRevision };
      }
      return { applied: false, reason: 'revision-conflict', currentRevision };
    }

    const patch = selectMutableCardPatch(command.fields, command.fieldMask);
    const nextRevision = currentRevision + 1;
    const isCurrentProtocolCard = storedCard.schemaVersion === 2
      && Number.isSafeInteger(storedCard.revision)
      && normalizedLibraryEpoch(storedCard.libraryEpoch) === serverEpoch;
    if (isCurrentProtocolCard) {
      transaction.set(cardRef, {
        ...patch,
        revision: nextRevision,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } else {
      const sanitizedCard = normalizeCardForMutation({
        ...storedCard,
        ...patch,
        id: command.cardId,
      }, command.cardId);
      transaction.set(cardRef, {
        ...sanitizedCard,
        // Legacy documents need a complete rules-safe v2 replacement. Current
        // v2 cards use the masked merge branch above to preserve cloud fields.
        id: command.cardId,
        schemaVersion: 2,
        revision: nextRevision,
        libraryEpoch: serverEpoch,
        updatedAt: serverTimestamp(),
      }, { merge: false });
    }
    return { applied: true, revision: nextRevision };
  });
}

export type DeleteCardWithTombstoneResult =
  | { deleted: true; tombstone: CardTombstone }
  | { deleted: false; reason: 'stale-library-epoch' | 'future-library-epoch' }
  | { deleted: false; reason: 'revision-conflict'; currentRevision: number };

export async function deleteCardWithTombstone(
  db: Firestore,
  userId: string,
  command: {
    cardId: string;
    opId: string;
    libraryEpoch: number;
    baseRevision: number;
  },
): Promise<DeleteCardWithTombstoneResult> {
  const stateRef = libraryStateRef(db, userId);
  const cardRef = doc(db, 'users', userId, 'cards', command.cardId);
  const tombstoneRef = cardTombstoneRef(db, userId, command.cardId);
  const operationId = normalizeCardOperationId(command.opId);
  return runTransaction(db, async transaction => {
    const stateSnapshot = await transaction.get(stateRef);
    const serverEpoch = stateSnapshot.exists()
      ? normalizedLibraryEpoch((stateSnapshot.data() as Record<string, unknown>).libraryEpoch)
      : 0;
    if (command.libraryEpoch < serverEpoch) return { deleted: false, reason: 'stale-library-epoch' };
    if (command.libraryEpoch > serverEpoch) return { deleted: false, reason: 'future-library-epoch' };

    const cardSnapshot = await transaction.get(cardRef);
    const tombstoneSnapshot = await transaction.get(tombstoneRef);
    const cardRevision = cardSnapshot.exists()
      ? normalizedLibraryEpoch((cardSnapshot.data() as Record<string, unknown>).revision)
      : command.baseRevision;
    const previousTombstoneRevision = tombstoneSnapshot.exists()
      ? normalizedLibraryEpoch((tombstoneSnapshot.data() as Record<string, unknown>).revision)
      : 0;
    if (
      tombstoneSnapshot.exists()
      && (tombstoneSnapshot.data() as Record<string, unknown>).opId === operationId
      && normalizedLibraryEpoch(
        (tombstoneSnapshot.data() as Record<string, unknown>).libraryEpoch,
      ) === serverEpoch
    ) {
      return {
        deleted: true,
        tombstone: tombstoneSnapshot.data() as CardTombstone,
      };
    }
    if (
      !cardSnapshot.exists()
      && tombstoneSnapshot.exists()
      && normalizedLibraryEpoch(
        (tombstoneSnapshot.data() as Record<string, unknown>).libraryEpoch,
      ) === serverEpoch
    ) {
      return {
        deleted: true,
        tombstone: tombstoneSnapshot.data() as CardTombstone,
      };
    }
    if (cardSnapshot.exists() && command.baseRevision !== cardRevision) {
      return {
        deleted: false,
        reason: 'revision-conflict',
        currentRevision: cardRevision,
      };
    }
    const baseRevision = Math.max(command.baseRevision, cardRevision, previousTombstoneRevision);
    const tombstone = buildCardTombstone({
      cardId: command.cardId,
      opId: operationId,
      libraryEpoch: command.libraryEpoch,
      baseRevision,
      deletedAt: new Date().toISOString(),
    });
    transaction.set(tombstoneRef, tombstone, { merge: false });
    if (cardSnapshot.exists()) transaction.delete(cardRef);
    return { deleted: true, tombstone };
  });
}

export async function createCardIfAbsent(
  db: Firestore,
  userId: string,
  card: CardData,
  options: CreateCardIfAbsentOptions = {},
): Promise<CreateCardIfAbsentResult> {
  const stableId = createWordCardId(card.normalizedWord || card.word);
  const stableCard = prepareCardForCreate(
    normalizeCardForMutation({ ...card, id: stableId }, stableId),
    options,
  );
  const cardRef = doc(db, 'users', userId, 'cards', stableCard.id);
  const stateRef = libraryStateRef(db, userId);
  const tombstoneRef = cardTombstoneRef(db, userId, stableCard.id);
  return runTransaction(db, async transaction => {
    const stateSnapshot = await transaction.get(stateRef);
    const serverEpoch = stateSnapshot.exists()
      ? normalizedLibraryEpoch((stateSnapshot.data() as Record<string, unknown>).libraryEpoch)
      : 0;
    const commandEpoch = normalizedLibraryEpoch(options.libraryEpoch);
    if (commandEpoch < serverEpoch) throw new CardMutationPreconditionError('stale-library-epoch');
    if (commandEpoch > serverEpoch) throw new CardMutationPreconditionError('future-library-epoch');

    const tombstoneSnapshot = await transaction.get(tombstoneRef);
    const existing = await transaction.get(cardRef);
    if (existing.exists()) {
      return {
        card: normalizeCardData(existing.data() as Partial<CardData>, existing.id),
        created: false,
      };
    }
    const tombstoneData = tombstoneSnapshot.exists()
      ? tombstoneSnapshot.data() as Record<string, unknown>
      : null;
    const tombstoneRevision = tombstoneData
      && normalizedLibraryEpoch(tombstoneData.libraryEpoch) === serverEpoch
      ? normalizedLibraryEpoch(tombstoneData.revision)
      : 0;
    const baseRevision = normalizedLibraryEpoch(options.baseRevision);
    if (tombstoneRevision > baseRevision) {
      throw new CardMutationPreconditionError('deleted');
    }
    const createdCard = tombstoneRevision > 0
      ? { ...stableCard, revision: tombstoneRevision + 1 }
      : stableCard;
    transaction.set(cardRef, {
      ...createdCard,
      updatedAt: serverTimestamp(),
    });
    return { card: createdCard, created: true };
  });
}

export async function clearCustomDeckAssignments(
  db: Firestore,
  userId: string,
  deckName: string,
): Promise<void> {
  const libraryEpoch = await getLibraryEpoch(db, userId);
  while (true) {
    const snapshot = await getDocs(query(
      cardsCollection(db, userId),
      where('customDeck', '==', deckName),
      limit(400),
    ));
    if (snapshot.empty) return;
    await mapWithConcurrency(snapshot.docs, 8, async cardDocument => {
      const card = cardDocument.data() as Partial<CardData>;
      await applyCardPatchIfCurrent(db, userId, {
        cardId: cardDocument.id,
        fields: { customDeck: null },
        fieldMask: ['customDeck'],
        baseRevision: normalizedLibraryEpoch(card.revision),
        libraryEpoch,
      });
    });
  }
}

export async function fetchAllCardsOnDemand(
  db: Firestore,
  userId: string,
  onPage?: (loaded: number, page: CardData[]) => void | Promise<void>,
): Promise<CardData[]> {
  const allCards: CardData[] = [];
  await streamAllCardsInBatches(db, userId, async (page, loaded) => {
    allCards.push(...page);
    await onPage?.(loaded, page);
  });
  return allCards;
}

export async function streamAllCardsInBatches(
  db: Firestore,
  userId: string,
  onBatch: (page: CardData[], loaded: number) => void | Promise<void>,
  requestedBatchSize = 100,
): Promise<number> {
  const batchSize = Math.max(1, Math.min(100, Math.floor(requestedBatchSize)));
  let cursor: QueryDocumentSnapshot | null = null;
  let loaded = 0;
  do {
    const constraints: QueryConstraint[] = [
      orderBy(documentId(), 'asc'),
      ...(cursor ? [startAfter(cursor)] : []),
      limit(batchSize),
    ];
    const snapshot = await getDocs(query(cardsCollection(db, userId), ...constraints));
    const page = snapshot.docs.map(card => normalizeCardData(card.data() as Partial<CardData>, card.id));
    loaded += page.length;
    if (page.length > 0) await onBatch(page, loaded);
    cursor = snapshot.docs.length === batchSize ? snapshot.docs[snapshot.docs.length - 1] : null;
  } while (cursor);
  return loaded;
}

export async function deleteAllCards(db: Firestore, userId: string): Promise<void> {
  while (true) {
    const snapshot = await getDocs(query(cardsCollection(db, userId), limit(400)));
    if (snapshot.empty) return;
    const batch = writeBatch(db);
    snapshot.docs.forEach(card => batch.delete(card.ref));
    await batch.commit();
  }
}
