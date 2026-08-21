import { createHash } from 'node:crypto';
import {
  FieldValue,
  FieldPath,
  Timestamp,
  type DocumentData,
  type Firestore,
} from 'firebase-admin/firestore';
import {
  createCanonicalCleanupCardId,
  normalizeCleanupWord,
  planLegacyIdentityGroup,
  summarizeFacetCounts,
  type CleanupCard,
  type DuplicateCleanupPlan,
} from './duplicateCleanup.js';
import type {
  LegacyLibraryMigrationStore,
  LegacyLibraryMigrationReadOptions,
  LegacyLibraryReservation,
  LegacyLibrarySnapshot,
} from './legacyLibraryMigration.js';

const MIGRATION_VERSION = 2;
const BACKUP_COLLECTION = 'admin_library_migration_backups';
const MAX_BACKUP_WRITES = 400;

export class LegacyLibraryGenerationChangedError extends Error {
  constructor() {
    super('Library changed generation while the Admin migration was running.');
    this.name = 'LegacyLibraryGenerationChangedError';
  }
}

const safeCounter = (value: unknown): number =>
  Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;

const assertSafeSegment = (value: string, label: string): string => {
  if (!/^[a-zA-Z0-9:_-]{1,128}$/.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
};

export function createLegacyReservationId(normalizedWord: string): string {
  return createHash('sha256').update(normalizedWord).digest('hex');
}

const ownerRef = (database: Firestore, ownerId: string) =>
  database.collection('users').doc(assertSafeSegment(ownerId, 'Owner ID'));

const cardsRef = (database: Firestore, ownerId: string) =>
  ownerRef(database, ownerId).collection('cards');

const reservationRef = (database: Firestore, ownerId: string, normalizedWord: string) =>
  ownerRef(database, ownerId)
    .collection('card_reservations')
    .doc(createLegacyReservationId(normalizedWord));

const libraryStateRef = (database: Firestore, ownerId: string) =>
  ownerRef(database, ownerId).collection('profile').doc('library_state');

const migrationProgressRef = (database: Firestore, ownerId: string) =>
  ownerRef(database, ownerId).collection('profile').doc('query_migration');

const tombstoneRef = (database: Firestore, ownerId: string, cardId: string) =>
  ownerRef(database, ownerId)
    .collection('card_tombstones')
    .doc(assertSafeSegment(cardId, 'Card ID'));

const backupRef = (database: Firestore, ownerId: string, jobId: string) =>
  ownerRef(database, ownerId)
    .collection(BACKUP_COLLECTION)
    .doc(assertSafeSegment(jobId, 'Migration job ID'));

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

async function readOwnerSnapshot(
  database: Firestore,
  ownerId: string,
  options: LegacyLibraryMigrationReadOptions = { jobId: 'query-v2', batchSize: 100 },
): Promise<LegacyLibrarySnapshot> {
  const pageSize = Math.max(1, Math.min(100, Math.floor(options.batchSize)));
  const [stateSnapshot, progressSnapshot, countSnapshot] = await Promise.all([
    libraryStateRef(database, ownerId).get(),
    migrationProgressRef(database, ownerId).get(),
    cardsRef(database, ownerId).count().get(),
  ]);
  const libraryEpoch = stateSnapshot.exists
    ? safeCounter(stateSnapshot.data()?.libraryEpoch)
    : 0;
  const progress = progressSnapshot.data();
  const ownsProgress = progress?.migrationVersion === MIGRATION_VERSION
    && progress?.jobId === options.jobId;
  const hasExplicitCursor = Object.prototype.hasOwnProperty.call(options, 'cursor');
  if (!hasExplicitCursor && ownsProgress && progress?.complete === true) {
    return {
      libraryEpoch,
      cards: [],
      reservations: new Map(),
      phase: 'complete',
      initialCardCount: safeCounter(countSnapshot.data().count),
      scannedCardCount: 0,
    };
  }
  const phase = !hasExplicitCursor && ownsProgress && progress?.phase === 'facets'
    ? 'facets'
    : 'migration';
  const cursor = hasExplicitCursor ? options.cursor : progress?.lastDocumentId;
  const lastDocumentId = typeof cursor === 'string'
    && /^[a-zA-Z0-9:_-]{1,128}$/.test(cursor)
    ? cursor
    : null;
  let query = cardsRef(database, ownerId)
    .orderBy(FieldPath.documentId())
    .limit(pageSize + 1);
  if (lastDocumentId) query = query.startAfter(lastDocumentId);
  const cardSnapshot = await query.get();
  const pageDocuments = cardSnapshot.docs.slice(0, pageSize);
  const cards = pageDocuments.map(cardFromSnapshot);
  const snapshot = {
    libraryEpoch,
    cards,
    reservations: new Map<string, unknown>(),
    phase,
    hasMore: cardSnapshot.size > pageSize,
    nextDocumentId: pageDocuments.at(-1)?.id ?? null,
    initialCardCount: safeCounter(countSnapshot.data().count),
    scannedCardCount: cards.length,
  } satisfies LegacyLibrarySnapshot;
  if (phase === 'facets') return snapshot;
  const normalizedWords = [...new Set(cards.map(card => (
    normalizeCleanupWord(card.normalizedWord) || normalizeCleanupWord(card.word)
  )).filter(Boolean))];
  const references = normalizedWords.flatMap(word => [
    reservationRef(database, ownerId, word),
    cardsRef(database, ownerId).doc(createCanonicalCleanupCardId(word)),
  ]);
  const snapshots = references.length > 0 ? await database.getAll(...references) : [];
  for (const [index, word] of normalizedWords.entries()) {
    const reservation = snapshots[index * 2];
    const canonical = snapshots[index * 2 + 1];
    if (reservation?.exists) snapshot.reservations.set(word, reservation.data());
    if (canonical?.exists && !cards.some(card => card.id === canonical.id)) {
      cards.push(cardFromSnapshot(canonical));
    }
  }
  return snapshot;
}

async function backupSourceCards(
  database: Firestore,
  ownerId: string,
  jobId: string,
  cards: CleanupCard[],
  expectedEpoch: number,
  initialCardCount: number,
): Promise<void> {
  const root = backupRef(database, ownerId, jobId);
  for (let offset = 0; offset < cards.length; offset += MAX_BACKUP_WRITES) {
    const batch = database.batch();
    for (const card of cards.slice(offset, offset + MAX_BACKUP_WRITES)) {
      batch.set(root.collection('sources').doc(assertSafeSegment(card.id, 'Card ID')), {
        sourceId: card.id,
        source: withoutUndefined(card),
        capturedAt: Timestamp.now(),
      }, { merge: false });
    }
    await batch.commit();
  }
  await database.runTransaction(async transaction => {
    const [rootSnapshot, stateSnapshot, progressSnapshot, facetsSnapshot] = await Promise.all([
      transaction.get(root),
      transaction.get(libraryStateRef(database, ownerId)),
      transaction.get(migrationProgressRef(database, ownerId)),
      transaction.get(ownerRef(database, ownerId).collection('profile').doc('library_facets')),
    ]);
    const currentEpoch = stateSnapshot.exists
      ? safeCounter(stateSnapshot.data()?.libraryEpoch)
      : 0;
    if (currentEpoch !== expectedEpoch) throw new LegacyLibraryGenerationChangedError();
    if (rootSnapshot.exists) {
      if (safeCounter(rootSnapshot.data()?.libraryEpoch) !== expectedEpoch) {
        throw new LegacyLibraryGenerationChangedError();
      }
      transaction.set(root, {
        sourceCount: FieldValue.increment(cards.length),
        updatedAt: Timestamp.now(),
      }, { merge: true });
      return;
    }
    transaction.set(root, {
      migrationVersion: MIGRATION_VERSION,
      ownerScope: 'self',
      libraryEpoch: expectedEpoch,
      initialCardCount,
      sourceCount: cards.length,
      previousProgress: progressSnapshot.exists ? progressSnapshot.data() : null,
      previousFacets: facetsSnapshot.exists ? facetsSnapshot.data() : null,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    }, { merge: false });
  });
}

async function applyMigrationPlan(
  database: Firestore,
  ownerId: string,
  jobId: string,
  plan: DuplicateCleanupPlan,
  expectedEpoch: number,
): Promise<void> {
  const planBackup = backupRef(database, ownerId, jobId)
    .collection('plans')
    .doc(createLegacyReservationId(plan.normalizedWord));
  const sourceIds = [...new Set([plan.primaryId, ...plan.loserIds])];
  const sourceReferences = sourceIds.map(cardId => cardsRef(database, ownerId).doc(cardId));
  const identityReservation = reservationRef(database, ownerId, plan.normalizedWord);
  const tombstoneReferences = plan.loserIds.map(cardId => tombstoneRef(database, ownerId, cardId));
  await database.runTransaction(async transaction => {
    const [stateSnapshot, sourceSnapshots, reservationSnapshot, tombstoneSnapshots, planBackupSnapshot] = await Promise.all([
      transaction.get(libraryStateRef(database, ownerId)),
      transaction.getAll(...sourceReferences),
      transaction.get(identityReservation),
      tombstoneReferences.length > 0 ? transaction.getAll(...tombstoneReferences) : Promise.resolve([]),
      transaction.get(planBackup),
    ]);
    const currentEpoch = stateSnapshot.exists
      ? safeCounter(stateSnapshot.data()?.libraryEpoch)
      : 0;
    if (currentEpoch !== expectedEpoch) {
      throw new LegacyLibraryGenerationChangedError();
    }
    const liveCards = sourceSnapshots.filter(snapshot => snapshot.exists).map(cardFromSnapshot);
    if (liveCards.length === 0) return;
    const livePlan = planLegacyIdentityGroup(liveCards, {
      jobId,
      libraryEpoch: currentEpoch,
    });
    if (livePlan.normalizedWord !== plan.normalizedWord) {
      throw new Error('Card identity changed while the Admin migration was running.');
    }
    const now = new Date().toISOString();
    const plannedTombstones = new Map(plan.loserIds.map((cardId, index) => [
      cardId,
      { reference: tombstoneReferences[index], snapshot: tombstoneSnapshots[index] },
    ]));
    const canonicalReference = cardsRef(database, ownerId).doc(livePlan.primaryId);
    if (!planBackupSnapshot.exists) {
      transaction.set(planBackup, {
        normalizedWord: livePlan.normalizedWord,
        primaryId: livePlan.primaryId,
        sourceIds,
        loserIds: plan.loserIds,
        appliedRevision: livePlan.merged.revision,
        beforeReservation: reservationSnapshot.exists ? reservationSnapshot.data() : null,
        beforeTombstones: plan.loserIds.map((cardId, index) => ({
          cardId,
          data: tombstoneSnapshots[index]?.exists ? tombstoneSnapshots[index].data() : null,
        })),
        capturedAt: Timestamp.now(),
      }, { merge: false });
    }
    transaction.set(canonicalReference, {
      ...withoutUndefined(livePlan.merged),
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: false });
    if (
      !reservationSnapshot.exists
      || reservationSnapshot.data()?.cardId !== livePlan.primaryId
      || reservationSnapshot.data()?.normalizedWord !== livePlan.normalizedWord
    ) {
      transaction.set(
        identityReservation,
        matchingReservation(livePlan.primaryId, livePlan.normalizedWord),
        { merge: false },
      );
    }
    for (const [index, loserId] of livePlan.loserIds.entries()) {
      const plannedTombstone = plannedTombstones.get(loserId);
      if (!plannedTombstone) {
        throw new Error('A new duplicate source appeared while the Admin migration was running.');
      }
      const previousRevision = plannedTombstone.snapshot?.exists
        ? safeCounter(plannedTombstone.snapshot.data()?.revision)
        : 0;
      const sourceRevision = safeCounter(liveCards.find(card => card.id === loserId)?.revision);
      transaction.set(plannedTombstone.reference, {
        ...livePlan.tombstones[index],
        revision: Math.max(previousRevision, sourceRevision) + 1,
        deletedAt: now,
      }, { merge: false });
      transaction.delete(cardsRef(database, ownerId).doc(loserId));
    }
  });
}

export function createFirestoreLegacyLibraryMigrationStore(
  database: Firestore,
): LegacyLibraryMigrationStore {
  return {
    read: (ownerId, options) => readOwnerSnapshot(database, ownerId, options),
    backup: (ownerId, jobId, cards, expectedEpoch, initialCardCount) => backupSourceCards(
      database,
      ownerId,
      jobId,
      cards,
      expectedEpoch,
      initialCardCount,
    ),
    apply: (ownerId, jobId, plan, expectedEpoch) => applyMigrationPlan(
      database,
      ownerId,
      jobId,
      plan,
      expectedEpoch,
    ),
    advanceMigration: async (ownerId, jobId, expectedEpoch, nextDocumentId) => {
      await database.runTransaction(async transaction => {
        const stateSnapshot = await transaction.get(libraryStateRef(database, ownerId));
        const currentEpoch = stateSnapshot.exists
          ? safeCounter(stateSnapshot.data()?.libraryEpoch)
          : 0;
        if (currentEpoch !== expectedEpoch) throw new LegacyLibraryGenerationChangedError();
        transaction.set(migrationProgressRef(database, ownerId), {
          migrationVersion: MIGRATION_VERSION,
          jobId,
          phase: 'migration',
          complete: false,
          lastDocumentId: nextDocumentId,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      });
    },
    beginFacetRebuild: async (ownerId, jobId, expectedEpoch) => {
      await database.runTransaction(async transaction => {
        const stateSnapshot = await transaction.get(libraryStateRef(database, ownerId));
        const currentEpoch = stateSnapshot.exists
          ? safeCounter(stateSnapshot.data()?.libraryEpoch)
          : 0;
        if (currentEpoch !== expectedEpoch) throw new LegacyLibraryGenerationChangedError();
        transaction.set(migrationProgressRef(database, ownerId), {
          migrationVersion: MIGRATION_VERSION,
          jobId,
          phase: 'facets',
          complete: false,
          lastDocumentId: null,
          categories: {},
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      });
    },
    advanceFacetRebuild: async (ownerId, jobId, expectedEpoch, nextDocumentId, cards) => {
      const pageCategories = summarizeFacetCounts(cards);
      await database.runTransaction(async transaction => {
        const [stateSnapshot, progressSnapshot] = await Promise.all([
          transaction.get(libraryStateRef(database, ownerId)),
          transaction.get(migrationProgressRef(database, ownerId)),
        ]);
        const currentEpoch = stateSnapshot.exists
          ? safeCounter(stateSnapshot.data()?.libraryEpoch)
          : 0;
        if (currentEpoch !== expectedEpoch) throw new LegacyLibraryGenerationChangedError();
        const previous = progressSnapshot.data()?.categories;
        const categories = previous && typeof previous === 'object' && !Array.isArray(previous)
          ? Object.fromEntries(Object.entries(previous).flatMap(([category, count]) => (
            Number.isSafeInteger(count) && Number(count) >= 0 ? [[category, Number(count)]] : []
          ))) as Record<string, number>
          : {};
        for (const [category, count] of Object.entries(pageCategories)) {
          categories[category] = (categories[category] ?? 0) + count;
        }
        if (Object.keys(categories).length > 500) {
          throw new Error('Facet rebuild exceeded 500 distinct categories.');
        }
        transaction.set(migrationProgressRef(database, ownerId), {
          migrationVersion: MIGRATION_VERSION,
          jobId,
          phase: 'facets',
          complete: false,
          lastDocumentId: nextDocumentId,
          categories,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
      });
    },
    markComplete: async (ownerId, jobId) => {
      const [progressSnapshot, countSnapshot] = await Promise.all([
        migrationProgressRef(database, ownerId).get(),
        cardsRef(database, ownerId).count().get(),
      ]);
      const progress = progressSnapshot.data() ?? {};
      const categories = progress.categories && typeof progress.categories === 'object'
        && !Array.isArray(progress.categories)
        ? progress.categories
        : {};
      const batch = database.batch();
      batch.set(migrationProgressRef(database, ownerId), {
        migrationVersion: MIGRATION_VERSION,
        jobId,
        phase: 'complete',
        complete: true,
        scanned: safeCounter(countSnapshot.data().count),
        lastDocumentId: null,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      batch.set(ownerRef(database, ownerId).collection('profile').doc('library_facets'), {
        categories,
        complete: true,
        version: 1,
        updatedAt: new Date().toISOString(),
      }, { merge: false });
      batch.set(backupRef(database, ownerId, jobId), {
        finalCardCount: safeCounter(countSnapshot.data().count),
        completedAt: Timestamp.now(),
      }, { merge: true });
      await batch.commit();
    },
  };
}

const restoreProfileDocument = (
  batch: ReturnType<Firestore['batch']>,
  reference: ReturnType<typeof migrationProgressRef>,
  value: unknown,
): void => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    batch.set(reference, value as DocumentData, { merge: false });
  } else {
    batch.delete(reference);
  }
};

export async function rollbackLegacyLibraryMigration(
  database: Firestore,
  ownerId: string,
  jobId: string,
): Promise<void> {
  const root = backupRef(database, ownerId, jobId);
  const [rootSnapshot, sourceSnapshot, planSnapshot, stateSnapshot, currentCardCount] = await Promise.all([
    root.get(),
    root.collection('sources').get(),
    root.collection('plans').get(),
    libraryStateRef(database, ownerId).get(),
    cardsRef(database, ownerId).count().get(),
  ]);
  if (!rootSnapshot.exists) throw new Error('Migration rollback snapshot does not exist.');
  const rootData = rootSnapshot.data() ?? {};
  const expectedEpoch = safeCounter(rootData.libraryEpoch);
  const currentEpoch = stateSnapshot.exists ? safeCounter(stateSnapshot.data()?.libraryEpoch) : 0;
  if (currentEpoch !== expectedEpoch) throw new LegacyLibraryGenerationChangedError();
  if (
    Number.isSafeInteger(rootData.finalCardCount)
    && safeCounter(currentCardCount.data().count) !== Number(rootData.finalCardCount)
  ) {
    throw new Error('Library changed after migration; automatic rollback was refused.');
  }
  const sources = new Map(sourceSnapshot.docs.map(document => [
    document.id,
    document.data().source as DocumentData,
  ]));

  for (const document of planSnapshot.docs) {
    const plan = document.data();
    const primaryId = assertSafeSegment(String(plan.primaryId ?? ''), 'Card ID');
    const normalizedWord = String(plan.normalizedWord ?? '');
    const sourceIds = Array.isArray(plan.sourceIds)
      ? plan.sourceIds.map(value => assertSafeSegment(String(value), 'Card ID'))
      : [];
    const recordedSourceIds = [...new Set([primaryId, ...sourceIds])];
    const recordedSourceReferences = recordedSourceIds.map(cardId => (
      cardsRef(database, ownerId).doc(cardId)
    ));
    const beforeTombstones = Array.isArray(plan.beforeTombstones)
      ? plan.beforeTombstones as Array<{ cardId?: unknown; data?: unknown }>
      : [];
    await database.runTransaction(async transaction => {
      const [liveState, currentSourceSnapshots] = await Promise.all([
        transaction.get(libraryStateRef(database, ownerId)),
        transaction.getAll(...recordedSourceReferences),
      ]);
      const liveEpoch = liveState.exists ? safeCounter(liveState.data()?.libraryEpoch) : 0;
      if (liveEpoch !== expectedEpoch) throw new LegacyLibraryGenerationChangedError();
      const liveSources = new Map(currentSourceSnapshots.map(snapshot => [snapshot.id, snapshot]));
      if (recordedSourceIds.some(sourceId => (
        sourceId !== primaryId && liveSources.get(sourceId)?.exists
      ))) {
        throw new Error(
          'A removed source ID was recreated after migration; automatic rollback was refused.',
        );
      }
      const currentPrimary = liveSources.get(primaryId);
      if (
        !currentPrimary?.exists
        || safeCounter(currentPrimary.data()?.revision) !== safeCounter(plan.appliedRevision)
      ) {
        throw new Error('A migrated card changed after apply; automatic rollback was refused.');
      }
      const originalPrimary = sources.get(primaryId);
      if (originalPrimary) transaction.set(cardsRef(database, ownerId).doc(primaryId), originalPrimary, { merge: false });
      else transaction.delete(cardsRef(database, ownerId).doc(primaryId));
      for (const sourceId of sourceIds) {
        const source = sources.get(sourceId);
        if (source) transaction.set(cardsRef(database, ownerId).doc(sourceId), source, { merge: false });
      }
      const identityReservation = reservationRef(database, ownerId, normalizedWord);
      if (plan.beforeReservation && typeof plan.beforeReservation === 'object') {
        transaction.set(identityReservation, plan.beforeReservation, { merge: false });
      } else {
        transaction.delete(identityReservation);
      }
      for (const previous of beforeTombstones) {
        const cardId = assertSafeSegment(String(previous.cardId ?? ''), 'Card ID');
        const reference = tombstoneRef(database, ownerId, cardId);
        if (previous.data && typeof previous.data === 'object') {
          transaction.set(reference, previous.data, { merge: false });
        } else {
          transaction.delete(reference);
        }
      }
    });
  }

  const batch = database.batch();
  restoreProfileDocument(
    batch,
    migrationProgressRef(database, ownerId),
    rootData.previousProgress,
  );
  restoreProfileDocument(
    batch,
    ownerRef(database, ownerId).collection('profile').doc('library_facets'),
    rootData.previousFacets,
  );
  batch.set(root, { rolledBackAt: Timestamp.now() }, { merge: true });
  await batch.commit();
}

export async function listLibraryOwnerIds(database: Firestore): Promise<string[]> {
  const snapshot = await database.collectionGroup('cards').select().get();
  const owners = new Set<string>();
  for (const document of snapshot.docs) {
    const segments = document.ref.path.split('/');
    if (segments.length === 4 && segments[0] === 'users' && segments[2] === 'cards') {
      owners.add(assertSafeSegment(segments[1], 'Owner ID'));
    }
  }
  return [...owners].sort((left, right) => left.localeCompare(right, 'en-US'));
}
