import { randomUUID } from 'node:crypto';
import {
  FieldPath,
  type DocumentData,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';
import { InputValidationError } from './inputValidation.js';
import {
  COURSE_QUERY_INDEX_PROJECTION_VERSION,
  COURSE_QUERY_INDEX_SCHEMA_VERSION,
  UnsupportedCourseCardLanguageError,
  buildCourseCardIndexProjection,
  type CourseCardIndexProjection,
  type CourseQueryIndexGeneration,
  type CourseQueryIndexPointer,
} from './course-card-index-contract.js';
import {
  isActiveMigrationFence,
  LegacyLibraryMigrationFenceError,
  migrationFenceReference,
} from './legacyLibraryMigrationOwnerScope.js';

export const COURSE_QUERY_INDEX_BATCH_SIZE = 100;
export const COURSE_QUERY_INDEX_MAX_CONCURRENCY = 8;
export const COURSE_QUERY_INDEX_LEASE_MS = 180_000;
export const COURSE_QUERY_INDEX_MAX_DIAGNOSTICS = 32;

const GENERATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const CARD_ID_MAX_LENGTH = 1_500;

export type BuildCourseQueryIndexBatchRequest = Readonly<{
  generationId?: string;
  leaseToken?: string;
}>;

export type CourseQueryIndexDiagnostic = Readonly<{
  cardId: string;
  reason: string;
}>;

export type CourseQueryIndexBatchStatus = 'building' | 'ready' | 'failed' | 'index-not-ready';

export type CourseQueryIndexBatchResult = Readonly<{
  generationId: string | null;
  status: CourseQueryIndexBatchStatus;
  complete: boolean;
  libraryEpoch: number;
  activeGenerationId: string | null;
  buildingGenerationId: string | null;
  lastCardId: string | null;
  scanned: number;
  leaseToken: string | null;
  diagnostics: readonly CourseQueryIndexDiagnostic[];
}>;

export class CourseQueryIndexStateError extends Error {
  constructor(public readonly reason = 'index-state-invalid') {
    super(`Course query index state is invalid: ${reason}.`);
    this.name = 'CourseQueryIndexStateError';
  }
}

export class CourseQueryIndexLeaseError extends Error {
  constructor(public readonly reason = 'lease-held') {
    super(`Course query index lease rejected: ${reason}.`);
    this.name = 'CourseQueryIndexLeaseError';
  }
}

export class CourseQueryIndexGenerationChangedError extends Error {
  constructor(public readonly reason = 'generation-changed') {
    super(`Course query index generation changed: ${reason}.`);
    this.name = 'CourseQueryIndexGenerationChangedError';
  }
}

export class CourseQueryIndexEpochChangedError extends Error {
  constructor(public readonly expectedEpoch?: number, public readonly actualEpoch?: number) {
    super('The card library epoch changed while the course query index was building.');
    this.name = 'CourseQueryIndexEpochChangedError';
  }
}

type StoredGeneration = CourseQueryIndexGeneration & {
  diagnostics: CourseQueryIndexDiagnostic[];
};

type BuildLease = Readonly<{
  pointer: CourseQueryIndexPointer;
  generation: StoredGeneration;
  generationId: string;
  leaseToken: string;
}>;

export type CourseCardIndexMirrorResult = Readonly<{
  generationIds: readonly string[];
  deleted: boolean;
  skipped: boolean;
}>;

type PreparedMirror = Readonly<{
  result: CourseCardIndexMirrorResult;
  apply: () => void;
}>;

const asRecord = (value: unknown, message: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CourseQueryIndexStateError(message);
  }
  return value as Record<string, unknown>;
};

const validOwnerId = (value: unknown): value is string => typeof value === 'string'
  && value.length > 0
  && value.length <= 128
  && !value.includes('/');

const validGenerationId = (value: unknown): value is string => typeof value === 'string'
  && GENERATION_ID_PATTERN.test(value);

const validCardId = (value: unknown): value is string => typeof value === 'string'
  && value.length > 0
  && value.length <= CARD_ID_MAX_LENGTH;

const safeCounter = (value: unknown, reason: string): number => {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new CourseQueryIndexStateError(reason);
  }
  return Number(value);
};

const exactKeys = (
  value: Record<string, unknown>,
  expected: readonly string[],
  reason: string,
): void => {
  const keys = Object.keys(value);
  if (keys.length !== expected.length || keys.some(key => !expected.includes(key))) {
    throw new CourseQueryIndexStateError(reason);
  }
};

const allowedKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
  reason: string,
): void => {
  if (Object.keys(value).some(key => !allowed.includes(key))) {
    throw new CourseQueryIndexStateError(reason);
  }
};

const inputRecord = (value: unknown, message: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new InputValidationError(message);
  }
  return value as Record<string, unknown>;
};

const allowedInputKeys = (
  value: Record<string, unknown>,
  allowed: readonly string[],
  message: string,
): void => {
  if (Object.keys(value).some(key => !allowed.includes(key))) {
    throw new InputValidationError(message);
  }
};

const optionalIso = (value: unknown, reason: string): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new CourseQueryIndexStateError(reason);
  }
  return new Date(value).toISOString();
};

const optionalLeaseExpiry = (value: unknown): number | null => {
  if (value === null) return null;
  return safeCounter(value, 'lease-expiry-invalid');
};

const parseDiagnostics = (value: unknown): CourseQueryIndexDiagnostic[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > COURSE_QUERY_INDEX_MAX_DIAGNOSTICS) {
    throw new CourseQueryIndexStateError('diagnostics-invalid');
  }
  return value.map(item => {
    const source = asRecord(item, 'diagnostic-invalid');
    exactKeys(source, ['cardId', 'reason'], 'diagnostic-fields-invalid');
    if (!validCardId(source.cardId) || typeof source.reason !== 'string'
      || source.reason.length < 1 || source.reason.length > 128) {
      throw new CourseQueryIndexStateError('diagnostic-value-invalid');
    }
    return { cardId: source.cardId, reason: source.reason };
  });
};

const parsePointer = (value: unknown): CourseQueryIndexPointer => {
  const source = asRecord(value, 'pointer-invalid');
  exactKeys(
    source,
    ['schemaVersion', 'projectionVersion', 'libraryEpoch', 'activeGenerationId', 'buildingGenerationId'],
    'pointer-fields-invalid',
  );
  if (source.schemaVersion !== COURSE_QUERY_INDEX_SCHEMA_VERSION
    || source.projectionVersion !== COURSE_QUERY_INDEX_PROJECTION_VERSION) {
    throw new CourseQueryIndexStateError('pointer-version-invalid');
  }
  const activeGenerationId = source.activeGenerationId === null ? null : source.activeGenerationId;
  const buildingGenerationId = source.buildingGenerationId === null ? null : source.buildingGenerationId;
  if ((activeGenerationId !== null && !validGenerationId(activeGenerationId))
    || (buildingGenerationId !== null && !validGenerationId(buildingGenerationId))) {
    throw new CourseQueryIndexStateError('pointer-generation-invalid');
  }
  return {
    schemaVersion: COURSE_QUERY_INDEX_SCHEMA_VERSION,
    projectionVersion: COURSE_QUERY_INDEX_PROJECTION_VERSION,
    libraryEpoch: safeCounter(source.libraryEpoch, 'pointer-epoch-invalid'),
    activeGenerationId,
    buildingGenerationId,
  };
};

const parseGeneration = (value: unknown): StoredGeneration => {
  const source = asRecord(value, 'generation-invalid');
  const requiredKeys = ['schemaVersion', 'projectionVersion', 'libraryEpoch', 'status', 'lastCardId', 'scanned',
    'leaseToken', 'leaseExpiresAt', 'startedAt'];
  allowedKeys(source, [...requiredKeys, 'completedAt', 'diagnostics'], 'generation-fields-invalid');
  if (requiredKeys.some(key => !(key in source))) throw new CourseQueryIndexStateError('generation-fields-invalid');
  if (source.schemaVersion !== COURSE_QUERY_INDEX_SCHEMA_VERSION
    || source.projectionVersion !== COURSE_QUERY_INDEX_PROJECTION_VERSION
    || !['building', 'ready', 'failed', 'retired'].includes(source.status as string)) {
    throw new CourseQueryIndexStateError('generation-version-or-status-invalid');
  }
  const lastCardId = source.lastCardId === null ? null : source.lastCardId;
  const leaseToken = source.leaseToken === null ? null : source.leaseToken;
  if ((lastCardId !== null && !validCardId(lastCardId))
    || (leaseToken !== null && !validGenerationId(leaseToken))) {
    throw new CourseQueryIndexStateError('generation-cursor-or-lease-invalid');
  }
  const startedAt = optionalIso(source.startedAt, 'generation-started-at-invalid');
  if (!startedAt) throw new CourseQueryIndexStateError('generation-started-at-invalid');
  const completedAt = optionalIso(source.completedAt, 'generation-completed-at-invalid');
  return {
    schemaVersion: COURSE_QUERY_INDEX_SCHEMA_VERSION,
    projectionVersion: COURSE_QUERY_INDEX_PROJECTION_VERSION,
    libraryEpoch: safeCounter(source.libraryEpoch, 'generation-epoch-invalid'),
    status: source.status as CourseQueryIndexGeneration['status'],
    lastCardId,
    scanned: safeCounter(source.scanned, 'generation-scanned-invalid'),
    leaseToken,
    leaseExpiresAt: optionalLeaseExpiry(source.leaseExpiresAt),
    startedAt,
    ...(completedAt ? { completedAt } : {}),
    diagnostics: parseDiagnostics(source.diagnostics),
  };
};

const parseGenerationRequestValue = (value: unknown, field: string): string | undefined => {
  if (value === undefined) return undefined;
  if (!validGenerationId(value)) throw new InputValidationError(`Course index ${field} is invalid.`);
  return value;
};

export const parseBuildCourseQueryIndexBatchRequest = (
  value: unknown,
): BuildCourseQueryIndexBatchRequest => {
  if (value === undefined || value === null) return {};
  const source = inputRecord(value, 'Course index batch request must be an object.');
  allowedInputKeys(source, ['generationId', 'leaseToken'], 'Course index batch request contains unsupported fields.');
  const generationId = parseGenerationRequestValue(source.generationId, 'generation ID');
  const leaseToken = parseGenerationRequestValue(source.leaseToken, 'lease token');
  if (leaseToken !== undefined && generationId === undefined) {
    throw new InputValidationError('Course index lease token requires a generation ID.');
  }
  return {
    ...(generationId ? { generationId } : {}),
    ...(leaseToken ? { leaseToken } : {}),
  };
};

export const courseQueryIndexPointerReference = (database: Firestore, ownerId: string) =>
  database.collection('users').doc(ownerId).collection('profile').doc('course_query_index');

export const courseQueryIndexGenerationReference = (
  database: Firestore,
  ownerId: string,
  generationId: string,
) => database.collection('users').doc(ownerId).collection('course_query_generations').doc(generationId);

export const courseQueryIndexCardReference = (
  database: Firestore,
  ownerId: string,
  generationId: string,
  cardId: string,
) => courseQueryIndexGenerationReference(database, ownerId, generationId).collection('cards').doc(cardId);

const ownerCardsReference = (database: Firestore, ownerId: string) =>
  database.collection('users').doc(ownerId).collection('cards');

const libraryStateReference = (database: Firestore, ownerId: string) =>
  database.collection('users').doc(ownerId).collection('profile').doc('library_state');

const sourceLibraryEpoch = (value: Record<string, unknown>): number => {
  if (value.libraryEpoch === undefined) return 0;
  return safeCounter(value.libraryEpoch, 'source-library-epoch-invalid');
};

const generationData = (generation: StoredGeneration): Record<string, unknown> => ({
  schemaVersion: generation.schemaVersion,
  projectionVersion: generation.projectionVersion,
  libraryEpoch: generation.libraryEpoch,
  status: generation.status,
  lastCardId: generation.lastCardId,
  scanned: generation.scanned,
  leaseToken: generation.leaseToken,
  leaseExpiresAt: generation.leaseExpiresAt,
  startedAt: generation.startedAt,
  ...(generation.completedAt ? { completedAt: generation.completedAt } : {}),
  ...(generation.diagnostics.length > 0 ? { diagnostics: generation.diagnostics } : {}),
});

const activeGeneration = async (
  transaction: Transaction,
  database: Firestore,
  ownerId: string,
  pointer: CourseQueryIndexPointer,
): Promise<StoredGeneration | null> => {
  if (!pointer.activeGenerationId) return null;
  const snapshot = await transaction.get(courseQueryIndexGenerationReference(database, ownerId, pointer.activeGenerationId));
  if (!snapshot.exists) return null;
  return parseGeneration(snapshot.data());
};

const assertNoActiveMigrationFence = (snapshot: { exists: boolean; data(): DocumentData | undefined }): void => {
  if (snapshot.exists && isActiveMigrationFence(snapshot.data())) {
    throw new LegacyLibraryMigrationFenceError();
  }
};

const assertLease = (
  pointer: CourseQueryIndexPointer,
  generation: StoredGeneration,
  generationId: string,
  leaseToken: string,
  expectedEpoch: number,
  actualEpoch: number,
): void => {
  if (actualEpoch !== expectedEpoch) throw new CourseQueryIndexEpochChangedError(expectedEpoch, actualEpoch);
  if (pointer.libraryEpoch !== expectedEpoch || pointer.buildingGenerationId !== generationId) {
    throw new CourseQueryIndexGenerationChangedError();
  }
  if (generation.status !== 'building' || generation.libraryEpoch !== expectedEpoch
    || generation.leaseToken !== leaseToken || generation.leaseExpiresAt === null
    || generation.leaseExpiresAt <= Date.now()) {
    throw new CourseQueryIndexLeaseError('lease-lost');
  }
};

const newGeneration = (libraryEpoch: number, leaseToken: string): StoredGeneration => ({
  schemaVersion: COURSE_QUERY_INDEX_SCHEMA_VERSION,
  projectionVersion: COURSE_QUERY_INDEX_PROJECTION_VERSION,
  libraryEpoch,
  status: 'building',
  lastCardId: null,
  scanned: 0,
  leaseToken,
  leaseExpiresAt: Date.now() + COURSE_QUERY_INDEX_LEASE_MS,
  startedAt: new Date().toISOString(),
  diagnostics: [],
});

const acquireBuildLease = async (
  database: Firestore,
  ownerId: string,
  request: BuildCourseQueryIndexBatchRequest,
): Promise<BuildLease> => database.runTransaction(async transaction => {
  const pointerReference = courseQueryIndexPointerReference(database, ownerId);
  const stateReference = libraryStateReference(database, ownerId);
  const fenceReference = migrationFenceReference(database, ownerId);
  const [pointerSnapshot, stateSnapshot, fenceSnapshot] = await Promise.all([
    transaction.get(pointerReference),
    transaction.get(stateReference),
    transaction.get(fenceReference),
  ]);
  assertNoActiveMigrationFence(fenceSnapshot);
  const libraryEpoch = stateSnapshot.exists
    ? safeCounter(stateSnapshot.data()?.libraryEpoch, 'library-state-epoch-invalid')
    : 0;
  const storedPointer = pointerSnapshot.exists ? parsePointer(pointerSnapshot.data()) : null;
  if (request.generationId && (!storedPointer || storedPointer.buildingGenerationId !== request.generationId)) {
    throw new CourseQueryIndexGenerationChangedError('requested-generation-is-not-building');
  }

  if (storedPointer?.buildingGenerationId) {
    const generationId = storedPointer.buildingGenerationId;
    const generationReference = courseQueryIndexGenerationReference(database, ownerId, generationId);
    const generationSnapshot = await transaction.get(generationReference);
    if (!generationSnapshot.exists) throw new CourseQueryIndexStateError('building-generation-missing');
    const generation = parseGeneration(generationSnapshot.data());
    if (generation.status !== 'building') {
      transaction.set(pointerReference, {
        ...storedPointer,
        buildingGenerationId: null,
      }, { merge: false });
    } else if (generation.libraryEpoch === libraryEpoch) {
      if (request.leaseToken && request.leaseToken !== generation.leaseToken) {
        throw new CourseQueryIndexLeaseError();
      }
      if (!request.leaseToken && generation.leaseExpiresAt !== null && generation.leaseExpiresAt > Date.now()) {
        throw new CourseQueryIndexLeaseError();
      }
      const leaseToken = randomUUID();
      const nextGeneration: StoredGeneration = {
        ...generation,
        leaseToken,
        leaseExpiresAt: Date.now() + COURSE_QUERY_INDEX_LEASE_MS,
      };
      transaction.set(generationReference, generationData(nextGeneration), { merge: false });
      return {
        pointer: storedPointer,
        generation: nextGeneration,
        generationId,
        leaseToken,
      };
    } else {
      transaction.set(generationReference, generationData({
        ...generation,
        status: 'failed',
        leaseToken: null,
        leaseExpiresAt: null,
        completedAt: new Date().toISOString(),
      }), { merge: false });
      transaction.set(pointerReference, {
        ...storedPointer,
        libraryEpoch,
        activeGenerationId: null,
        buildingGenerationId: null,
      }, { merge: false });
    }
  }

  if (request.leaseToken) throw new CourseQueryIndexGenerationChangedError('requested-lease-is-not-building');
  const activeId = storedPointer?.activeGenerationId ?? null;
  const active = storedPointer && activeId && storedPointer.libraryEpoch === libraryEpoch
    ? await activeGeneration(transaction, database, ownerId, storedPointer)
    : null;
  const compatibleActiveId = active?.status === 'ready' && active.libraryEpoch === libraryEpoch
    ? activeId
    : null;
  const generationId = randomUUID();
  const leaseToken = randomUUID();
  const generation = newGeneration(libraryEpoch, leaseToken);
  const pointer: CourseQueryIndexPointer = {
    schemaVersion: COURSE_QUERY_INDEX_SCHEMA_VERSION,
    projectionVersion: COURSE_QUERY_INDEX_PROJECTION_VERSION,
    libraryEpoch,
    activeGenerationId: compatibleActiveId,
    buildingGenerationId: generationId,
  };
  transaction.create(courseQueryIndexGenerationReference(database, ownerId, generationId), generationData(generation));
  transaction.set(pointerReference, pointer, { merge: false });
  return { pointer, generation, generationId, leaseToken };
});

const verifyBuildLease = async (
  transaction: Transaction,
  database: Firestore,
  ownerId: string,
  generationId: string,
  leaseToken: string,
): Promise<{ pointer: CourseQueryIndexPointer; generation: StoredGeneration; libraryEpoch: number }> => {
  const [pointerSnapshot, generationSnapshot, stateSnapshot, fenceSnapshot] = await Promise.all([
    transaction.get(courseQueryIndexPointerReference(database, ownerId)),
    transaction.get(courseQueryIndexGenerationReference(database, ownerId, generationId)),
    transaction.get(libraryStateReference(database, ownerId)),
    transaction.get(migrationFenceReference(database, ownerId)),
  ]);
  assertNoActiveMigrationFence(fenceSnapshot);
  if (!pointerSnapshot.exists || !generationSnapshot.exists) {
    throw new CourseQueryIndexGenerationChangedError('generation-missing');
  }
  const pointer = parsePointer(pointerSnapshot.data());
  const generation = parseGeneration(generationSnapshot.data());
  const libraryEpoch = stateSnapshot.exists
    ? safeCounter(stateSnapshot.data()?.libraryEpoch, 'library-state-epoch-invalid')
    : 0;
  assertLease(pointer, generation, generationId, leaseToken, generation.libraryEpoch, libraryEpoch);
  return { pointer, generation, libraryEpoch };
};

const mirrorScannedCard = async (
  database: Firestore,
  ownerId: string,
  generationId: string,
  leaseToken: string,
  cardId: string,
  expectedEpoch: number,
): Promise<void> => database.runTransaction(async transaction => {
  const sourceReference = ownerCardsReference(database, ownerId).doc(cardId);
  const [pointerSnapshot, generationSnapshot, stateSnapshot, fenceSnapshot, sourceSnapshot] = await Promise.all([
    transaction.get(courseQueryIndexPointerReference(database, ownerId)),
    transaction.get(courseQueryIndexGenerationReference(database, ownerId, generationId)),
    transaction.get(libraryStateReference(database, ownerId)),
    transaction.get(migrationFenceReference(database, ownerId)),
    transaction.get(sourceReference),
  ]);
  assertNoActiveMigrationFence(fenceSnapshot);
  if (!pointerSnapshot.exists || !generationSnapshot.exists) {
    throw new CourseQueryIndexGenerationChangedError('generation-missing');
  }
  const pointer = parsePointer(pointerSnapshot.data());
  const generation = parseGeneration(generationSnapshot.data());
  const actualEpoch = stateSnapshot.exists
    ? safeCounter(stateSnapshot.data()?.libraryEpoch, 'library-state-epoch-invalid')
    : 0;
  assertLease(pointer, generation, generationId, leaseToken, expectedEpoch, actualEpoch);
  const rowReference = courseQueryIndexCardReference(database, ownerId, generationId, cardId);
  if (!sourceSnapshot.exists) {
    transaction.delete(rowReference);
    return;
  }
  const source = asRecord(sourceSnapshot.data(), 'source-card-invalid');
  if (sourceLibraryEpoch(source) !== expectedEpoch) {
    transaction.delete(rowReference);
    return;
  }
  const projection = buildCourseCardIndexProjection(source, cardId);
  transaction.set(rowReference, projection, { merge: false });
});

const appendDiagnostic = (
  diagnostics: readonly CourseQueryIndexDiagnostic[],
  diagnostic: CourseQueryIndexDiagnostic,
): CourseQueryIndexDiagnostic[] => {
  if (diagnostics.some(item => item.cardId === diagnostic.cardId && item.reason === diagnostic.reason)) {
    return [...diagnostics];
  }
  return [...diagnostics, diagnostic].slice(0, COURSE_QUERY_INDEX_MAX_DIAGNOSTICS);
};

const failBuild = async (
  database: Firestore,
  ownerId: string,
  generationId: string,
  leaseToken: string,
  diagnostics: readonly CourseQueryIndexDiagnostic[],
): Promise<CourseQueryIndexBatchResult> => database.runTransaction(async transaction => {
  const pointerReference = courseQueryIndexPointerReference(database, ownerId);
  const generationReference = courseQueryIndexGenerationReference(database, ownerId, generationId);
  const [pointerSnapshot, generationSnapshot, stateSnapshot, fenceSnapshot] = await Promise.all([
    transaction.get(pointerReference),
    transaction.get(generationReference),
    transaction.get(libraryStateReference(database, ownerId)),
    transaction.get(migrationFenceReference(database, ownerId)),
  ]);
  assertNoActiveMigrationFence(fenceSnapshot);
  if (!pointerSnapshot.exists || !generationSnapshot.exists) {
    throw new CourseQueryIndexGenerationChangedError('generation-missing');
  }
  const pointer = parsePointer(pointerSnapshot.data());
  const generation = parseGeneration(generationSnapshot.data());
  const libraryEpoch = stateSnapshot.exists
    ? safeCounter(stateSnapshot.data()?.libraryEpoch, 'library-state-epoch-invalid')
    : 0;
  assertLease(pointer, generation, generationId, leaseToken, generation.libraryEpoch, libraryEpoch);
  const mergedDiagnostics = diagnostics.reduce(appendDiagnostic, generation.diagnostics);
  const failed: StoredGeneration = {
    ...generation,
    status: 'failed',
    leaseToken: null,
    leaseExpiresAt: null,
    completedAt: new Date().toISOString(),
    diagnostics: mergedDiagnostics,
  };
  transaction.set(generationReference, generationData(failed), { merge: false });
  const nextPointer: CourseQueryIndexPointer = {
    ...pointer,
    buildingGenerationId: null,
  };
  transaction.set(pointerReference, nextPointer, { merge: false });
  return batchResult(failed, nextPointer, generationId, libraryEpoch, false);
});

const commitCheckpoint = async (
  database: Firestore,
  ownerId: string,
  generationId: string,
  leaseToken: string,
  expectedCursor: string | null,
  lastCardId: string,
  scannedCount: number,
): Promise<CourseQueryIndexBatchResult> => database.runTransaction(async transaction => {
  const { pointer, generation, libraryEpoch } = await verifyBuildLease(
    transaction,
    database,
    ownerId,
    generationId,
    leaseToken,
  );
  if (generation.lastCardId !== expectedCursor) {
    throw new CourseQueryIndexGenerationChangedError('checkpoint-cursor-changed');
  }
  const nextGeneration: StoredGeneration = {
    ...generation,
    lastCardId,
    scanned: generation.scanned + scannedCount,
    leaseExpiresAt: Date.now() + COURSE_QUERY_INDEX_LEASE_MS,
  };
  transaction.set(courseQueryIndexGenerationReference(database, ownerId, generationId), generationData(nextGeneration), { merge: false });
  return batchResult(nextGeneration, pointer, generationId, libraryEpoch, false);
});

const publishGeneration = async (
  database: Firestore,
  ownerId: string,
  generationId: string,
  leaseToken: string,
  expectedCursor: string | null,
): Promise<CourseQueryIndexBatchResult> => database.runTransaction(async transaction => {
  const { pointer, generation, libraryEpoch } = await verifyBuildLease(
    transaction,
    database,
    ownerId,
    generationId,
    leaseToken,
  );
  if (generation.lastCardId !== expectedCursor) {
    throw new CourseQueryIndexGenerationChangedError('publish-cursor-changed');
  }
  const ready: StoredGeneration = {
    ...generation,
    status: 'ready',
    leaseToken: null,
    leaseExpiresAt: null,
    completedAt: new Date().toISOString(),
  };
  const nextPointer: CourseQueryIndexPointer = {
    ...pointer,
    activeGenerationId: generationId,
    buildingGenerationId: null,
  };
  transaction.set(courseQueryIndexGenerationReference(database, ownerId, generationId), generationData(ready), { merge: false });
  if (pointer.activeGenerationId && pointer.activeGenerationId !== generationId) {
    transaction.set(courseQueryIndexGenerationReference(database, ownerId, pointer.activeGenerationId), {
      status: 'retired',
      leaseToken: null,
      leaseExpiresAt: null,
      completedAt: new Date().toISOString(),
    }, { merge: true });
  }
  transaction.set(courseQueryIndexPointerReference(database, ownerId), nextPointer, { merge: false });
  return batchResult(ready, nextPointer, generationId, libraryEpoch, true);
});

const batchResult = (
  generation: StoredGeneration | null,
  pointer: CourseQueryIndexPointer,
  generationId: string | null,
  libraryEpoch: number,
  complete: boolean,
): CourseQueryIndexBatchResult => ({
  generationId,
  status: complete ? 'ready' : generation?.status === 'failed' ? 'failed' : generation ? 'building' : 'index-not-ready',
  complete,
  libraryEpoch,
  activeGenerationId: pointer.activeGenerationId,
  buildingGenerationId: pointer.buildingGenerationId,
  lastCardId: generation?.lastCardId ?? null,
  scanned: generation?.scanned ?? 0,
  leaseToken: generation?.leaseToken ?? null,
  diagnostics: generation?.diagnostics ?? [],
});

const releaseBuildLease = async (
  database: Firestore,
  ownerId: string,
  generationId: string,
  leaseToken: string,
): Promise<void> => database.runTransaction(async transaction => {
  const [pointerSnapshot, generationSnapshot] = await Promise.all([
    transaction.get(courseQueryIndexPointerReference(database, ownerId)),
    transaction.get(courseQueryIndexGenerationReference(database, ownerId, generationId)),
  ]);
  if (!pointerSnapshot.exists || !generationSnapshot.exists) return;
  const pointer = parsePointer(pointerSnapshot.data());
  const generation = parseGeneration(generationSnapshot.data());
  if (pointer.buildingGenerationId !== generationId || generation.leaseToken !== leaseToken) return;
  transaction.set(courseQueryIndexGenerationReference(database, ownerId, generationId), {
    ...generationData(generation),
    leaseToken: null,
    leaseExpiresAt: null,
  }, { merge: false });
});

const readPage = async (
  database: Firestore,
  ownerId: string,
  cursor: string | null,
): Promise<readonly { id: string }[]> => {
  let query = ownerCardsReference(database, ownerId)
    .orderBy(FieldPath.documentId())
    .limit(COURSE_QUERY_INDEX_BATCH_SIZE);
  if (cursor !== null) query = query.startAfter(cursor);
  const snapshot = await query.get();
  return snapshot.docs.map(document => ({ id: document.id }));
};

const invalidateAfterEpochChange = async (
  database: Firestore,
  ownerId: string,
  generationId: string,
): Promise<void> => database.runTransaction(async transaction => {
  const pointerReference = courseQueryIndexPointerReference(database, ownerId);
  const [pointerSnapshot, stateSnapshot] = await Promise.all([
    transaction.get(pointerReference),
    transaction.get(libraryStateReference(database, ownerId)),
  ]);
  if (!stateSnapshot.exists) return;
  const libraryEpoch = safeCounter(stateSnapshot.data()?.libraryEpoch, 'library-state-epoch-invalid');
  if (!pointerSnapshot.exists) return;
  const pointer = parsePointer(pointerSnapshot.data());
  if (pointer.buildingGenerationId !== generationId) return;
  if (pointer.libraryEpoch >= libraryEpoch && pointer.buildingGenerationId === null) return;
  transaction.set(pointerReference, {
    ...pointer,
    libraryEpoch,
    activeGenerationId: null,
    buildingGenerationId: null,
  }, { merge: false });
  if (pointer.buildingGenerationId) {
    transaction.set(courseQueryIndexGenerationReference(database, ownerId, pointer.buildingGenerationId), {
      status: 'failed',
      leaseToken: null,
      leaseExpiresAt: null,
      completedAt: new Date().toISOString(),
    }, { merge: true });
  }
});

/**
 * Mirror the authoritative source card in every compatible active/building
 * generation. The caller must invoke this before any transaction write.
 */
export const prepareCourseCardIndexMirrorInTransaction = async (
  database: Firestore,
  transaction: Transaction,
  ownerId: string,
  cardId: string,
  sourceCard: Record<string, unknown> | null,
): Promise<PreparedMirror> => {
  if (!validOwnerId(ownerId)) throw new InputValidationError('Course index owner is invalid.');
  if (!validCardId(cardId)) throw new InputValidationError('Course index card ID is invalid.');
  const pointerSnapshot = await transaction.get(courseQueryIndexPointerReference(database, ownerId));
  if (!pointerSnapshot.exists) return {
    result: { generationIds: [], deleted: false, skipped: true },
    apply: () => undefined,
  };
  const pointer = parsePointer(pointerSnapshot.data());
  const generationIds = [...new Set([
    pointer.activeGenerationId,
    pointer.buildingGenerationId,
  ].filter((value): value is string => value !== null))];
  if (generationIds.length === 0) return {
    result: { generationIds: [], deleted: false, skipped: true },
    apply: () => undefined,
  };
  const generationSnapshots = await Promise.all(generationIds.map(generationId => transaction.get(
    courseQueryIndexGenerationReference(database, ownerId, generationId),
  )));
  const compatible = generationSnapshots.flatMap((snapshot, index) => {
    if (!snapshot.exists) return [];
    const generation = parseGeneration(snapshot.data());
    const generationId = generationIds[index];
    if ((pointer.activeGenerationId === generationId && generation.status !== 'ready')
      || (pointer.buildingGenerationId === generationId && generation.status !== 'building')
      || generation.libraryEpoch !== pointer.libraryEpoch) return [];
    return [generationId];
  });
  if (compatible.length === 0) return {
    result: { generationIds: [], deleted: false, skipped: true },
    apply: () => undefined,
  };

  let projection: CourseCardIndexProjection | null = null;
  if (sourceCard) {
    try {
      projection = buildCourseCardIndexProjection(sourceCard, cardId);
      if (sourceLibraryEpoch(sourceCard) !== pointer.libraryEpoch) projection = null;
    } catch (error) {
      if (!(error instanceof UnsupportedCourseCardLanguageError)) throw error;
      projection = null;
    }
  }
  const result: CourseCardIndexMirrorResult = {
    generationIds: compatible,
    deleted: !projection,
    skipped: !projection && sourceCard !== null,
  };
  return {
    result,
    apply: () => {
      for (const generationId of compatible) {
        const rowReference = courseQueryIndexCardReference(database, ownerId, generationId, cardId);
        if (projection) transaction.set(rowReference, projection, { merge: false });
        else transaction.delete(rowReference);
      }
    },
  };
};

export const mirrorCourseCardIndexInTransaction = async (
  database: Firestore,
  transaction: Transaction,
  ownerId: string,
  cardId: string,
  sourceCard: Record<string, unknown> | null,
): Promise<CourseCardIndexMirrorResult> => {
  const prepared = await prepareCourseCardIndexMirrorInTransaction(
    database,
    transaction,
    ownerId,
    cardId,
    sourceCard,
  );
  prepared.apply();
  return prepared.result;
};

/** Clear active/building generations when the primary library epoch advances. */
export const invalidateCourseQueryIndexInTransaction = async (
  database: Firestore,
  transaction: Transaction,
  ownerId: string,
  libraryEpoch: number,
): Promise<void> => {
  if (!validOwnerId(ownerId)) throw new InputValidationError('Course index owner is invalid.');
  const nextEpoch = safeCounter(libraryEpoch, 'course-index-epoch-invalid');
  const pointerReference = courseQueryIndexPointerReference(database, ownerId);
  const pointerSnapshot = await transaction.get(pointerReference);
  if (!pointerSnapshot.exists) {
    transaction.set(pointerReference, {
      schemaVersion: COURSE_QUERY_INDEX_SCHEMA_VERSION,
      projectionVersion: COURSE_QUERY_INDEX_PROJECTION_VERSION,
      libraryEpoch: nextEpoch,
      activeGenerationId: null,
      buildingGenerationId: null,
    }, { merge: false });
    return;
  }
  const pointer = parsePointer(pointerSnapshot.data());
  if (pointer.libraryEpoch > nextEpoch) throw new CourseQueryIndexEpochChangedError(pointer.libraryEpoch, nextEpoch);
  transaction.set(pointerReference, {
    ...pointer,
    libraryEpoch: nextEpoch,
    activeGenerationId: null,
    buildingGenerationId: null,
  }, { merge: false });
  const generationIds = [...new Set([
    pointer.activeGenerationId,
    pointer.buildingGenerationId,
  ].filter((value): value is string => value !== null))];
  for (const generationId of generationIds) {
    transaction.set(courseQueryIndexGenerationReference(database, ownerId, generationId), {
      status: 'retired',
      leaseToken: null,
      leaseExpiresAt: null,
      completedAt: new Date().toISOString(),
    }, { merge: true });
  }
};

export const invalidateCourseQueryIndex = async (
  database: Firestore,
  ownerId: string,
  libraryEpoch: number,
): Promise<void> => database.runTransaction(transaction =>
  invalidateCourseQueryIndexInTransaction(database, transaction, ownerId, libraryEpoch));

export const readCourseQueryIndexPointer = async (
  database: Firestore,
  ownerId: string,
): Promise<CourseQueryIndexPointer | null> => {
  if (!validOwnerId(ownerId)) throw new InputValidationError('Course index owner is invalid.');
  const snapshot = await courseQueryIndexPointerReference(database, ownerId).get();
  return snapshot.exists ? parsePointer(snapshot.data()) : null;
};

/** Run one authenticated-owner batch; the callable wrapper supplies auth.uid. */
export const buildCourseQueryIndexBatch = async (
  database: Firestore,
  ownerId: string,
  request: BuildCourseQueryIndexBatchRequest = {},
): Promise<CourseQueryIndexBatchResult> => {
  if (!validOwnerId(ownerId)) throw new InputValidationError('Course index owner is invalid.');
  const parsedRequest = parseBuildCourseQueryIndexBatchRequest(request);
  const lease = await acquireBuildLease(database, ownerId, parsedRequest);
  let page: readonly { id: string }[];
  try {
    page = await readPage(database, ownerId, lease.generation.lastCardId);
  } catch (error) {
    await releaseBuildLease(database, ownerId, lease.generationId, lease.leaseToken);
    throw error;
  }
  if (page.length === 0) {
    try {
      return await publishGeneration(
        database,
        ownerId,
        lease.generationId,
        lease.leaseToken,
        lease.generation.lastCardId,
      );
    } catch (error) {
      await releaseBuildLease(database, ownerId, lease.generationId, lease.leaseToken);
      if (error instanceof CourseQueryIndexEpochChangedError) {
        await invalidateAfterEpochChange(database, ownerId, lease.generationId);
      }
      throw error;
    }
  }

  const diagnostics: CourseQueryIndexDiagnostic[] = [];
  for (let offset = 0; offset < page.length; offset += COURSE_QUERY_INDEX_MAX_CONCURRENCY) {
    const chunk = page.slice(offset, offset + COURSE_QUERY_INDEX_MAX_CONCURRENCY);
    const outcomes = await Promise.allSettled(chunk.map(document => mirrorScannedCard(
      database,
      ownerId,
      lease.generationId,
      lease.leaseToken,
      document.id,
      lease.generation.libraryEpoch,
    )));
    const fatal: unknown[] = [];
    outcomes.forEach(outcome => {
      if (outcome.status === 'fulfilled') return;
      if (outcome.reason instanceof UnsupportedCourseCardLanguageError) {
        diagnostics.push({ cardId: outcome.reason.cardId, reason: 'unsupported-target-language' });
      } else {
        fatal.push(outcome.reason);
      }
    });
    if (fatal.length > 0) {
      await releaseBuildLease(database, ownerId, lease.generationId, lease.leaseToken);
      if (fatal.some(error => error instanceof CourseQueryIndexEpochChangedError)) {
        await invalidateAfterEpochChange(database, ownerId, lease.generationId);
      }
      throw fatal[0];
    }
  }
  if (diagnostics.length > 0) {
    return failBuild(database, ownerId, lease.generationId, lease.leaseToken, diagnostics);
  }
  const lastCardId = page.at(-1)?.id;
  if (!lastCardId) throw new CourseQueryIndexStateError('page-last-card-missing');
  try {
    return await commitCheckpoint(
      database,
      ownerId,
      lease.generationId,
      lease.leaseToken,
      lease.generation.lastCardId,
      lastCardId,
      page.length,
    );
  } catch (error) {
    await releaseBuildLease(database, ownerId, lease.generationId, lease.leaseToken);
    if (error instanceof CourseQueryIndexEpochChangedError) {
      await invalidateAfterEpochChange(database, ownerId, lease.generationId);
    }
    throw error;
  }
};
