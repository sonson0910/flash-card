import {
  collection,
  doc,
  documentId,
  endAt,
  getCountFromServer as getCount,
  getDocs,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  startAfter,
  startAt,
  where,
  type DocumentSnapshot,
  type Firestore,
  type QueryConstraint,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import type { CardData } from '../types/card';
import { normalizeCardData } from './cardNormalization';
import {
  CLOUD_PAGE_SIZE,
  createDailyPracticePivot,
  normalizePrefixSearch,
  normalizePartOfSpeech,
  prioritizePracticeCards,
  queryStateKey,
  type CardQueryState,
} from './cardQuery';
import {
  buildCourseCardIndexProjection,
  effectiveCardTargetLanguage,
  type CourseCardIndexProjection,
  type CourseQueryContext,
  type CourseQueryIndexGeneration,
  type CourseQueryIndexPointer,
  type SupportedTargetLanguage,
} from './course-card-index';

const COURSE_INDEX_PAGE_LIMIT = 100;
const COURSE_INDEX_HYDRATION_BATCH_SIZE = 30;
const COURSE_PRACTICE_LIMIT = 100;

export class CourseIndexNotReadyError extends Error {
  readonly code = 'index-not-ready';

  constructor(message = 'The selected course index is not ready.') {
    super(message);
    this.name = 'CourseIndexNotReadyError';
  }
}

export class CourseQueryIndexNotReadyError extends CourseIndexNotReadyError {}

export class CourseIndexStaleError extends Error {
  readonly code = 'stale-course-index';
  readonly reason: 'missing' | 'revision' | 'target' | 'cursor' | 'context';

  constructor(
    reason: 'missing' | 'revision' | 'target' | 'cursor' | 'context',
    message = `The course query index is stale (${reason}).`,
  ) {
    super(message);
    this.name = 'CourseIndexStaleError';
    this.reason = reason;
  }
}

export class CourseQueryIndexStaleError extends CourseIndexStaleError {}

export interface CourseCardPage {
  items: CardData[];
  firstCursor: QueryDocumentSnapshot | null;
  lastCursor: QueryDocumentSnapshot | null;
  hasNext: boolean;
}

export interface CourseRealtimeCardPage extends CourseCardPage {
  changeTypes: Array<'added' | 'modified' | 'removed'>;
  fromCache: boolean;
  hasPendingWrites: boolean;
}

export interface CourseCardPageOptions {
  db: Firestore;
  userId: string;
  filters: CardQueryState;
  context: CourseQueryContext;
  cursor?: DocumentSnapshot | null;
  pageSize?: number;
  onStale?: CourseIndexStaleHandler;
}

export interface CoursePracticeOptions {
  db: Firestore;
  userId: string;
  context: CourseQueryContext;
  maximum: number;
  includeFuture?: boolean;
  now?: Date;
  onStale?: CourseIndexStaleHandler;
}

export type CourseIndexStaleHandler = (error: CourseIndexStaleError) => void | Promise<void>;

interface CourseIndexScope {
  pointer: CourseQueryIndexPointer;
  generation: CourseQueryIndexGeneration;
  context: CourseQueryContext;
}

export interface CourseIndexMirrorTarget {
  generationId: string;
  status: 'building' | 'ready';
}

interface CursorScope {
  ownerId: string;
  queryKey: string;
  courseId: string;
  targetLanguage: SupportedTargetLanguage;
  libraryEpoch: number;
  generationId: string;
}

const cursorScopes = new WeakMap<object, CursorScope>();

export const courseQueryIndexPointerRef = (db: Firestore, userId: string) =>
  doc(db, 'users', userId, 'profile', 'course_query_index');

export const courseQueryIndexGenerationRef = (
  db: Firestore,
  userId: string,
  generationId: string,
) => doc(db, 'users', userId, 'course_query_generations', generationId);

export const courseQueryIndexCardsCollection = (
  db: Firestore,
  userId: string,
  generationId: string,
) => collection(
  db,
  'users',
  userId,
  'course_query_generations',
  generationId,
  'cards',
);

const courseQueryIndexCardRef = (
  db: Firestore,
  userId: string,
  generationId: string,
  cardId: string,
) => doc(courseQueryIndexCardsCollection(db, userId, generationId), cardId);

const primaryCardsCollection = (db: Firestore, userId: string) =>
  collection(db, 'users', userId, 'cards');

const libraryStateRef = (db: Firestore, userId: string) =>
  doc(db, 'users', userId, 'profile', 'library_state');

const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);

const validCounter = (value: unknown): value is number =>
  Number.isSafeInteger(value) && Number(value) >= 0;

const parsePointer = (value: unknown): CourseQueryIndexPointer | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (
    source.schemaVersion !== 1
    || source.projectionVersion !== 1
    || !validCounter(source.libraryEpoch)
    || (source.activeGenerationId !== null && !validId(source.activeGenerationId))
    || (source.buildingGenerationId !== null && !validId(source.buildingGenerationId))
  ) return null;
  return {
    schemaVersion: 1,
    projectionVersion: 1,
    libraryEpoch: Number(source.libraryEpoch),
    activeGenerationId: source.activeGenerationId as string | null,
    buildingGenerationId: source.buildingGenerationId as string | null,
  };
};

const parseGeneration = (value: unknown): CourseQueryIndexGeneration | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const statuses = new Set(['building', 'ready', 'failed', 'retired']);
  if (
    source.schemaVersion !== 1
    || source.projectionVersion !== 1
    || !validCounter(source.libraryEpoch)
    || typeof source.status !== 'string'
    || !statuses.has(source.status)
    || (source.lastCardId !== null && !validId(source.lastCardId))
    || !validCounter(source.scanned)
    || (source.leaseToken !== null && typeof source.leaseToken !== 'string')
    || (source.leaseExpiresAt !== null && !Number.isFinite(source.leaseExpiresAt))
    || typeof source.startedAt !== 'string'
  ) return null;
  return {
    schemaVersion: 1,
    projectionVersion: 1,
    libraryEpoch: Number(source.libraryEpoch),
    status: source.status as CourseQueryIndexGeneration['status'],
    lastCardId: source.lastCardId as string | null,
    scanned: Number(source.scanned),
    leaseToken: source.leaseToken as string | null,
    leaseExpiresAt: source.leaseExpiresAt === null ? null : Number(source.leaseExpiresAt),
    startedAt: source.startedAt,
    ...(typeof source.completedAt === 'string' ? { completedAt: source.completedAt } : {}),
  };
};

const assertContextShape = (context: CourseQueryContext): void => {
  if (
    !context
    || typeof context !== 'object'
    || !validId(context.courseId)
    || !validCounter(context.libraryEpoch)
    || !validId(context.activeGenerationId)
    || !effectiveCardTargetLanguage(context.targetLanguage)
    || effectiveCardTargetLanguage(context.targetLanguage) !== context.targetLanguage
  ) throw new CourseIndexNotReadyError('The selected course context is invalid.');
};

const currentLibraryEpoch = async (db: Firestore, userId: string): Promise<number> => {
  const snapshot = await getDoc(libraryStateRef(db, userId));
  if (!snapshot.exists()) return 0;
  const value = snapshot.data()?.libraryEpoch;
  if (value === undefined) return 0;
  if (!validCounter(value)) throw new CourseIndexNotReadyError('The library epoch is invalid.');
  return Number(value);
};

const readScope = async (
  db: Firestore,
  userId: string,
  context: CourseQueryContext,
): Promise<CourseIndexScope> => {
  assertContextShape(context);
  const [pointerSnapshot, epoch] = await Promise.all([
    getDoc(courseQueryIndexPointerRef(db, userId)),
    currentLibraryEpoch(db, userId),
  ]);
  const pointer = parsePointer(pointerSnapshot.exists() ? pointerSnapshot.data() : null);
  if (!pointer || pointer.libraryEpoch !== epoch || !pointer.activeGenerationId) {
    throw new CourseIndexNotReadyError();
  }
  if (
    pointer.libraryEpoch !== context.libraryEpoch
    || pointer.activeGenerationId !== context.activeGenerationId
  ) throw new CourseIndexStaleError('context');

  const generationSnapshot = await getDoc(
    courseQueryIndexGenerationRef(db, userId, pointer.activeGenerationId),
  );
  const generation = parseGeneration(generationSnapshot.exists() ? generationSnapshot.data() : null);
  if (!generation || generation.status !== 'ready' || generation.libraryEpoch !== epoch) {
    throw new CourseIndexNotReadyError();
  }
  return { pointer, generation, context };
};

const readCurrentReadyScope = async (
  db: Firestore,
  userId: string,
  context: CourseQueryContext,
): Promise<CourseIndexScope> => {
  assertContextShape(context);
  const [pointerSnapshot, epoch] = await Promise.all([
    getDoc(courseQueryIndexPointerRef(db, userId)),
    currentLibraryEpoch(db, userId),
  ]);
  const pointer = parsePointer(pointerSnapshot.exists() ? pointerSnapshot.data() : null);
  if (!pointer || !pointer.activeGenerationId || pointer.libraryEpoch !== epoch) {
    throw new CourseIndexNotReadyError();
  }
  const generationSnapshot = await getDoc(
    courseQueryIndexGenerationRef(db, userId, pointer.activeGenerationId),
  );
  const generation = parseGeneration(generationSnapshot.exists() ? generationSnapshot.data() : null);
  if (!generation || generation.status !== 'ready' || generation.libraryEpoch !== epoch) {
    throw new CourseIndexNotReadyError();
  }
  return {
    pointer,
    generation,
    context: {
      ...context,
      libraryEpoch: epoch,
      activeGenerationId: pointer.activeGenerationId,
    },
  };
};

const assertCurrentScope = async (
  db: Firestore,
  userId: string,
  scope: CourseIndexScope,
): Promise<void> => {
  try {
    await readScope(db, userId, scope.context);
  } catch (error) {
    if (error instanceof CourseIndexNotReadyError) throw new CourseIndexStaleError('context');
    throw error;
  }
};

const dateRange = (date: string): { start: string; end: string } | null => {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  const next = new Date(parsed);
  next.setDate(next.getDate() + 1);
  return { start: parsed.toISOString(), end: next.toISOString() };
};

const projectionFilterConstraints = (
  filters: CardQueryState,
  now: Date,
): QueryConstraint[] => {
  const constraints: QueryConstraint[] = [];
  if (filters.category) constraints.push(where('category', '==', filters.category));
  if (filters.partOfSpeech) constraints.push(where('partOfSpeech', '==', normalizePartOfSpeech(filters.partOfSpeech)));
  if (filters.customDeck === 'unassigned') constraints.push(where('customDeck', '==', null));
  else if (filters.customDeck) constraints.push(where('customDeck', '==', filters.customDeck));
  if (filters.difficulty && filters.difficulty !== 'due') constraints.push(where('difficulty', '==', filters.difficulty));
  if (filters.difficulty === 'due') constraints.push(where('nextReviewDate', '<=', now.toISOString()));
  if (filters.bookmarkedOnly) constraints.push(where('bookmarked', '==', true));
  const range = filters.createdDate ? dateRange(filters.createdDate) : null;
  if (range) constraints.push(where('createdAt', '>=', range.start), where('createdAt', '<', range.end));
  return constraints;
};

const projectionOrderConstraints = (
  filters: CardQueryState,
  cursor: DocumentSnapshot | null,
): QueryConstraint[] => {
  const prefix = normalizePrefixSearch(filters.wordPrefix);
  if (prefix) return [
    orderBy('normalizedWord', 'asc'),
    orderBy(documentId(), 'asc'),
    ...(cursor ? [startAfter(cursor)] : [startAt(prefix)]),
    endAt(`${prefix}\uf8ff`),
  ];
  if (filters.difficulty === 'due') return [
    orderBy('nextReviewDate', 'asc'),
    orderBy(documentId(), 'asc'),
    ...(cursor ? [startAfter(cursor)] : []),
  ];
  return [
    orderBy('createdAt', 'desc'),
    orderBy(documentId(), 'desc'),
    ...(cursor ? [startAfter(cursor)] : []),
  ];
};

export const buildCourseCardIndexQuery = (
  db: Firestore,
  userId: string,
  filters: CardQueryState,
  context: CourseQueryContext,
  cursor: DocumentSnapshot | null = null,
  extra: QueryConstraint[] = [],
  now = new Date(),
) => query(
  courseQueryIndexCardsCollection(db, userId, context.activeGenerationId),
  where('targetLanguage', '==', context.targetLanguage),
  ...projectionFilterConstraints(filters, now),
  ...projectionOrderConstraints(filters, cursor),
  ...extra,
);

const cursorMatchesScope = (
  cursor: DocumentSnapshot,
  ownerId: string,
  filters: CardQueryState,
  context: CourseQueryContext,
): boolean => {
  const registered = cursorScopes.get(cursor as object);
  if (!registered) return false;
  return registered.ownerId === ownerId
    && registered.queryKey === queryStateKey(filters)
    && registered.courseId === context.courseId
    && registered.targetLanguage === context.targetLanguage
    && registered.libraryEpoch === context.libraryEpoch
    && registered.generationId === context.activeGenerationId;
};

const assertCursor = (
  cursor: DocumentSnapshot | null,
  ownerId: string,
  filters: CardQueryState,
  context: CourseQueryContext,
): void => {
  if (cursor && !cursorMatchesScope(cursor, ownerId, filters, context)) {
    throw new CourseIndexStaleError('cursor');
  }
};

const registerCursor = (
  cursor: QueryDocumentSnapshot | null,
  ownerId: string,
  filters: CardQueryState,
  context: CourseQueryContext,
): void => {
  if (!cursor) return;
  cursorScopes.set(cursor as object, {
    ownerId,
    queryKey: queryStateKey(filters),
    courseId: context.courseId,
    targetLanguage: context.targetLanguage,
    libraryEpoch: context.libraryEpoch,
    generationId: context.activeGenerationId,
  });
};

const projectionRows = (
  documents: readonly QueryDocumentSnapshot[],
): CourseCardIndexProjection[] => documents.map(document => ({
  ...(document.data() as CourseCardIndexProjection),
  cardId: document.id,
}));

const rawCardEpoch = (card: Partial<CardData>): number =>
  validCounter(card.libraryEpoch) ? Number(card.libraryEpoch) : 0;

const rawCardRevision = (card: Partial<CardData>): number | null =>
  validCounter(card.revision) ? Number(card.revision) : null;

const hydrateProjectionRows = async (
  db: Firestore,
  userId: string,
  rows: readonly CourseCardIndexProjection[],
  context: CourseQueryContext,
): Promise<CardData[]> => {
  const cardsById = new Map<string, CardData>();
  for (let offset = 0; offset < rows.length; offset += COURSE_INDEX_HYDRATION_BATCH_SIZE) {
    const ids = rows.slice(offset, offset + COURSE_INDEX_HYDRATION_BATCH_SIZE).map(row => row.cardId);
    const snapshot = await getDocs(query(
      primaryCardsCollection(db, userId),
      where(documentId(), 'in', ids),
    ));
    snapshot.docs.forEach(cardDocument => {
      const raw = cardDocument.data() as Partial<CardData>;
      const normalized = normalizeCardData(raw, cardDocument.id);
      cardsById.set(cardDocument.id, normalized);
    });
  }

  return rows.map(row => {
    const card = cardsById.get(row.cardId);
    if (!card) throw new CourseIndexStaleError('missing');
    if (
      effectiveCardTargetLanguage(card.language) !== row.targetLanguage
      || row.targetLanguage !== context.targetLanguage
      || rawCardEpoch(card) !== row.sourceLibraryEpoch
      || rawCardRevision(card) !== row.sourceRevision
      || row.sourceLibraryEpoch !== context.libraryEpoch
    ) {
      const reason = !card || effectiveCardTargetLanguage(card.language) !== row.targetLanguage
        ? 'target'
        : rawCardRevision(card) !== row.sourceRevision ? 'revision' : 'context';
      throw new CourseIndexStaleError(reason);
    }
    return card;
  });
};

const queryProjectionRows = async (
  db: Firestore,
  userId: string,
  filters: CardQueryState,
  context: CourseQueryContext,
  cursor: DocumentSnapshot | null,
  extra: QueryConstraint[],
  now = new Date(),
): Promise<QuerySnapshot> => {
  assertCursor(cursor, userId, filters, context);
  return getDocs(queryProjectionRowsQuery(
    db,
    userId,
    filters,
    context,
    cursor,
    extra,
    now,
  ));
};

const queryProjectionRowsQuery = (
  db: Firestore,
  userId: string,
  filters: CardQueryState,
  context: CourseQueryContext,
  cursor: DocumentSnapshot | null,
  extra: QueryConstraint[],
  now: Date,
) => buildCourseCardIndexQuery(db, userId, filters, context, cursor, extra, now);

const fetchCoursePageOnce = async (
  options: Required<Pick<CourseCardPageOptions, 'db' | 'userId' | 'filters' | 'context'>>
    & Pick<CourseCardPageOptions, 'cursor' | 'pageSize'>,
): Promise<CourseCardPage> => {
  const pageSize = Math.max(1, Math.min(COURSE_INDEX_PAGE_LIMIT, Math.floor(options.pageSize ?? CLOUD_PAGE_SIZE)));
  const scope = await readScope(options.db, options.userId, options.context);
  const snapshot = await queryProjectionRows(
    options.db,
    options.userId,
    options.filters,
    scope.context,
    options.cursor ?? null,
    [limit(pageSize + 1)],
  );
  const visibleDocuments = snapshot.docs.slice(0, pageSize);
  const visibleRows = projectionRows(visibleDocuments);
  const items = await hydrateProjectionRows(options.db, options.userId, visibleRows, scope.context);
  await assertCurrentScope(options.db, options.userId, scope);
  registerCursor(visibleDocuments[0] ?? null, options.userId, options.filters, scope.context);
  registerCursor(visibleDocuments.at(-1) ?? null, options.userId, options.filters, scope.context);
  return {
    items,
    firstCursor: visibleDocuments[0] ?? null,
    lastCursor: visibleDocuments.at(-1) ?? null,
    hasNext: snapshot.docs.length > pageSize,
  };
};

const isRetryableStale = (error: unknown): error is CourseIndexStaleError =>
  error instanceof CourseIndexStaleError;

const notifyStale = async (
  handler: CourseIndexStaleHandler | undefined,
  error: CourseIndexStaleError,
): Promise<void> => {
  if (!handler) return;
  try {
    await handler(error);
  } catch (handlerError) {
    console.warn('Course index stale recovery handler failed.', handlerError);
  }
};

export async function fetchCourseCardPage(options: CourseCardPageOptions): Promise<CourseCardPage> {
  const context = options.context;
  try {
    return await fetchCoursePageOnce(options);
  } catch (error) {
    if (!isRetryableStale(error)) throw error;
    const refreshed = await readCurrentReadyScope(options.db, options.userId, context);
    const cursor = refreshed.context.activeGenerationId === context.activeGenerationId
      ? options.cursor ?? null
      : null;
    try {
      return await fetchCoursePageOnce({ ...options, context: refreshed.context, cursor });
    } catch (retryError) {
      if (isRetryableStale(retryError)) await notifyStale(options.onStale, retryError);
      throw retryError;
    }
  }
}

export function subscribeCourseCardPage(
  options: CourseCardPageOptions,
  onPage: (page: CourseRealtimeCardPage) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  let stopped = false;
  let unsubscribe: Unsubscribe | null = null;
  let retryCount = 0;
  let subscriptionGeneration = 0;

  const open = async (context: CourseQueryContext, cursor: DocumentSnapshot | null) => {
    try {
      const scope = await readScope(options.db, options.userId, context);
      assertCursor(cursor, options.userId, options.filters, scope.context);
      if (stopped) return;
      const generation = ++subscriptionGeneration;
      const pageSize = Math.max(1, Math.min(COURSE_INDEX_PAGE_LIMIT, Math.floor(options.pageSize ?? CLOUD_PAGE_SIZE)));
      const source = onSnapshot(
        buildCourseCardIndexQuery(
          options.db,
          options.userId,
          options.filters,
          scope.context,
          cursor,
          [limit(pageSize + 1)],
        ),
        snapshot => {
          void (async () => {
            const visibleDocuments = snapshot.docs.slice(0, pageSize);
            const visibleRows = projectionRows(visibleDocuments);
            const items = await hydrateProjectionRows(options.db, options.userId, visibleRows, scope.context);
            await assertCurrentScope(options.db, options.userId, scope);
            registerCursor(visibleDocuments[0] ?? null, options.userId, options.filters, scope.context);
            registerCursor(visibleDocuments.at(-1) ?? null, options.userId, options.filters, scope.context);
            if (stopped || generation !== subscriptionGeneration) return;
            onPage({
              items,
              firstCursor: visibleDocuments[0] ?? null,
              lastCursor: visibleDocuments.at(-1) ?? null,
              hasNext: snapshot.docs.length > pageSize,
              changeTypes: snapshot.docChanges().map(change => change.type),
              fromCache: snapshot.metadata.fromCache,
              hasPendingWrites: snapshot.metadata.hasPendingWrites,
            });
          })().catch(async error => {
            if (stopped || generation !== subscriptionGeneration) return;
            if (isRetryableStale(error) && retryCount < 1) {
              retryCount += 1;
              unsubscribe?.();
              unsubscribe = null;
              try {
                const refreshed = await readCurrentReadyScope(options.db, options.userId, context);
                await open(
                  refreshed.context,
                  refreshed.context.activeGenerationId === context.activeGenerationId ? cursor : null,
                );
              } catch (retryError) {
                onError(retryError instanceof Error ? retryError : new Error(String(retryError)));
              }
              return;
            }
            if (isRetryableStale(error)) await notifyStale(options.onStale, error);
            onError(error instanceof Error ? error : new Error(String(error)));
          });
        },
        error => onError(error instanceof Error ? error : new Error(String(error))),
      );
      unsubscribe = source ?? null;
    } catch (error) {
      if (stopped) return;
      if (isRetryableStale(error) && retryCount < 1) {
        retryCount += 1;
        try {
          const refreshed = await readCurrentReadyScope(options.db, options.userId, context);
          await open(
            refreshed.context,
            refreshed.context.activeGenerationId === context.activeGenerationId ? cursor : null,
          );
        } catch (retryError) {
          onError(retryError instanceof Error ? retryError : new Error(String(retryError)));
        }
        return;
      }
      if (isRetryableStale(error)) await notifyStale(options.onStale, error);
      onError(error instanceof Error ? error : new Error(String(error)));
    }
  };

  void open(options.context, options.cursor ?? null);
  return () => {
    stopped = true;
    subscriptionGeneration += 1;
    unsubscribe?.();
    unsubscribe = null;
  };
}

export async function countCourseCards(
  db: Firestore,
  userId: string,
  filters: CardQueryState,
  context: CourseQueryContext,
  onStale?: CourseIndexStaleHandler,
): Promise<number> {
  try {
    const scope = await readScope(db, userId, context);
    const prefix = normalizePrefixSearch(filters.wordPrefix);
    const prefixConstraints: QueryConstraint[] = prefix ? [
      orderBy('normalizedWord', 'asc'),
      startAt(prefix),
      endAt(`${prefix}\uf8ff`),
    ] : [];
    const result = await getCount(query(
      courseQueryIndexCardsCollection(db, userId, scope.context.activeGenerationId),
      where('targetLanguage', '==', scope.context.targetLanguage),
      ...projectionFilterConstraints(filters, new Date()),
      ...prefixConstraints,
    ));
    await assertCurrentScope(db, userId, scope);
    return result.data().count;
  } catch (error) {
    if (!isRetryableStale(error)) throw error;
    const refreshed = await readCurrentReadyScope(db, userId, context);
    const prefix = normalizePrefixSearch(filters.wordPrefix);
    const prefixConstraints: QueryConstraint[] = prefix ? [
      orderBy('normalizedWord', 'asc'),
      startAt(prefix),
      endAt(`${prefix}\uf8ff`),
    ] : [];
    try {
      const result = await getCount(query(
        courseQueryIndexCardsCollection(db, userId, refreshed.context.activeGenerationId),
        where('targetLanguage', '==', refreshed.context.targetLanguage),
        ...projectionFilterConstraints(filters, new Date()),
        ...prefixConstraints,
      ));
      await assertCurrentScope(db, userId, refreshed);
      return result.data().count;
    } catch (retryError) {
      if (isRetryableStale(retryError)) await notifyStale(onStale, retryError);
      throw retryError;
    }
  }
}

const queryPracticeRows = async (
  db: Firestore,
  userId: string,
  context: CourseQueryContext,
  constraints: QueryConstraint[],
): Promise<CourseCardIndexProjection[]> => {
  const snapshot = await getDocs(query(
    courseQueryIndexCardsCollection(db, userId, context.activeGenerationId),
    where('targetLanguage', '==', context.targetLanguage),
    ...constraints,
  ));
  return projectionRows(snapshot.docs);
};

const fetchCoursePracticeOnce = async (options: CoursePracticeOptions): Promise<CardData[]> => {
  const maximumCards = Math.max(1, Math.min(COURSE_PRACTICE_LIMIT, Math.floor(options.maximum)));
  const now = options.now ?? new Date();
  const scope = await readScope(options.db, options.userId, options.context);
  let dueRows: CourseCardIndexProjection[] = [];
  let queueError: unknown;
  try {
    dueRows = await queryPracticeRows(options.db, options.userId, scope.context, [
      where('nextReviewDate', '<=', now.toISOString()),
      orderBy('nextReviewDate', 'asc'),
      orderBy(documentId(), 'asc'),
      limit(maximumCards),
    ]);
  } catch (error) {
    if (error instanceof CourseIndexNotReadyError) throw error;
    queueError = error;
  }
  const dueCards = await hydrateProjectionRows(options.db, options.userId, dueRows, scope.context);

  let newRows: CourseCardIndexProjection[] = [];
  if (dueCards.length < maximumCards) {
    try {
      newRows = await queryPracticeRows(options.db, options.userId, scope.context, [
        where('difficulty', '==', 'unrated'),
        orderBy('createdAt', 'desc'),
        orderBy(documentId(), 'desc'),
        limit(maximumCards - dueCards.length),
      ]);
    } catch (error) {
      if (error instanceof CourseIndexNotReadyError) throw error;
      queueError = error;
    }
  }
  const newCards = await hydrateProjectionRows(options.db, options.userId, newRows, scope.context);
  const scheduledCards = prioritizePracticeCards(dueCards, newCards, maximumCards);
  await assertCurrentScope(options.db, options.userId, scope);
  if (options.includeFuture === false) {
    if (scheduledCards.length === 0 && queueError) throw queueError;
    return scheduledCards;
  }
  if (scheduledCards.length >= maximumCards) return scheduledCards;

  const sampleSize = Math.min(100, Math.max(maximumCards, (maximumCards - scheduledCards.length) * 2));
  const pivot = createDailyPracticePivot(options.userId, now);
  let rotatedRows = await queryPracticeRows(options.db, options.userId, scope.context, [
    orderBy(documentId(), 'asc'),
    startAt(pivot),
    limit(sampleSize),
  ]);
  if (rotatedRows.length < sampleSize) {
    const wrappedRows = await queryPracticeRows(options.db, options.userId, scope.context, [
      orderBy(documentId(), 'asc'),
      limit(sampleSize - rotatedRows.length),
    ]);
    rotatedRows = [...rotatedRows, ...wrappedRows];
  }
  const rotatedCards = await hydrateProjectionRows(options.db, options.userId, rotatedRows, scope.context);
  await assertCurrentScope(options.db, options.userId, scope);
  return prioritizePracticeCards(scheduledCards, rotatedCards, maximumCards);
};

export async function fetchCoursePracticeCards(options: CoursePracticeOptions): Promise<CardData[]> {
  try {
    return await fetchCoursePracticeOnce(options);
  } catch (error) {
    if (!isRetryableStale(error)) throw error;
    const refreshed = await readCurrentReadyScope(options.db, options.userId, options.context);
    try {
      return await fetchCoursePracticeOnce({ ...options, context: refreshed.context });
    } catch (retryError) {
      if (isRetryableStale(retryError)) await notifyStale(options.onStale, retryError);
      throw retryError;
    }
  }
}

interface CourseIndexTransaction {
  get<T = unknown>(reference: unknown): Promise<{ exists(): boolean; data(): T | undefined }>;
  set(reference: unknown, value: unknown, options?: unknown): void;
  delete(reference: unknown): void;
}

export async function readCourseIndexMirrorTargets(
  transaction: CourseIndexTransaction,
  db: Firestore,
  userId: string,
  libraryEpoch: number,
): Promise<CourseIndexMirrorTarget[]> {
  const pointerSnapshot = await transaction.get(courseQueryIndexPointerRef(db, userId));
  const pointer = parsePointer(pointerSnapshot.exists() ? pointerSnapshot.data() : null);
  if (!pointer || pointer.libraryEpoch !== libraryEpoch) return [];
  const generationIds = [...new Set([
    pointer.activeGenerationId,
    pointer.buildingGenerationId,
  ].filter((value): value is string => Boolean(value)))];
  const targets: CourseIndexMirrorTarget[] = [];
  for (const generationId of generationIds) {
    const generationSnapshot = await transaction.get(
      courseQueryIndexGenerationRef(db, userId, generationId),
    );
    const generation = parseGeneration(generationSnapshot.exists() ? generationSnapshot.data() : null);
    if (
      generation
      && generation.libraryEpoch === libraryEpoch
      && (generation.status === 'building' || generation.status === 'ready')
    ) targets.push({ generationId, status: generation.status });
  }
  return targets;
}

export function writeCourseIndexMirrors(
  transaction: CourseIndexTransaction,
  db: Firestore,
  userId: string,
  targets: readonly CourseIndexMirrorTarget[],
  card: CardData | Partial<CardData>,
): void {
  const cardId = typeof card.id === 'string' ? card.id : '';
  if (!validId(cardId)) throw new Error('Cannot mirror a card without a valid id.');
  const projection = buildCourseCardIndexProjection(card, cardId);
  for (const target of targets) {
    transaction.set(
      courseQueryIndexCardRef(db, userId, target.generationId, cardId),
      projection,
      { merge: false },
    );
  }
}

export function deleteCourseIndexMirrors(
  transaction: CourseIndexTransaction,
  db: Firestore,
  userId: string,
  targets: readonly CourseIndexMirrorTarget[],
  cardId: string,
): void {
  if (!validId(cardId)) return;
  for (const target of targets) {
    transaction.delete(courseQueryIndexCardRef(db, userId, target.generationId, cardId));
  }
}

export const COURSE_INDEX_MAX_PAGE_SIZE = COURSE_INDEX_PAGE_LIMIT;
export const COURSE_INDEX_MAX_HYDRATION_BATCH_SIZE = COURSE_INDEX_HYDRATION_BATCH_SIZE;
