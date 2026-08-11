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
import { mapWithConcurrencyUntilFailure } from './asyncPool';
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
  createCardIdentityReservation,
  createCardIdentityReservationId,
  dedupeCardsByNormalizedWord,
  isCardIdentityReservationForWord,
  isMatchingCardIdentityReservation,
  normalizeCardWord,
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

export interface LegacyMigrationProgress {
  scanned: number;
  complete: boolean;
}

const CARD_QUERY_MIGRATION_VERSION = 2;

interface StoredLegacyMigrationProgress extends LegacyMigrationProgress {
  lastDocumentId: string | null;
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

const legacyMigrationProgressRef = (db: Firestore, userId: string) =>
  doc(db, 'users', userId, 'profile', 'query_migration');

const parseLegacyMigrationProgress = (value: unknown): StoredLegacyMigrationProgress => {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || (value as Record<string, unknown>).migrationVersion !== CARD_QUERY_MIGRATION_VERSION
  ) {
    return { scanned: 0, complete: false, lastDocumentId: null };
  }
  const progress = value as Record<string, unknown>;
  const hasValidScanned = Number.isSafeInteger(progress.scanned) && Number(progress.scanned) >= 0;
  return {
    scanned: hasValidScanned ? Number(progress.scanned) : 0,
    complete: hasValidScanned && progress.complete === true,
    lastDocumentId: typeof progress.lastDocumentId === 'string'
      ? progress.lastDocumentId
      : null,
  };
};

export async function getLegacyCardQueryMigrationProgress(
  db: Firestore,
  userId: string,
): Promise<LegacyMigrationProgress> {
  const snapshot = await getDoc(legacyMigrationProgressRef(db, userId));
  const progress = parseLegacyMigrationProgress(snapshot.exists() ? snapshot.data() : null);
  return { scanned: progress.scanned, complete: progress.complete };
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

export async function migrateLegacyCardQueryFields(
  db: Firestore,
  userId: string,
  requestedBatchSize = 100,
): Promise<LegacyMigrationResult> {
  const batchSize = Math.max(1, Math.min(200, Math.floor(requestedBatchSize)));
  const progressRef = legacyMigrationProgressRef(db, userId);
  const progressSnapshot = await getDoc(progressRef);
  const currentProgress = parseLegacyMigrationProgress(
    progressSnapshot.exists() ? progressSnapshot.data() : null,
  );
  if (currentProgress.complete === true) return { migrated: 0, scanned: 0, complete: true };

  const { lastDocumentId } = currentProgress;
  const previouslyScanned = currentProgress.scanned;
  const snapshot = await getDocs(query(
    cardsCollection(db, userId),
    orderBy(documentId(), 'asc'),
    ...(lastDocumentId ? [startAfter(lastDocumentId)] : []),
    limit(batchSize),
  ));

  if (snapshot.empty) {
    await setDoc(progressRef, {
      migrationVersion: CARD_QUERY_MIGRATION_VERSION,
      lastDocumentId,
      complete: true,
      scanned: previouslyScanned,
      updatedAt: new Date().toISOString(),
    }, { merge: true });
    return { migrated: 0, scanned: 0, complete: true };
  }

  const libraryEpoch = await getLibraryEpoch(db, userId);
  const migrationResults = await mapWithConcurrencyUntilFailure(snapshot.docs, 8, async cardDocument => {
    const card = cardDocument.data() as Partial<CardData>;
    const updates: Partial<CardData> = {};
    if (!card.normalizedWord && card.word) updates.normalizedWord = normalizePrefixSearch(card.word);
    if (card.customDeck === undefined) updates.customDeck = null;
    if (!card.difficulty) updates.difficulty = 'unrated';
    if (card.bookmarked === undefined) updates.bookmarked = false;
    const result = await applyCardPatchIfCurrent(db, userId, {
      cardId: cardDocument.id,
      fields: updates,
      fieldMask: Object.keys(updates) as Array<keyof CardData>,
      baseRevision: normalizedLibraryEpoch(card.revision),
      libraryEpoch,
      requireIdentityReservation: true,
    });
    if (!result.applied && result.reason !== 'missing') {
      throw new Error(`Card query migration rejected: ${result.reason}.`);
    }
    return result.applied;
  });
  const migrated = migrationResults.filter(Boolean).length;

  const complete = snapshot.docs.length < batchSize;
  await setDoc(progressRef, {
    migrationVersion: CARD_QUERY_MIGRATION_VERSION,
    lastDocumentId: snapshot.docs[snapshot.docs.length - 1].id,
    complete,
    scanned: previouslyScanned + snapshot.docs.length,
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

function explicitCardLibraryEpoch(card: Partial<CardData>): number | null {
  if (!Object.prototype.hasOwnProperty.call(card, 'libraryEpoch')) return null;
  return Number.isSafeInteger(card.libraryEpoch) && Number(card.libraryEpoch) >= 0
    ? Number(card.libraryEpoch)
    : Number.NaN;
}

const CARD_MATCHES_PER_WORD_LIMIT = 20;

function requestedLibraryEpoch(
  libraryEpoch: number | undefined,
): number | null {
  if (libraryEpoch === undefined) return 0;
  return Number.isSafeInteger(libraryEpoch) && libraryEpoch >= 0
    ? libraryEpoch
    : null;
}

function cardHasExplicitLibraryEpoch(
  card: Partial<CardData>,
  libraryEpoch: number,
): boolean {
  return explicitCardLibraryEpoch(card) === libraryEpoch;
}

export async function findCardByNormalizedWord(
  db: Firestore,
  userId: string,
  word: string,
  libraryEpoch?: number,
): Promise<CardData | null> {
  const normalizedWord = normalizePrefixSearch(word);
  const activeLibraryEpoch = requestedLibraryEpoch(libraryEpoch);
  if (activeLibraryEpoch === null) return null;
  const normalizedSnapshot = await getDocsFromServer(query(
    cardsCollection(db, userId),
    where('normalizedWord', '==', normalizedWord),
    where('libraryEpoch', '==', activeLibraryEpoch),
    limit(CARD_MATCHES_PER_WORD_LIMIT),
  ));
  const normalizedMatches = normalizedSnapshot.docs
    .filter(card => cardHasExplicitLibraryEpoch(
      card.data() as Partial<CardData>,
      activeLibraryEpoch,
    ));
  if (normalizedMatches.length > 0) {
    return normalizedMatches
      .map(card => normalizeCardData(card.data() as Partial<CardData>, card.id))
      .reduce(preferCardWithLearningProgress);
  }

  if (activeLibraryEpoch !== 0) return null;

  const exactWordSnapshot = await getDocsFromServer(query(
    cardsCollection(db, userId),
    where('word', 'in', legacyWordVariants(word)),
    limit(CARD_MATCHES_PER_WORD_LIMIT),
  ));
  const exactWordMatches = exactWordSnapshot.docs
    .filter(card => explicitCardLibraryEpoch(card.data() as Partial<CardData>) === null);
  if (exactWordMatches.length > 0) {
    await Promise.all(exactWordMatches.map(card =>
      repairNormalizedWord(db, userId, card, normalizedWord)));
    return exactWordMatches
      .map(card => normalizeCardData(card.data() as Partial<CardData>, card.id))
      .reduce(preferCardWithLearningProgress);
  }

  return null;
}

export async function findCardsByNormalizedWords(
  db: Firestore,
  userId: string,
  words: string[],
  libraryEpoch?: number,
): Promise<Map<string, CardData>> {
  const normalizedWords = [...new Set(words.map(normalizePrefixSearch).filter(Boolean))];
  const requestedWords = new Set(normalizedWords);
  const matches = new Map<string, CardData>();
  const activeLibraryEpoch = requestedLibraryEpoch(libraryEpoch);
  if (activeLibraryEpoch === null) return matches;
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
      where('libraryEpoch', '==', activeLibraryEpoch),
      limit(chunk.length * CARD_MATCHES_PER_WORD_LIMIT),
    ));
    snapshot.docs
      .filter(card => cardHasExplicitLibraryEpoch(
        card.data() as Partial<CardData>,
        activeLibraryEpoch,
      ))
      .forEach(card => {
        const data = normalizeCardData(card.data() as Partial<CardData>, card.id);
        remember(data);
      });
  }

  if (activeLibraryEpoch !== 0) return matches;

  const missingWords = new Set(normalizedWords.filter(word => !matches.has(word)));
  const legacyVariants = [...new Set(words.flatMap(legacyWordVariants))]
    .filter(word => missingWords.has(normalizePrefixSearch(word)));
  for (let offset = 0; offset < legacyVariants.length; offset += 30) {
    const chunk = legacyVariants.slice(offset, offset + 30);
    const snapshot = await getDocs(query(
      cardsCollection(db, userId),
      where('word', 'in', chunk),
      limit(chunk.length * CARD_MATCHES_PER_WORD_LIMIT),
    ));
    const currentMatches = snapshot.docs
      .filter(card => explicitCardLibraryEpoch(card.data() as Partial<CardData>) === null);
    await Promise.all(currentMatches.map(async card => {
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
  constructor(public readonly reason:
    | 'stale-library-epoch'
    | 'future-library-epoch'
    | 'deleted'
    | 'identity-conflict') {
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
    requireIdentityReservation?: boolean;
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
    const storedEpoch = explicitCardLibraryEpoch(storedCard);
    if (storedEpoch === null && serverEpoch > 0) {
      return { applied: false, reason: 'stale-library-epoch' };
    }
    if (storedEpoch !== null) {
      if (!Number.isSafeInteger(storedEpoch) || storedEpoch > serverEpoch) {
        return { applied: false, reason: 'future-library-epoch' };
      }
      if (storedEpoch < serverEpoch) {
        return { applied: false, reason: 'stale-library-epoch' };
      }
    }
    let patch = selectMutableCardPatch(command.fields, command.fieldMask);
    const hasStoredIdentity = typeof storedCard.normalizedWord === 'string'
      && storedCard.normalizedWord.length > 0;
    const patchesNormalizedWord = Object.prototype.hasOwnProperty.call(patch, 'normalizedWord');
    if (
      hasStoredIdentity
      && patchesNormalizedWord
      && patch.normalizedWord !== storedCard.normalizedWord
    ) {
      throw new CardMutationPreconditionError('identity-conflict');
    }
    const patchesWord = Object.prototype.hasOwnProperty.call(patch, 'word');
    const effectiveWord = patchesWord ? patch.word : storedCard.word;
    if (
      (
        hasStoredIdentity
        && normalizeCardWord(storedCard.word) !== normalizeCardWord(storedCard.normalizedWord)
      )
      || (patchesWord && patch.word !== storedCard.word)
    ) {
      throw new CardMutationPreconditionError('identity-conflict');
    }

    const currentRevision = normalizedLibraryEpoch(storedCard.revision);
    const nextRevision = currentRevision + 1;
    const isCurrentProtocolCard = storedCard.schemaVersion === 2
      && Number.isSafeInteger(storedCard.revision)
      && storedEpoch !== null
      && storedEpoch === serverEpoch;
    const needsIdentityClaim = command.requireIdentityReservation === true
      || !isCurrentProtocolCard
      || (!hasStoredIdentity && patchesNormalizedWord);
    const hasRevisionConflict = command.baseRevision !== currentRevision;
    const alreadyHasPatch = hasRevisionConflict
      && cardAlreadyHasPatch(storedCard, command.fields, command.fieldMask);
    if (hasRevisionConflict && (!alreadyHasPatch || !needsIdentityClaim)) {
      if (alreadyHasPatch) {
        return { applied: true, revision: currentRevision };
      }
      return { applied: false, reason: 'revision-conflict', currentRevision };
    }

    let sanitizedLegacyCard: CardData | null = null;
    if (!isCurrentProtocolCard) {
      sanitizedLegacyCard = normalizeCardForMutation({
        ...storedCard,
        ...patch,
        id: command.cardId,
        ...(hasStoredIdentity ? { normalizedWord: storedCard.normalizedWord } : {}),
      }, command.cardId);
    }

    if (needsIdentityClaim) {
      const identityToClaim = hasStoredIdentity
        ? normalizeCardWord(storedCard.normalizedWord)
        : normalizeCardWord(
          isCurrentProtocolCard ? patch.normalizedWord : sanitizedLegacyCard?.normalizedWord,
        );
      if (
        !identityToClaim
        || normalizeCardWord(effectiveWord) !== identityToClaim
        || (
          !hasStoredIdentity
          && (typeof storedCard.word !== 'string' || storedCard.word !== identityToClaim)
        )
      ) {
        throw new CardMutationPreconditionError('identity-conflict');
      }
      if (hasStoredIdentity && identityToClaim !== storedCard.normalizedWord) {
        throw new CardMutationPreconditionError('identity-conflict');
      }
      if (isCurrentProtocolCard && !hasStoredIdentity) {
        patch = { ...patch, normalizedWord: identityToClaim };
      } else if (sanitizedLegacyCard) {
        sanitizedLegacyCard = {
          ...sanitizedLegacyCard,
          normalizedWord: identityToClaim,
        };
      }
      const reservation = {
        schemaVersion: 1 as const,
        cardId: command.cardId,
        normalizedWord: identityToClaim,
      };
      const reservationRef = doc(
        db,
        'users',
        userId,
        'card_reservations',
        createCardIdentityReservationId(identityToClaim),
      );
      const reservationSnapshot = await transaction.get(reservationRef);
      if (
        reservationSnapshot.exists()
        && !isMatchingCardIdentityReservation(reservationSnapshot.data(), reservation)
      ) {
        throw new CardMutationPreconditionError('identity-conflict');
      }
      if (!reservationSnapshot.exists()) {
        transaction.set(reservationRef, reservation, { merge: false });
      }
    }

    if (hasRevisionConflict) {
      if (alreadyHasPatch) return { applied: true, revision: currentRevision };
      return { applied: false, reason: 'revision-conflict', currentRevision };
    }

    if (isCurrentProtocolCard && Object.keys(patch).length > 0) {
      transaction.set(cardRef, {
        ...patch,
        revision: nextRevision,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    } else if (!isCurrentProtocolCard) {
      transaction.set(cardRef, {
        ...sanitizedLegacyCard,
        // Legacy documents need a complete rules-safe v2 replacement. Current
        // v2 cards use the masked merge branch above to preserve cloud fields.
        id: command.cardId,
        schemaVersion: 2,
        revision: nextRevision,
        libraryEpoch: serverEpoch,
        updatedAt: serverTimestamp(),
      }, { merge: false });
    }
    return {
      applied: true,
      revision: isCurrentProtocolCard && Object.keys(patch).length === 0
        ? currentRevision
        : nextRevision,
    };
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
    const previousTombstoneEpoch = tombstoneSnapshot.exists()
      ? normalizedLibraryEpoch((tombstoneSnapshot.data() as Record<string, unknown>).libraryEpoch)
      : -1;
    const previousTombstoneRevision = tombstoneSnapshot.exists() && previousTombstoneEpoch === serverEpoch
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
  const proposedReservation = createCardIdentityReservation(card.normalizedWord || card.word);
  if (
    !proposedReservation.normalizedWord
    || normalizeCardWord(card.word) !== proposedReservation.normalizedWord
  ) {
    throw new CardMutationPreconditionError('identity-conflict');
  }
  const reservationRef = doc(
    db,
    'users',
    userId,
    'card_reservations',
    createCardIdentityReservationId(proposedReservation.normalizedWord),
  );
  const stateRef = libraryStateRef(db, userId);
  return runTransaction(db, async transaction => {
    const stateSnapshot = await transaction.get(stateRef);
    const serverEpoch = stateSnapshot.exists()
      ? normalizedLibraryEpoch((stateSnapshot.data() as Record<string, unknown>).libraryEpoch)
      : 0;
    const commandEpoch = normalizedLibraryEpoch(options.libraryEpoch);
    if (commandEpoch < serverEpoch) throw new CardMutationPreconditionError('stale-library-epoch');
    if (commandEpoch > serverEpoch) throw new CardMutationPreconditionError('future-library-epoch');

    const reservationSnapshot = await transaction.get(reservationRef);
    let reservation = proposedReservation;
    if (reservationSnapshot.exists()) {
      const storedReservation = reservationSnapshot.data();
      if (!isCardIdentityReservationForWord(
        storedReservation,
        proposedReservation.normalizedWord,
      )) {
        throw new CardMutationPreconditionError('identity-conflict');
      }
      reservation = storedReservation;
    }
    const stableCard = prepareCardForCreate(
      normalizeCardForMutation({
        ...card,
        id: reservation.cardId,
        normalizedWord: reservation.normalizedWord,
      }, reservation.cardId),
      options,
    );
    const cardRef = doc(db, 'users', userId, 'cards', reservation.cardId);
    const tombstoneRef = cardTombstoneRef(db, userId, reservation.cardId);
    const tombstoneSnapshot = await transaction.get(tombstoneRef);
    const existing = await transaction.get(cardRef);
    const claimReservation = () => {
      if (!reservationSnapshot.exists()) {
        transaction.set(reservationRef, proposedReservation, { merge: false });
      }
    };
    if (existing.exists()) {
      const existingData = existing.data() as Partial<CardData>;
      const persistedIdentity = typeof existingData.normalizedWord === 'string'
        ? existingData.normalizedWord
        : '';
      const normalizedExisting = normalizeCardData(existingData, reservation.cardId);
      if (normalizeCardWord(existingData.word) !== reservation.normalizedWord) {
        throw new CardMutationPreconditionError('identity-conflict');
      }
      if (cardWordKey(normalizedExisting) !== reservation.normalizedWord) {
        throw new CardMutationPreconditionError('identity-conflict');
      }
      if (persistedIdentity && persistedIdentity !== reservation.normalizedWord) {
        throw new CardMutationPreconditionError('identity-conflict');
      }
      const existingEpoch = explicitCardLibraryEpoch(existingData);
      if (existingEpoch === null && serverEpoch > 0) {
        throw new CardMutationPreconditionError('stale-library-epoch');
      }
      if (existingEpoch !== null) {
        if (!Number.isSafeInteger(existingEpoch) || existingEpoch > serverEpoch) {
          throw new CardMutationPreconditionError('future-library-epoch');
        }
        if (existingEpoch < serverEpoch) {
          throw new CardMutationPreconditionError('stale-library-epoch');
        }
      }
      if (!persistedIdentity) {
        if (
          Object.prototype.hasOwnProperty.call(existingData, 'revision')
          && (!Number.isSafeInteger(existingData.revision) || Number(existingData.revision) < 0)
        ) {
          throw new CardMutationPreconditionError('identity-conflict');
        }
        const upgradedCard = {
          ...normalizeCardForMutation({
            ...existingData,
            id: reservation.cardId,
            normalizedWord: reservation.normalizedWord,
          }, reservation.cardId),
          schemaVersion: 2 as const,
          revision: normalizedLibraryEpoch(existingData.revision) + 1,
          libraryEpoch: serverEpoch,
        };
        claimReservation();
        transaction.set(cardRef, {
          ...upgradedCard,
          updatedAt: serverTimestamp(),
        }, { merge: false });
        return { card: upgradedCard, created: false };
      }
      claimReservation();
      return {
        card: normalizedExisting,
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
    claimReservation();
    transaction.set(cardRef, {
      ...createdCard,
      updatedAt: serverTimestamp(),
    });
    return { card: createdCard, created: true };
  });
}

const CUSTOM_DECK_PATCH_MAX_ATTEMPTS = 3;
const CUSTOM_DECK_STALLED_BATCH_LIMIT = 3;

type ClearCustomDeckCardResult = ApplyCardPatchResult
  | { applied: false; reason: 'reassigned' };

async function clearCustomDeckAssignmentIfCurrent(
  db: Firestore,
  userId: string,
  deckName: string,
  cardDocument: QueryDocumentSnapshot,
  libraryEpoch: number,
): Promise<ClearCustomDeckCardResult> {
  const cardRef = doc(db, 'users', userId, 'cards', cardDocument.id);
  let baseRevision = normalizedLibraryEpoch(
    (cardDocument.data() as Partial<CardData>).revision,
  );

  for (let attempt = 0; attempt < CUSTOM_DECK_PATCH_MAX_ATTEMPTS; attempt += 1) {
    const result = await applyCardPatchIfCurrent(db, userId, {
      cardId: cardDocument.id,
      fields: { customDeck: null },
      fieldMask: ['customDeck'],
      baseRevision,
      libraryEpoch,
    });
    if (result.applied || result.reason !== 'revision-conflict') return result;
    if (attempt === CUSTOM_DECK_PATCH_MAX_ATTEMPTS - 1) return result;

    const currentSnapshot = await getDoc(cardRef);
    if (!currentSnapshot.exists()) return { applied: false, reason: 'missing' };
    const currentCard = currentSnapshot.data() as Partial<CardData>;
    if (currentCard.customDeck !== deckName) {
      return { applied: false, reason: 'reassigned' };
    }
    baseRevision = normalizedLibraryEpoch(currentCard.revision);
  }

  throw new Error('Unreachable custom deck patch retry state.');
}

const customDeckBatchKey = (documents: readonly QueryDocumentSnapshot[]): string =>
  JSON.stringify(documents
    .map(cardDocument => ({
      id: cardDocument.id,
      revision: normalizedLibraryEpoch(
        (cardDocument.data() as Partial<CardData>).revision,
      ),
    }))
    .sort((left, right) => left.id.localeCompare(right.id)));

export async function clearCustomDeckAssignments(
  db: Firestore,
  userId: string,
  deckName: string,
): Promise<void> {
  let libraryEpoch = await getLibraryEpoch(db, userId);
  let stalledBatchKey: string | null = null;
  let stalledBatchCount = 0;
  while (true) {
    const snapshot = await getDocs(query(
      cardsCollection(db, userId),
      where('customDeck', '==', deckName),
      limit(400),
    ));
    if (snapshot.empty) return;
    const batchKey = customDeckBatchKey(snapshot.docs);
    const results = await mapWithConcurrencyUntilFailure(snapshot.docs, 8, cardDocument =>
      clearCustomDeckAssignmentIfCurrent(
        db,
        userId,
        deckName,
        cardDocument,
        libraryEpoch,
      ));

    if (results.some(result => !result.applied && result.reason === 'future-library-epoch')) {
      throw new CardMutationPreconditionError('future-library-epoch');
    }

    let epochAdvanced = false;
    if (results.some(result => !result.applied && result.reason === 'stale-library-epoch')) {
      const refreshedEpoch = await getLibraryEpoch(db, userId);
      if (refreshedEpoch < libraryEpoch) {
        throw new CardMutationPreconditionError('future-library-epoch');
      }
      epochAdvanced = refreshedEpoch > libraryEpoch;
      libraryEpoch = refreshedEpoch;
    }

    if (epochAdvanced || results.some(result => result.applied)) {
      stalledBatchKey = null;
      stalledBatchCount = 0;
      continue;
    }

    stalledBatchCount = batchKey === stalledBatchKey ? stalledBatchCount + 1 : 1;
    stalledBatchKey = batchKey;
    if (stalledBatchCount >= CUSTOM_DECK_STALLED_BATCH_LIMIT) {
      throw new Error(
        `Unable to clear custom deck "${deckName}": the same card batch made no progress.`,
      );
    }
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
