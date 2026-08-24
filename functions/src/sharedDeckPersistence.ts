import type {
  DocumentData,
  DocumentReference,
  Firestore,
  Query,
  QuerySnapshot,
} from 'firebase-admin/firestore';
import { Timestamp } from 'firebase-admin/firestore';
import {
  calculateSharedDeckPayloadBytes,
  type CreateSharedDeckRequest,
} from './inputValidation.js';

export const SHARED_DECK_COLLECTION = 'shared_decks';
export const SHARED_DECK_OWNER_COLLECTION = 'shared_deck_owners';
export const SHARED_DECK_USAGE_COLLECTION = 'shared_deck_usage';
export const MAX_SHARED_DECKS = 100;
export const MAX_SHARED_DECK_BYTES = 25_000_000;

export type TimestampCompatible = { toMillis(): number };

export class SharedDeckQuotaError extends Error {
  constructor() {
    super('Shared-deck quota reached.');
    this.name = 'SharedDeckQuotaError';
  }
}

export class SharedDeckMigrationRequiredError extends Error {
  constructor(message = 'Shared-deck usage requires protected migration.') {
    super(message);
    this.name = 'SharedDeckMigrationRequiredError';
  }
}

export class SharedDeckUsageStateError extends Error {
  constructor(message = 'Shared-deck usage state is inconsistent.') {
    super(message);
    this.name = 'SharedDeckUsageStateError';
  }
}

export type SharedDeckPersistenceOptions = {
  now?: TimestampCompatible;
  ownerUid?: string;
  payloadBytes?: number;
  maximumActiveShares?: number;
  maximumActiveBytes?: number;
  maxActiveCount?: number;
  maxActiveBytes?: number;
  usageDocument?: DocumentReference;
  ownerMetadataQuery?: Query;
};

export class SharedDeckOwnershipError extends Error {
  constructor() {
    super('Only the deck author can revoke this share.');
    this.name = 'SharedDeckOwnershipError';
  }
}

export const buildSharedDeckDocuments = <TimestampValue>(
  input: CreateSharedDeckRequest,
  ownerUid: string,
  createdAt: TimestampValue,
  expiresAt: TimestampValue,
) => ({
  sharedDeck: {
    category: input.category,
    cards: input.cards,
    createdAt,
    expiresAt,
    schemaVersion: 2,
  },
  ownership: {
    ownerUid,
    createdAt,
    expiresAt,
    payloadBytes: calculateSharedDeckPayloadBytes(input),
    schemaVersion: 2,
  },
});

interface SharedDeckDocuments {
  readonly sharedDeck: DocumentData;
  readonly ownership: DocumentData;
}

type SharedDeckUsageEntry = {
  payloadBytes: number;
  expiresAt: TimestampCompatible;
};

type SharedDeckUsage = {
  schemaVersion: 1;
  shares: Record<string, SharedDeckUsageEntry>;
  activeCount: number;
  activeBytes: number;
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const timestampMillis = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (isRecord(value) && typeof value.toMillis === 'function') {
    const millis = value.toMillis();
    return typeof millis === 'number' && Number.isFinite(millis) ? millis : null;
  }
  return null;
};

const exactKeys = (value: Record<string, unknown>, keys: readonly string[]) => (
  Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
);

const validPayloadBytes = (value: unknown): value is number => (
  typeof value === 'number'
  && Number.isSafeInteger(value)
  && value > 0
);

const parseUsage = (value: DocumentData | undefined): SharedDeckUsage => {
  if (!isRecord(value) || !exactKeys(value, ['schemaVersion', 'shares', 'activeCount', 'activeBytes'])) {
    throw new SharedDeckUsageStateError();
  }
  if (value.schemaVersion !== 1 || !isRecord(value.shares)) {
    throw new SharedDeckUsageStateError();
  }
  const shares: Record<string, SharedDeckUsageEntry> = {};
  const entries = Object.entries(value.shares);
  if (entries.length > MAX_SHARED_DECKS) throw new SharedDeckUsageStateError();
  for (const [shareId, rawEntry] of entries) {
    if (shareId.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(shareId)
      || shareId === '__proto__' || shareId === 'constructor' || shareId === 'prototype'
      || !isRecord(rawEntry)
      || !exactKeys(rawEntry, ['payloadBytes', 'expiresAt'])
      || !validPayloadBytes(rawEntry.payloadBytes)
      || timestampMillis(rawEntry.expiresAt) === null) {
      throw new SharedDeckUsageStateError();
    }
    shares[shareId] = rawEntry as unknown as SharedDeckUsageEntry;
  }
  if (
    typeof value.activeCount !== 'number'
    || !Number.isSafeInteger(value.activeCount)
    || value.activeCount < 0
    || typeof value.activeBytes !== 'number'
    || !Number.isSafeInteger(value.activeBytes)
    || value.activeBytes < 0
  ) throw new SharedDeckUsageStateError();
  return {
    schemaVersion: 1,
    shares,
    activeCount: value.activeCount,
    activeBytes: value.activeBytes,
  };
};

const recomputeUsage = (
  usage: SharedDeckUsage,
  nowMillis: number,
): SharedDeckUsage => {
  const shares: Record<string, SharedDeckUsageEntry> = {};
  let activeCount = 0;
  let activeBytes = 0;
  for (const [shareId, entry] of Object.entries(usage.shares)) {
    if ((timestampMillis(entry.expiresAt) as number) <= nowMillis) {
      continue;
    }
    shares[shareId] = entry;
    activeCount += 1;
    activeBytes += entry.payloadBytes;
  }
  return { schemaVersion: 1, shares, activeCount, activeBytes };
};

const usageReference = (database: Firestore, ownerUid: string): DocumentReference => (
  database.collection('users').doc(ownerUid).collection('profile').doc(SHARED_DECK_USAGE_COLLECTION)
);

const hasQueryDocuments = (value: unknown): boolean => {
  if (!isRecord(value)) return false;
  if (Array.isArray(value.docs)) return value.docs.length > 0;
  if (value.exists === true) return true;
  return value.empty === false;
};

const ownerQuery = (database: Firestore, ownerUid: string): Query => database
  .collection(SHARED_DECK_OWNER_COLLECTION)
  .where('ownerUid', '==', ownerUid)
  .limit(1);

const usageDocumentData = (usage: SharedDeckUsage): DocumentData => ({
  schemaVersion: usage.schemaVersion,
  shares: usage.shares,
  activeCount: usage.activeCount,
  activeBytes: usage.activeBytes,
});

const ownerSchema = (value: DocumentData | undefined): 1 | 2 | null => {
  if (!isRecord(value) || (value.schemaVersion !== 1 && value.schemaVersion !== 2)) return null;
  return value.schemaVersion;
};

const validOwnerMetadata = (value: DocumentData | undefined): boolean => {
  if (!isRecord(value) || (value.schemaVersion !== 1 && value.schemaVersion !== 2)) return false;
  const keys = value.schemaVersion === 2
    ? ['ownerUid', 'createdAt', 'expiresAt', 'payloadBytes', 'schemaVersion']
    : ['ownerUid', 'createdAt', 'expiresAt', 'schemaVersion'];
  return exactKeys(value, keys)
    && typeof value.ownerUid === 'string'
    && value.ownerUid.length > 0
    && timestampMillis(value.createdAt) !== null
    && timestampMillis(value.expiresAt) !== null
    && (value.schemaVersion === 1 || validPayloadBytes(value.payloadBytes));
};

const ownerPayloadBytes = (value: DocumentData | undefined): number | null => (
  isRecord(value) && validPayloadBytes(value.payloadBytes) ? value.payloadBytes : null
);

const ownerExpiryMillis = (value: DocumentData | undefined): number | null => (
  isRecord(value) ? timestampMillis(value.expiresAt) : null
);

const ownerUidFrom = (value: DocumentData | undefined, field: 'ownerUid' | 'authorUid') => {
  const ownerUid = value?.[field];
  return typeof ownerUid === 'string' && ownerUid.length > 0 ? ownerUid : null;
};

const validateUsageCounters = (usage: SharedDeckUsage, nowMillis: number) => {
  const allEntries = Object.values(usage.shares);
  const activeEntries = allEntries.filter(entry => (timestampMillis(entry.expiresAt) as number) > nowMillis);
  const allBytes = allEntries.reduce((total, entry) => total + entry.payloadBytes, 0);
  const activeBytes = activeEntries.reduce((total, entry) => total + entry.payloadBytes, 0);
  if (!Number.isSafeInteger(allBytes) || !Number.isSafeInteger(activeBytes)) {
    throw new SharedDeckUsageStateError();
  }
  const matchesAll = usage.activeCount === allEntries.length && usage.activeBytes === allBytes;
  const matchesActive = usage.activeCount === activeEntries.length && usage.activeBytes === activeBytes;
  if (!matchesAll && !matchesActive) {
    throw new SharedDeckUsageStateError();
  }
};

const shareIdFrom = (document: DocumentReference): string => {
  if (typeof document.id === 'string' && document.id) return document.id;
  const segments = document.path.split('/');
  return segments[segments.length - 1] ?? '';
};

export const createSharedDeckAtomically = async (
  database: Firestore,
  sharedDeck: DocumentReference,
  ownership: DocumentReference,
  documents: SharedDeckDocuments,
  options: SharedDeckPersistenceOptions = {},
): Promise<void> => {
  const ownerUid = options.ownerUid ?? ownerUidFrom(documents.ownership, 'ownerUid');
  if (!ownerUid || !validOwnerMetadata(documents.ownership) || documents.ownership.schemaVersion !== 2) {
    throw new SharedDeckUsageStateError('Shared-deck owner metadata is invalid.');
  }
  if (options.ownerUid && ownerUidFrom(documents.ownership, 'ownerUid') !== options.ownerUid) {
    throw new SharedDeckUsageStateError('Shared-deck owner metadata is invalid.');
  }
  const usageDocument = options.usageDocument ?? usageReference(database, ownerUid);
  const metadataQuery = options.ownerMetadataQuery ?? ownerQuery(database, ownerUid);
  const now = options.now ?? Timestamp.now();
  const nowMillis = timestampMillis(now);
  if (nowMillis === null) throw new SharedDeckUsageStateError('Trusted transaction time is invalid.');
  const maximumCount = options.maximumActiveShares ?? options.maxActiveCount ?? MAX_SHARED_DECKS;
  const maximumBytes = options.maximumActiveBytes ?? options.maxActiveBytes ?? MAX_SHARED_DECK_BYTES;
  await database.runTransaction(async transaction => {
    const usageSnapshot = await transaction.get(usageDocument);
    let usage: SharedDeckUsage;
    let usageExists = usageSnapshot.exists;
    if (usageExists) {
      const parsed = parseUsage(usageSnapshot.data());
      validateUsageCounters(parsed, nowMillis);
      usage = recomputeUsage(parsed, nowMillis);
    } else {
      const metadataSnapshot = await transaction.get(metadataQuery) as unknown as QuerySnapshot;
      if (hasQueryDocuments(metadataSnapshot)) throw new SharedDeckMigrationRequiredError();
      usage = { schemaVersion: 1, shares: {}, activeCount: 0, activeBytes: 0 };
    }
    const payloadBytes = options.payloadBytes ?? ownerPayloadBytes(documents.ownership);
    if (payloadBytes === null) throw new SharedDeckUsageStateError('Shared-deck payload size is invalid.');
    if (!validPayloadBytes(payloadBytes)) throw new SharedDeckUsageStateError('Shared-deck payload size is invalid.');
    if (usage.activeCount >= maximumCount || usage.activeBytes > maximumBytes - payloadBytes) {
      throw new SharedDeckQuotaError();
    }
    const shareId = shareIdFrom(sharedDeck);
    if (Object.hasOwn(usage.shares, shareId)) throw new SharedDeckUsageStateError();
    usage.shares = {
      ...usage.shares,
      [shareId]: {
        payloadBytes,
        expiresAt: documents.ownership.expiresAt as TimestampCompatible,
      },
    };
    usage.activeCount += 1;
    usage.activeBytes += payloadBytes;
    transaction.create(sharedDeck, documents.sharedDeck);
    transaction.create(ownership, documents.ownership);
    if (usageExists) transaction.set(usageDocument, usageDocumentData(usage));
    else transaction.create(usageDocument, usageDocumentData(usage));
  });
};

export const revokeSharedDeckAtomically = async (
  database: Firestore,
  sharedDeck: DocumentReference,
  ownership: DocumentReference,
  requestingUserId: string,
  options: SharedDeckPersistenceOptions = {},
): Promise<boolean> => database.runTransaction(async transaction => {
  // Firestore transactions require every read to happen before the first write.
  const ownershipSnapshot = await transaction.get(ownership);
  const sharedDeckSnapshot = await transaction.get(sharedDeck);

  if (!ownershipSnapshot.exists && !sharedDeckSnapshot.exists) return false;

  // Private metadata is authoritative. The public authorUid fallback exists only
  // for shares created before ownership was split into its own collection.
  const ownerUid = ownershipSnapshot.exists
    ? ownerUidFrom(ownershipSnapshot.data(), 'ownerUid')
    : ownerUidFrom(sharedDeckSnapshot.data(), 'authorUid');
  if (ownershipSnapshot.exists && !validOwnerMetadata(ownershipSnapshot.data())) {
    throw new SharedDeckUsageStateError('Shared-deck ownership metadata is invalid.');
  }
  if (ownerUid !== requestingUserId) throw new SharedDeckOwnershipError();

  const now = options.now ?? Timestamp.now();
  const nowMillis = timestampMillis(now);
  if (nowMillis === null) throw new SharedDeckUsageStateError('Trusted transaction time is invalid.');
  const usageDocument = options.usageDocument ?? usageReference(database, ownerUid);
  const usageSnapshot = await transaction.get(usageDocument);
  const schema = ownerSchema(ownershipSnapshot.data());
  if (ownershipSnapshot.exists && schema === null) throw new SharedDeckUsageStateError();
  let usage: SharedDeckUsage | undefined;
  let nextUsage: SharedDeckUsage | undefined;
  if (usageSnapshot.exists) {
    usage = parseUsage(usageSnapshot.data());
    validateUsageCounters(usage, nowMillis);
    nextUsage = recomputeUsage(usage, nowMillis);
  }

  if (schema === 2) {
    const expiresAt = ownerExpiryMillis(ownershipSnapshot.data());
    const payloadBytes = ownerPayloadBytes(ownershipSnapshot.data());
    if (expiresAt === null || payloadBytes === null) throw new SharedDeckUsageStateError();
    const ledgerEntry = usage?.shares[shareIdFrom(sharedDeck)];
    const ownerIsActive = expiresAt > nowMillis;
    if (ownerIsActive && (!ledgerEntry
      || ledgerEntry.payloadBytes !== payloadBytes
      || timestampMillis(ledgerEntry.expiresAt) !== expiresAt)) {
      throw new SharedDeckUsageStateError();
    }
    if (ledgerEntry) {
      if (ledgerEntry.payloadBytes !== payloadBytes
        || timestampMillis(ledgerEntry.expiresAt) !== expiresAt) {
        throw new SharedDeckUsageStateError();
      }
      if (nextUsage) {
        delete nextUsage.shares[shareIdFrom(sharedDeck)];
        nextUsage.activeCount = Object.keys(nextUsage.shares).length;
        nextUsage.activeBytes = Object.values(nextUsage.shares)
          .reduce((total, entry) => total + entry.payloadBytes, 0);
      }
    }
  }

  if (sharedDeckSnapshot.exists) transaction.delete(sharedDeck);
  if (ownershipSnapshot.exists) transaction.delete(ownership);
  if (usage && nextUsage && JSON.stringify(usageDocumentData(usage)) !== JSON.stringify(usageDocumentData(nextUsage))) {
    transaction.set(usageDocument as DocumentReference, usageDocumentData(nextUsage));
  }
  return true;
});
