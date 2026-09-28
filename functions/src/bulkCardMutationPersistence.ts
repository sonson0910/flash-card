import type {
  DocumentData,
  DocumentReference,
  DocumentSnapshot,
  Firestore,
  Transaction,
} from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { InputValidationError } from './inputValidation.js';
import { assertOwnerLibraryWriteAllowed } from './legacyLibraryMigrationOwnerScope.js';
import { deleteCatalogProgressForCard } from './catalogProgressPersistence.js';

export const MAX_PROTOCOL_COUNTER = Number.MAX_SAFE_INTEGER;

// Firestore transactions cap the number of documents they can touch at 500.
// Every delete reads and writes three documents (the card, its tombstone, and
// its catalog projection),
// a patch touches one, and the shared library-state read costs one more, so
// this bound keeps every request safely under that ceiling regardless of mix.
export const MAX_BULK_MUTATION_DOCUMENTS = 400;

// The bulk callable intentionally supports only the fields real multi-card UI
// actions mutate today (deck reassignment, bookmark toggling). Any other
// field continues through the single-card path, which already validates the
// full card shape; this keeps the bulk validation surface small and safe.
export type BulkPatchableField = 'customDeck' | 'bookmarked';
const BULK_PATCHABLE_FIELDS: readonly BulkPatchableField[] = ['customDeck', 'bookmarked'];
const BULK_PATCHABLE_FIELD_SET = new Set<string>(BULK_PATCHABLE_FIELDS);

const CARD_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;
const OPERATION_ID_PATTERN = /^(?!__proto__$|constructor$|prototype$)[a-zA-Z0-9_-]+(?::(?!__proto__$|constructor$|prototype$)[a-zA-Z0-9_-]+)*$/;

export type BulkCardPatchFields = { customDeck?: string | null; bookmarked?: boolean };

export type BulkCardPatchCommand = {
  cardId: string;
  baseRevision: number;
  fields: BulkCardPatchFields;
  fieldMask: BulkPatchableField[];
};

export type BulkCardDeleteCommand = {
  cardId: string;
  baseRevision: number;
  opId: string;
};

export type BulkCardMutationRequest = {
  libraryEpoch: number;
  patches: BulkCardPatchCommand[];
  deletes: BulkCardDeleteCommand[];
};

export type BulkMutationConflictReason =
  | 'missing'
  | 'requires-migration'
  | 'stale-library-epoch'
  | 'future-library-epoch'
  | 'revision-conflict';

export type BulkCardMutationItemResult =
  | { cardId: string; op: 'patch'; applied: true; revision: number }
  | { cardId: string; op: 'patch'; applied: false; reason: BulkMutationConflictReason; currentRevision?: number }
  | {
    cardId: string;
    op: 'delete';
    applied: true;
    revision: number;
    deletedAt: string;
    opId: string;
    libraryEpoch: number;
  }
  | { cardId: string; op: 'delete'; applied: false; reason: 'revision-conflict'; currentRevision: number };

export type BulkCardMutationResult = {
  results: BulkCardMutationItemResult[];
};

export class BulkMutationEpochError extends Error {
  constructor(public readonly reason: 'stale-library-epoch' | 'future-library-epoch') {
    super(`Bulk card mutation rejected: ${reason}.`);
    this.name = 'BulkMutationEpochError';
  }
}

const asRecord = (value: unknown, message: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new InputValidationError(message);
  return value as Record<string, unknown>;
};

const nonNegativeInteger = (value: unknown, field: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new InputValidationError(`Bulk card mutation field "${field}" is invalid.`);
  }
  return Number(value);
};

const cardId = (value: unknown): string => {
  if (typeof value !== 'string' || !CARD_ID_PATTERN.test(value)) {
    throw new InputValidationError('Bulk card mutation cardId is invalid.');
  }
  return value;
};

const operationId = (value: unknown): string => {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128 || !OPERATION_ID_PATTERN.test(value)) {
    throw new InputValidationError('Bulk card mutation opId is invalid.');
  }
  return value;
};

const customDeckValue = (value: unknown): string | null => {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 128) {
    throw new InputValidationError('Bulk card mutation field "customDeck" is invalid.');
  }
  return value.trim();
};

const parseFieldMask = (value: unknown): BulkPatchableField[] => {
  if (!Array.isArray(value) || value.length < 1 || value.length > BULK_PATCHABLE_FIELDS.length) {
    throw new InputValidationError('Bulk card mutation fieldMask is invalid.');
  }
  const mask = value.map(item => {
    if (typeof item !== 'string' || !BULK_PATCHABLE_FIELD_SET.has(item)) {
      throw new InputValidationError('Bulk card mutation fieldMask is invalid.');
    }
    return item as BulkPatchableField;
  });
  if (new Set(mask).size !== mask.length) {
    throw new InputValidationError('Bulk card mutation fieldMask contains a duplicate field.');
  }
  return mask;
};

const parseFields = (value: unknown, fieldMask: readonly BulkPatchableField[]): BulkCardPatchFields => {
  const source = asRecord(value, 'Bulk card mutation fields must be an object.');
  if (Object.keys(source).length !== fieldMask.length || fieldMask.some(field => !Object.hasOwn(source, field))) {
    throw new InputValidationError('Bulk card mutation fields must match the field mask exactly.');
  }
  const fields: BulkCardPatchFields = {};
  for (const field of fieldMask) {
    if (field === 'customDeck') fields.customDeck = customDeckValue(source.customDeck);
    else if (field === 'bookmarked') {
      if (typeof source.bookmarked !== 'boolean') {
        throw new InputValidationError('Bulk card mutation field "bookmarked" is invalid.');
      }
      fields.bookmarked = source.bookmarked;
    }
  }
  return fields;
};

const parsePatchCommand = (value: unknown): BulkCardPatchCommand => {
  const source = asRecord(value, 'Bulk card patch command must be an object.');
  if (Object.keys(source).some(key => !new Set(['cardId', 'baseRevision', 'fields', 'fieldMask']).has(key))) {
    throw new InputValidationError('Bulk card patch command contains an unsupported field.');
  }
  const fieldMask = parseFieldMask(source.fieldMask);
  return {
    cardId: cardId(source.cardId),
    baseRevision: nonNegativeInteger(source.baseRevision, 'baseRevision'),
    fieldMask,
    fields: parseFields(source.fields, fieldMask),
  };
};

const parseDeleteCommand = (value: unknown): BulkCardDeleteCommand => {
  const source = asRecord(value, 'Bulk card delete command must be an object.');
  if (Object.keys(source).some(key => !new Set(['cardId', 'baseRevision', 'opId']).has(key))) {
    throw new InputValidationError('Bulk card delete command contains an unsupported field.');
  }
  return {
    cardId: cardId(source.cardId),
    baseRevision: nonNegativeInteger(source.baseRevision, 'baseRevision'),
    opId: operationId(source.opId),
  };
};

export function parseBulkCardMutationRequest(value: unknown): BulkCardMutationRequest {
  const source = asRecord(value, 'Bulk card mutation request must be an object.');
  if (Object.keys(source).some(key => !new Set(['libraryEpoch', 'patches', 'deletes']).has(key))) {
    throw new InputValidationError('Bulk card mutation request contains an unsupported field.');
  }
  const libraryEpoch = nonNegativeInteger(source.libraryEpoch, 'libraryEpoch');
  const patches = source.patches === undefined ? [] : source.patches;
  const deletes = source.deletes === undefined ? [] : source.deletes;
  if (!Array.isArray(patches) || !Array.isArray(deletes)) {
    throw new InputValidationError('Bulk card mutation patches and deletes must be arrays.');
  }
  const parsedPatches = patches.map(parsePatchCommand);
  const parsedDeletes = deletes.map(parseDeleteCommand);
  const totalCommands = parsedPatches.length + parsedDeletes.length;
  if (totalCommands < 1) {
    throw new InputValidationError('Bulk card mutation request must contain at least one command.');
  }
  // Each delete has weight three (card + tombstone + catalog projection); each
  // patch has weight one. Bound the total so the transaction never approaches
  // 500-document-per-transaction ceiling regardless of the patch/delete mix.
  if (parsedPatches.length + parsedDeletes.length * 3 > MAX_BULK_MUTATION_DOCUMENTS) {
    throw new InputValidationError('Bulk card mutation request is too large.');
  }
  const seenIds = new Set<string>();
  for (const item of [...parsedPatches, ...parsedDeletes]) {
    if (seenIds.has(item.cardId)) {
      throw new InputValidationError('Bulk card mutation request cannot target the same card twice.');
    }
    seenIds.add(item.cardId);
  }
  return { libraryEpoch, patches: parsedPatches, deletes: parsedDeletes };
}

const safeCounter = (value: unknown, fallback = 0): number =>
  Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : fallback;

const nextRevision = (value: number): number => {
  if (value >= MAX_PROTOCOL_COUNTER) throw new InputValidationError('Card revision cannot be advanced beyond the maximum safe integer.');
  return value + 1;
};

const patchAlreadyApplied = (
  data: DocumentData,
  fields: BulkCardPatchFields,
  fieldMask: readonly BulkPatchableField[],
): boolean => fieldMask.every(field => Object.is(data[field], fields[field]));

function resolvePatchResult(
  transaction: Transaction,
  cardRef: DocumentReference,
  snapshot: DocumentSnapshot,
  command: BulkCardPatchCommand,
  serverEpoch: number,
): BulkCardMutationItemResult {
  if (!snapshot.exists) return { cardId: command.cardId, op: 'patch', applied: false, reason: 'missing' };
  const data = snapshot.data() as DocumentData;
  const revision = safeCounter(data.revision, Number.NaN);
  const storedEpoch = safeCounter(data.libraryEpoch, Number.NaN);
  if (data.schemaVersion !== 2 || !Number.isFinite(revision) || revision < 1 || !Number.isFinite(storedEpoch)) {
    // A card that has not gone through the identity/reservation protocol
    // needs the single-card path, which can safely upgrade it in place.
    return { cardId: command.cardId, op: 'patch', applied: false, reason: 'requires-migration' };
  }
  if (storedEpoch !== serverEpoch) {
    return {
      cardId: command.cardId,
      op: 'patch',
      applied: false,
      reason: storedEpoch < serverEpoch ? 'stale-library-epoch' : 'future-library-epoch',
    };
  }
  if (command.baseRevision !== revision) {
    if (patchAlreadyApplied(data, command.fields, command.fieldMask)) {
      return { cardId: command.cardId, op: 'patch', applied: true, revision };
    }
    return { cardId: command.cardId, op: 'patch', applied: false, reason: 'revision-conflict', currentRevision: revision };
  }
  const revisionAfterPatch = nextRevision(revision);
  const patch: Record<string, unknown> = {};
  for (const field of command.fieldMask) patch[field] = command.fields[field];
  transaction.set(cardRef, {
    ...patch,
    revision: revisionAfterPatch,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { cardId: command.cardId, op: 'patch', applied: true, revision: revisionAfterPatch };
}

function resolveDeleteResult(
  database: Firestore,
  transaction: Transaction,
  ownerId: string,
  cardRef: DocumentReference,
  tombstoneRef: DocumentReference,
  cardSnapshot: DocumentSnapshot,
  tombstoneSnapshot: DocumentSnapshot,
  command: BulkCardDeleteCommand,
  serverEpoch: number,
): BulkCardMutationItemResult {
  const cardData = cardSnapshot.exists ? cardSnapshot.data() as DocumentData : null;
  const cardRevision = cardData ? safeCounter(cardData.revision) : command.baseRevision;
  const tombstoneData = tombstoneSnapshot.exists ? tombstoneSnapshot.data() as DocumentData : null;
  const tombstoneEpoch = tombstoneData ? safeCounter(tombstoneData.libraryEpoch, -1) : -1;
  const previousTombstoneRevision = tombstoneData && tombstoneEpoch === serverEpoch
    ? safeCounter(tombstoneData.revision)
    : 0;
  const deletedAt = new Date().toISOString();

  if (tombstoneData && tombstoneData.opId === command.opId && tombstoneEpoch === serverEpoch) {
    return {
      cardId: command.cardId, op: 'delete', applied: true,
      revision: safeCounter(tombstoneData.revision, 1) || 1,
      deletedAt: String(tombstoneData.deletedAt ?? deletedAt),
      opId: String(tombstoneData.opId), libraryEpoch: tombstoneEpoch,
    };
  }
  if (!cardData && tombstoneData && tombstoneEpoch === serverEpoch) {
    return {
      cardId: command.cardId, op: 'delete', applied: true,
      revision: safeCounter(tombstoneData.revision, 1) || 1,
      deletedAt: String(tombstoneData.deletedAt ?? deletedAt),
      opId: typeof tombstoneData.opId === 'string' ? tombstoneData.opId : command.opId,
      libraryEpoch: tombstoneEpoch,
    };
  }
  if (cardData && command.baseRevision !== cardRevision) {
    return { cardId: command.cardId, op: 'delete', applied: false, reason: 'revision-conflict', currentRevision: cardRevision };
  }
  const baseRevision = Math.max(command.baseRevision, cardRevision, previousTombstoneRevision);
  const tombstoneRevision = nextRevision(baseRevision);
  transaction.set(tombstoneRef, {
    cardId: command.cardId,
    opId: command.opId,
    libraryEpoch: serverEpoch,
    revision: tombstoneRevision,
    deletedAt,
  }, { merge: false });
  if (cardData) {
    deleteCatalogProgressForCard(database, transaction, ownerId, cardData);
    transaction.delete(cardRef);
  }
  return {
    cardId: command.cardId, op: 'delete', applied: true, revision: tombstoneRevision,
    deletedAt, opId: command.opId, libraryEpoch: serverEpoch,
  };
}

export async function applyBulkCardMutationsForOwner(
  database: Firestore,
  ownerId: string,
  request: BulkCardMutationRequest,
): Promise<BulkCardMutationResult> {
  if (!ownerId || ownerId.includes('/')) throw new InputValidationError('Bulk card mutation owner is invalid.');
  const owner = database.collection('users').doc(ownerId);
  const stateRef = owner.collection('profile').doc('library_state');
  const patchCardRefs = request.patches.map(patch => owner.collection('cards').doc(patch.cardId));
  const deleteCardRefs = request.deletes.map(del => owner.collection('cards').doc(del.cardId));
  const deleteTombstoneRefs = request.deletes.map(del => owner.collection('card_tombstones').doc(del.cardId));

  return database.runTransaction(async (transaction: Transaction) => {
    await assertOwnerLibraryWriteAllowed(transaction, database, ownerId);
    const stateSnapshot = await transaction.get(stateRef);
    const serverEpoch = stateSnapshot.exists ? safeCounter(stateSnapshot.data()?.libraryEpoch) : 0;
    if (request.libraryEpoch !== serverEpoch) {
      throw new BulkMutationEpochError(request.libraryEpoch < serverEpoch ? 'stale-library-epoch' : 'future-library-epoch');
    }

    const allRefs = [...patchCardRefs, ...deleteCardRefs, ...deleteTombstoneRefs];
    const allSnapshots = allRefs.length ? await transaction.getAll(...allRefs) : [];
    const patchSnapshots = allSnapshots.slice(0, patchCardRefs.length);
    const deleteCardSnapshots = allSnapshots.slice(patchCardRefs.length, patchCardRefs.length + deleteCardRefs.length);
    const deleteTombstoneSnapshots = allSnapshots.slice(patchCardRefs.length + deleteCardRefs.length);

    const results: BulkCardMutationItemResult[] = [];
    request.patches.forEach((patch, index) => {
      results.push(resolvePatchResult(transaction, patchCardRefs[index], patchSnapshots[index], patch, serverEpoch));
    });
    request.deletes.forEach((del, index) => {
      results.push(resolveDeleteResult(
        database,
        transaction,
        ownerId,
        deleteCardRefs[index],
        deleteTombstoneRefs[index],
        deleteCardSnapshots[index],
        deleteTombstoneSnapshots[index],
        del,
        serverEpoch,
      ));
    });
    return { results };
  });
}
