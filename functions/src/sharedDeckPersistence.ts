import { Timestamp } from 'firebase-admin/firestore';
import type {
  DocumentData,
  DocumentReference,
  Firestore,
} from 'firebase-admin/firestore';
import {
  parseStoredSharedDeckPayload,
  type CreateSharedDeckRequest,
} from './inputValidation.js';

export const SHARED_DECK_COLLECTION = 'shared_decks';
export const SHARED_DECK_OWNER_COLLECTION = 'shared_deck_owners';

export class SharedDeckOwnershipError extends Error {
  constructor() {
    super('Only the deck author can revoke this share.');
    this.name = 'SharedDeckOwnershipError';
  }
}

export class SharedDeckUnavailableError extends Error {
  constructor() {
    super('The shared deck is unavailable.');
    this.name = 'SharedDeckUnavailableError';
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
    schemaVersion: 1,
  },
});

interface SharedDeckDocuments {
  readonly sharedDeck: DocumentData;
  readonly ownership: DocumentData;
}

export const createSharedDeckAtomically = async (
  database: Firestore,
  sharedDeck: DocumentReference,
  ownership: DocumentReference,
  documents: SharedDeckDocuments,
): Promise<void> => {
  await database.runTransaction(async transaction => {
    transaction.create(sharedDeck, documents.sharedDeck);
    transaction.create(ownership, documents.ownership);
  });
};

const PUBLIC_SHARED_DECK_FIELDS = [
  'category', 'cards', 'createdAt', 'expiresAt', 'schemaVersion',
];

export const loadPublicSharedDeck = async (
  sharedDeck: DocumentReference,
  now: Timestamp = Timestamp.now(),
): Promise<CreateSharedDeckRequest> => {
  const snapshot = await sharedDeck.get();
  if (!snapshot.exists) throw new SharedDeckUnavailableError();
  const data = snapshot.data();
  const fields = data ? Object.keys(data).sort() : [];
  if (
    !data
    || fields.join('\n') !== [...PUBLIC_SHARED_DECK_FIELDS].sort().join('\n')
    || data.schemaVersion !== 2
    || !(data.createdAt instanceof Timestamp)
    || !(data.expiresAt instanceof Timestamp)
    || data.expiresAt.toMillis() <= now.toMillis()
  ) {
    throw new SharedDeckUnavailableError();
  }
  try {
    return parseStoredSharedDeckPayload({ category: data.category, cards: data.cards });
  } catch {
    throw new SharedDeckUnavailableError();
  }
};

const ownerUidFrom = (value: DocumentData | undefined, field: 'ownerUid' | 'authorUid') => {
  const ownerUid = value?.[field];
  return typeof ownerUid === 'string' && ownerUid.length > 0 ? ownerUid : null;
};

export const revokeSharedDeckAtomically = async (
  database: Firestore,
  sharedDeck: DocumentReference,
  ownership: DocumentReference,
  requestingUserId: string,
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
  if (ownerUid !== requestingUserId) throw new SharedDeckOwnershipError();

  if (sharedDeckSnapshot.exists) transaction.delete(sharedDeck);
  if (ownershipSnapshot.exists) transaction.delete(ownership);
  return true;
});
