import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  FieldPath,
  FieldValue,
  Timestamp,
  type DocumentData,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';
import {
  createCanonicalCleanupCardId,
  normalizeCleanupWord,
  planLegacyIdentityGroup,
  type CleanupCard,
  type DuplicateCleanupPlan,
} from './duplicateCleanup.js';
import {
  LegacyLibraryGenerationChangedError,
  LegacyLibrarySourceLimitError,
  MAX_AUTOMATIC_ROLLBACK_SOURCE_CARDS,
  MAX_LEGACY_LIBRARY_MIGRATION_SOURCE_CARDS,
  type LegacyLibraryMigrationPage,
  type LegacyLibraryMigrationPhase,
  type LegacyLibraryMigrationPreflightEvidence,
  type LegacyLibraryMigrationPreflightResult,
  type LegacyLibraryMigrationProgressToken,
  type LegacyLibraryMigrationStore,
  type LegacyLibraryReservation,
} from './legacyLibraryMigration.js';

export { LegacyLibraryGenerationChangedError } from './legacyLibraryMigration.js';

export type LegacyLibraryMigrationExecutionIdentity = {
  migrationRunId: string;
  migrationRunAttempt: number;
};

export class LegacyLibraryExecutionChangedError extends Error {
  constructor() {
    super('Migration execution authorization does not match the persisted Admin migration.');
    this.name = 'LegacyLibraryExecutionChangedError';
  }
}

const MIGRATION_VERSION = 3;
const BACKUP_COLLECTION = 'admin_library_migration_backups';

const safeCounter = (value: unknown): number =>
  Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;

const migrationSourceCount = (value: unknown): number | null => (
  Number.isSafeInteger(value)
  && Number(value) >= 0
  && Number(value) <= MAX_LEGACY_LIBRARY_MIGRATION_SOURCE_CARDS
    ? Number(value)
    : null
);

const assertSafeSegment = (value: string, label: string): string => {
  if (!/^[a-zA-Z0-9:_-]{1,128}$/.test(value)) throw new Error(`${label} is invalid.`);
  return value;
};

const executionFields = (identity?: LegacyLibraryMigrationExecutionIdentity): DocumentData => (
  identity ? {
    migrationRunId: identity.migrationRunId,
    migrationRunAttempt: identity.migrationRunAttempt,
  } : {}
);

const assertExecutionIdentity = (
  value: DocumentData | null,
  expected?: LegacyLibraryMigrationExecutionIdentity,
): void => {
  if (!value) return;
  const hasIdentity = value.migrationRunId !== undefined || value.migrationRunAttempt !== undefined;
  if (!hasIdentity && !expected) return;
  if (
    !expected
    || value.migrationRunId !== expected.migrationRunId
    || value.migrationRunAttempt !== expected.migrationRunAttempt
  ) throw new LegacyLibraryExecutionChangedError();
};

const assertRollbackExecutionIdentity = (
  value: DocumentData,
  expected?: LegacyLibraryMigrationExecutionIdentity,
): void => {
  const hasIdentity = value.rollbackMigrationRunId !== undefined
    || value.rollbackMigrationRunAttempt !== undefined;
  if (!hasIdentity) return;
  if (
    !expected
    || value.rollbackMigrationRunId !== expected.migrationRunId
    || value.rollbackMigrationRunAttempt !== expected.migrationRunAttempt
  ) throw new LegacyLibraryExecutionChangedError();
};

export function createLegacyReservationId(normalizedWord: string): string {
  return createHash('sha256').update(normalizedWord).digest('hex');
}

const ownerRef = (database: Firestore, ownerId: string) =>
  database.collection('users').doc(assertSafeSegment(ownerId, 'Owner ID'));
const cardsRef = (database: Firestore, ownerId: string) => ownerRef(database, ownerId).collection('cards');
const reservationRef = (database: Firestore, ownerId: string, normalizedWord: string) =>
  ownerRef(database, ownerId).collection('card_reservations').doc(createLegacyReservationId(normalizedWord));
const libraryStateRef = (database: Firestore, ownerId: string) =>
  ownerRef(database, ownerId).collection('profile').doc('library_state');
const migrationProgressRef = (database: Firestore, ownerId: string) =>
  ownerRef(database, ownerId).collection('profile').doc('query_migration');
const tombstoneRef = (database: Firestore, ownerId: string, cardId: string) =>
  ownerRef(database, ownerId).collection('card_tombstones').doc(assertSafeSegment(cardId, 'Card ID'));
const backupRef = (database: Firestore, ownerId: string, jobId: string) =>
  ownerRef(database, ownerId).collection(BACKUP_COLLECTION).doc(assertSafeSegment(jobId, 'Migration job ID'));

const cardFromSnapshot = (document: { id: string; data(): DocumentData | undefined }): CleanupCard => ({
  ...(document.data() ?? {}),
  id: document.id,
});

const withoutUndefined = (value: CleanupCard): CleanupCard => Object.fromEntries(
  Object.entries(value).filter(([, field]) => field !== undefined),
) as CleanupCard;

const matchingReservation = (cardId: string, normalizedWord: string): LegacyLibraryReservation => ({
  schemaVersion: 1,
  cardId,
  normalizedWord,
});

type OwnerGeneration = { libraryEpoch: number; mutationGeneration: number };
type ActivePhase = Exclude<LegacyLibraryMigrationPhase, 'complete'>;
type StoredMigrationProgress = {
  phase: LegacyLibraryMigrationPhase;
  expectedEpoch: number;
  expectedMutationGeneration: number;
  applyCursor: string | null;
  applyScanned: number;
  verificationCursor: string | null;
  verificationScanned: number;
  preflight: LegacyLibraryMigrationPreflightResult | null;
  complete: boolean;
};

const readPreflightResult = (value: unknown): LegacyLibraryMigrationPreflightResult | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  const scanned = migrationSourceCount(result.scanned);
  const pending = migrationSourceCount(result.pending);
  const merged = migrationSourceCount(result.merged);
  const invalid = migrationSourceCount(result.invalid);
  if (
    scanned === null || pending === null || merged === null || invalid === null
    || pending > scanned || merged > pending || invalid > scanned
    || result.preflightComplete !== true || typeof result.migrationComplete !== 'boolean'
  ) return null;
  return {
    scanned, pending, merged, invalid,
    preflightComplete: true,
    migrationComplete: result.migrationComplete,
  };
};

const ownerGeneration = (snapshot: { exists: boolean; data(): DocumentData | undefined }): OwnerGeneration => ({
  libraryEpoch: snapshot.exists ? safeCounter(snapshot.data()?.libraryEpoch) : 0,
  mutationGeneration: snapshot.exists ? safeCounter(snapshot.data()?.mutationGeneration) : 0,
});

const emptyProgress = (): StoredMigrationProgress => ({
  phase: 'apply',
  expectedEpoch: 0,
  expectedMutationGeneration: 0,
  applyCursor: null,
  applyScanned: 0,
  verificationCursor: null,
  verificationScanned: 0,
  preflight: null,
  complete: false,
});

const readStoredMigrationProgress = (value: unknown, jobId: string): StoredMigrationProgress => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyProgress();
  const progress = value as Record<string, unknown>;
  const phase = progress.phase;
  if (
    progress.migrationVersion !== MIGRATION_VERSION
    || progress.jobId !== jobId
    || (phase !== 'apply' && phase !== 'verify' && phase !== 'complete')
  ) return emptyProgress();
  const complete = phase === 'complete' && progress.complete === true;
  if (phase === 'complete' && !complete) return emptyProgress();
  return {
    phase,
    expectedEpoch: safeCounter(progress.expectedEpoch),
    expectedMutationGeneration: safeCounter(progress.expectedMutationGeneration),
    applyCursor: typeof progress.applyCursor === 'string' ? progress.applyCursor : null,
    applyScanned: safeCounter(progress.applyScanned),
    verificationCursor: typeof progress.verificationCursor === 'string' ? progress.verificationCursor : null,
    verificationScanned: safeCounter(progress.verificationScanned),
    preflight: readPreflightResult(progress.preflight),
    complete,
  };
};

const progressToken = (progress: StoredMigrationProgress): LegacyLibraryMigrationProgressToken => ({
  phase: progress.phase === 'verify' ? 'verify' : 'apply',
  cursor: progress.phase === 'verify' ? progress.verificationCursor : progress.applyCursor,
  scanned: progress.phase === 'verify' ? progress.verificationScanned : progress.applyScanned,
});

const matchesProgress = (
  progress: StoredMigrationProgress,
  expected: LegacyLibraryMigrationProgressToken,
): boolean => {
  if (progress.complete || progress.phase !== expected.phase) return false;
  const token = progressToken(progress);
  return token.cursor === expected.cursor && token.scanned === expected.scanned;
};

const hasMatchingGeneration = (current: OwnerGeneration, expectedEpoch: number, expectedGeneration: number): boolean =>
  current.libraryEpoch === expectedEpoch && current.mutationGeneration === expectedGeneration;

const activeProgressDocument = (
  jobId: string,
  generation: OwnerGeneration,
  next: LegacyLibraryMigrationProgressToken,
  previous?: StoredMigrationProgress,
  executionIdentity?: LegacyLibraryMigrationExecutionIdentity,
): DocumentData => ({
  migrationVersion: MIGRATION_VERSION,
  jobId,
  ...executionFields(executionIdentity),
  phase: next.phase,
  complete: false,
  expectedEpoch: generation.libraryEpoch,
  expectedMutationGeneration: generation.mutationGeneration,
  applyCursor: next.phase === 'apply' ? next.cursor : previous?.applyCursor ?? null,
  applyScanned: next.phase === 'apply' ? next.scanned : previous?.applyScanned ?? 0,
  verificationCursor: next.phase === 'verify' ? next.cursor : null,
  verificationScanned: next.phase === 'verify' ? next.scanned : 0,
  preflight: previous?.preflight ?? null,
  updatedAt: new Date().toISOString(),
});

async function restartForGenerationChange(
  database: Firestore,
  ownerId: string,
  jobId: string,
  executionIdentity?: LegacyLibraryMigrationExecutionIdentity,
  restartCompletedMigration = false,
): Promise<OwnerGeneration> {
  const state = libraryStateRef(database, ownerId);
  const progress = migrationProgressRef(database, ownerId);
  const root = backupRef(database, ownerId, jobId);
  return database.runTransaction(async transaction => {
    const [stateSnapshot, progressSnapshot, rootSnapshot] = await Promise.all([
      transaction.get(state), transaction.get(progress), transaction.get(root),
    ]);
    const current = ownerGeneration(stateSnapshot);
    const progressData = progressSnapshot.exists ? progressSnapshot.data() ?? {} : null;
    const rootData = rootSnapshot.exists ? rootSnapshot.data() ?? {} : null;
    assertExecutionIdentity(progressData, executionIdentity);
    assertExecutionIdentity(rootData, executionIdentity);
    const stored = readStoredMigrationProgress(progressData, jobId);
    if (
      (!restartCompletedMigration && stored.phase === 'complete')
      || (stored.expectedEpoch === current.libraryEpoch
        && stored.expectedMutationGeneration === current.mutationGeneration)
    ) return current;
    transaction.set(progress, activeProgressDocument(jobId, current, {
      phase: 'apply', cursor: null, scanned: 0,
    }, undefined, executionIdentity), { merge: false });
    if (rootSnapshot.exists) {
      transaction.set(root, {
        ...executionFields(executionIdentity),
        libraryEpoch: current.libraryEpoch,
        expectedMutationGeneration: current.mutationGeneration,
        expectedEpoch: current.libraryEpoch,
        rollbackInvalidated: true,
        rollbackInvalidatedAt: Timestamp.now(),
        restartedAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      }, { merge: true });
    }
    return current;
  });
}

async function readPersistedPreflight(
  database: Firestore,
  ownerId: string,
  jobId: string,
  executionIdentity?: LegacyLibraryMigrationExecutionIdentity,
): Promise<LegacyLibraryMigrationPreflightEvidence | null> {
  const [stateSnapshot, progressSnapshot] = await Promise.all([
    libraryStateRef(database, ownerId).get(), migrationProgressRef(database, ownerId).get(),
  ]);
  let generation = ownerGeneration(stateSnapshot);
  const progressData = progressSnapshot.exists ? progressSnapshot.data() ?? {} : null;
  const hasStoredV3Progress = progressData?.migrationVersion === MIGRATION_VERSION
    && progressData.jobId === jobId;
  if (!hasStoredV3Progress) return null;
  assertExecutionIdentity(progressData, executionIdentity);
  const stored = readStoredMigrationProgress(progressData, jobId);
  if (!hasMatchingGeneration(
    generation,
    stored.expectedEpoch,
    stored.expectedMutationGeneration,
  )) {
    generation = await restartForGenerationChange(database, ownerId, jobId, executionIdentity, true);
    return null;
  }
  if (!stored.preflight || !hasMatchingGeneration(
    generation,
    stored.expectedEpoch,
    stored.expectedMutationGeneration,
  )) return null;
  return {
    result: stored.preflight,
    libraryEpoch: generation.libraryEpoch,
    mutationGeneration: generation.mutationGeneration,
  };
}

async function persistPreflight(
  database: Firestore,
  ownerId: string,
  jobId: string,
  evidence: LegacyLibraryMigrationPreflightEvidence,
  executionIdentity?: LegacyLibraryMigrationExecutionIdentity,
): Promise<void> {
  await database.runTransaction(async transaction => {
    const [stateSnapshot, progressSnapshot] = await Promise.all([
      transaction.get(libraryStateRef(database, ownerId)),
      transaction.get(migrationProgressRef(database, ownerId)),
    ]);
    const generation = ownerGeneration(stateSnapshot);
    if (!hasMatchingGeneration(generation, evidence.libraryEpoch, evidence.mutationGeneration)) {
      throw new LegacyLibraryGenerationChangedError();
    }
    const progressData = progressSnapshot.exists ? progressSnapshot.data() ?? {} : null;
    const hasStoredV3Progress = progressData?.migrationVersion === MIGRATION_VERSION
      && progressData.jobId === jobId;
    if (hasStoredV3Progress) assertExecutionIdentity(progressData, executionIdentity);
    const stored = readStoredMigrationProgress(progressData, jobId);
    if (stored.complete) {
      transaction.set(migrationProgressRef(database, ownerId), {
        preflight: evidence.result,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      return;
    }
    if (hasStoredV3Progress && !hasMatchingGeneration(
      generation,
      stored.expectedEpoch,
      stored.expectedMutationGeneration,
    )) throw new LegacyLibraryGenerationChangedError();
    const next = hasStoredV3Progress ? progressToken(stored) : {
      phase: 'apply' as const, cursor: null, scanned: 0,
    };
    transaction.set(migrationProgressRef(database, ownerId), {
      ...activeProgressDocument(jobId, generation, next, hasStoredV3Progress ? stored : undefined, executionIdentity),
      preflight: evidence.result,
    }, { merge: false });
  });
}

async function readOwnerPage(
  database: Firestore,
  ownerId: string,
  options: {
    jobId: string;
    batchSize: number;
    cursor?: string | null;
    scannedBefore?: number;
    phase?: ActivePhase;
  },
  executionIdentity?: LegacyLibraryMigrationExecutionIdentity,
): Promise<LegacyLibraryMigrationPage> {
  const [stateSnapshot, progressSnapshot] = await Promise.all([
    libraryStateRef(database, ownerId).get(), migrationProgressRef(database, ownerId).get(),
  ]);
  let generation = ownerGeneration(stateSnapshot);
  const rawProgress = progressSnapshot.exists ? progressSnapshot.data() ?? {} : null;
  const hasStoredV3Progress = rawProgress?.migrationVersion === MIGRATION_VERSION
    && rawProgress.jobId === options.jobId;
  if (hasStoredV3Progress) assertExecutionIdentity(rawProgress, executionIdentity);
  let stored = readStoredMigrationProgress(rawProgress, options.jobId);

  if (options.cursor === undefined && hasStoredV3Progress && stored.phase !== 'complete' && (
    stored.expectedEpoch !== generation.libraryEpoch
    || stored.expectedMutationGeneration !== generation.mutationGeneration
  )) {
    generation = await restartForGenerationChange(database, ownerId, options.jobId, executionIdentity);
    stored = emptyProgress();
  }

  if (options.cursor === undefined && stored.complete) {
    // Completion was atomically fenced by markComplete. Future normal client
    // mutations cannot recreate legacy cards under the current Rules protocol.
    return {
      libraryEpoch: generation.libraryEpoch,
      mutationGeneration: generation.mutationGeneration,
      phase: 'complete', sourceCards: [], canonicalCards: new Map(), reservations: new Map(),
      progressCursor: null, lastDocumentId: null, hasMore: false, scannedBefore: 0, alreadyComplete: true,
    };
  }

  const phase: ActivePhase = options.cursor === undefined
    ? (stored.phase === 'verify' ? 'verify' : 'apply')
    : options.phase ?? 'apply';
  const cursor = options.cursor === undefined
    ? (phase === 'verify' ? stored.verificationCursor : stored.applyCursor)
    : options.cursor;
  const scannedBefore = options.cursor === undefined
    ? (phase === 'verify' ? stored.verificationScanned : stored.applyScanned)
    : safeCounter(options.scannedBefore);
  const requestedBatchSize = Math.max(1, Math.min(100, Math.floor(options.batchSize)));
  const orderedCards = cardsRef(database, ownerId)
    .orderBy(FieldPath.documentId(), 'asc');
  const cardQuery = cursor ? orderedCards.startAfter(cursor) : orderedCards;
  const cardSnapshot = await cardQuery
    .limit(requestedBatchSize + 1)
    .get();
  const hasMore = cardSnapshot.docs.length > requestedBatchSize;
  const sourceCards = cardSnapshot.docs.slice(0, requestedBatchSize).map(cardFromSnapshot);
  if (scannedBefore + sourceCards.length > MAX_LEGACY_LIBRARY_MIGRATION_SOURCE_CARDS) {
    throw new LegacyLibrarySourceLimitError();
  }
  const normalizedWords = [...new Set(sourceCards.map(card => (
    normalizeCleanupWord(card.normalizedWord) || normalizeCleanupWord(card.word)
  )).filter((word): word is string => Boolean(word)))];
  const sourceIds = new Set(sourceCards.map(card => card.id));
  const canonicalWords = normalizedWords.filter(word => !sourceIds.has(createCanonicalCleanupCardId(word)));
  const canonicalReferences = canonicalWords.map(word => cardsRef(database, ownerId).doc(createCanonicalCleanupCardId(word)));
  const reservationReferences = normalizedWords.map(word => reservationRef(database, ownerId, word));
  const lookups = canonicalReferences.length + reservationReferences.length > 0
    ? await database.getAll(...canonicalReferences, ...reservationReferences) : [];
  const finalGeneration = ownerGeneration(await libraryStateRef(database, ownerId).get());
  if (!hasMatchingGeneration(finalGeneration, generation.libraryEpoch, generation.mutationGeneration)) {
    throw new LegacyLibraryGenerationChangedError();
  }

  return {
    libraryEpoch: generation.libraryEpoch,
    mutationGeneration: generation.mutationGeneration,
    phase,
    sourceCards,
    canonicalCards: new Map(lookups.slice(0, canonicalReferences.length).flatMap((snapshot, index) => (
      snapshot.exists ? [[canonicalWords[index], cardFromSnapshot(snapshot)]] : []
    ))),
    reservations: new Map(lookups.slice(canonicalReferences.length).flatMap((snapshot, index) => (
      snapshot.exists ? [[normalizedWords[index], snapshot.data()]] : []
    ))),
    progressCursor: cursor,
    lastDocumentId: sourceCards.at(-1)?.id ?? cursor,
    hasMore,
    scannedBefore,
    alreadyComplete: false,
  };
}

const assertTransactionState = async (
  database: Firestore,
  ownerId: string,
  jobId: string,
  transaction: Parameters<Firestore['runTransaction']>[0] extends (transaction: infer T) => unknown ? T : never,
  expectedEpoch: number,
  expectedGeneration: number,
  expected: LegacyLibraryMigrationProgressToken,
  executionIdentity?: LegacyLibraryMigrationExecutionIdentity,
): Promise<{
  root: ReturnType<typeof backupRef>;
  rootExists: boolean;
  rootData: DocumentData | null;
}> => {
  const root = backupRef(database, ownerId, jobId);
  const [stateSnapshot, progressSnapshot, rootSnapshot] = await Promise.all([
    transaction.get(libraryStateRef(database, ownerId)),
    transaction.get(migrationProgressRef(database, ownerId)),
    transaction.get(root),
  ]);
  if (!hasMatchingGeneration(ownerGeneration(stateSnapshot), expectedEpoch, expectedGeneration)) {
    throw new LegacyLibraryGenerationChangedError();
  }
  const progressData = progressSnapshot.exists ? progressSnapshot.data() ?? {} : null;
  const rootData = rootSnapshot.exists ? rootSnapshot.data() ?? {} : null;
  if (progressData) assertExecutionIdentity(progressData, executionIdentity);
  if (rootData) assertExecutionIdentity(rootData, executionIdentity);
  const progress = readStoredMigrationProgress(progressData, jobId);
  if (!matchesProgress(progress, expected)) throw new LegacyLibraryGenerationChangedError();
  if (rootSnapshot.exists && (
    safeCounter(rootSnapshot.data()?.libraryEpoch) !== expectedEpoch
    || safeCounter(rootSnapshot.data()?.expectedMutationGeneration) !== expectedGeneration
  )) throw new LegacyLibraryGenerationChangedError();
  return {
    root,
    rootExists: rootSnapshot.exists,
    rootData,
  };
};

async function backupSourceCards(
  database: Firestore, ownerId: string, jobId: string, _cards: CleanupCard[], expectedEpoch: number,
  expectedGeneration: number, expected: LegacyLibraryMigrationProgressToken,
  executionIdentity?: LegacyLibraryMigrationExecutionIdentity,
): Promise<void> {
  await database.runTransaction(async transaction => {
    const { root, rootExists } = await assertTransactionState(
      database, ownerId, jobId, transaction, expectedEpoch, expectedGeneration, expected,
      executionIdentity,
    );
    if (rootExists) return;
    const [progressSnapshot, facetsSnapshot] = await Promise.all([
      transaction.get(migrationProgressRef(database, ownerId)),
      transaction.get(ownerRef(database, ownerId).collection('profile').doc('library_facets')),
    ]);
    transaction.set(root, {
      migrationVersion: MIGRATION_VERSION, ownerScope: 'self', libraryEpoch: expectedEpoch,
      ...executionFields(executionIdentity),
      startedMutationGeneration: expectedGeneration, expectedMutationGeneration: expectedGeneration,
      sourceCount: 0, previousProgress: progressSnapshot.exists ? progressSnapshot.data() : null,
      previousFacets: facetsSnapshot.exists ? facetsSnapshot.data() : null,
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    }, { merge: false });
  });
}

async function applyMigrationPlan(
  database: Firestore, ownerId: string, jobId: string, plan: DuplicateCleanupPlan, expectedEpoch: number,
  expectedGeneration: number, expected: LegacyLibraryMigrationProgressToken,
  executionIdentity?: LegacyLibraryMigrationExecutionIdentity,
): Promise<void> {
  const root = backupRef(database, ownerId, jobId);
  const planBackup = root.collection('plans').doc(createLegacyReservationId(plan.normalizedWord));
  const sourceIds = [...new Set([plan.primaryId, ...plan.loserIds])];
  const sourceReferences = sourceIds.map(cardId => cardsRef(database, ownerId).doc(cardId));
  const sourceBackupReferences = sourceIds.map(cardId => root.collection('sources').doc(assertSafeSegment(cardId, 'Card ID')));
  const identityReservation = reservationRef(database, ownerId, plan.normalizedWord);
  const tombstoneReferences = plan.loserIds.map(cardId => tombstoneRef(database, ownerId, cardId));
  await database.runTransaction(async transaction => {
    const { rootExists, rootData } = await assertTransactionState(
      database, ownerId, jobId, transaction, expectedEpoch, expectedGeneration, expected,
      executionIdentity,
    );
    if (!rootExists || !rootData) throw new LegacyLibraryGenerationChangedError();
    const sourceCount = migrationSourceCount(rootData.sourceCount);
    if (sourceCount === null) throw new LegacyLibrarySourceLimitError();
    const [sourceSnapshots, sourceBackupSnapshots, reservationSnapshot, tombstoneSnapshots, planBackupSnapshot] = await Promise.all([
      transaction.getAll(...sourceReferences), transaction.getAll(...sourceBackupReferences),
      transaction.get(identityReservation),
      tombstoneReferences.length > 0 ? transaction.getAll(...tombstoneReferences) : Promise.resolve([]),
      transaction.get(planBackup),
    ]);
    const existingPlan = planBackupSnapshot.exists ? planBackupSnapshot.data() ?? {} : {};
    const existingSourceIds = Array.isArray(existingPlan.sourceIds)
      ? existingPlan.sourceIds.map(value => assertSafeSegment(String(value), 'Card ID')) : [];
    if (
      planBackupSnapshot.exists
      && Number.isSafeInteger(existingPlan.appliedLibraryEpoch)
      && Number(existingPlan.appliedLibraryEpoch) === expectedEpoch
      && Number.isSafeInteger(existingPlan.appliedMutationGeneration)
      && Number(existingPlan.appliedMutationGeneration) === expectedGeneration
      && sourceIds.every(sourceId => existingSourceIds.includes(sourceId))
    ) return;
    const liveCards = sourceSnapshots.filter(snapshot => snapshot.exists).map(cardFromSnapshot);
    if (liveCards.length === 0) return;
    const livePlan = planLegacyIdentityGroup(liveCards, { jobId, libraryEpoch: expectedEpoch });
    if (livePlan.normalizedWord !== plan.normalizedWord || (
      planBackupSnapshot.exists && existingPlan.primaryId !== livePlan.primaryId
    )) throw new Error('Card identity changed while the Admin migration was running.');
    const now = new Date().toISOString();
    const plannedTombstones = new Map(plan.loserIds.map((cardId, index) => [
      cardId, { reference: tombstoneReferences[index], snapshot: tombstoneSnapshots[index] },
    ]));
    const existingTombstones = Array.isArray(existingPlan.beforeTombstones)
      ? existingPlan.beforeTombstones as Array<{ cardId?: unknown; data?: unknown }> : [];
    const recordedTombstones = new Map(existingTombstones.flatMap(tombstone => {
      const cardId = typeof tombstone.cardId === 'string' ? tombstone.cardId : '';
      return cardId ? [[cardId, tombstone]] : [];
    }));
    for (const [index, loserId] of plan.loserIds.entries()) {
      if (!recordedTombstones.has(loserId)) recordedTombstones.set(loserId, {
        cardId: loserId, data: tombstoneSnapshots[index]?.exists ? tombstoneSnapshots[index].data() : null,
      });
    }
    const existingPostApplyTombstones = Array.isArray(existingPlan.afterTombstones)
      ? existingPlan.afterTombstones as Array<{ cardId?: unknown; data?: unknown }> : [];
    const recordedPostApplyTombstones = new Map(existingPostApplyTombstones.flatMap(tombstone => {
      const cardId = typeof tombstone.cardId === 'string' ? tombstone.cardId : '';
      return cardId ? [[cardId, tombstone]] : [];
    }));
    const postApplyTombstones = livePlan.loserIds.map((loserId, index) => {
      const plannedTombstone = plannedTombstones.get(loserId);
      if (!plannedTombstone) throw new Error('A new duplicate source appeared while the Admin migration was running.');
      const previousRevision = plannedTombstone.snapshot?.exists
        ? safeCounter(plannedTombstone.snapshot.data()?.revision) : 0;
      const sourceRevision = safeCounter(liveCards.find(card => card.id === loserId)?.revision);
      const data = {
        ...livePlan.tombstones[index], revision: Math.max(previousRevision, sourceRevision) + 1, deletedAt: now,
      };
      const recorded = { cardId: loserId, data };
      recordedPostApplyTombstones.set(loserId, recorded);
      return { reference: plannedTombstone.reference, ...recorded };
    });
    const missingSourceBackups = sourceSnapshots.flatMap((snapshot, index) => (
      snapshot.exists && !sourceBackupSnapshots[index]?.exists && !existingSourceIds.includes(snapshot.id)
        ? [{ card: cardFromSnapshot(snapshot), reference: sourceBackupReferences[index] }] : []
    ));
    if (sourceCount + missingSourceBackups.length > MAX_AUTOMATIC_ROLLBACK_SOURCE_CARDS) {
      throw new LegacyLibrarySourceLimitError();
    }
    for (const backup of missingSourceBackups) transaction.set(backup.reference, {
      sourceId: backup.card.id, source: withoutUndefined(backup.card), capturedAt: Timestamp.now(),
    }, { merge: false });
    if (missingSourceBackups.length > 0) transaction.set(root, {
      sourceCount: FieldValue.increment(missingSourceBackups.length), updatedAt: Timestamp.now(),
    }, { merge: true });
    transaction.set(planBackup, {
      normalizedWord: livePlan.normalizedWord, primaryId: livePlan.primaryId,
      sourceIds: [...new Set([...existingSourceIds, ...sourceIds])],
      loserIds: [...new Set([...(Array.isArray(existingPlan.loserIds) ? existingPlan.loserIds : []), ...plan.loserIds])],
      appliedLibraryEpoch: expectedEpoch,
      appliedMutationGeneration: expectedGeneration,
      appliedRevision: livePlan.merged.revision,
      beforeReservation: planBackupSnapshot.exists ? existingPlan.beforeReservation ?? null
        : reservationSnapshot.exists ? reservationSnapshot.data() : null,
      beforeTombstones: [...recordedTombstones.values()],
      afterTombstones: [...recordedPostApplyTombstones.values()],
      ...(planBackupSnapshot.exists ? {} : { capturedAt: Timestamp.now() }), updatedAt: Timestamp.now(),
    }, { merge: false });
    transaction.set(cardsRef(database, ownerId).doc(livePlan.primaryId), {
      ...withoutUndefined(livePlan.merged), updatedAt: FieldValue.serverTimestamp(),
    }, { merge: false });
    if (!reservationSnapshot.exists || reservationSnapshot.data()?.cardId !== livePlan.primaryId
      || reservationSnapshot.data()?.normalizedWord !== livePlan.normalizedWord) {
      transaction.set(identityReservation, matchingReservation(livePlan.primaryId, livePlan.normalizedWord), { merge: false });
    }
    for (const tombstone of postApplyTombstones) {
      transaction.set(tombstone.reference, tombstone.data, { merge: false });
      transaction.delete(cardsRef(database, ownerId).doc(tombstone.cardId));
    }
  });
}

async function advanceMigrationProgress(
  database: Firestore, ownerId: string, jobId: string, expectedEpoch: number, expectedGeneration: number,
  expected: LegacyLibraryMigrationProgressToken, next: LegacyLibraryMigrationProgressToken,
  executionIdentity?: LegacyLibraryMigrationExecutionIdentity,
): Promise<void> {
  await database.runTransaction(async transaction => {
    const { root, rootExists } = await assertTransactionState(
      database, ownerId, jobId, transaction, expectedEpoch, expectedGeneration, expected,
      executionIdentity,
    );
    const currentSnapshot = await transaction.get(migrationProgressRef(database, ownerId));
    const current = readStoredMigrationProgress(currentSnapshot.exists ? currentSnapshot.data() : null, jobId);
    transaction.set(migrationProgressRef(database, ownerId), activeProgressDocument(
      jobId,
      { libraryEpoch: expectedEpoch, mutationGeneration: expectedGeneration },
      next,
      current,
      executionIdentity,
    ), { merge: false });
    if (rootExists) transaction.set(root, { updatedAt: Timestamp.now() }, { merge: true });
  });
}

async function markMigrationComplete(
  database: Firestore, ownerId: string, jobId: string, expectedEpoch: number, expectedGeneration: number,
  expected: LegacyLibraryMigrationProgressToken,
  executionIdentity?: LegacyLibraryMigrationExecutionIdentity,
): Promise<void> {
  await database.runTransaction(async transaction => {
    const { root, rootExists } = await assertTransactionState(
      database, ownerId, jobId, transaction, expectedEpoch, expectedGeneration, expected,
      executionIdentity,
    );
    if (!rootExists) throw new LegacyLibraryGenerationChangedError();
    const currentSnapshot = await transaction.get(migrationProgressRef(database, ownerId));
    const current = readStoredMigrationProgress(currentSnapshot.exists ? currentSnapshot.data() : null, jobId);
    transaction.set(migrationProgressRef(database, ownerId), {
      ...activeProgressDocument(
        jobId,
        { libraryEpoch: expectedEpoch, mutationGeneration: expectedGeneration },
        expected,
        current,
        executionIdentity,
      ),
      phase: 'complete', complete: true, completedMutationGeneration: expectedGeneration,
    }, { merge: false });
    transaction.set(ownerRef(database, ownerId).collection('profile').doc('library_facets'), {
      categories: {}, complete: false, version: 1, updatedAt: new Date().toISOString(),
    }, { merge: false });
    transaction.set(root, {
      completedAt: Timestamp.now(), completedMutationGeneration: expectedGeneration, updatedAt: Timestamp.now(),
    }, { merge: true });
  });
}

export function createFirestoreLegacyLibraryMigrationStore(
  database: Firestore,
  executionIdentity?: LegacyLibraryMigrationExecutionIdentity,
): LegacyLibraryMigrationStore {
  return {
    readPage: (ownerId, options) => readOwnerPage(database, ownerId, options, executionIdentity),
    readPreflight: (ownerId, jobId) => readPersistedPreflight(database, ownerId, jobId, executionIdentity),
    storePreflight: (ownerId, jobId, evidence) => persistPreflight(
      database, ownerId, jobId, evidence, executionIdentity,
    ),
    backup: (ownerId, jobId, cards, epoch, generation, expected) => backupSourceCards(
      database, ownerId, jobId, cards, epoch, generation, expected, executionIdentity,
    ),
    apply: (ownerId, jobId, plan, epoch, generation, expected) => applyMigrationPlan(
      database, ownerId, jobId, plan, epoch, generation, expected, executionIdentity,
    ),
    advanceProgress: (ownerId, jobId, epoch, generation, expected, next) => advanceMigrationProgress(
      database, ownerId, jobId, epoch, generation, expected, next, executionIdentity,
    ),
    markComplete: (ownerId, jobId, epoch, generation, expected) => markMigrationComplete(
      database, ownerId, jobId, epoch, generation, expected, executionIdentity,
    ),
  };
}

type ProfileDocumentWriter = {
  set(
    reference: ReturnType<typeof migrationProgressRef>,
    value: DocumentData,
    options: { merge: boolean },
  ): unknown;
  delete(reference: ReturnType<typeof migrationProgressRef>): unknown;
};

const restoreProfileDocument = (
  batch: ProfileDocumentWriter,
  reference: ReturnType<typeof migrationProgressRef>,
  value: unknown,
): void => {
  if (value && typeof value === 'object' && !Array.isArray(value)) batch.set(reference, value as DocumentData, { merge: false });
  else batch.delete(reference);
};

type RollbackPlan = {
  plan: DocumentData;
  primaryId: string;
  normalizedWord: string;
  sourceIds: string[];
  loserIds: string[];
  recordedIds: string[];
  references: Array<ReturnType<ReturnType<typeof cardsRef>['doc']>>;
  beforeTombstones: Array<{ cardId?: unknown; data?: unknown }>;
  expectedTombstones: Map<string, DocumentData>;
  tombstoneReferences: ReturnType<typeof tombstoneRef>[];
};

const parseRollbackPlan = (database: Firestore, ownerId: string, plan: DocumentData): RollbackPlan => {
  const primaryId = assertSafeSegment(String(plan.primaryId ?? ''), 'Card ID');
  const normalizedWord = String(plan.normalizedWord ?? '');
  const sourceIds = Array.isArray(plan.sourceIds)
    ? plan.sourceIds.map(value => assertSafeSegment(String(value), 'Card ID')) : [];
  const loserIds = Array.isArray(plan.loserIds)
    ? plan.loserIds.map(value => assertSafeSegment(String(value), 'Card ID')) : [];
  const expectedTombstones = new Map((Array.isArray(plan.afterTombstones)
    ? plan.afterTombstones as Array<{ cardId?: unknown; data?: unknown }> : []
  ).map(tombstone => {
    const cardId = assertSafeSegment(String(tombstone.cardId ?? ''), 'Card ID');
    if (!tombstone.data || typeof tombstone.data !== 'object' || Array.isArray(tombstone.data)) {
      throw new Error('Migration rollback tombstone backup is invalid.');
    }
    return [cardId, tombstone.data as DocumentData];
  }));
  const beforeTombstones = Array.isArray(plan.beforeTombstones)
    ? plan.beforeTombstones as Array<{ cardId?: unknown; data?: unknown }> : [];
  const beforeTombstoneIds = beforeTombstones.map(tombstone => (
    assertSafeSegment(String(tombstone.cardId ?? ''), 'Card ID')
  ));
  if (
    expectedTombstones.size !== loserIds.length
    || new Set(loserIds).size !== loserIds.length
    || loserIds.some(cardId => !expectedTombstones.has(cardId))
    || beforeTombstoneIds.length !== loserIds.length
    || new Set(beforeTombstoneIds).size !== beforeTombstoneIds.length
    || beforeTombstoneIds.some(cardId => !expectedTombstones.has(cardId))
  ) throw new Error('Migration rollback tombstone backup is inconsistent.');
  const recordedIds = [...new Set([primaryId, ...sourceIds])];
  return {
    plan,
    primaryId,
    normalizedWord,
    sourceIds,
    loserIds,
    recordedIds,
    references: recordedIds.map(cardId => cardsRef(database, ownerId).doc(cardId)),
    beforeTombstones,
    expectedTombstones,
    tombstoneReferences: loserIds.map(cardId => tombstoneRef(database, ownerId, cardId)),
  };
};

const assertRollbackPlanLive = async (
  database: Firestore,
  ownerId: string,
  transaction: Transaction,
  rollbackPlan: RollbackPlan,
  expectedEpoch: number,
  completedGeneration: number,
): Promise<void> => {
  const [liveState, liveSources, liveTombstones] = await Promise.all([
    transaction.get(libraryStateRef(database, ownerId)),
    transaction.getAll(...rollbackPlan.references),
    rollbackPlan.tombstoneReferences.length > 0
      ? transaction.getAll(...rollbackPlan.tombstoneReferences) : Promise.resolve([]),
  ]);
  if (!hasMatchingGeneration(ownerGeneration(liveState), expectedEpoch, completedGeneration)) {
    throw new LegacyLibraryGenerationChangedError();
  }
  const byId = new Map(liveSources.map(snapshot => [snapshot.id, snapshot]));
  if (rollbackPlan.recordedIds.some(sourceId => sourceId !== rollbackPlan.primaryId && byId.get(sourceId)?.exists)) {
    throw new Error('A removed source ID was recreated after migration; automatic rollback was refused.');
  }
  const primary = byId.get(rollbackPlan.primaryId);
  if (!primary?.exists || safeCounter(primary.data()?.revision) !== safeCounter(rollbackPlan.plan['appliedRevision'])) {
    throw new Error('A migrated card changed after apply; automatic rollback was refused.');
  }
  if (liveTombstones.some((snapshot, index) => (
    !snapshot.exists || !isDeepStrictEqual(snapshot.data(), rollbackPlan.expectedTombstones.get(rollbackPlan.loserIds[index]))
 ))) throw new Error('A migration tombstone changed after apply; automatic rollback was refused.');
};

export async function rollbackLegacyLibraryMigration(
  database: Firestore,
  ownerId: string,
  jobId: string,
  executionIdentity?: LegacyLibraryMigrationExecutionIdentity,
): Promise<void> {
  const root = backupRef(database, ownerId, jobId);
  const [rootSnapshot, sourceSnapshot, planSnapshot, stateSnapshot] = await Promise.all([
    root.get(),
    root.collection('sources').limit(MAX_AUTOMATIC_ROLLBACK_SOURCE_CARDS + 1).get(),
    root.collection('plans').limit(MAX_AUTOMATIC_ROLLBACK_SOURCE_CARDS + 1).get(),
    libraryStateRef(database, ownerId).get(),
  ]);
  if (!rootSnapshot.exists) throw new Error('Migration rollback snapshot does not exist.');
  const rootData = rootSnapshot.data() ?? {};
  assertRollbackExecutionIdentity(rootData, executionIdentity);
  const sourceCount = migrationSourceCount(rootData.sourceCount);
  if (
    rootData.migrationVersion !== MIGRATION_VERSION
    || !Number.isSafeInteger(rootData.completedMutationGeneration)
    || Number(rootData.completedMutationGeneration) < 0
  ) throw new Error('Migration rollback requires a completed v3 migration snapshot.');
  if (
    sourceCount === null
    || sourceCount > MAX_AUTOMATIC_ROLLBACK_SOURCE_CARDS
    || sourceSnapshot.size !== sourceCount
    || sourceSnapshot.size > MAX_AUTOMATIC_ROLLBACK_SOURCE_CARDS
    || planSnapshot.size > sourceCount
  ) throw new LegacyLibrarySourceLimitError();
  if (rootData.rollbackInvalidated === true) {
    throw new Error('Migration rollback was invalidated by a generation restart.');
  }
  const expectedEpoch = safeCounter(rootData.libraryEpoch);
  const completedGeneration = Number(rootData.completedMutationGeneration);
  const currentGeneration = ownerGeneration(stateSnapshot);
  if (!hasMatchingGeneration(currentGeneration, expectedEpoch, completedGeneration)) {
    throw new LegacyLibraryGenerationChangedError();
  }
  const rollbackPlans = planSnapshot.docs.map(document => parseRollbackPlan(database, ownerId, document.data()));
  const sourceBackupReferences = sourceSnapshot.docs.map(document => root.collection('sources').doc(document.id));
  await database.runTransaction(async transaction => {
    const [liveState, liveRoot, liveSourceSnapshots] = await Promise.all([
      transaction.get(libraryStateRef(database, ownerId)),
      transaction.get(root),
      sourceBackupReferences.length > 0
        ? transaction.getAll(...sourceBackupReferences)
        : Promise.resolve([]),
    ]);
    const liveRootData = liveRoot.exists ? liveRoot.data() ?? {} : {};
    assertRollbackExecutionIdentity(liveRootData, executionIdentity);
    if (
      liveRootData.migrationVersion !== MIGRATION_VERSION
      || liveRootData.rollbackInvalidated === true
      || migrationSourceCount(liveRootData.sourceCount) !== sourceCount
      || !Number.isSafeInteger(liveRootData.completedMutationGeneration)
      || Number(liveRootData.completedMutationGeneration) !== completedGeneration
      || !hasMatchingGeneration(ownerGeneration(liveState), expectedEpoch, completedGeneration)
    ) throw new LegacyLibraryGenerationChangedError();
    if (liveSourceSnapshots.length !== sourceCount) throw new LegacyLibrarySourceLimitError();
    const sources = new Map(liveSourceSnapshots.map(document => {
      const data = document.data();
      const source = data?.source;
      if (
        !document.exists
        || data?.sourceId !== document.id
        || !source
        || typeof source !== 'object'
        || Array.isArray(source)
      ) throw new Error('Migration rollback source backup is inconsistent.');
      return [document.id, source as DocumentData];
    }));
    for (const rollbackPlan of rollbackPlans) {
      await assertRollbackPlanLive(
        database, ownerId, transaction, rollbackPlan, expectedEpoch, completedGeneration,
      );
    }
    for (const [sourceId, source] of sources) {
      transaction.set(cardsRef(database, ownerId).doc(sourceId), source, { merge: false });
    }
    for (const rollbackPlan of rollbackPlans) {
      if (!sources.has(rollbackPlan.primaryId)) transaction.delete(cardsRef(database, ownerId).doc(rollbackPlan.primaryId));
      const reservation = reservationRef(database, ownerId, rollbackPlan.normalizedWord);
      if (rollbackPlan.plan.beforeReservation && typeof rollbackPlan.plan.beforeReservation === 'object') {
        transaction.set(reservation, rollbackPlan.plan.beforeReservation, { merge: false });
      } else transaction.delete(reservation);
      for (const previous of rollbackPlan.beforeTombstones) {
        const cardId = assertSafeSegment(String(previous.cardId ?? ''), 'Card ID');
        if (previous.data && typeof previous.data === 'object') transaction.set(tombstoneRef(database, ownerId, cardId), previous.data, { merge: false });
        else transaction.delete(tombstoneRef(database, ownerId, cardId));
      }
    }
    restoreProfileDocument(transaction, migrationProgressRef(database, ownerId), rootData.previousProgress);
    restoreProfileDocument(
      transaction,
      ownerRef(database, ownerId).collection('profile').doc('library_facets'),
      rootData.previousFacets,
    );
    transaction.set(root, {
      rolledBackAt: Timestamp.now(),
      ...(executionIdentity ? {
        rollbackMigrationRunId: executionIdentity.migrationRunId,
        rollbackMigrationRunAttempt: executionIdentity.migrationRunAttempt,
      } : {}),
    }, { merge: true });
  });
}
