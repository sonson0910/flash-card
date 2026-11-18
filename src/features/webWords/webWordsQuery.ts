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
import { effectiveCardLanguagePair, normalizeCardData } from '../../lib/cardNormalization';

/** Matches the existing library page size family (CLOUD_PAGE_SIZE = 9 for the
 * dense grid); WebWords groups by article, so a larger page keeps a whole
 * recent article's words together more often. */
export const WEB_WORDS_PAGE_SIZE = 30;

export interface WebWordsPage {
  readonly items: readonly CardData[];
  /** Number of raw target-language documents examined before pair filtering. */
  readonly scannedCount: number;
  readonly hasNext: boolean;
  readonly cursor: QueryDocumentSnapshot | null;
}

export interface FetchWebWordsPageOptions {
  readonly db: Firestore;
  readonly ownerId: string;
  /** BCP-47 target language code; every card always has an explicit `language` (canonicalCard writes it), so this is a plain equality filter. */
  readonly targetLanguage: string;
  /** Meaning language for the active course. Legacy omissions resolve to Vietnamese after the bounded query. */
  readonly translationLanguage: string;
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
 * `source.capturedAt`, then filtered to the active language pair after
 * normalization. This preserves legacy Vietnamese source cards that omit
 * `translationLanguage`; Firestore equality filters cannot include omitted
 * fields. No separate "source exists" filter is issued.
 * Firestore's `orderBy` silently excludes any document missing the ordered
 * field, and the card `source` contract guarantees `capturedAt` is always
 * populated whenever any other `source` field is (see
 * contract-card-source-metadata.md). So `orderBy('source.capturedAt', 'desc')`
 * doubles as the "has a web source" filter at zero extra read cost — the
 * cheapest correct shape for this query, and the reason there is no
 * additional `where` clause or sidecar collection here.
 *
 * Required composite index (already in firestore.indexes.json):
 *   collectionGroup: cards, fields: language ASC, source.capturedAt DESC, __name__ DESC
 */
export async function fetchWebWordsPage({
  db,
  ownerId,
  targetLanguage,
  translationLanguage,
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
    .filter((card): card is CardData & { source: NonNullable<CardData['source']> } => {
      if (!card.source) return false;
      try {
        const pair = effectiveCardLanguagePair(card);
        return pair.language === targetLanguage && pair.translationLanguage === translationLanguage;
      } catch {
        return false;
      }
    });
  return {
    items,
    scannedCount: visibleDocs.length,
    hasNext: detectHasNext && snapshot.docs.length > pageSize,
    cursor: visibleDocs[visibleDocs.length - 1] ?? null,
  };
}
