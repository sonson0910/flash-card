import { createHash } from 'node:crypto';
import {
  FieldPath,
  FieldValue,
  Timestamp,
  type DocumentData,
  type DocumentSnapshot,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';
import {
  normalizeCleanupWord,
  nextSafeRevision,
  planLegacyIdentityGroup,
  summarizeFacetCounts,
  type CleanupCard,
  type DuplicateCleanupPlan,
} from './duplicateCleanup.js';
import {
  DISCOVERY_LEASE_MS,
  LEGACY_LIBRARY_DISCOVERY_SCHEMA_VERSION,
  createLegacyLibrarySourceDescriptor,
  createLegacyLibraryInitialRevision,
  digestLegacyLibraryDiscoveryPage,
  nextLegacyLibrarySourceRevision,
  normalizedLegacyLibraryIdentity,
  LegacyLibraryInvalidCardsError,
  type LegacyLibraryDiscoveryCommit,
  type LegacyLibraryDiscoveryJob,
  type LegacyLibraryDiscoveryStore,
  type LegacyLibraryIdentityGroup,
  type LegacyLibraryPage,
  type LegacyLibraryMigrationStore,
  type LegacyLibraryReservation,
  type LegacyLibrarySnapshot,
} from './legacyLibraryMigration.js';

const MIGRATION_VERSION = 2;
const BACKUP_COLLECTION = 'admin_library_migration_backups';
const MAX_BACKUP_WRITES = 400;
const DISCOVERY_JOB_COLLECTION = 'admin_library_migration_jobs';
const DISCOVERY_GROUP_COLLECTION = 'groups';

export class LegacyLibraryGenerationChangedError extends Error {
  constructor() {
    super('Library changed generation while the Admin migration was running.');
    this.name = 'LegacyLibraryGenerationChangedError';
  }
}

export class LegacyLibraryDiscoveryLeaseError extends Error {
  constructor() {
    super('Another Admin discovery worker currently holds the migration lease.');
    this.name = 'LegacyLibraryDiscoveryLeaseError';
  }
}

export class LegacyLibraryDiscoveryStateChangedError extends Error {
  constructor() {
    super('Legacy library discovery state changed; retry the discovery page.');
    this.name = 'LegacyLibraryDiscoveryStateChangedError';
  }
}

const safeCounter = (value: unknown): number => {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new LegacyLibraryInvalidCardsError(1);
  }
  return Number(value);
};

const assertSafeSegment = (value: string, label: string): string => {
  if (!/^[a-zA-Z0-9:_-]{1,128}$/.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
};

const DISCOVERY_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DISCOVERY_DIGEST_RE = /^[a-f0-9]{64}$/;
const MAX_DISCOVERY_SOURCE_ID_BYTES = 1_500;

const isDiscoverySourceId = (value: unknown): value is string => (
  typeof value === 'string'
  && value.length > 0
  && !value.includes('/')
  && new TextEncoder().encode(value).byteLength <= MAX_DISCOVERY_SOURCE_ID_BYTES
);

const isDiscoveryUuid = (value: unknown): value is string => (
  typeof value === 'string' && DISCOVERY_UUID_RE.test(value)
);

const isDiscoveryLeaseOwner = (value: unknown): value is string => (
  typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,128}$/.test(value)
);

const isDiscoveryDigest = (value: unknown): value is string => (
  typeof value === 'string' && DISCOVERY_DIGEST_RE.test(value)
);

const documentIdCompare = (left: string, right: string): number => {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
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

const discoveryJobRef = (database: Firestore, ownerId: string, jobId: string) =>
  ownerRef(database, ownerId)
    .collection(DISCOVERY_JOB_COLLECTION)
    .doc(assertSafeSegment(jobId, 'Migration job ID'));

const discoveryGroupRef = (
  database: Firestore,
  ownerId: string,
  jobId: string,
  normalizedWord: string,
) => discoveryJobRef(database, ownerId, jobId)
  .collection(DISCOVERY_GROUP_COLLECTION)
  .doc(createLegacyReservationId(normalizedWord));

const validDiscoveryJob = (value: DocumentData | undefined): LegacyLibraryDiscoveryJob => {
  if (!value || value.schemaVersion !== LEGACY_LIBRARY_DISCOVERY_SCHEMA_VERSION) {
    throw new Error('Legacy library discovery job state is invalid.');
  }
  const counters = ['scanned', 'sourceCount', 'groupCount'] as const;
  for (const counter of counters) {
    if (!Number.isSafeInteger(value[counter]) || Number(value[counter]) < 0) {
      throw new Error('Legacy library discovery job counters are invalid.');
    }
  }
  const leaseExpiresAt = value.leaseExpiresAt instanceof Timestamp
    ? value.leaseExpiresAt.toMillis()
    : value.leaseExpiresAt;
  if (
    !isDiscoveryUuid(value.scanId)
    || typeof value.sourceRevision !== 'string'
    || (value.sourceRevision !== '' && !isDiscoveryDigest(value.sourceRevision))
    || !['discover', 'discovered', 'blocked', 'verify'].includes(value.phase)
    || (value.cursor !== null && !isDiscoverySourceId(value.cursor))
    || (value.libraryEpoch !== null && (!Number.isSafeInteger(value.libraryEpoch) || value.libraryEpoch < 0))
    || (value.leaseOwner !== null && !isDiscoveryLeaseOwner(value.leaseOwner))
    || (leaseExpiresAt !== null && (!Number.isSafeInteger(leaseExpiresAt) || leaseExpiresAt < 0))
    || (value.lastPageDigest !== null && !isDiscoveryDigest(value.lastPageDigest))
    || (value.sourceRevision === '' && value.lastPageDigest !== null)
    || (value.sourceRevision !== '' && value.lastPageDigest === null)
    || (value.leaseOwner === null && leaseExpiresAt !== null)
    || (value.leaseOwner !== null && leaseExpiresAt === null)
    || (value.blockedReason !== undefined
      && (typeof value.blockedReason !== 'string' || value.blockedReason.length > 128))
  ) throw new Error('Legacy library discovery job state is invalid.');
  return {
    schemaVersion: 3,
    scanId: value.scanId,
    phase: value.phase,
    cursor: value.cursor ?? null,
    libraryEpoch: value.libraryEpoch ?? null,
    sourceRevision: value.sourceRevision,
    scanned: Number(value.scanned),
    sourceCount: Number(value.sourceCount),
    groupCount: Number(value.groupCount),
    lastPageDigest: value.lastPageDigest ?? null,
    ...(typeof value.blockedReason === 'string' ? { blockedReason: value.blockedReason } : {}),
    leaseOwner: value.leaseOwner ?? null,
    leaseExpiresAt: leaseExpiresAt ?? null,
  };
};

const discoveryJobData = (job: LegacyLibraryDiscoveryJob, now: Timestamp): DocumentData => ({
  schemaVersion: LEGACY_LIBRARY_DISCOVERY_SCHEMA_VERSION,
  scanId: job.scanId,
  phase: job.phase,
  cursor: job.cursor,
  libraryEpoch: job.libraryEpoch,
  sourceRevision: job.sourceRevision,
  scanned: job.scanned,
  sourceCount: job.sourceCount,
  groupCount: job.groupCount,
  lastPageDigest: job.lastPageDigest,
  ...(job.blockedReason ? { blockedReason: job.blockedReason } : {}),
  leaseOwner: job.leaseOwner,
  leaseExpiresAt: job.leaseExpiresAt === null
    ? null
    : Timestamp.fromMillis(job.leaseExpiresAt),
  updatedAt: now,
});

const discoveryGroupData = (group: LegacyLibraryIdentityGroup, now: Timestamp): DocumentData => ({
  schemaVersion: LEGACY_LIBRARY_DISCOVERY_SCHEMA_VERSION,
  scanId: group.scanId,
  libraryEpoch: group.libraryEpoch,
  sourceRevision: group.sourceRevision,
  normalizedWord: group.normalizedWord,
  sourceBytes: group.sourceBytes,
  sources: group.sources,
  updatedAt: now,
});

const parseDiscoveryGroup = (value: DocumentData | undefined): LegacyLibraryIdentityGroup => {
  if (!value || value.schemaVersion !== LEGACY_LIBRARY_DISCOVERY_SCHEMA_VERSION) {
    throw new Error('Legacy library discovery group is invalid.');
  }
  if (
    typeof value.normalizedWord !== 'string'
    || value.normalizedWord.length === 0
    || value.normalizedWord.length > 256
    || normalizeCleanupWord(value.normalizedWord) !== value.normalizedWord
    || !Array.isArray(value.sources)
    || !Number.isSafeInteger(value.sourceBytes)
    || value.sourceBytes < 0
    || value.sourceBytes > 4 * 1024 * 1024
    || value.sources.length === 0
    || value.sources.length > 100
    || !isDiscoveryUuid(value.scanId)
    || !Number.isSafeInteger(value.libraryEpoch)
    || Number(value.libraryEpoch) < 0
    || !isDiscoveryDigest(value.sourceRevision)
  ) throw new Error('Legacy library discovery group is invalid.');
  const sources = value.sources.map(source => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      throw new Error('Legacy library discovery source descriptor is invalid.');
    }
    const descriptor = source as Record<string, unknown>;
    if (
      typeof descriptor.id !== 'string'
      || !isDiscoverySourceId(descriptor.id)
      || typeof descriptor.sourceDigest !== 'string'
      || !isDiscoveryDigest(descriptor.sourceDigest)
      || !Number.isSafeInteger(descriptor.sourceBytes)
      || Number(descriptor.sourceBytes) <= 0
      || Number(descriptor.sourceBytes) > 8 * 1024 * 1024
    ) throw new Error('Legacy library discovery source descriptor is invalid.');
    return {
      id: descriptor.id,
      sourceDigest: descriptor.sourceDigest,
      sourceBytes: Number(descriptor.sourceBytes),
    };
  });
  if (sources.some((source, index) => (
    index > 0 && documentIdCompare(sources[index - 1].id, source.id) >= 0
  ))) throw new Error('Legacy library discovery source order is invalid.');
  const bytes = sources.reduce((total, source) => total + source.sourceBytes, 0);
  if (bytes !== value.sourceBytes || bytes > 4 * 1024 * 1024) {
    throw new Error('Legacy library discovery group size is invalid.');
  }
  return {
    schemaVersion: 3,
    scanId: value.scanId,
    libraryEpoch: Number(value.libraryEpoch),
    sourceRevision: value.sourceRevision,
    normalizedWord: value.normalizedWord,
    sourceBytes: bytes,
    sources,
  };
};

const sameSourceDescriptor = (
  left: { id: string; sourceDigest: string; sourceBytes: number },
  right: { id: string; sourceDigest: string; sourceBytes: number },
): boolean => left.id === right.id
  && left.sourceDigest === right.sourceDigest
  && left.sourceBytes === right.sourceBytes;

const requestCommitDiscoveryPage = async (
  database: Firestore,
  ownerId: string,
  transaction: Transaction,
  request: LegacyLibraryDiscoveryCommit,
): Promise<LegacyLibraryDiscoveryJob> => {
  const job = discoveryJobRef(database, ownerId, request.jobId);
  const [jobSnapshot, stateSnapshot] = await Promise.all([
    transaction.get(job),
    transaction.get(libraryStateRef(database, ownerId)),
  ]);
  if (!jobSnapshot.exists) throw new LegacyLibraryDiscoveryStateChangedError();
  const current = validDiscoveryJob(jobSnapshot.data());
  if (current.phase === 'discovered' || current.phase === 'blocked') return current;
  const now = Timestamp.now();
  const nowMillis = now.toMillis();
  if (
    current.leaseOwner !== request.leaseOwner
    || (current.leaseExpiresAt ?? 0) <= nowMillis
  ) throw new LegacyLibraryDiscoveryLeaseError();
  if (
    current.lastPageDigest === request.pageDigest
    && current.cursor === request.nextJob.cursor
  ) return current;
  if (
    request.expectedJob
    && (
      current.cursor !== request.expectedJob.cursor
      || current.sourceRevision !== request.expectedJob.sourceRevision
      || current.scanId !== request.expectedJob.scanId
    )
  ) throw new LegacyLibraryDiscoveryStateChangedError();
  const nextJob = validDiscoveryJob({
    ...(request.nextJob as unknown as DocumentData),
    leaseOwner: null,
    leaseExpiresAt: null,
  });
  if (nextJob.scanId !== current.scanId) throw new LegacyLibraryDiscoveryStateChangedError();
  const currentEpoch = stateSnapshot.exists
    ? safeCounter(stateSnapshot.data()?.libraryEpoch)
    : 0;
  if (request.pageDigest && request.page.libraryEpoch !== currentEpoch) {
    const blocked: LegacyLibraryDiscoveryJob = {
      ...current,
      phase: 'blocked',
      blockedReason: 'library-epoch-changed',
      leaseOwner: null,
      leaseExpiresAt: null,
    };
    transaction.set(job, discoveryJobData(blocked, now), { merge: false });
    return blocked;
  }
  const references = request.page.documents.map(document => cardsRef(database, ownerId).doc(document.id));
  const groupWords = [...new Set(request.groups.map(group => group.normalizedWord))];
  const groupReferences = groupWords.map(word => discoveryGroupRef(
    database,
    ownerId,
    request.jobId,
    word,
  ));
  const [sourceSnapshots, groupSnapshots] = await Promise.all([
    references.length > 0 ? transaction.getAll(...references) : Promise.resolve([]),
    groupReferences.length > 0 ? transaction.getAll(...groupReferences) : Promise.resolve([]),
  ]);
  if (request.pageDigest) {
    const expectedPhase = request.page.terminal ? 'discovered' : 'discover';
    if (
      nextJob.phase !== expectedPhase
      || nextJob.cursor !== request.page.cursor
      || nextJob.libraryEpoch !== request.page.libraryEpoch
      || nextJob.lastPageDigest !== request.pageDigest
    ) throw new LegacyLibraryDiscoveryStateChangedError();
    if (request.page.libraryEpoch !== currentEpoch) {
      throw new LegacyLibraryDiscoveryStateChangedError();
    }
    const actualDescriptors = sourceSnapshots.map(snapshot => (
      snapshot.exists
        ? createLegacyLibrarySourceDescriptor({ id: snapshot.id, data: snapshot.data() as Record<string, unknown> })
        : null
    ));
    const expectedDescriptors = request.page.documents.map(createLegacyLibrarySourceDescriptor);
    if (
      digestLegacyLibraryDiscoveryPage(
        request.page,
        request.expectedJob?.cursor ?? null,
        expectedDescriptors,
      ) !== request.pageDigest
    ) throw new LegacyLibraryDiscoveryStateChangedError();
    const previousRevision = current.sourceRevision || createLegacyLibraryInitialRevision(
      current.scanId,
      request.page.libraryEpoch,
    );
    if (nextLegacyLibrarySourceRevision(previousRevision, request.pageDigest) !== request.nextJob.sourceRevision) {
      throw new LegacyLibraryDiscoveryStateChangedError();
    }
    if (
      actualDescriptors.length !== expectedDescriptors.length
      || actualDescriptors.some((descriptor, index) => (
        descriptor === null || !sameSourceDescriptor(descriptor, expectedDescriptors[index])
      ))
      || request.page.documents.some((document, index) => (
        index > 0 && documentIdCompare(request.page.documents[index - 1].id, document.id) >= 0
      ))
    ) throw new LegacyLibraryDiscoveryStateChangedError();

    const requestedGroups = request.groups.map(group => parseDiscoveryGroup(group as unknown as DocumentData));
    if (requestedGroups.some(group => (
      group.scanId !== current.scanId
      || group.libraryEpoch !== currentEpoch
      || group.sourceRevision !== nextJob.sourceRevision
    ))) throw new LegacyLibraryDiscoveryStateChangedError();
    const currentGroups = new Map(
      groupSnapshots.flatMap(snapshot => {
        if (!snapshot.exists) return [];
        const group = parseDiscoveryGroup(snapshot.data());
        if (
          group.scanId !== current.scanId
          || group.libraryEpoch !== current.libraryEpoch
          || group.sourceRevision !== current.sourceRevision
        ) throw new LegacyLibraryDiscoveryStateChangedError();
        return [[group.normalizedWord, group] as const];
      }),
    );
    for (const group of request.groups) {
      const previous = currentGroups.get(group.normalizedWord);
      if (!previous) continue;
      if (
        previous.sources.length > group.sources.length
        || previous.sources.some((source, index) => !sameSourceDescriptor(source, group.sources[index]))
      ) throw new LegacyLibraryDiscoveryStateChangedError();
    }
    for (const [index, document] of request.page.documents.entries()) {
      const identity = normalizedLegacyLibraryIdentity(document.data);
      const group = request.groups.find(candidate => candidate.normalizedWord === identity);
      if (!group || !sameSourceDescriptor(group.sources.find(source => source.id === expectedDescriptors[index].id) ?? {
        id: '', sourceDigest: '', sourceBytes: -1,
      }, expectedDescriptors[index])) {
        throw new LegacyLibraryDiscoveryStateChangedError();
      }
    }
    for (const group of request.groups) {
      transaction.set(
        discoveryGroupRef(database, ownerId, request.jobId, group.normalizedWord),
        discoveryGroupData(group, now),
        { merge: false },
      );
    }
  }
  const committedJob: LegacyLibraryDiscoveryJob = {
    ...request.nextJob,
    // The lease protects the read/commit window. Release it after the atomic
    // page commit so the next bounded request can acquire a fresh server lease.
    leaseOwner: null,
    leaseExpiresAt: null,
  };
  transaction.set(job, discoveryJobData(committedJob, now), { merge: false });
  return committedJob;
};

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
): Promise<LegacyLibrarySnapshot> {
  const [stateSnapshot, cardSnapshot] = await Promise.all([
    libraryStateRef(database, ownerId).get(),
    cardsRef(database, ownerId).get(),
  ]);
  const libraryEpoch = stateSnapshot.exists
    ? safeCounter(stateSnapshot.data()?.libraryEpoch)
    : 0;
  const cards = cardSnapshot.docs.map(cardFromSnapshot);
  const normalizedWords = [...new Set(cards.map(card => (
    normalizeCleanupWord(card.normalizedWord) || normalizeCleanupWord(card.word)
  )).filter(Boolean))];
  const references = normalizedWords.map(word => reservationRef(database, ownerId, word));
  const snapshots = references.length > 0 ? await database.getAll(...references) : [];
  return {
    libraryEpoch,
    cards,
    reservations: new Map(snapshots.flatMap((snapshot, index) => (
      snapshot.exists ? [[normalizedWords[index], snapshot.data()]] : []
    ))),
  };
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
        revision: nextSafeRevision(
          Math.max(previousRevision, sourceRevision),
          'Tombstone revision',
        ),
        deletedAt: now,
      }, { merge: false });
      transaction.delete(cardsRef(database, ownerId).doc(loserId));
    }
  });
}

export function createFirestoreLegacyLibraryMigrationStore(
  database: Firestore,
): LegacyLibraryMigrationStore & LegacyLibraryDiscoveryStore {
  const discovery: LegacyLibraryDiscoveryStore = {
    acquireDiscoveryLease: async (ownerId, request) => database.runTransaction(async transaction => {
      if (!isDiscoveryUuid(request.scanId) || !isDiscoveryLeaseOwner(request.leaseOwner)) {
        throw new Error('Legacy library discovery lease request is invalid.');
      }
      const reference = discoveryJobRef(database, ownerId, request.jobId);
      const snapshot = await transaction.get(reference);
      const now = Timestamp.now();
      const nowMillis = now.toMillis();
      const current = snapshot.exists ? validDiscoveryJob(snapshot.data()) : null;
      if (current?.phase === 'discovered' || current?.phase === 'blocked') return current;
      if (
        current
        && current.leaseOwner
        && current.leaseOwner !== request.leaseOwner
        && (current.leaseExpiresAt ?? 0) > nowMillis
      ) throw new LegacyLibraryDiscoveryLeaseError();
      const next: LegacyLibraryDiscoveryJob = {
        schemaVersion: 3,
        scanId: current?.scanId ?? request.scanId,
        phase: current?.phase ?? 'discover',
        cursor: current?.cursor ?? null,
        libraryEpoch: current?.libraryEpoch ?? null,
        sourceRevision: current?.sourceRevision ?? '',
        scanned: current?.scanned ?? 0,
        sourceCount: current?.sourceCount ?? 0,
        groupCount: current?.groupCount ?? 0,
        lastPageDigest: current?.lastPageDigest ?? null,
        ...(current?.blockedReason ? { blockedReason: current.blockedReason } : {}),
        leaseOwner: request.leaseOwner,
        leaseExpiresAt: nowMillis + DISCOVERY_LEASE_MS,
      };
      transaction.set(reference, discoveryJobData(next, now), { merge: false });
      return next;
    }),
    readPage: async (ownerId, options): Promise<LegacyLibraryPage> => {
      const stateSnapshot = await libraryStateRef(database, ownerId).get();
      const libraryEpoch = stateSnapshot.exists
        ? safeCounter(stateSnapshot.data()?.libraryEpoch)
        : 0;
      let query = cardsRef(database, ownerId)
        .orderBy(FieldPath.documentId())
        .limit(Math.max(1, Math.min(100, Math.floor(options.limit))));
      if (options.cursor !== null) query = query.startAfter(options.cursor);
      const snapshot = await query.get();
      const documents = snapshot.docs.map(document => ({
        id: document.id,
        data: (document.data() ?? {}) as Record<string, unknown>,
      }));
      return {
        documents,
        cursor: documents.at(-1)?.id ?? options.cursor,
        terminal: documents.length < Math.max(1, Math.min(100, Math.floor(options.limit))),
        libraryEpoch,
      };
    },
    readDiscoveryGroups: async (ownerId, jobId, normalizedWords) => {
      const references = normalizedWords.map(word => discoveryGroupRef(
        database,
        ownerId,
        jobId,
        word,
      ));
      if (references.length === 0) return [];
      const snapshots = await database.getAll(...references);
      return snapshots.flatMap(snapshot => snapshot.exists
        ? [parseDiscoveryGroup(snapshot.data())]
        : []);
    },
    commitDiscoveryPage: async (ownerId, request) => database.runTransaction(async transaction => {
      assertSafeSegment(request.jobId, 'Migration job ID');
      return requestCommitDiscoveryPage(database, ownerId, transaction, request);
    }),
  };

  return {
    ...discovery,
    read: ownerId => readOwnerSnapshot(database, ownerId),
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
    markComplete: async (ownerId, jobId, cards) => {
      const batch = database.batch();
      batch.set(migrationProgressRef(database, ownerId), {
        migrationVersion: MIGRATION_VERSION,
        jobId,
        complete: true,
        scanned: cards.length,
        lastDocumentId: null,
        updatedAt: new Date().toISOString(),
      }, { merge: true });
      batch.set(ownerRef(database, ownerId).collection('profile').doc('library_facets'), {
        categories: summarizeFacetCounts(cards),
        complete: true,
        version: 1,
        updatedAt: new Date().toISOString(),
      }, { merge: false });
      batch.set(backupRef(database, ownerId, jobId), {
        finalCardCount: cards.length,
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
  const [rootSnapshot, sourceSnapshot, planSnapshot, stateSnapshot, currentCards] = await Promise.all([
    root.get(),
    root.collection('sources').get(),
    root.collection('plans').get(),
    libraryStateRef(database, ownerId).get(),
    cardsRef(database, ownerId).get(),
  ]);
  if (!rootSnapshot.exists) throw new Error('Migration rollback snapshot does not exist.');
  const rootData = rootSnapshot.data() ?? {};
  const expectedEpoch = safeCounter(rootData.libraryEpoch);
  const currentEpoch = stateSnapshot.exists ? safeCounter(stateSnapshot.data()?.libraryEpoch) : 0;
  if (currentEpoch !== expectedEpoch) throw new LegacyLibraryGenerationChangedError();
  if (
    Number.isSafeInteger(rootData.finalCardCount)
    && currentCards.size !== Number(rootData.finalCardCount)
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

export async function forEachLibraryOwnerId(
  database: Firestore,
  callback: (ownerId: string) => Promise<void> | void,
): Promise<number> {
  const owners = new Set<string>();
  let cursor: DocumentSnapshot | undefined;
  while (true) {
    let query = database.collectionGroup('cards')
      .orderBy(FieldPath.documentId())
      .limit(100);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    for (const document of snapshot.docs) {
      const segments = document.ref.path.split('/');
      if (segments.length !== 4 || segments[0] !== 'users' || segments[2] !== 'cards') continue;
      const ownerId = assertSafeSegment(segments[1], 'Owner ID');
      if (owners.has(ownerId)) continue;
      owners.add(ownerId);
      await callback(ownerId);
    }
    if (snapshot.docs.length < 100) break;
    cursor = snapshot.docs.at(-1);
  }
  return owners.size;
}
