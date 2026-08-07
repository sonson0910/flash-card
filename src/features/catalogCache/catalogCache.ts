import { parseLexemeV3 } from '../multilingual/schemaV3Validation';
import type { LexemeV3 } from '../multilingual/schemaV3';

export const CATALOG_CACHE_DATABASE_NAME = 'sonflash-catalog-cache';
const DATABASE_VERSION = 3;
export const CATALOG_STORE = 'catalogs';
export const RELEASE_STORE = 'releases';
export const RECEIPT_STORE = 'chunk-receipts';
export const ENTRY_STORE = 'entries';
export const SKILL_STORE = 'skill-postings';
export const LEXEME_STORE = 'lexemes';

const MAX_RELEASE_MEMBERSHIPS = 10_000;
const MAX_RELEASE_LEXEMES = 10_000;
const MAX_RELEASE_CHUNKS = 100;
const MAX_RELEASE_BYTES = 50 * 1024 * 1024;
const MAX_CHUNK_MEMBERSHIPS = 100;
const MAX_CHUNK_LEXEMES = 100;
const MAX_CHUNK_BYTES = 512 * 1024;
const MAX_TEXT = 256;
const MAX_SKILLS = 8;

export interface CatalogReleaseDescriptor {
  readonly catalogId: string;
  readonly releaseId: string;
  readonly schemaVersion: number;
  readonly contentLanguage: string;
  readonly chunkCount: number;
  /** Optional only for cache schema v2 compatibility. */
  readonly lexemeCount?: number;
  readonly membershipCount: number;
  readonly encodedBytes: number;
}

export interface CatalogChunkReceipt {
  readonly chunkId: string;
  readonly sha256: string;
  /** Optional only for cache schema v2 compatibility. */
  readonly lexemeCount?: number;
  readonly membershipCount: number;
  readonly encodedBytes: number;
}

export interface CatalogCacheEntry {
  readonly membershipId: string;
  readonly lexemeId: string;
  readonly language: string;
  readonly trackId: string;
  readonly tier: string;
  readonly cefrLevel: string | null;
  readonly topic: string;
  readonly partOfSpeech: string;
  readonly skills: readonly string[];
  readonly rank: number;
  readonly normalizedLemma: string;
  readonly lemma: string;
}

export interface CatalogInstallHandle {
  readonly catalogId: string;
  readonly releaseId: string;
  readonly releaseKey: string;
  readonly installId: string;
}

export interface CatalogInstallStatus {
  readonly receivedChunks: number;
  readonly receivedLexemes: number;
  readonly receivedMemberships: number;
  readonly receivedBytes: number;
  readonly complete: boolean;
}

/** Internal-release identity paired atomically with its public descriptor. */
export interface ActiveCatalogReleaseSnapshot {
  readonly releaseKey: string;
  readonly release: CatalogReleaseDescriptor;
}

interface StoredCatalog {
  readonly catalogId: string;
  readonly activeReleaseKey: string | null;
  readonly previousReleaseKey: string | null;
  readonly pendingReleaseKey: string | null;
  readonly pendingInstallId: string | null;
}

interface StoredRelease extends CatalogReleaseDescriptor {
  readonly releaseKey: string;
  readonly installId: string;
  readonly status: 'staging' | 'complete';
}

interface StoredReceipt extends CatalogChunkReceipt {
  readonly receiptKey: string;
  readonly releaseKey: string;
}

export interface StoredCatalogEntry extends CatalogCacheEntry {
  readonly entryKey: string;
  readonly releaseKey: string;
}

interface StoredSkillPosting {
  readonly postingKey: string;
  readonly releaseKey: string;
  readonly language: string;
  readonly trackId: string;
  readonly skill: string;
  readonly rank: number;
  readonly membershipId: string;
  readonly entryKey: string;
}

interface StoredCatalogLexeme {
  readonly lexemeKey: string;
  readonly releaseKey: string;
  readonly lexemeId: string;
  readonly value: LexemeV3;
}

export interface HydratedCatalogEntry {
  readonly membership: CatalogCacheEntry;
  readonly lexeme: LexemeV3;
}

type UnknownRecord = Record<string, unknown>;

let databasePromise: Promise<IDBDatabase> | null = null;
let activeDatabase: IDBDatabase | null = null;

const keyOf = (...parts: readonly string[]) => JSON.stringify(parts);

const requestResult = <T>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
});

const transactionDone = (transaction: IDBTransaction): Promise<void> => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onabort = () => reject(transaction.error ?? new Error('Catalog cache transaction was aborted.'));
  transaction.onerror = () => reject(transaction.error ?? new Error('Catalog cache transaction failed.'));
});

const recordAt = (value: unknown, label: string, keys: readonly string[]): UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  const source = value as UnknownRecord;
  const unknown = Object.keys(source).find(key => !keys.includes(key));
  if (unknown) throw new TypeError(`${label}.${unknown} is an unknown field.`);
  return source;
};

const boundedString = (value: unknown, label: string, maximum = MAX_TEXT): string => {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new TypeError(`${label} must contain between 1 and ${maximum} characters.`);
  }
  return value;
};

const boundedInteger = (
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): number => {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new TypeError(`${label} must be a safe integer between ${minimum.toLocaleString('en-US')} and ${maximum.toLocaleString('en-US')}.`);
  }
  return value as number;
};

const normalizeDescriptor = (value: CatalogReleaseDescriptor): CatalogReleaseDescriptor => {
  const source = recordAt(value, 'release', [
    'catalogId', 'releaseId', 'schemaVersion', 'contentLanguage', 'chunkCount', 'lexemeCount',
    'membershipCount', 'encodedBytes',
  ]);
  return {
    catalogId: boundedString(source.catalogId, 'release.catalogId', 128),
    releaseId: boundedString(source.releaseId, 'release.releaseId', 128),
    schemaVersion: boundedInteger(source.schemaVersion, 'release.schemaVersion', 1, Number.MAX_SAFE_INTEGER),
    contentLanguage: boundedString(source.contentLanguage, 'release.contentLanguage', 35),
    chunkCount: boundedInteger(source.chunkCount, 'release.chunkCount', 1, MAX_RELEASE_CHUNKS),
    lexemeCount: source.lexemeCount === undefined
      ? 0
      : boundedInteger(source.lexemeCount, 'release.lexemeCount', 0, MAX_RELEASE_LEXEMES),
    membershipCount: boundedInteger(source.membershipCount, 'release.membershipCount', 1, MAX_RELEASE_MEMBERSHIPS),
    encodedBytes: boundedInteger(source.encodedBytes, 'release.encodedBytes', 1, MAX_RELEASE_BYTES),
  };
};

const normalizeReceipt = (value: CatalogChunkReceipt): CatalogChunkReceipt => {
  const source = recordAt(value, 'receipt', [
    'chunkId', 'sha256', 'lexemeCount', 'membershipCount', 'encodedBytes',
  ]);
  const sha256 = boundedString(source.sha256, 'receipt.sha256', 64);
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new TypeError('receipt.sha256 must be a lowercase SHA-256 hex digest.');
  return {
    chunkId: boundedString(source.chunkId, 'receipt.chunkId', 128),
    sha256,
    lexemeCount: source.lexemeCount === undefined
      ? 0
      : boundedInteger(source.lexemeCount, 'receipt.lexemeCount', 0, MAX_CHUNK_LEXEMES),
    membershipCount: boundedInteger(source.membershipCount, 'receipt.membershipCount', 1, MAX_CHUNK_MEMBERSHIPS),
    encodedBytes: boundedInteger(source.encodedBytes, 'receipt.encodedBytes', 1, MAX_CHUNK_BYTES),
  };
};

const normalizeEntry = (value: CatalogCacheEntry): CatalogCacheEntry => {
  const source = recordAt(value, 'entry', [
    'membershipId', 'lexemeId', 'language', 'trackId', 'tier', 'cefrLevel', 'topic', 'partOfSpeech',
    'skills', 'rank', 'normalizedLemma', 'lemma',
  ]);
  if (!Array.isArray(source.skills) || source.skills.length > MAX_SKILLS) {
    throw new TypeError(`entry.skills must contain at most ${MAX_SKILLS} items.`);
  }
  const skills = source.skills.map((skill, index) => boundedString(skill, `entry.skills[${index}]`, 128));
  if (new Set(skills).size !== skills.length) throw new TypeError('entry.skills contains a duplicate skill.');
  const cefrLevel = source.cefrLevel === null
    ? null
    : boundedString(source.cefrLevel, 'entry.cefrLevel', 32);
  return {
    membershipId: boundedString(source.membershipId, 'entry.membershipId', 128),
    lexemeId: boundedString(source.lexemeId, 'entry.lexemeId', 128),
    language: boundedString(source.language, 'entry.language', 35),
    trackId: boundedString(source.trackId, 'entry.trackId', 128),
    tier: boundedString(source.tier, 'entry.tier'),
    cefrLevel,
    topic: boundedString(source.topic, 'entry.topic'),
    partOfSpeech: boundedString(source.partOfSpeech, 'entry.partOfSpeech', 64),
    skills,
    rank: boundedInteger(source.rank, 'entry.rank', 0, Number.MAX_SAFE_INTEGER),
    normalizedLemma: boundedString(source.normalizedLemma, 'entry.normalizedLemma'),
    lemma: boundedString(source.lemma, 'entry.lemma'),
  };
};

const normalizeLexeme = (value: LexemeV3): LexemeV3 => {
  const parsed = parseLexemeV3(value);
  if (parsed.provenance.editorialStatus !== 'published') {
    throw new TypeError('Catalog cache accepts only published lexeme content.');
  }
  return parsed;
};

const createStores = (database: IDBDatabase): void => {
  const catalogs = database.createObjectStore(CATALOG_STORE, { keyPath: 'catalogId' });
  void catalogs;
  const releases = database.createObjectStore(RELEASE_STORE, { keyPath: 'releaseKey' });
  releases.createIndex('catalogId', 'catalogId');
  const receipts = database.createObjectStore(RECEIPT_STORE, { keyPath: 'receiptKey' });
  receipts.createIndex('releaseKey', 'releaseKey');
  const entries = database.createObjectStore(ENTRY_STORE, { keyPath: 'entryKey' });
  entries.createIndex('releaseKey', 'releaseKey');
  entries.createIndex('releaseLanguageTrackRank', ['releaseKey', 'language', 'trackId', 'rank', 'membershipId']);
  entries.createIndex('releaseLanguageTrackTierRank', ['releaseKey', 'language', 'trackId', 'tier', 'rank', 'membershipId']);
  entries.createIndex('releaseLanguageTrackCefrRank', ['releaseKey', 'language', 'trackId', 'cefrLevel', 'rank', 'membershipId']);
  entries.createIndex('releaseLanguageTrackTopicRank', ['releaseKey', 'language', 'trackId', 'topic', 'rank', 'membershipId']);
  entries.createIndex('releaseLanguageTrackPosRank', ['releaseKey', 'language', 'trackId', 'partOfSpeech', 'rank', 'membershipId']);
  entries.createIndex('releaseLanguageTrackLemma', ['releaseKey', 'language', 'trackId', 'normalizedLemma', 'rank', 'membershipId']);
  const skills = database.createObjectStore(SKILL_STORE, { keyPath: 'postingKey' });
  skills.createIndex('releaseKey', 'releaseKey');
  skills.createIndex('releaseLanguageTrackSkillRank', ['releaseKey', 'language', 'trackId', 'skill', 'rank', 'membershipId']);
  const lexemes = database.createObjectStore(LEXEME_STORE, { keyPath: 'lexemeKey' });
  lexemes.createIndex('releaseKey', 'releaseKey');
};

const requiredIndexes = {
  [RELEASE_STORE]: ['catalogId'],
  [RECEIPT_STORE]: ['releaseKey'],
  [ENTRY_STORE]: [
    'releaseKey',
    'releaseLanguageTrackRank', 'releaseLanguageTrackTierRank', 'releaseLanguageTrackCefrRank',
    'releaseLanguageTrackTopicRank', 'releaseLanguageTrackPosRank', 'releaseLanguageTrackLemma',
  ],
  [SKILL_STORE]: ['releaseKey', 'releaseLanguageTrackSkillRank'],
  [LEXEME_STORE]: ['releaseKey'],
} as const;

const upgradeReleaseIndexes = (transaction: IDBTransaction): void => {
  const releases = transaction.objectStore(RELEASE_STORE);
  if (!releases.indexNames.contains('catalogId')) releases.createIndex('catalogId', 'catalogId');
  const entries = transaction.objectStore(ENTRY_STORE);
  if (!entries.indexNames.contains('releaseKey')) entries.createIndex('releaseKey', 'releaseKey');
  const skills = transaction.objectStore(SKILL_STORE);
  if (!skills.indexNames.contains('releaseKey')) skills.createIndex('releaseKey', 'releaseKey');
};

const createLexemeStore = (database: IDBDatabase): void => {
  if (database.objectStoreNames.contains(LEXEME_STORE)) return;
  const lexemes = database.createObjectStore(LEXEME_STORE, { keyPath: 'lexemeKey' });
  lexemes.createIndex('releaseKey', 'releaseKey');
};

const assertCompatibleSchema = (database: IDBDatabase): void => {
  for (const storeName of [CATALOG_STORE, RELEASE_STORE, RECEIPT_STORE, ENTRY_STORE, SKILL_STORE, LEXEME_STORE]) {
    if (!database.objectStoreNames.contains(storeName)) throw new Error('The catalog cache schema is incompatible.');
  }
  for (const [storeName, indexes] of Object.entries(requiredIndexes)) {
    const transaction = database.transaction(storeName, 'readonly');
    const existing = transaction.objectStore(storeName).indexNames;
    if (indexes.some(index => !existing.contains(index))) throw new Error('The catalog cache schema is incompatible.');
  }
};

const registerDatabase = (database: IDBDatabase): IDBDatabase => {
  activeDatabase = database;
  database.onversionchange = () => {
    database.close();
    if (activeDatabase === database) activeDatabase = null;
    databasePromise = null;
  };
  return database;
};

const openForwardCompatibleDatabase = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = indexedDB.open(CATALOG_CACHE_DATABASE_NAME);
  request.onsuccess = () => {
    try {
      assertCompatibleSchema(request.result);
      resolve(registerDatabase(request.result));
    } catch (error) {
      request.result.close();
      reject(error);
    }
  };
  request.onerror = () => reject(request.error ?? new Error('Could not open the newer catalog cache.'));
});

/** Internal persistence seam shared by the bounded index module. */
export function openCatalogCacheDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB is unavailable.'));
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(CATALOG_CACHE_DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = event => {
      const oldVersion = (event as IDBVersionChangeEvent).oldVersion;
      if (oldVersion === 0) createStores(request.result);
      else {
        if (oldVersion < 2 && request.transaction) upgradeReleaseIndexes(request.transaction);
        if (oldVersion < 3) createLexemeStore(request.result);
      }
    };
    request.onsuccess = () => resolve(registerDatabase(request.result));
    request.onerror = () => {
      const error = request.error ?? new Error('Could not open the catalog cache.');
      if (error.name === 'VersionError') {
        openForwardCompatibleDatabase().then(resolve, reject);
        return;
      }
      databasePromise = null;
      reject(error);
    };
  });
  return databasePromise;
}

const createInstallId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
};

const defaultCatalog = (catalogId: string): StoredCatalog => ({
  catalogId,
  activeReleaseKey: null,
  previousReleaseKey: null,
  pendingReleaseKey: null,
  pendingInstallId: null,
});

const sameDescriptor = (left: StoredRelease, right: CatalogReleaseDescriptor): boolean => (
  left.catalogId === right.catalogId
  && left.releaseId === right.releaseId
  && left.schemaVersion === right.schemaVersion
  && left.contentLanguage === right.contentLanguage
  && left.chunkCount === right.chunkCount
  && (left.lexemeCount ?? 0) === (right.lexemeCount ?? 0)
  && left.membershipCount === right.membershipCount
  && left.encodedBytes === right.encodedBytes
);

const deleteIndexMatches = (
  transaction: IDBTransaction,
  storeName: string,
  indexName: string,
  releaseKey: string,
): Promise<void> => {
  const store = transaction.objectStore(storeName);
  return requestResult(store.index(indexName).getAllKeys(IDBKeyRange.only(releaseKey)))
    .then(keys => { keys.forEach(key => store.delete(key)); });
};

const purgeObsoleteCatalogGenerations = async (
  transaction: IDBTransaction,
  catalogId: string,
  retainedReleaseKeys: ReadonlySet<string>,
): Promise<void> => {
  const releaseStore = transaction.objectStore(RELEASE_STORE);
  const releases = await requestResult(
    releaseStore.index('catalogId').getAll(IDBKeyRange.only(catalogId)),
  ) as StoredRelease[];
  const obsolete = releases.filter(release => !retainedReleaseKeys.has(release.releaseKey));
  for (const release of obsolete) {
    await deleteIndexMatches(transaction, RECEIPT_STORE, 'releaseKey', release.releaseKey);
    await deleteIndexMatches(transaction, ENTRY_STORE, 'releaseKey', release.releaseKey);
    await deleteIndexMatches(transaction, SKILL_STORE, 'releaseKey', release.releaseKey);
    await deleteIndexMatches(transaction, LEXEME_STORE, 'releaseKey', release.releaseKey);
    releaseStore.delete(release.releaseKey);
  }
};

export async function beginCatalogInstall(input: CatalogReleaseDescriptor): Promise<CatalogInstallHandle> {
  const descriptor = normalizeDescriptor(input);
  const database = await openCatalogCacheDatabase();
  const transaction = database.transaction(
    [CATALOG_STORE, RELEASE_STORE, RECEIPT_STORE, ENTRY_STORE, SKILL_STORE, LEXEME_STORE],
    'readwrite',
  );
  const done = transactionDone(transaction);
  const catalogs = transaction.objectStore(CATALOG_STORE);
  const releases = transaction.objectStore(RELEASE_STORE);
  const catalog = (await requestResult(catalogs.get(descriptor.catalogId)) as StoredCatalog | undefined)
    ?? defaultCatalog(descriptor.catalogId);
  if (catalog.pendingReleaseKey && catalog.pendingInstallId) {
    const pending = await requestResult(releases.get(catalog.pendingReleaseKey)) as StoredRelease | undefined;
    if (pending?.status === 'staging' && sameDescriptor(pending, descriptor)) {
      await done;
      return {
        catalogId: descriptor.catalogId,
        releaseId: descriptor.releaseId,
        releaseKey: pending.releaseKey,
        installId: pending.installId,
      };
    }
  }
  const installId = createInstallId();
  const releaseKey = keyOf(descriptor.catalogId, descriptor.releaseId, installId);
  releases.put({ ...descriptor, releaseKey, installId, status: 'staging' } satisfies StoredRelease);
  catalogs.put({
    ...catalog,
    pendingReleaseKey: releaseKey,
    pendingInstallId: installId,
  } satisfies StoredCatalog);
  await purgeObsoleteCatalogGenerations(transaction, descriptor.catalogId, new Set([
    releaseKey,
    ...(catalog.activeReleaseKey ? [catalog.activeReleaseKey] : []),
    ...(catalog.previousReleaseKey ? [catalog.previousReleaseKey] : []),
  ]));
  await done;
  return { catalogId: descriptor.catalogId, releaseId: descriptor.releaseId, releaseKey, installId };
}

const activeInstall = async (
  transaction: IDBTransaction,
  handle: CatalogInstallHandle,
): Promise<{ catalog: StoredCatalog; release: StoredRelease }> => {
  const catalog = await requestResult(transaction.objectStore(CATALOG_STORE).get(handle.catalogId)) as StoredCatalog | undefined;
  const release = await requestResult(transaction.objectStore(RELEASE_STORE).get(handle.releaseKey)) as StoredRelease | undefined;
  if (
    !catalog
    || !release
    || release.status !== 'staging'
    || catalog.pendingReleaseKey !== handle.releaseKey
    || catalog.pendingInstallId !== handle.installId
    || release.releaseId !== handle.releaseId
  ) throw new Error('The catalog install handle is stale.');
  return { catalog, release };
};

/**
 * Persists a chunk receipt only after the delivery seam has verified the
 * receipt against the actual chunk bytes. This cache does not authenticate or
 * recompute content hashes; it protects activation and resumability.
 */
export async function stageCatalogChunk(
  handle: CatalogInstallHandle,
  inputReceipt: CatalogChunkReceipt,
  inputEntries: readonly CatalogCacheEntry[],
  inputLexemes: readonly LexemeV3[] = [],
): Promise<'staged' | 'already-staged'> {
  const receipt = normalizeReceipt(inputReceipt);
  if (inputEntries.length !== receipt.membershipCount) throw new Error('Chunk membership count does not match its receipt.');
  if (inputLexemes.length !== (receipt.lexemeCount ?? 0)) throw new Error('Chunk lexeme count does not match its receipt.');
  const entries = inputEntries.map(normalizeEntry);
  const lexemes = inputLexemes.map(normalizeLexeme);
  const ids = new Set(entries.map(value => value.membershipId));
  if (ids.size !== entries.length) throw new Error('Chunk contains a duplicate membership ID.');
  if (new Set(lexemes.map(value => value.id)).size !== lexemes.length) {
    throw new Error('Chunk contains a duplicate lexeme ID.');
  }
  const database = await openCatalogCacheDatabase();
  const transaction = database.transaction(
    [CATALOG_STORE, RELEASE_STORE, RECEIPT_STORE, ENTRY_STORE, SKILL_STORE, LEXEME_STORE],
    'readwrite',
  );
  const done = transactionDone(transaction);
  const { release } = await activeInstall(transaction, handle);
  if (entries.some(value => value.language !== release.contentLanguage)) {
    throw new Error('Chunk entry language does not match the release content language.');
  }
  if (lexemes.some(value => value.language !== release.contentLanguage)) {
    throw new Error('Chunk lexeme language does not match the release content language.');
  }
  const receiptKey = keyOf(handle.releaseKey, receipt.chunkId);
  const receipts = transaction.objectStore(RECEIPT_STORE);
  const existingReceipt = await requestResult(receipts.get(receiptKey)) as StoredReceipt | undefined;
  if (existingReceipt) {
    const identical = existingReceipt.sha256 === receipt.sha256
      && (existingReceipt.lexemeCount ?? 0) === (receipt.lexemeCount ?? 0)
      && existingReceipt.membershipCount === receipt.membershipCount
      && existingReceipt.encodedBytes === receipt.encodedBytes;
    await done;
    if (!identical) throw new Error('A different receipt already exists for this chunk.');
    return 'already-staged';
  }
  const currentReceipts = await requestResult(
    receipts.index('releaseKey').getAll(IDBKeyRange.only(handle.releaseKey)),
  ) as StoredReceipt[];
  const receivedMemberships = currentReceipts.reduce((total, value) => total + value.membershipCount, 0);
  const receivedLexemes = currentReceipts.reduce((total, value) => total + (value.lexemeCount ?? 0), 0);
  const receivedBytes = currentReceipts.reduce((total, value) => total + value.encodedBytes, 0);
  if (currentReceipts.length + 1 > release.chunkCount) throw new Error('Chunk count exceeds the release descriptor.');
  if (receivedMemberships + receipt.membershipCount > release.membershipCount) {
    throw new Error('Membership count exceeds the release descriptor.');
  }
  if (receivedLexemes + (receipt.lexemeCount ?? 0) > (release.lexemeCount ?? 0)) {
    throw new Error('Lexeme count exceeds the release descriptor.');
  }
  if (receivedBytes + receipt.encodedBytes > release.encodedBytes) {
    throw new Error('Encoded byte count exceeds the release descriptor.');
  }
  const entryStore = transaction.objectStore(ENTRY_STORE);
  const entryKeys = entries.map(value => keyOf(handle.releaseKey, value.membershipId));
  const existingEntries = await Promise.all(entryKeys.map(entryKey => requestResult(entryStore.get(entryKey))));
  if (existingEntries.some(Boolean)) throw new Error('A duplicate membership exists in another chunk.');
  const lexemeStore = transaction.objectStore(LEXEME_STORE);
  const lexemeKeys = lexemes.map(value => keyOf(handle.releaseKey, value.id));
  const existingLexemes = await Promise.all(lexemeKeys.map(lexemeKey => requestResult(lexemeStore.get(lexemeKey))));
  if (existingLexemes.some(Boolean)) throw new Error('A duplicate lexeme exists in another chunk.');
  const skillStore = transaction.objectStore(SKILL_STORE);
  try {
    entries.forEach((value, index) => {
      const stored = {
        ...value,
        entryKey: entryKeys[index],
        releaseKey: handle.releaseKey,
      } satisfies StoredCatalogEntry;
      entryStore.put(stored);
      value.skills.forEach(skill => skillStore.put({
        postingKey: keyOf(handle.releaseKey, skill, value.membershipId),
        releaseKey: handle.releaseKey,
        language: value.language,
        trackId: value.trackId,
        skill,
        rank: value.rank,
        membershipId: value.membershipId,
        entryKey: stored.entryKey,
      } satisfies StoredSkillPosting));
    });
    lexemes.forEach((value, index) => lexemeStore.put({
      lexemeKey: lexemeKeys[index],
      releaseKey: handle.releaseKey,
      lexemeId: value.id,
      value,
    } satisfies StoredCatalogLexeme));
    receipts.put({ ...receipt, receiptKey, releaseKey: handle.releaseKey } satisfies StoredReceipt);
  } catch (error) {
    transaction.abort();
    await done.catch(() => undefined);
    throw error;
  }
  await done;
  return 'staged';
}

const installStatus = async (
  transaction: IDBTransaction,
  release: StoredRelease,
): Promise<CatalogInstallStatus> => {
  const receipts = await requestResult(
    transaction.objectStore(RECEIPT_STORE).index('releaseKey').getAll(IDBKeyRange.only(release.releaseKey)),
  ) as StoredReceipt[];
  const status = {
    receivedChunks: receipts.length,
    receivedLexemes: receipts.reduce((total, value) => total + (value.lexemeCount ?? 0), 0),
    receivedMemberships: receipts.reduce((total, value) => total + value.membershipCount, 0),
    receivedBytes: receipts.reduce((total, value) => total + value.encodedBytes, 0),
  };
  return {
    ...status,
    complete: status.receivedChunks === release.chunkCount
      && status.receivedLexemes === (release.lexemeCount ?? 0)
      && status.receivedMemberships === release.membershipCount
      && status.receivedBytes === release.encodedBytes,
  };
};

export async function getCatalogInstallStatus(handle: CatalogInstallHandle): Promise<CatalogInstallStatus> {
  const database = await openCatalogCacheDatabase();
  const transaction = database.transaction([CATALOG_STORE, RELEASE_STORE, RECEIPT_STORE], 'readonly');
  const done = transactionDone(transaction);
  const { release } = await activeInstall(transaction, handle);
  const status = await installStatus(transaction, release);
  await done;
  return status;
}

export async function activateCatalogInstall(handle: CatalogInstallHandle): Promise<void> {
  const database = await openCatalogCacheDatabase();
  const transaction = database.transaction(
    [CATALOG_STORE, RELEASE_STORE, RECEIPT_STORE, ENTRY_STORE, SKILL_STORE, LEXEME_STORE],
    'readwrite',
  );
  const done = transactionDone(transaction);
  const { catalog, release } = await activeInstall(transaction, handle);
  const status = await installStatus(transaction, release);
  if (!status.complete) throw new Error('The staged catalog release is incomplete.');
  transaction.objectStore(RELEASE_STORE).put({ ...release, status: 'complete' } satisfies StoredRelease);
  transaction.objectStore(CATALOG_STORE).put({
    ...catalog,
    activeReleaseKey: release.releaseKey,
    previousReleaseKey: catalog.activeReleaseKey === release.releaseKey ? catalog.previousReleaseKey : catalog.activeReleaseKey,
    pendingReleaseKey: null,
    pendingInstallId: null,
  } satisfies StoredCatalog);
  await purgeObsoleteCatalogGenerations(transaction, handle.catalogId, new Set([
    release.releaseKey,
    ...(catalog.activeReleaseKey ? [catalog.activeReleaseKey] : []),
  ]));
  await done;
}

const publicDescriptor = (release: StoredRelease): CatalogReleaseDescriptor => ({
  catalogId: release.catalogId,
  releaseId: release.releaseId,
  schemaVersion: release.schemaVersion,
  contentLanguage: release.contentLanguage,
  chunkCount: release.chunkCount,
  lexemeCount: release.lexemeCount ?? 0,
  membershipCount: release.membershipCount,
  encodedBytes: release.encodedBytes,
});

export async function getActiveCatalogReleaseSnapshot(
  catalogId: string,
): Promise<ActiveCatalogReleaseSnapshot | null> {
  const safeCatalogId = boundedString(catalogId, 'catalogId', 128);
  const database = await openCatalogCacheDatabase();
  const transaction = database.transaction([CATALOG_STORE, RELEASE_STORE], 'readonly');
  const done = transactionDone(transaction);
  const catalog = await requestResult(transaction.objectStore(CATALOG_STORE).get(safeCatalogId)) as StoredCatalog | undefined;
  const release = catalog?.activeReleaseKey
    ? await requestResult(transaction.objectStore(RELEASE_STORE).get(catalog.activeReleaseKey)) as StoredRelease | undefined
    : undefined;
  await done;
  return release?.status === 'complete'
    ? { releaseKey: release.releaseKey, release: publicDescriptor(release) }
    : null;
}

export async function getActiveCatalogRelease(catalogId: string): Promise<CatalogReleaseDescriptor | null> {
  return (await getActiveCatalogReleaseSnapshot(catalogId))?.release ?? null;
}

export async function rollbackCatalogRelease(catalogId: string): Promise<void> {
  const safeCatalogId = boundedString(catalogId, 'catalogId', 128);
  const database = await openCatalogCacheDatabase();
  const transaction = database.transaction([CATALOG_STORE, RELEASE_STORE], 'readwrite');
  const done = transactionDone(transaction);
  const catalogs = transaction.objectStore(CATALOG_STORE);
  const catalog = await requestResult(catalogs.get(safeCatalogId)) as StoredCatalog | undefined;
  if (!catalog?.activeReleaseKey || !catalog.previousReleaseKey) throw new Error('No complete previous catalog release is available.');
  const previous = await requestResult(transaction.objectStore(RELEASE_STORE).get(catalog.previousReleaseKey)) as StoredRelease | undefined;
  if (previous?.status !== 'complete') throw new Error('The previous catalog release is incomplete.');
  catalogs.put({
    ...catalog,
    activeReleaseKey: catalog.previousReleaseKey,
    previousReleaseKey: catalog.activeReleaseKey,
  } satisfies StoredCatalog);
  await done;
}

export async function getActiveCatalogReleaseKey(catalogId: string): Promise<string | null> {
  const safeCatalogId = boundedString(catalogId, 'catalogId', 128);
  const database = await openCatalogCacheDatabase();
  const transaction = database.transaction([CATALOG_STORE, RELEASE_STORE], 'readonly');
  const done = transactionDone(transaction);
  const catalog = await requestResult(transaction.objectStore(CATALOG_STORE).get(safeCatalogId)) as StoredCatalog | undefined;
  const release = catalog?.activeReleaseKey
    ? await requestResult(transaction.objectStore(RELEASE_STORE).get(catalog.activeReleaseKey)) as StoredRelease | undefined
    : undefined;
  await done;
  return release?.status === 'complete' ? release.releaseKey : null;
}

export function publicCatalogEntry(value: StoredCatalogEntry): CatalogCacheEntry {
  return {
    membershipId: value.membershipId,
    lexemeId: value.lexemeId,
    language: value.language,
    trackId: value.trackId,
    tier: value.tier,
    cefrLevel: value.cefrLevel,
    topic: value.topic,
    partOfSpeech: value.partOfSpeech,
    skills: [...value.skills],
    rank: value.rank,
    normalizedLemma: value.normalizedLemma,
    lemma: value.lemma,
  };
}

const assertLookupIds = (lexemeIds: readonly string[]): readonly string[] => {
  if (!Array.isArray(lexemeIds) || lexemeIds.length > 100) {
    throw new TypeError('A catalog lexeme lookup may contain at most 100 IDs.');
  }
  return lexemeIds.map((value, index) => boundedString(value, `lexemeIds[${index}]`, 128));
};

export async function getCatalogLexemes(
  catalogId: string,
  lexemeIds: readonly string[],
): Promise<readonly (LexemeV3 | null)[]> {
  const safeCatalogId = boundedString(catalogId, 'catalogId', 128);
  const safeLexemeIds = assertLookupIds(lexemeIds);
  if (safeLexemeIds.length === 0) return [];
  const database = await openCatalogCacheDatabase();
  const transaction = database.transaction([CATALOG_STORE, RELEASE_STORE, LEXEME_STORE], 'readonly');
  const done = transactionDone(transaction);
  const catalog = await requestResult(transaction.objectStore(CATALOG_STORE).get(safeCatalogId)) as StoredCatalog | undefined;
  const release = catalog?.activeReleaseKey
    ? await requestResult(transaction.objectStore(RELEASE_STORE).get(catalog.activeReleaseKey)) as StoredRelease | undefined
    : undefined;
  if (release?.status !== 'complete') {
    await done;
    return safeLexemeIds.map(() => null);
  }
  const store = transaction.objectStore(LEXEME_STORE);
  const stored = await Promise.all(safeLexemeIds.map(lexemeId => requestResult(
    store.get(keyOf(release.releaseKey, lexemeId)),
  ))) as (StoredCatalogLexeme | undefined)[];
  await done;
  return stored.map(value => value?.value ?? null);
}

export async function hydrateCatalogEntries(
  catalogId: string,
  inputEntries: readonly CatalogCacheEntry[],
): Promise<readonly HydratedCatalogEntry[]> {
  if (!Array.isArray(inputEntries) || inputEntries.length > 100) {
    throw new TypeError('A catalog hydration batch may contain at most 100 memberships.');
  }
  const entries = inputEntries.map(normalizeEntry);
  const lexemes = await getCatalogLexemes(catalogId, entries.map(value => value.lexemeId));
  return entries.map((membership, index) => {
    const lexeme = lexemes[index];
    if (!lexeme) throw new Error(`Catalog lexeme ${membership.lexemeId} is unavailable in the active release.`);
    return { membership, lexeme };
  });
}

/** Test-only lifecycle seam. Production connections close on versionchange. */
export function closeCatalogCacheForTests(): void {
  activeDatabase?.close();
  activeDatabase = null;
  databasePromise = null;
}
