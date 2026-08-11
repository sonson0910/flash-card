import {
  ENTRY_STORE,
  SKILL_STORE,
  getActiveCatalogReleaseKey,
  openCatalogCacheDatabase,
  publicCatalogEntry,
  type CatalogCacheEntry,
  type StoredCatalogEntry,
} from './catalogCache';
import { observeCatalogTransaction } from './catalogTransaction';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const DEFAULT_SCAN_LIMIT = 250;
const MAX_SCAN_LIMIT = 500;
const MAX_CURSOR_BYTES = 4_096;
const MAX_RANK = Number.MAX_SAFE_INTEGER;

export interface CatalogCacheQuery {
  readonly catalogId: string;
  readonly language: string;
  readonly trackId: string;
  readonly tier?: string;
  readonly cefrLevel?: string;
  readonly topic?: string;
  readonly partOfSpeech?: string;
  readonly skill?: string;
  readonly normalizedLemmaPrefix?: string;
  readonly minimumRank?: number;
  readonly maximumRank?: number;
  readonly pageSize?: number;
  readonly scanLimit?: number;
  readonly cursor?: string | null;
}

export interface CatalogCacheQueryResult {
  readonly items: readonly CatalogCacheEntry[];
  readonly scanned: number;
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
}

type QueryIndex =
  | 'releaseLanguageTrackRank'
  | 'releaseLanguageTrackTierRank'
  | 'releaseLanguageTrackCefrRank'
  | 'releaseLanguageTrackTopicRank'
  | 'releaseLanguageTrackPosRank'
  | 'releaseLanguageTrackLemma'
  | 'releaseLanguageTrackSkillRank';

interface QueryPlan {
  readonly storeName: typeof ENTRY_STORE | typeof SKILL_STORE;
  readonly indexName: QueryIndex;
  readonly range: IDBKeyRange;
  readonly keyPrefix: readonly IDBValidKey[];
}

const boundedString = (value: unknown, label: string, maximum = 256): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new TypeError(`${label} must contain between 1 and ${maximum} characters.`);
  }
  return value;
};

const optionalString = (value: unknown, label: string, maximum = 256): string | undefined => (
  value === undefined ? undefined : boundedString(value, label, maximum)
);

const boundedInteger = (value: unknown, fallback: number, minimum: number, maximum: number): number => {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value as number)));
};

const normalizePrefix = (value: string | undefined): string | undefined => {
  if (value === undefined) return undefined;
  const normalized = value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  return normalized || undefined;
};

const boundedCursor = (value: unknown): string | null | undefined => {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'string' || new TextEncoder().encode(value).byteLength > MAX_CURSOR_BYTES) {
    throw new TypeError(`cursor must be a string of at most ${MAX_CURSOR_BYTES} encoded bytes.`);
  }
  return value;
};

const rankRange = (
  prefix: readonly IDBValidKey[],
  minimumRank: number,
  maximumRank: number,
): IDBKeyRange => IDBKeyRange.bound(
  [...prefix, minimumRank, ''],
  [...prefix, maximumRank, '\uffff'],
);

const selectPlan = (
  releaseKey: string,
  query: Required<Pick<CatalogCacheQuery, 'language' | 'trackId'>> & CatalogCacheQuery,
  minimumRank: number,
  maximumRank: number,
): QueryPlan => {
  const common = [releaseKey, query.language, query.trackId] as const;
  const lemmaPrefix = normalizePrefix(query.normalizedLemmaPrefix);
  if (lemmaPrefix) {
    return {
      storeName: ENTRY_STORE,
      indexName: 'releaseLanguageTrackLemma',
      keyPrefix: common,
      range: IDBKeyRange.bound(
        [...common, lemmaPrefix],
        [...common, `${lemmaPrefix}\uffff`, MAX_RANK, '\uffff'],
      ),
    };
  }
  if (query.skill) {
    const prefix = [...common, query.skill] as const;
    return {
      storeName: SKILL_STORE,
      indexName: 'releaseLanguageTrackSkillRank',
      keyPrefix: prefix,
      range: rankRange(prefix, minimumRank, maximumRank),
    };
  }
  const exactPlans: readonly [string | undefined, QueryIndex][] = [
    [query.tier, 'releaseLanguageTrackTierRank'],
    [query.cefrLevel, 'releaseLanguageTrackCefrRank'],
    [query.topic, 'releaseLanguageTrackTopicRank'],
    [query.partOfSpeech, 'releaseLanguageTrackPosRank'],
  ];
  const exact = exactPlans.find(([value]) => value !== undefined);
  if (exact) {
    const prefix = [...common, exact[0] as string] as const;
    return {
      storeName: ENTRY_STORE,
      indexName: exact[1],
      keyPrefix: prefix,
      range: rankRange(prefix, minimumRank, maximumRank),
    };
  }
  return {
    storeName: ENTRY_STORE,
    indexName: 'releaseLanguageTrackRank',
    keyPrefix: common,
    range: rankRange(common, minimumRank, maximumRank),
  };
};

const transactionDone = (transaction: IDBTransaction): Promise<void> => observeCatalogTransaction(
  transaction,
  'Catalog query transaction was aborted.',
  'Catalog query transaction failed.',
);

const requestResult = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('Catalog query request failed.'));
});

const nextCursor = (
  request: IDBRequest<IDBCursorWithValue | null>,
  cursor: IDBCursorWithValue,
): Promise<IDBCursorWithValue | null> => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('Catalog cursor failed.'));
  cursor.continue();
});

const rangeAfterCursor = (
  range: IDBKeyRange,
  afterKey: IDBValidKey,
): IDBKeyRange | null => {
  if (!range.includes(afterKey)) {
    throw new TypeError('The catalog query cursor is outside the active filter range.');
  }
  if (range.upper !== undefined && indexedDB.cmp(afterKey, range.upper) >= 0) return null;
  return range.upper === undefined
    ? IDBKeyRange.lowerBound(afterKey, true)
    : IDBKeyRange.bound(afterKey, range.upper, true, range.upperOpen);
};

const cursorSignature = (
  query: CatalogCacheQuery,
  minimumRank: number,
  maximumRank: number,
): string => JSON.stringify({
  catalogId: query.catalogId,
  language: query.language,
  trackId: query.trackId,
  tier: query.tier ?? null,
  cefrLevel: query.cefrLevel ?? null,
  topic: query.topic ?? null,
  partOfSpeech: query.partOfSpeech ?? null,
  skill: query.skill ?? null,
  normalizedLemmaPrefix: normalizePrefix(query.normalizedLemmaPrefix) ?? null,
  minimumRank,
  maximumRank,
});

const encodeCursor = (indexName: QueryIndex, signature: string, key: IDBValidKey): string => encodeURIComponent(JSON.stringify({
  indexName,
  signature,
  key,
}));

const decodeCursor = (
  value: string | null | undefined,
  indexName: QueryIndex,
  signature: string,
): IDBValidKey | undefined => {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as { indexName?: unknown; signature?: unknown; key?: unknown };
    if (parsed.indexName !== indexName || parsed.signature !== signature || !Array.isArray(parsed.key)) {
      throw new Error('mismatch');
    }
    return parsed.key as IDBValidKey;
  } catch {
    throw new TypeError('The catalog query cursor is invalid for this filter set.');
  }
};

const startsWithKeys = (key: IDBValidKey, prefix: readonly IDBValidKey[]): boolean => (
  Array.isArray(key)
  && prefix.every((value, index) => key[index] === value)
);

const matches = (
  entry: CatalogCacheEntry,
  query: CatalogCacheQuery,
  minimumRank: number,
  maximumRank: number,
  lemmaPrefix: string | undefined,
): boolean => (
  entry.language === query.language
  && entry.trackId === query.trackId
  && (query.tier === undefined || entry.tier === query.tier)
  && (query.cefrLevel === undefined || entry.cefrLevel === query.cefrLevel)
  && (query.topic === undefined || entry.topic === query.topic)
  && (query.partOfSpeech === undefined || entry.partOfSpeech === query.partOfSpeech)
  && (query.skill === undefined || entry.skills.includes(query.skill))
  && (lemmaPrefix === undefined || entry.normalizedLemma.startsWith(lemmaPrefix))
  && entry.rank >= minimumRank
  && entry.rank <= maximumRank
);

export async function queryCatalogCache(input: CatalogCacheQuery): Promise<CatalogCacheQueryResult> {
  const query: CatalogCacheQuery = {
    ...input,
    catalogId: boundedString(input.catalogId, 'catalogId', 128),
    language: boundedString(input.language, 'language', 35),
    trackId: boundedString(input.trackId, 'trackId', 128),
    tier: optionalString(input.tier, 'tier'),
    cefrLevel: optionalString(input.cefrLevel, 'cefrLevel', 32),
    topic: optionalString(input.topic, 'topic'),
    partOfSpeech: optionalString(input.partOfSpeech, 'partOfSpeech', 64),
    skill: optionalString(input.skill, 'skill', 128),
    normalizedLemmaPrefix: optionalString(
      input.normalizedLemmaPrefix,
      'normalizedLemmaPrefix',
      256,
    ),
    cursor: boundedCursor(input.cursor),
  };
  const minimumRank = boundedInteger(input.minimumRank, 0, 0, MAX_RANK);
  const maximumRank = boundedInteger(input.maximumRank, MAX_RANK, 0, MAX_RANK);
  if (minimumRank > maximumRank) throw new TypeError('minimumRank must not exceed maximumRank.');
  const pageSize = boundedInteger(input.pageSize, DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  const scanLimit = boundedInteger(input.scanLimit, DEFAULT_SCAN_LIMIT, pageSize, MAX_SCAN_LIMIT);
  const releaseKey = await getActiveCatalogReleaseKey(query.catalogId);
  if (!releaseKey) return { items: [], scanned: 0, hasMore: false, nextCursor: null };
  const plan = selectPlan(releaseKey, query as Required<Pick<CatalogCacheQuery, 'language' | 'trackId'>> & CatalogCacheQuery, minimumRank, maximumRank);
  const signature = cursorSignature(query, minimumRank, maximumRank);
  const afterKey = decodeCursor(query.cursor, plan.indexName, signature);
  if (afterKey && !startsWithKeys(afterKey, plan.keyPrefix)) {
    throw new TypeError('The catalog query cursor belongs to another release or filter set.');
  }
  const database = await openCatalogCacheDatabase();
  const transaction = database.transaction(
    plan.storeName === SKILL_STORE ? [SKILL_STORE, ENTRY_STORE] : ENTRY_STORE,
    'readonly',
  );
  const done = transactionDone(transaction);
  try {
    const index = transaction.objectStore(plan.storeName).index(plan.indexName);
    const cursorRange = afterKey ? rangeAfterCursor(plan.range, afterKey) : plan.range;
    if (!cursorRange) {
      await done;
      return { items: [], scanned: 0, hasMore: false, nextCursor: null };
    }
    const cursorRequest = index.openCursor(cursorRange);
    let cursor = await requestResult(cursorRequest);
    const lemmaPrefix = normalizePrefix(query.normalizedLemmaPrefix);
    const items: CatalogCacheEntry[] = [];
    let scanned = 0;
    let lastKey: IDBValidKey | null = null;
    while (cursor && scanned < scanLimit && items.length < pageSize) {
      lastKey = cursor.key;
      scanned += 1;
      const stored = plan.storeName === ENTRY_STORE
        ? cursor.value as StoredCatalogEntry
        : await requestResult(
            transaction.objectStore(ENTRY_STORE).get((cursor.value as { entryKey: string }).entryKey),
          ) as StoredCatalogEntry | undefined;
      if (stored) {
        const entry = publicCatalogEntry(stored);
        if (matches(entry, query, minimumRank, maximumRank, lemmaPrefix)) items.push(entry);
      }
      if (scanned < scanLimit && items.length < pageSize) cursor = await nextCursor(cursorRequest, cursor);
    }
    const stoppedAtBound = Boolean(cursor) && (scanned >= scanLimit || items.length >= pageSize);
    await done;
    return {
      items,
      scanned,
      hasMore: stoppedAtBound,
      nextCursor: stoppedAtBound && lastKey !== null ? encodeCursor(plan.indexName, signature, lastKey) : null,
    };
  } catch (error) {
    try { transaction.abort(); } catch { /* already completed or aborted */ }
    await done.catch(() => undefined);
    throw error;
  }
}
