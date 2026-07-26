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

function repairNormalizedWord(
  cardDocument: QueryDocumentSnapshot,
  normalizedWord: string,
): void {
  const storedValue = (cardDocument.data() as Partial<CardData>).normalizedWord;
  if (storedValue === normalizedWord) return;
  void setDoc(cardDocument.ref, { normalizedWord }, { merge: true })
    .catch(error => console.warn('A legacy card was found but its search identity could not be repaired.', error));
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

  const batch = writeBatch(db);
  let migrated = 0;
  snapshot.docs.forEach(cardDocument => {
    const card = cardDocument.data() as Partial<CardData>;
    const updates: Partial<CardData> = {};
    if (!card.id) updates.id = cardDocument.id;
    if (!card.createdAt) updates.createdAt = new Date(0).toISOString();
    if (!card.normalizedWord && card.word) updates.normalizedWord = normalizePrefixSearch(card.word);
    if (card.customDeck === undefined) updates.customDeck = null;
    if (!card.difficulty) updates.difficulty = 'unrated';
    if (card.bookmarked === undefined) updates.bookmarked = false;
    if (Object.keys(updates).length > 0) {
      batch.update(cardDocument.ref, updates);
      migrated += 1;
    }
  });

  const complete = snapshot.docs.length < batchSize;
  batch.set(progressRef, {
    lastDocumentId: snapshot.docs[snapshot.docs.length - 1].id,
    complete,
    scanned: Number(progress.scanned || 0) + snapshot.docs.length,
    updatedAt: new Date().toISOString(),
  }, { merge: true });
  await batch.commit();
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
  const [total, easy, good, hard, explicitlyUnrated, bookmarked, due] = await Promise.all([
    countCards(db, userId, EMPTY_FILTERS),
    countCards(db, userId, { ...EMPTY_FILTERS, difficulty: 'easy' }),
    countCards(db, userId, { ...EMPTY_FILTERS, difficulty: 'good' }),
    countCards(db, userId, { ...EMPTY_FILTERS, difficulty: 'hard' }),
    countCards(db, userId, { ...EMPTY_FILTERS, difficulty: 'unrated' }),
    countCards(db, userId, { ...EMPTY_FILTERS, bookmarkedOnly: true }),
    countCards(db, userId, { ...EMPTY_FILTERS, difficulty: 'due' }),
  ]);
  const legacyUnindexed = Math.max(0, total - easy - good - hard - explicitlyUnrated);
  const unrated = explicitlyUnrated + legacyUnindexed;
  return { total, easy, good, hard, unrated, bookmarked, due, legacyUnindexed };
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
    exactWordSnapshot.docs.forEach(card => repairNormalizedWord(card, normalizedWord));
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
    snapshot.docs.forEach(card => {
      const normalizedWord = normalizePrefixSearch(String((card.data() as Partial<CardData>).word ?? ''));
      repairNormalizedWord(card, normalizedWord);
      remember(normalizeCardData(card.data() as Partial<CardData>, card.id));
    });
  }
  return matches;
}

export interface CreateCardIfAbsentResult {
  card: CardData;
  created: boolean;
}

export async function createCardIfAbsent(
  db: Firestore,
  userId: string,
  card: CardData,
): Promise<CreateCardIfAbsentResult> {
  const stableCard = { ...card, id: createWordCardId(card.normalizedWord || card.word) };
  const cardRef = doc(db, 'users', userId, 'cards', stableCard.id);
  return runTransaction(db, async transaction => {
    const existing = await transaction.get(cardRef);
    if (existing.exists()) {
      return {
        card: normalizeCardData(existing.data() as Partial<CardData>, existing.id),
        created: false,
      };
    }
    transaction.set(cardRef, stableCard);
    return { card: stableCard, created: true };
  });
}

export async function clearCustomDeckAssignments(
  db: Firestore,
  userId: string,
  deckName: string,
): Promise<void> {
  while (true) {
    const snapshot = await getDocs(query(
      cardsCollection(db, userId),
      where('customDeck', '==', deckName),
      limit(400),
    ));
    if (snapshot.empty) return;
    const batch = writeBatch(db);
    snapshot.docs.forEach(card => batch.update(card.ref, { customDeck: null }));
    await batch.commit();
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
