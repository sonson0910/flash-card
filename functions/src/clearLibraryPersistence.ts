import type { DocumentData, DocumentReference, Firestore } from 'firebase-admin/firestore';
import { InputValidationError } from './inputValidation.js';
import { LegacyLibraryMigrationFenceError } from './legacyLibraryMigrationOwnerScope.js';
import { catalogProgressReferenceForCard } from './catalogProgressPersistence.js';

export const MAX_CLEAR_LIBRARY_PAGE_CARDS = 249;

const CARD_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;

export type ClearLibraryPageRequest = { expectedOwnerId: string; libraryEpoch: number; cardIds: string[] };
export type ClearLibraryPageResult = { deletedCardIds: string[]; deletedProjectionLexemeIds: string[] };

export class ClearLibraryEpochError extends Error {
  constructor(public readonly reason: 'stale-library-epoch' | 'future-library-epoch') {
    super(`Clear library rejected: ${reason}.`);
    this.name = 'ClearLibraryEpochError';
  }
}

export class ClearLibraryStoredCardError extends Error {
  constructor(public readonly reason: 'invalid-stored-library-epoch' | 'future-stored-library-epoch') {
    super('Clear library found a card with an invalid library epoch.');
    this.name = 'ClearLibraryStoredCardError';
  }
}

export class ClearLibraryStoredProjectionError extends Error {
  constructor(public readonly reason: 'invalid-stored-projection-epoch' | 'future-stored-projection-epoch') {
    super('Clear library found a projection with an invalid library epoch.');
    this.name = 'ClearLibraryStoredProjectionError';
  }
}

const isCounter = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;

export function parseClearLibraryPageRequest(value: unknown): ClearLibraryPageRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InputValidationError('Clear library request must be an object.');
  }
  const source = value as Record<string, unknown>;
  if (Object.keys(source).length !== 3 || !Object.hasOwn(source, 'expectedOwnerId')
    || !Object.hasOwn(source, 'libraryEpoch') || !Object.hasOwn(source, 'cardIds')) {
    throw new InputValidationError('Clear library request contains an unsupported field.');
  }
  if (typeof source.expectedOwnerId !== 'string' || source.expectedOwnerId.length < 1 || source.expectedOwnerId.length > 128) {
    throw new InputValidationError('Clear library expectedOwnerId is invalid.');
  }
  if (!isCounter(source.libraryEpoch)) throw new InputValidationError('Clear library libraryEpoch is invalid.');
  if (!Array.isArray(source.cardIds) || source.cardIds.length < 1 || source.cardIds.length > MAX_CLEAR_LIBRARY_PAGE_CARDS) {
    throw new InputValidationError('Clear library cardIds is invalid.');
  }
  const cardIds = source.cardIds.map(cardId => {
    if (typeof cardId !== 'string' || !CARD_ID_PATTERN.test(cardId)) {
      throw new InputValidationError('Clear library cardId is invalid.');
    }
    return cardId;
  });
  if (new Set(cardIds).size !== cardIds.length) throw new InputValidationError('Clear library cardIds contains a duplicate.');
  return { expectedOwnerId: source.expectedOwnerId, libraryEpoch: Number(source.libraryEpoch), cardIds };
}

const isOldGeneration = (card: DocumentData, clearEpoch: number): boolean => {
  if (!Object.hasOwn(card, 'libraryEpoch')) return true;
  if (!isCounter(card.libraryEpoch)) throw new ClearLibraryStoredCardError('invalid-stored-library-epoch');
  if (card.libraryEpoch > clearEpoch) throw new ClearLibraryStoredCardError('future-stored-library-epoch');
  return card.libraryEpoch < clearEpoch;
};

export async function clearLibraryCardsPageForOwner(
  database: Firestore,
  ownerId: string,
  request: ClearLibraryPageRequest,
): Promise<ClearLibraryPageResult> {
  if (!ownerId || ownerId.includes('/')) throw new InputValidationError('Clear library owner is invalid.');
  const owner = database.collection('users').doc(ownerId);
  const stateRef = owner.collection('profile').doc('library_state');
  const cardRefs = request.cardIds.map(cardId => owner.collection('cards').doc(cardId));

  return database.runTransaction(async transaction => {
    const stateSnapshot = await transaction.get(stateRef);
    const state = stateSnapshot.exists ? stateSnapshot.data() : undefined;
    if (state?.libraryMigrationFenceActive === true) throw new LegacyLibraryMigrationFenceError();
    const serverEpoch = stateSnapshot.exists && isCounter(state?.libraryEpoch) ? state.libraryEpoch : 0;
    if (request.libraryEpoch !== serverEpoch) {
      throw new ClearLibraryEpochError(request.libraryEpoch < serverEpoch ? 'stale-library-epoch' : 'future-library-epoch');
    }

    const cardSnapshots = await transaction.getAll(...cardRefs);
    const oldCards = cardSnapshots.flatMap((snapshot, index) => {
      if (!snapshot.exists) return [];
      const data = snapshot.data() as DocumentData;
      return isOldGeneration(data, serverEpoch) ? [{ reference: cardRefs[index], data }] : [];
    });
    const projectionByPath = new Map<string, { reference: DocumentReference; lexemeId: string }>();
    oldCards.forEach(({ data }) => {
      const reference = catalogProgressReferenceForCard(database, ownerId, data);
      if (reference) projectionByPath.set(reference.path, { reference, lexemeId: reference.id });
    });
    const projections = [...projectionByPath.values()];
    const projectionSnapshots = projections.length ? await transaction.getAll(...projections.map(({ reference }) => reference)) : [];

    const deletedProjections = projectionSnapshots.flatMap((snapshot, index) => {
      const projection = snapshot.exists ? snapshot.data() as DocumentData : undefined;
      if (!projection) return [];
      if (!isCounter(projection.libraryEpoch)) {
        throw new ClearLibraryStoredProjectionError('invalid-stored-projection-epoch');
      }
      if (projection.libraryEpoch > serverEpoch) {
        throw new ClearLibraryStoredProjectionError('future-stored-projection-epoch');
      }
      return projection.libraryEpoch < serverEpoch ? [projections[index]] : [];
    });
    deletedProjections.forEach(({ reference }) => transaction.delete(reference));
    oldCards.forEach(({ reference }) => transaction.delete(reference));
    return {
      deletedCardIds: oldCards.map(({ reference }) => reference.id),
      deletedProjectionLexemeIds: deletedProjections.map(({ lexemeId }) => lexemeId),
    };
  });
}
