import {
  collection,
  documentId,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  where,
  type Firestore,
  type QueryConstraint,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import type { CardData } from '../../types/card';
import { normalizeCardData } from '../../lib/cardNormalization';

/** Matches the existing library page size family (CLOUD_PAGE_SIZE = 9 for the
 * dense grid); WebWords groups by article, so a larger page keeps a whole
 * recent article's words together more often. */
export const WEB_WORDS_PAGE_SIZE = 30;

export interface WebWordsPage {
  readonly items: readonly CardData[];
  readonly hasNext: boolean;
  readonly cursor: QueryDocumentSnapshot | null;
}

export interface FetchWebWordsPageOptions {
  readonly db: Firestore;
  readonly ownerId: string;
  /** BCP-47 target language code; every card always has an explicit `language` (canonicalCard writes it), so this is a plain equality filter. */
  readonly targetLanguage: string;
  readonly cursor?: QueryDocumentSnapshot | null;
  readonly pageSize?: number;
  /**
   * When true (default), the query requests one extra document to detect
   * `hasNext` without a second round trip — the same lookahead pattern
   * `cardRepository.ts` already uses for the library grid. The Today strip
   * passes false because it never paginates, saving one read per open.
   */
  readonly detectHasNext?: boolean;
}

/**
 * Cards captured from the web are queried by `language` plus an order on
 * `source.capturedAt` — no separate "source exists" filter is issued.
 * Firestore's `orderBy` silently excludes any document missing the ordered
 * field, and the card `source` contract guarantees `capturedAt` is always
 * populated whenever any other `source` field is (see
 * contract-card-source-metadata.md). So `orderBy('source.capturedAt', 'desc')`
 * doubles as the "has a web source" filter at zero extra read cost — the
 * cheapest correct shape for this query, and the reason there is no
 * additional `where` clause or sidecar collection here.
 *
 * Required composite index (added to firestore.indexes.json by the
 * controller, see the phase report):
 *   collectionGroup: cards, fields: language ASC, source.capturedAt DESC, __name__ DESC
 */
export async function fetchWebWordsPage({
  db,
  ownerId,
  targetLanguage,
  cursor = null,
  pageSize = WEB_WORDS_PAGE_SIZE,
  detectHasNext = true,
}: FetchWebWordsPageOptions): Promise<WebWordsPage> {
  const requestSize = detectHasNext ? pageSize + 1 : pageSize;
  const constraints: QueryConstraint[] = [
    where('language', '==', targetLanguage),
    orderBy('source.capturedAt', 'desc'),
    orderBy(documentId(), 'desc'),
    ...(cursor ? [startAfter(cursor)] : []),
    limit(requestSize),
  ];
  const snapshot = await getDocs(query(collection(db, 'users', ownerId, 'cards'), ...constraints));
  const visibleDocs = detectHasNext ? snapshot.docs.slice(0, pageSize) : snapshot.docs;
  const items = visibleDocs
    .map(doc => normalizeCardData(doc.data() as Partial<CardData>, doc.id))
    // Defense in depth: the query's own ordering already guarantees this,
    // the filter here only protects against a future query-shape change.
    .filter((card): card is CardData & { source: NonNullable<CardData['source']> } => Boolean(card.source));
  return {
    items,
    hasNext: detectHasNext && snapshot.docs.length > pageSize,
    cursor: visibleDocs[visibleDocs.length - 1] ?? null,
  };
}
