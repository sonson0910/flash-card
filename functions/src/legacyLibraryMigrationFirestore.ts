import { createHash, randomUUID } from 'node:crypto';
import {
  FieldPath,
  Timestamp,
  type DocumentData,
  type DocumentSnapshot,
  type Firestore,
  type Transaction,
} from 'firebase-admin/firestore';
import {
  createCanonicalCleanupCardId,
  normalizeCleanupWord,
  planLegacyIdentityGroup,
  summarizeFacetCounts,
  type CleanupCard,
} from './duplicateCleanup.js';
import {
  DISCOVERY_LEASE_MS,
  LEGACY_LIBRARY_DISCOVERY_SCHEMA_VERSION,
  createLegacyLibrarySourceDescriptor,
  createLegacyLibraryInitialRevision,
  canonicalLegacyLibraryUtf8Bytes,
  digestLegacyLibraryValue,
  digestLegacyLibraryDiscoveryPage,
  nextLegacyLibrarySourceRevision,
  normalizedLegacyLibraryIdentity,
  LegacyLibraryInvalidCardsError,
  type LegacyLibraryDiscoveryCommit,
  type LegacyLibraryDiscoveryJob,
  type LegacyLibraryDiscoveryStore,
  type LegacyLibraryIdentityGroup,
  type LegacyLibrarySourceDescriptor,
  type LegacyLibraryPage,
} from './legacyLibraryMigration.js';
import {
  isActiveMigrationFence,
  migrationFenceReference,
  LegacyLibraryMigrationFenceError,
  type LegacyLibraryMigrationFence,
} from './legacyLibraryMigrationOwnerScope.js';

const MIGRATION_VERSION = 2;
const BACKUP_COLLECTION = 'admin_library_migration_backups';
const DISCOVERY_JOB_COLLECTION = 'admin_library_migration_jobs';
const DISCOVERY_GROUP_COLLECTION = 'groups';

type MigrationFence = LegacyLibraryMigrationFence & {
  readonly rollbackGroupCount: number;
};

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

export class LegacyLibraryMigrationConflictError extends Error {
  constructor(public readonly reason: 'source' | 'reservation' | 'tombstone' | 'revision' | 'final-scan') {
    super(`Legacy library migration conflict: ${reason}.`);
    this.name = 'LegacyLibraryMigrationConflictError';
  }
}

export class LegacyLibraryRollbackConflictError extends Error {
  constructor(public readonly blockedGroups: number, public readonly blockedSources: number) {
    super(`Legacy library rollback blocked for ${blockedGroups} group(s) and ${blockedSources} source(s).`);
    this.name = 'LegacyLibraryRollbackConflictError';
  }
}

export class LegacyLibraryMigrationResourceLimitError extends Error {
  constructor() {
    super('Legacy library migration group exceeds the Firestore transaction resource limit.');
    this.name = 'LegacyLibraryMigrationResourceLimitError';
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

const facetsRef = (database: Firestore, ownerId: string) =>
  ownerRef(database, ownerId).collection('profile').doc('library_facets');

const resourceUsageRef = (database: Firestore, ownerId: string) =>
  ownerRef(database, ownerId).collection('profile').doc('resource_usage');

const planBackupRef = (database: Firestore, ownerId: string, jobId: string, normalizedWord: string) =>
  backupRef(database, ownerId, jobId).collection('plans').doc(createLegacyReservationId(normalizedWord));

const fenceFromSnapshot = (snapshot: DocumentSnapshot): MigrationFence => {
  if (!snapshot.exists || !isActiveMigrationFence(snapshot.data())) {
    throw new LegacyLibraryMigrationFenceError('missing');
  }
  const value = snapshot.data() as Record<string, unknown>;
  const leaseExpiresAt = value.leaseExpiresAt instanceof Timestamp
    ? value.leaseExpiresAt.toMillis()
    : value.leaseExpiresAt;
  const startedAt = value.startedAt instanceof Timestamp
    ? value.startedAt.toMillis()
    : value.startedAt;
  const integerFields = [
    'libraryEpoch', 'revision', 'appliedGroupCount',
    'appliedSourceCount', 'sourceCount', 'groupCount',
  ];
  if (
    (value.phase !== 'verify' && value.phase !== 'apply' && value.phase !== 'rollback')
    || typeof value.jobId !== 'string'
    || typeof value.scanId !== 'string'
    || typeof value.token !== 'string'
    || typeof value.leaseOwner !== 'string'
    || typeof value.sourceRevision !== 'string'
    || !Number.isSafeInteger(leaseExpiresAt)
    || !Number.isSafeInteger(startedAt)
    || Number(leaseExpiresAt) < 0
    || Number(startedAt) < 0
    || integerFields.some(field => !Number.isSafeInteger(value[field]) || Number(value[field]) < 0)
    || (value.rollbackGroupCount !== undefined
      && (!Number.isSafeInteger(value.rollbackGroupCount) || Number(value.rollbackGroupCount) < 0))
  ) throw new LegacyLibraryMigrationFenceError('invalid');
  return {
    schemaVersion: 1,
    active: true,
    phase: value.phase as LegacyLibraryMigrationFence['phase'],
    jobId: value.jobId,
    scanId: value.scanId,
    token: value.token,
    leaseOwner: value.leaseOwner,
    leaseExpiresAt: Number(leaseExpiresAt),
    sourceRevision: value.sourceRevision,
    libraryEpoch: Number(value.libraryEpoch),
    revision: Number(value.revision),
    appliedGroupCount: Number(value.appliedGroupCount),
    appliedSourceCount: Number(value.appliedSourceCount),
    sourceCount: Number(value.sourceCount),
    groupCount: Number(value.groupCount),
    startedAt: Number(startedAt),
    rollbackGroupCount: Number.isSafeInteger(value.rollbackGroupCount)
      && Number(value.rollbackGroupCount) >= 0 ? Number(value.rollbackGroupCount) : 0,
  };
};

const fenceData = (fence: LegacyLibraryMigrationFence, now: Timestamp): DocumentData => ({
  ...fence,
  leaseExpiresAt: Timestamp.fromMillis(fence.leaseExpiresAt),
  startedAt: Timestamp.fromMillis(fence.startedAt),
  updatedAt: now,
});

const stableTimestamp = (fence: LegacyLibraryMigrationFence): Timestamp =>
  Timestamp.fromMillis(fence.startedAt);

const stableIso = (fence: LegacyLibraryMigrationFence): string =>
  stableTimestamp(fence).toDate().toISOString();

const assertFenceLease = (
  fence: LegacyLibraryMigrationFence,
  token: string,
  leaseOwner: string,
): void => {
  if (
    fence.token !== token
    || fence.leaseOwner !== leaseOwner
    || fence.leaseExpiresAt <= Date.now()
  ) throw new LegacyLibraryMigrationFenceError('lease');
};

const digestAfterState = (value: {
  canonical: DocumentData | null;
  reservation: DocumentData | null;
  tombstones: readonly { cardId: string; data: DocumentData | null }[];
  absentSourceIds: readonly string[];
}): string => digestLegacyLibraryValue({
  canonical: value.canonical,
  reservation: value.reservation,
  tombstones: value.tombstones.map(item => ({ cardId: item.cardId, data: item.data })),
  absentSourceIds: [...value.absentSourceIds].sort(documentIdCompare),
});

const sourceDescriptorFromSnapshot = (snapshot: DocumentSnapshot) => snapshot.exists
  ? createLegacyLibrarySourceDescriptor({
    id: snapshot.id,
    data: (snapshot.data() ?? {}) as Record<string, unknown>,
  })
  : null;

const sourceDigestMatches = (snapshot: DocumentSnapshot, expected: {
  id: string;
  sourceDigest: string;
  sourceBytes: number;
}): boolean => {
  const actual = sourceDescriptorFromSnapshot(snapshot);
  return Boolean(actual && sameSourceDescriptor(actual, expected));
};

const backupSourceMatches = (
  snapshot: DocumentSnapshot,
  expected: LegacyLibrarySourceDescriptor,
  requireSealed = true,
): boolean => {
  if (!snapshot.exists) return false;
  const value = snapshot.data() ?? {};
  if (value.sourceId !== expected.id
      || value.sourceDigest !== expected.sourceDigest
      || value.sourceBytes !== expected.sourceBytes
      || (requireSealed && value.sealed !== true)
      || !value.source || typeof value.source !== 'object' || Array.isArray(value.source)) return false;
  try {
    return sameSourceDescriptor(
      createLegacyLibrarySourceDescriptor({ id: expected.id, data: value.source as Record<string, unknown> }),
      expected,
    );
  } catch {
    return false;
  }
};

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
    || !['discover', 'discovered', 'blocked', 'verify', 'apply', 'complete', 'rollback', 'rolled-back'].includes(value.phase)
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
    ...(typeof value.fenceToken === 'string' ? { fenceToken: value.fenceToken } : {}),
    ...(Number.isSafeInteger(value.appliedGroupCount) ? { appliedGroupCount: Number(value.appliedGroupCount) } : {}),
    ...(Number.isSafeInteger(value.appliedSourceCount) ? { appliedSourceCount: Number(value.appliedSourceCount) } : {}),
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
  ...(job.fenceToken ? { fenceToken: job.fenceToken } : {}),
  ...(job.appliedGroupCount === undefined ? {} : { appliedGroupCount: job.appliedGroupCount }),
  ...(job.appliedSourceCount === undefined ? {} : { appliedSourceCount: job.appliedSourceCount }),
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
  const [jobSnapshot, stateSnapshot, fenceSnapshot] = await Promise.all([
    transaction.get(job),
    transaction.get(libraryStateRef(database, ownerId)),
    transaction.get(migrationFenceReference(database, ownerId)),
  ]);
  if (!jobSnapshot.exists) throw new LegacyLibraryDiscoveryStateChangedError();
  const current = validDiscoveryJob(jobSnapshot.data());
  if (current.phase !== 'discover') return current;
  if (fenceSnapshot.exists && isActiveMigrationFence(fenceSnapshot.data())) {
    throw new LegacyLibraryMigrationFenceError('active');
  }
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

const matchingReservation = (cardId: string, normalizedWord: string) => ({
  schemaVersion: 1,
  cardId,
  normalizedWord,
});

export type LegacyLibraryMigrationApplyOptions = {
  readonly jobId: string;
  readonly leaseOwner?: string;
  readonly sourceRevision: string;
};

export type LegacyLibraryMigrationOperatorResult = {
  readonly ownerKey: string;
  readonly jobId: string;
  readonly phase: LegacyLibraryDiscoveryJob['phase'];
  readonly sourceRevision: string;
  readonly scanned: number;
  readonly sourceCount: number;
  readonly groupCount: number;
  readonly appliedGroupCount: number;
  readonly complete: boolean;
};

type FreshLibraryRead = {
  readonly libraryEpoch: number;
  readonly cards: CleanupCard[];
  readonly descriptors: readonly LegacyLibrarySourceDescriptor[];
};

const readManifestGroups = async (
  database: Firestore,
  ownerId: string,
  jobId: string,
): Promise<LegacyLibraryIdentityGroup[]> => {
  const snapshot = await discoveryJobRef(database, ownerId, jobId).collection(DISCOVERY_GROUP_COLLECTION)
    .orderBy(FieldPath.documentId()).get();
  return snapshot.docs.map(document => parseDiscoveryGroup(document.data()));
};

const readFreshLibrary = async (
  database: Firestore,
  ownerId: string,
): Promise<FreshLibraryRead> => {
  let cursor: string | null = null;
  const cards: CleanupCard[] = [];
  const descriptors: LegacyLibrarySourceDescriptor[] = [];
  while (true) {
    let query = cardsRef(database, ownerId)
      .orderBy(FieldPath.documentId())
      .limit(100);
    if (cursor !== null) query = query.startAfter(cursor);
    const snapshot = await query.get();
    let pageBytes = 0;
    for (const document of snapshot.docs) {
      const data = (document.data() ?? {}) as Record<string, unknown>;
      const descriptor = createLegacyLibrarySourceDescriptor({ id: document.id, data });
      pageBytes += descriptor.sourceBytes;
      if (pageBytes > 8 * 1024 * 1024) throw new Error('Legacy migration verification page exceeds the size limit.');
      descriptors.push(descriptor);
      cards.push(cardFromSnapshot(document));
    }
    if (snapshot.docs.length < 100) break;
    const nextCursor = snapshot.docs.at(-1)?.id ?? null;
    if (!nextCursor || nextCursor === cursor) throw new Error('Legacy migration verification cursor stalled.');
    cursor = nextCursor;
  }
  const stateSnapshot = await libraryStateRef(database, ownerId).get();
  return {
    libraryEpoch: stateSnapshot.exists ? safeCounter(stateSnapshot.data()?.libraryEpoch) : 0,
    cards,
    descriptors,
  };
};

type AggregateDocument = {
  readonly id: string;
  readonly data: DocumentData | null;
};

type FinalLibraryAggregate = {
  readonly cards: readonly AggregateDocument[];
  readonly reservations: readonly AggregateDocument[];
  readonly tombstones: readonly AggregateDocument[];
  readonly migrationProgress: DocumentData | null;
  readonly facets: DocumentData | null;
  readonly resourceUsage: DocumentData | null;
};

const aggregateDocuments = (snapshot: { docs: readonly DocumentSnapshot[] }): AggregateDocument[] => (
  snapshot.docs.map(document => ({
    id: document.id,
    data: document.data() ?? null,
  }))
);

const readFinalLibraryAggregate = async (
  database: Firestore,
  ownerId: string,
): Promise<FinalLibraryAggregate> => {
  const owner = ownerRef(database, ownerId);
  const [cards, reservations, tombstones, migrationProgress, facets, resourceUsage] = await Promise.all([
    cardsRef(database, ownerId).orderBy(FieldPath.documentId()).get(),
    owner.collection('card_reservations').orderBy(FieldPath.documentId()).get(),
    owner.collection('card_tombstones').orderBy(FieldPath.documentId()).get(),
    migrationProgressRef(database, ownerId).get(),
    facetsRef(database, ownerId).get(),
    resourceUsageRef(database, ownerId).get(),
  ]);
  return {
    cards: aggregateDocuments(cards),
    reservations: aggregateDocuments(reservations),
    tombstones: aggregateDocuments(tombstones),
    migrationProgress: migrationProgress.exists ? migrationProgress.data() ?? null : null,
    facets: facets.exists ? facets.data() ?? null : null,
    resourceUsage: resourceUsage.exists ? resourceUsage.data() ?? null : null,
  };
};

const digestFinalLibraryAggregate = (value: FinalLibraryAggregate): string => (
  digestLegacyLibraryValue(value)
);

const verifyFreshManifest = (
  fresh: FreshLibraryRead,
  job: LegacyLibraryDiscoveryJob,
  groups: readonly LegacyLibraryIdentityGroup[],
): void => {
  if (fresh.libraryEpoch !== job.libraryEpoch || fresh.cards.length !== job.sourceCount) {
    throw new LegacyLibraryGenerationChangedError();
  }
  const expected = new Map<string, LegacyLibrarySourceDescriptor>();
  for (const group of groups) {
    if (group.scanId !== job.scanId || group.libraryEpoch !== job.libraryEpoch) {
      throw new LegacyLibraryDiscoveryStateChangedError();
    }
    for (const source of group.sources) {
      if (expected.has(source.id)) throw new LegacyLibraryDiscoveryStateChangedError();
      expected.set(source.id, source);
    }
  }
  if (expected.size !== job.sourceCount || fresh.descriptors.length !== expected.size) {
    throw new LegacyLibraryDiscoveryStateChangedError();
  }
  for (const descriptor of fresh.descriptors) {
    const expectedDescriptor = expected.get(descriptor.id);
    if (!expectedDescriptor || !sameSourceDescriptor(descriptor, expectedDescriptor)) {
      throw new LegacyLibraryGenerationChangedError();
    }
  }
};

const beginMigrationFence = async (
  database: Firestore,
  ownerId: string,
  options: LegacyLibraryMigrationApplyOptions,
  phase: 'verify' | 'rollback',
): Promise<MigrationFence> => database.runTransaction(async transaction => {
  const jobReference = discoveryJobRef(database, ownerId, options.jobId);
  const fenceReference = migrationFenceReference(database, ownerId);
  const [jobSnapshot, stateSnapshot, fenceSnapshot] = await Promise.all([
    transaction.get(jobReference),
    transaction.get(libraryStateRef(database, ownerId)),
    transaction.get(fenceReference),
  ]);
  if (!jobSnapshot.exists) throw new LegacyLibraryDiscoveryStateChangedError();
  const job = validDiscoveryJob(jobSnapshot.data());
  if (job.sourceRevision !== options.sourceRevision || !isDiscoveryDigest(options.sourceRevision)) {
    throw new LegacyLibraryDiscoveryStateChangedError();
  }
  if (job.libraryEpoch === null || job.sourceCount < 0 || job.groupCount < 0) {
    throw new LegacyLibraryDiscoveryStateChangedError();
  }
  const currentEpoch = stateSnapshot.exists ? safeCounter(stateSnapshot.data()?.libraryEpoch) : 0;
  if (currentEpoch !== job.libraryEpoch) throw new LegacyLibraryGenerationChangedError();
  const now = Timestamp.now();
  const nowMillis = now.toMillis();
  const existing = fenceSnapshot.exists ? fenceFromSnapshot(fenceSnapshot) : null;
  if (existing?.phase === 'rollback' && phase !== 'rollback') {
    throw new LegacyLibraryMigrationFenceError('rollback');
  }
  if (existing?.phase !== undefined && existing.phase !== 'rollback' && phase === 'rollback'
      && existing.appliedGroupCount === 0) {
    throw new LegacyLibraryMigrationFenceError('apply');
  }
  if (existing && existing.active && existing.leaseExpiresAt > nowMillis
      && existing.leaseOwner !== (options.leaseOwner ?? '')) {
    throw new LegacyLibraryDiscoveryLeaseError();
  }
  if (existing) {
    if (existing.jobId !== options.jobId || existing.sourceRevision !== options.sourceRevision) {
      throw new LegacyLibraryDiscoveryStateChangedError();
    }
    const leaseOwner = options.leaseOwner ?? randomUUID();
    const resumed: MigrationFence = {
      ...existing,
      phase: existing.phase === 'rollback' || (phase === 'rollback' && existing.appliedGroupCount > 0)
        ? 'rollback'
        : existing.appliedGroupCount > 0 ? 'apply' : phase,
      leaseOwner,
      leaseExpiresAt: nowMillis + DISCOVERY_LEASE_MS,
      revision: existing.revision + 1,
    };
    transaction.set(fenceReference, fenceData(resumed, now), { merge: false });
    transaction.set(jobReference, discoveryJobData({
      ...job,
      phase: resumed.phase === 'rollback' ? 'rollback' : resumed.phase,
      fenceToken: resumed.token,
      leaseOwner,
      leaseExpiresAt: resumed.leaseExpiresAt,
      appliedGroupCount: resumed.appliedGroupCount,
      appliedSourceCount: resumed.appliedSourceCount,
    }, now), { merge: false });
    return resumed;
  }
  if (
    job.phase !== 'discovered'
    && job.phase !== 'verify'
    && job.phase !== 'apply'
    && job.phase !== 'rollback'
    && !(phase === 'rollback' && (job.phase === 'complete' || job.phase === 'rolled-back'))
  ) {
    throw new LegacyLibraryDiscoveryStateChangedError();
  }
  const leaseOwner = options.leaseOwner ?? randomUUID();
  const fence: MigrationFence = {
    schemaVersion: 1,
    active: true,
    phase,
    jobId: options.jobId,
    scanId: job.scanId,
    token: randomUUID(),
    leaseOwner,
    leaseExpiresAt: nowMillis + DISCOVERY_LEASE_MS,
    sourceRevision: options.sourceRevision,
    libraryEpoch: job.libraryEpoch,
    revision: 1,
    appliedGroupCount: phase === 'rollback' ? Number(job.appliedGroupCount ?? job.groupCount) : 0,
    appliedSourceCount: phase === 'rollback' ? Number(job.appliedSourceCount ?? job.sourceCount) : 0,
    sourceCount: job.sourceCount,
    groupCount: job.groupCount,
    startedAt: nowMillis,
    rollbackGroupCount: 0,
  };
  transaction.create(fenceReference, fenceData(fence, now));
  transaction.set(jobReference, discoveryJobData({
    ...job,
    phase,
    fenceToken: fence.token,
    leaseOwner,
    leaseExpiresAt: fence.leaseExpiresAt,
    appliedGroupCount: fence.appliedGroupCount,
    appliedSourceCount: fence.appliedSourceCount,
  }, now), { merge: false });
  return fence;
});

const readMigrationJob = async (
  database: Firestore,
  ownerId: string,
  jobId: string,
): Promise<LegacyLibraryDiscoveryJob> => {
  const snapshot = await discoveryJobRef(database, ownerId, jobId).get();
  if (!snapshot.exists) throw new LegacyLibraryDiscoveryStateChangedError();
  return validDiscoveryJob(snapshot.data());
};

const renewMigrationFence = async (
  database: Firestore,
  ownerId: string,
  fence: MigrationFence,
): Promise<MigrationFence> => database.runTransaction(async transaction => {
  const [fenceSnapshot, jobSnapshot, rootSnapshot] = await Promise.all([
    transaction.get(migrationFenceReference(database, ownerId)),
    transaction.get(discoveryJobRef(database, ownerId, fence.jobId)),
    transaction.get(backupRef(database, ownerId, fence.jobId)),
  ]);
  const current = fenceFromSnapshot(fenceSnapshot);
  assertFenceLease(current, fence.token, fence.leaseOwner);
  const now = Timestamp.now();
  const next = { ...current, leaseExpiresAt: now.toMillis() + DISCOVERY_LEASE_MS };
  transaction.set(migrationFenceReference(database, ownerId), fenceData(next, now), { merge: false });
  const job = validDiscoveryJob(jobSnapshot.data());
  transaction.set(discoveryJobRef(database, ownerId, fence.jobId), discoveryJobData({
    ...job,
    leaseOwner: next.leaseOwner,
    leaseExpiresAt: next.leaseExpiresAt,
    fenceToken: next.token,
  }, now), { merge: false });
  if (rootSnapshot.exists) transaction.set(backupRef(database, ownerId, fence.jobId), {
    fenceToken: next.token,
    leaseOwner: next.leaseOwner,
    leaseExpiresAt: next.leaseExpiresAt,
    fenceRevision: next.revision,
    updatedAt: now,
  }, { merge: true });
  return next;
});

export const clearZeroProgressFence = async (
  database: Firestore,
  ownerId: string,
  fence: MigrationFence,
  phase: 'discovered' | 'complete',
): Promise<void> => database.runTransaction(async transaction => {
  const fenceReference = migrationFenceReference(database, ownerId);
  const jobReference = discoveryJobRef(database, ownerId, fence.jobId);
  const [fenceSnapshot, jobSnapshot, rootSnapshot] = await Promise.all([
    transaction.get(fenceReference),
    transaction.get(jobReference),
    transaction.get(backupRef(database, ownerId, fence.jobId)),
  ]);
  if (!fenceSnapshot.exists || !jobSnapshot.exists) return;
  const current = fenceFromSnapshot(fenceSnapshot);
  if (
    current.token !== fence.token
    || current.leaseOwner !== fence.leaseOwner
    || current.revision !== fence.revision
  ) return;
  const zeroProgress = current.phase === 'rollback'
    ? current.rollbackGroupCount === 0
    : current.appliedGroupCount === 0;
  if (!zeroProgress) return;
  const job = validDiscoveryJob(jobSnapshot.data());
  const now = Timestamp.now();
  transaction.set(jobReference, discoveryJobData({
    ...job,
    phase,
    leaseOwner: null,
    leaseExpiresAt: null,
    fenceToken: null,
    ...(phase === 'discovered' ? { appliedGroupCount: 0, appliedSourceCount: 0 } : {}),
  }, now), { merge: false });
  if (phase === 'discovered') {
    transaction.delete(backupRef(database, ownerId, fence.jobId));
  } else if (rootSnapshot.exists) transaction.set(backupRef(database, ownerId, fence.jobId), {
    fenceToken: null,
    leaseOwner: null,
    updatedAt: now,
  }, { merge: true });
  transaction.delete(fenceReference);
});

const ensureBackupRoot = async (
  database: Firestore,
  ownerId: string,
  fence: LegacyLibraryMigrationFence,
): Promise<void> => {
  const root = backupRef(database, ownerId, fence.jobId);
  await database.runTransaction(async transaction => {
    const [fenceSnapshot, rootSnapshot, progressSnapshot, facetsSnapshot, usageSnapshot] = await Promise.all([
      transaction.get(migrationFenceReference(database, ownerId)),
      transaction.get(root),
      transaction.get(migrationProgressRef(database, ownerId)),
      transaction.get(facetsRef(database, ownerId)),
      transaction.get(resourceUsageRef(database, ownerId)),
    ]);
    const current = fenceFromSnapshot(fenceSnapshot);
    assertFenceLease(current, fence.token, fence.leaseOwner);
    if (rootSnapshot.exists) {
      const rootData = rootSnapshot.data() ?? {};
      if (rootData.sourceRevision !== fence.sourceRevision
          || safeCounter(rootData.libraryEpoch) !== fence.libraryEpoch
          || safeCounter(rootData.sourceCount) !== fence.sourceCount
          || safeCounter(rootData.groupCount) !== fence.groupCount) {
        throw new LegacyLibraryDiscoveryStateChangedError();
      }
      transaction.set(root, {
        fenceToken: current.token,
        leaseOwner: current.leaseOwner,
        fenceRevision: current.revision,
        updatedAt: stableTimestamp(current),
      }, { merge: true });
      return;
    }
    transaction.create(root, {
      migrationVersion: MIGRATION_VERSION,
      ownerScope: 'self',
      jobId: fence.jobId,
      scanId: fence.scanId,
      sourceRevision: fence.sourceRevision,
      libraryEpoch: fence.libraryEpoch,
      sourceCount: fence.sourceCount,
      groupCount: fence.groupCount,
      fenceToken: fence.token,
      leaseOwner: fence.leaseOwner,
      fenceRevision: fence.revision,
      previousProgress: progressSnapshot.exists ? progressSnapshot.data() : null,
      previousFacets: facetsSnapshot.exists ? facetsSnapshot.data() : null,
      previousResourceUsage: usageSnapshot.exists ? usageSnapshot.data() : null,
      prepared: false,
      sealed: false,
      complete: false,
      createdAt: stableTimestamp(fence),
      updatedAt: stableTimestamp(fence),
    });
  });
};

const prepareGroupBackup = async (
  database: Firestore,
  ownerId: string,
  fence: LegacyLibraryMigrationFence,
  group: LegacyLibraryIdentityGroup,
): Promise<void> => {
  const sourceReferences = group.sources.map(source => cardsRef(database, ownerId).doc(source.id));
  const reservationReference = reservationRef(database, ownerId, group.normalizedWord);
  const canonicalId = createCanonicalCleanupCardId(group.normalizedWord);
  const tombstoneIds = [...new Set([canonicalId, ...group.sources.map(source => source.id)])];
  const tombstoneReferences = tombstoneIds.map(cardId => tombstoneRef(database, ownerId, cardId));
  const [sourceSnapshots, reservationSnapshot, ...tombstoneSnapshots] = await Promise.all([
    sourceReferences.length > 0 ? database.getAll(...sourceReferences) : Promise.resolve([]),
    reservationReference.get(),
    ...tombstoneReferences.map(reference => reference.get()),
  ]);
  if (sourceSnapshots.length !== group.sources.length || sourceSnapshots.some((snapshot, index) => (
    !sourceDigestMatches(snapshot, group.sources[index])
  ))) throw new LegacyLibraryGenerationChangedError();
  const beforeReservation = reservationSnapshot.exists ? reservationSnapshot.data() ?? null : null;
  const beforeTombstones = tombstoneIds.map((cardId, index) => ({
    cardId,
    data: tombstoneSnapshots[index]?.exists ? tombstoneSnapshots[index].data() ?? null : null,
  }));
  const root = backupRef(database, ownerId, fence.jobId);
  const sourceBackupReferences = group.sources.map(source => root.collection('sources').doc(source.id));
  const existingBackups = sourceBackupReferences.length > 0
    ? await database.getAll(...sourceBackupReferences)
    : [];
  const batch = database.batch();
  let hasWrites = false;
  for (const [index, source] of group.sources.entries()) {
    const existing = existingBackups[index];
    if (existing?.exists && !backupSourceMatches(existing, source, false)) {
      throw new LegacyLibraryDiscoveryStateChangedError();
    }
    if (!existing?.exists) {
      hasWrites = true;
      batch.create(sourceBackupReferences[index], {
        sourceId: source.id,
        sourceDigest: source.sourceDigest,
        sourceBytes: source.sourceBytes,
        source: sourceSnapshots[index].data() ?? {},
        prepared: true,
        sealed: false,
        capturedAt: stableTimestamp(fence),
      });
    }
  }
  if (hasWrites) await batch.commit();
  await database.runTransaction(async transaction => {
    const groupReference = discoveryGroupRef(database, ownerId, fence.jobId, group.normalizedWord);
    const [fenceSnapshot, groupSnapshot, ...liveSnapshots] = await Promise.all([
      transaction.get(migrationFenceReference(database, ownerId)),
      transaction.get(groupReference),
      ...sourceReferences.map(reference => transaction.get(reference)),
      transaction.get(reservationReference),
      ...tombstoneReferences.map(reference => transaction.get(reference)),
    ]);
    const current = fenceFromSnapshot(fenceSnapshot);
    assertFenceLease(current, fence.token, fence.leaseOwner);
    if (!groupSnapshot.exists) throw new LegacyLibraryDiscoveryStateChangedError();
    const liveSourceSnapshots = liveSnapshots.slice(0, sourceReferences.length);
    const liveReservationSnapshot = liveSnapshots[sourceReferences.length];
    const liveTombstoneSnapshots = liveSnapshots.slice(sourceReferences.length + 1);
    if (liveSourceSnapshots.length !== group.sources.length || liveSourceSnapshots.some((snapshot, index) => (
      !sourceDigestMatches(snapshot, group.sources[index])
    ))) throw new LegacyLibraryGenerationChangedError();
    if (digestLegacyLibraryValue(liveReservationSnapshot?.exists ? liveReservationSnapshot.data() ?? null : null)
      !== digestLegacyLibraryValue(beforeReservation)
      || liveTombstoneSnapshots.some((snapshot, index) => (
        digestLegacyLibraryValue(snapshot.exists ? snapshot.data() ?? null : null)
          !== digestLegacyLibraryValue(beforeTombstones[index].data)
      ))) throw new LegacyLibraryMigrationConflictError('tombstone');
    const storedGroup = groupSnapshot.data() ?? {};
    if (storedGroup.beforeReservation !== undefined
      && digestLegacyLibraryValue(storedGroup.beforeReservation) !== digestLegacyLibraryValue(beforeReservation)) {
      throw new LegacyLibraryDiscoveryStateChangedError();
    }
    if (Array.isArray(storedGroup.beforeTombstones)
      && digestLegacyLibraryValue(storedGroup.beforeTombstones) !== digestLegacyLibraryValue(beforeTombstones)) {
      throw new LegacyLibraryDiscoveryStateChangedError();
    }
    const backups = await Promise.all(sourceBackupReferences.map(reference => transaction.get(reference)));
    if (backups.length !== group.sources.length || backups.some((snapshot, index) => (
      !backupSourceMatches(snapshot, group.sources[index], false)
    ))) throw new LegacyLibraryDiscoveryStateChangedError();
    transaction.set(groupReference, {
      beforeReservation,
      beforeTombstones,
      backupSealed: true,
      backupSealedAt: stableTimestamp(current),
    }, { merge: true });
    for (const reference of sourceBackupReferences) transaction.set(reference, {
      sealed: true,
      sealedAt: stableTimestamp(current),
    }, { merge: true });
  });
};

const enterApplyPhase = async (
  database: Firestore,
  ownerId: string,
  fence: MigrationFence,
): Promise<MigrationFence> => database.runTransaction(async transaction => {
  const [fenceSnapshot, jobSnapshot, rootSnapshot] = await Promise.all([
    transaction.get(migrationFenceReference(database, ownerId)),
    transaction.get(discoveryJobRef(database, ownerId, fence.jobId)),
    transaction.get(backupRef(database, ownerId, fence.jobId)),
  ]);
  const current = fenceFromSnapshot(fenceSnapshot);
  assertFenceLease(current, fence.token, fence.leaseOwner);
  if (current.appliedGroupCount > 0 || current.phase === 'apply') return current;
  if (!rootSnapshot.exists) throw new LegacyLibraryDiscoveryStateChangedError();
  const job = validDiscoveryJob(jobSnapshot.data());
  const now = Timestamp.now();
  const next: MigrationFence = {
    ...current,
    phase: 'apply',
    revision: current.revision + 1,
    leaseExpiresAt: now.toMillis() + DISCOVERY_LEASE_MS,
  };
  transaction.set(migrationFenceReference(database, ownerId), fenceData(next, now), { merge: false });
  transaction.set(backupRef(database, ownerId, fence.jobId), {
    fenceToken: next.token,
    leaseOwner: next.leaseOwner,
    fenceRevision: next.revision,
    updatedAt: stableTimestamp(next),
  }, { merge: true });
  transaction.set(discoveryJobRef(database, ownerId, fence.jobId), discoveryJobData({
    ...job,
    phase: 'apply',
    fenceToken: next.token,
    leaseOwner: next.leaseOwner,
    leaseExpiresAt: next.leaseExpiresAt,
    appliedGroupCount: next.appliedGroupCount,
    appliedSourceCount: next.appliedSourceCount,
  }, now), { merge: false });
  return next;
});

const applyMigrationGroup = async (
  database: Firestore,
  ownerId: string,
  fence: MigrationFence,
  group: LegacyLibraryIdentityGroup,
): Promise<MigrationFence> => database.runTransaction(async transaction => {
  const sourceReferences = group.sources.map(source => cardsRef(database, ownerId).doc(source.id));
  const canonicalReference = cardsRef(database, ownerId).doc(createCanonicalCleanupCardId(group.normalizedWord));
  const canonicalIsSource = sourceReferences.some(reference => reference.id === canonicalReference.id);
  const sourceAndCanonicalReferences = canonicalIsSource
    ? sourceReferences
    : [...sourceReferences, canonicalReference];
  const tombstoneIds = [...new Set([canonicalReference.id, ...group.sources.map(source => source.id)])];
  const tombstoneReferences = tombstoneIds.map(cardId => tombstoneRef(database, ownerId, cardId));
  const planReference = planBackupRef(database, ownerId, fence.jobId, group.normalizedWord);
  const [fenceSnapshot, jobSnapshot, groupSnapshot, rootSnapshot, ...snapshots] = await Promise.all([
    transaction.get(migrationFenceReference(database, ownerId)),
    transaction.get(discoveryJobRef(database, ownerId, fence.jobId)),
    transaction.get(discoveryGroupRef(database, ownerId, fence.jobId, group.normalizedWord)),
    transaction.get(backupRef(database, ownerId, fence.jobId)),
    ...sourceAndCanonicalReferences.map(reference => transaction.get(reference)),
    transaction.get(reservationRef(database, ownerId, group.normalizedWord)),
    ...tombstoneReferences.map(reference => transaction.get(reference)),
  ]);
  const current = fenceFromSnapshot(fenceSnapshot);
  assertFenceLease(current, fence.token, fence.leaseOwner);
  if (current.revision !== fence.revision) throw new LegacyLibraryMigrationConflictError('revision');
  if (!rootSnapshot.exists || !groupSnapshot.exists) throw new LegacyLibraryDiscoveryStateChangedError();
  const rootData = rootSnapshot.data() ?? {};
  if (rootData.fenceToken !== current.token
      || rootData.leaseOwner !== current.leaseOwner
      || rootData.fenceRevision !== current.revision) {
    throw new LegacyLibraryMigrationConflictError('revision');
  }
  const groupData = groupSnapshot.data() ?? {};
  const currentGroup = parseDiscoveryGroup(groupData);
  const applied = groupData.status === 'applied';
  if (applied) return current;
  const sourceSnapshots = snapshots.slice(0, sourceReferences.length);
  const canonicalSnapshot = canonicalIsSource
    ? sourceSnapshots.find(snapshot => snapshot.id === canonicalReference.id)
    : snapshots[sourceReferences.length];
  const reservationIndex = sourceAndCanonicalReferences.length;
  const reservationSnapshot = snapshots[reservationIndex];
  const tombstoneSnapshots = snapshots.slice(reservationIndex + 1);
  if (
    sourceSnapshots.length !== group.sources.length
    || sourceSnapshots.some((snapshot, index) => !sourceDigestMatches(snapshot, group.sources[index]))
  ) throw new LegacyLibraryMigrationConflictError('source');
  if (!canonicalIsSource && canonicalSnapshot?.exists) {
    throw new LegacyLibraryMigrationConflictError('source');
  }
  if (!Array.isArray(groupData.beforeTombstones)
      || groupData.beforeTombstones.length !== tombstoneIds.length
      || groupData.beforeReservation === undefined) {
    throw new LegacyLibraryDiscoveryStateChangedError();
  }
  const beforeReservation = groupData.beforeReservation as DocumentData | null;
  const beforeTombstones = groupData.beforeTombstones as Array<{ cardId: string; data: DocumentData | null }>;
  if (digestLegacyLibraryValue(reservationSnapshot?.exists ? reservationSnapshot.data() ?? null : null)
      !== digestLegacyLibraryValue(beforeReservation)) {
    throw new LegacyLibraryMigrationConflictError('reservation');
  }
  if (beforeTombstones.some((item, index) => (
    item.cardId !== tombstoneIds[index]
      || digestLegacyLibraryValue(item.data)
      !== digestLegacyLibraryValue(tombstoneSnapshots[index]?.exists
        ? tombstoneSnapshots[index].data() ?? null
        : null)
  ))) throw new LegacyLibraryMigrationConflictError('tombstone');
  const liveCards = sourceSnapshots.map(cardFromSnapshot);
  const livePlan = planLegacyIdentityGroup(liveCards, {
    jobId: fence.jobId,
    libraryEpoch: fence.libraryEpoch,
  });
  if (
    livePlan.normalizedWord !== group.normalizedWord
    || livePlan.primaryId !== createCanonicalCleanupCardId(group.normalizedWord)
    || new Set(livePlan.loserIds).size !== livePlan.loserIds.length
    || livePlan.loserIds.some(id => !group.sources.some(source => source.id === id))
  ) throw new LegacyLibraryMigrationConflictError('source');
  const updatedCard = withoutUndefined({
    ...livePlan.merged,
    updatedAt: stableIso(current),
  });
  const canonicalBytes = canonicalLegacyLibraryUtf8Bytes(updatedCard).byteLength;
  const loserTombstones = livePlan.loserIds.map((cardId, index) => {
    const sourceIndex = group.sources.findIndex(source => source.id === cardId);
    const tombstoneIndex = tombstoneIds.indexOf(cardId);
    const previous = tombstoneSnapshots[tombstoneIndex];
    const previousRevision = previous?.exists ? safeCounter(previous.data()?.revision ?? 0) : 0;
    const sourceRevision = sourceSnapshots[sourceIndex]?.exists
      ? safeCounter(sourceSnapshots[sourceIndex].data()?.revision ?? 0)
      : 0;
    const revision = Math.max(
      livePlan.tombstones[index]?.revision ?? 0,
      previousRevision,
      sourceRevision,
    );
    return {
      cardId,
      data: {
        ...(livePlan.tombstones[index] ?? {}),
        cardId,
        opId: livePlan.tombstones[index]?.opId ?? `duplicate-cleanup-${fence.jobId}-${cardId}`,
        libraryEpoch: fence.libraryEpoch,
        revision,
        deletedAt: stableIso(current),
      },
    };
  });
  const tombstoneData = tombstoneIds.map(cardId => ({
    cardId,
    data: loserTombstones.find(item => item.cardId === cardId)?.data ?? null,
  }));
  const afterReservation = matchingReservation(livePlan.primaryId, livePlan.normalizedWord);
  const afterStateIds = [...new Set([livePlan.primaryId, ...group.sources.map(source => source.id)])];
  const appliedDigest = digestAfterState({
    canonical: updatedCard,
    reservation: afterReservation,
    tombstones: afterStateIds.map(cardId => ({
      cardId,
      data: tombstoneData.find(item => item.cardId === cardId)?.data ?? null,
    })),
    absentSourceIds: livePlan.loserIds,
  });
  const estimate = canonicalBytes
    + canonicalLegacyLibraryUtf8Bytes(afterReservation).byteLength
    + tombstoneData.reduce((total, item) => total + canonicalLegacyLibraryUtf8Bytes(item.data).byteLength, 0);
  if (estimate > 8 * 1024 * 1024) throw new LegacyLibraryMigrationResourceLimitError();
  const planBackup = {
    schemaVersion: 1,
    normalizedWord: livePlan.normalizedWord,
    sourceIds: afterStateIds,
    originalSourceIds: group.sources.map(source => source.id),
    primaryId: livePlan.primaryId,
    loserIds: livePlan.loserIds,
    beforeReservation,
    beforeTombstones,
    canonicalAfter: updatedCard,
    reservationAfter: afterReservation,
    tombstonesAfter: tombstoneData,
    absentSourceIds: livePlan.loserIds,
    appliedDigest,
    sourceRevision: fence.sourceRevision,
    libraryEpoch: fence.libraryEpoch,
    status: 'applied',
    appliedAt: stableTimestamp(current),
  };
  transaction.set(planReference, planBackup, { merge: false });
  transaction.set(cardsRef(database, ownerId).doc(livePlan.primaryId), updatedCard, { merge: false });
  transaction.set(reservationRef(database, ownerId, livePlan.normalizedWord), afterReservation, { merge: false });
  for (const item of tombstoneData) {
    if (item.data) transaction.set(tombstoneRef(database, ownerId, item.cardId), item.data, { merge: false });
    else transaction.delete(tombstoneRef(database, ownerId, item.cardId));
  }
  for (const item of loserTombstones) {
    transaction.delete(cardsRef(database, ownerId).doc(item.cardId));
  }
  const next: MigrationFence = {
    ...current,
    phase: 'apply',
    revision: current.revision + 1,
    leaseExpiresAt: Date.now() + DISCOVERY_LEASE_MS,
    appliedGroupCount: current.appliedGroupCount + 1,
    appliedSourceCount: current.appliedSourceCount + group.sources.length,
  };
  transaction.set(discoveryGroupRef(database, ownerId, fence.jobId, currentGroup.normalizedWord), {
    status: 'applied',
    appliedDigest,
    appliedSourceCount: group.sources.length,
    appliedAt: stableTimestamp(current),
  }, { merge: true });
  const job = validDiscoveryJob(jobSnapshot.data());
  transaction.set(discoveryJobRef(database, ownerId, fence.jobId), discoveryJobData({
    ...job,
    phase: 'apply',
    fenceToken: next.token,
    leaseOwner: next.leaseOwner,
    leaseExpiresAt: next.leaseExpiresAt,
    appliedGroupCount: next.appliedGroupCount,
    appliedSourceCount: next.appliedSourceCount,
  }, stableTimestamp(current)), { merge: false });
  transaction.set(migrationFenceReference(database, ownerId), fenceData(next, stableTimestamp(current)), { merge: false });
  transaction.set(backupRef(database, ownerId, fence.jobId), {
    fenceToken: next.token,
    leaseOwner: next.leaseOwner,
    fenceRevision: next.revision,
    appliedGroupCount: next.appliedGroupCount,
    appliedSourceCount: next.appliedSourceCount,
    updatedAt: stableTimestamp(next),
  }, { merge: true });
  return next;
});

type FinalLibraryState = {
  readonly cards: CleanupCard[];
  readonly facets: Record<string, number>;
  readonly reservationCount: number;
  readonly aggregateDigest: string;
};

const scanFinalLibrary = async (
  database: Firestore,
  ownerId: string,
  fence: LegacyLibraryMigrationFence,
  groups: readonly LegacyLibraryIdentityGroup[],
): Promise<FinalLibraryState> => {
  const fenceSnapshot = await migrationFenceReference(database, ownerId).get();
  const currentFence = fenceFromSnapshot(fenceSnapshot);
  assertFenceLease(currentFence, fence.token, fence.leaseOwner);
  if (currentFence.revision !== fence.revision) throw new LegacyLibraryMigrationConflictError('revision');
  const fresh = await readFreshLibrary(database, ownerId);
  if (fresh.libraryEpoch !== currentFence.libraryEpoch) throw new LegacyLibraryGenerationChangedError();
  if (fresh.cards.length !== groups.length) throw new LegacyLibraryMigrationConflictError('final-scan');
  const cardsByWord = new Map<string, CleanupCard[]>();
  for (const card of fresh.cards) {
    const word = normalizedLegacyLibraryIdentity(card);
    if (!word) throw new LegacyLibraryMigrationConflictError('final-scan');
    const bucket = cardsByWord.get(word) ?? [];
    bucket.push(card);
    cardsByWord.set(word, bucket);
  }
  if (cardsByWord.size !== groups.length) throw new LegacyLibraryMigrationConflictError('final-scan');
  const reservationsSnapshot = await ownerRef(database, ownerId).collection('card_reservations').get();
  if (reservationsSnapshot.size !== groups.length) throw new LegacyLibraryMigrationConflictError('final-scan');
  for (const group of groups) {
    const cards = cardsByWord.get(group.normalizedWord) ?? [];
    const canonicalId = createCanonicalCleanupCardId(group.normalizedWord);
    if (
      cards.length !== 1
      || cards[0].id !== canonicalId
      || cards[0].word !== group.normalizedWord
      || cards[0].normalizedWord !== group.normalizedWord
      || cards[0].schemaVersion !== 2
      || cards[0].libraryEpoch !== currentFence.libraryEpoch
    ) throw new LegacyLibraryMigrationConflictError('final-scan');
    const reservation = reservationsSnapshot.docs.find(document => (
      document.id === createLegacyReservationId(group.normalizedWord)
    ));
    if (!reservation || digestLegacyLibraryValue(reservation.data()) !== digestLegacyLibraryValue(
      matchingReservation(canonicalId, group.normalizedWord),
    )) throw new LegacyLibraryMigrationConflictError('final-scan');
  }
  const facets = summarizeFacetCounts(fresh.cards);
  if (Object.keys(facets).length > 256) throw new LegacyLibraryMigrationResourceLimitError();
  const aggregate = await readFinalLibraryAggregate(database, ownerId);
  const updatedAt = stableIso(currentFence);
  const expectedResourceUsage = {
    ...(aggregate.resourceUsage ?? {}),
    schemaVersion: 1,
    cardCount: fresh.cards.length,
  };
  const expectedAggregate: FinalLibraryAggregate = {
    ...aggregate,
    cards: fresh.cards.map(card => ({ id: card.id, data: withoutUndefined(card) })),
    facets: {
      categories: facets,
      complete: true,
      version: 1,
      updatedAt,
    },
    migrationProgress: {
      migrationVersion: MIGRATION_VERSION,
      jobId: fence.jobId,
      complete: true,
      scanned: fresh.cards.length,
      lastDocumentId: null,
      updatedAt,
    },
    resourceUsage: expectedResourceUsage,
  };
  return {
    cards: fresh.cards,
    facets,
    reservationCount: reservationsSnapshot.size,
    aggregateDigest: digestFinalLibraryAggregate(expectedAggregate),
  };
};

const verifySealedFinalLibrary = async (
  database: Firestore,
  ownerId: string,
  fence: MigrationFence,
): Promise<void> => {
  const rootSnapshot = await backupRef(database, ownerId, fence.jobId).get();
  if (!rootSnapshot.exists) throw new LegacyLibraryRollbackConflictError(1, 1);
  const root = rootSnapshot.data() ?? {};
  const expectedDigest = root.finalAggregateDigest;
  if (typeof expectedDigest !== 'string' || !isDiscoveryDigest(expectedDigest)) {
    throw new LegacyLibraryRollbackConflictError(1, 1);
  }
  const aggregate = await readFinalLibraryAggregate(database, ownerId);
  if (
    aggregate.cards.length !== safeCounter(root.finalCardCount)
    || aggregate.reservations.length !== safeCounter(root.finalReservationCount)
    || Object.keys((aggregate.facets?.categories ?? {}) as Record<string, unknown>).length
      !== safeCounter(root.finalFacetCount)
    || digestFinalLibraryAggregate(aggregate) !== expectedDigest
  ) throw new LegacyLibraryRollbackConflictError(1, aggregate.cards.length);
};

const finalizeMigration = async (
  database: Firestore,
  ownerId: string,
  fence: LegacyLibraryMigrationFence,
  groups: readonly LegacyLibraryIdentityGroup[],
  finalState: FinalLibraryState,
): Promise<LegacyLibraryMigrationOperatorResult> => database.runTransaction(async transaction => {
  const [fenceSnapshot, jobSnapshot, rootSnapshot] = await Promise.all([
    transaction.get(migrationFenceReference(database, ownerId)),
    transaction.get(discoveryJobRef(database, ownerId, fence.jobId)),
    transaction.get(backupRef(database, ownerId, fence.jobId)),
  ]);
  const current = fenceFromSnapshot(fenceSnapshot);
  assertFenceLease(current, fence.token, fence.leaseOwner);
  if (current.appliedGroupCount !== groups.length) {
    throw new LegacyLibraryMigrationConflictError('final-scan');
  }
  if (!rootSnapshot.exists) throw new LegacyLibraryDiscoveryStateChangedError();
  const rootData = rootSnapshot.data() ?? {};
  if (rootData.fenceToken !== current.token
      || rootData.leaseOwner !== current.leaseOwner
      || rootData.fenceRevision !== current.revision) {
    throw new LegacyLibraryMigrationConflictError('revision');
  }
  const job = validDiscoveryJob(jobSnapshot.data());
  const now = stableTimestamp(current);
  const updatedJob: LegacyLibraryDiscoveryJob = {
    ...job,
    phase: 'complete',
    leaseOwner: null,
    leaseExpiresAt: null,
    appliedGroupCount: current.appliedGroupCount,
    appliedSourceCount: current.appliedSourceCount,
  };
  transaction.set(facetsRef(database, ownerId), {
    categories: finalState.facets,
    complete: true,
    version: 1,
    updatedAt: stableIso(current),
  }, { merge: false });
  transaction.set(migrationProgressRef(database, ownerId), {
    migrationVersion: MIGRATION_VERSION,
    jobId: fence.jobId,
    complete: true,
    scanned: finalState.cards.length,
    lastDocumentId: null,
    updatedAt: stableIso(current),
  }, { merge: false });
  transaction.set(resourceUsageRef(database, ownerId), {
    schemaVersion: 1,
    cardCount: finalState.cards.length,
  }, { merge: true });
  transaction.set(backupRef(database, ownerId, fence.jobId), {
    finalCardCount: finalState.cards.length,
    finalReservationCount: finalState.reservationCount,
    finalFacetCount: Object.keys(finalState.facets).length,
    finalAggregateDigest: finalState.aggregateDigest,
    complete: true,
    completedAt: now,
    fenceToken: current.token,
    leaseOwner: null,
    fenceRevision: current.revision,
    updatedAt: now,
  }, { merge: true });
  transaction.set(discoveryJobRef(database, ownerId, fence.jobId), discoveryJobData(updatedJob, now), { merge: false });
  transaction.delete(migrationFenceReference(database, ownerId));
  return {
    ownerKey: '',
    jobId: fence.jobId,
    phase: 'complete',
    sourceRevision: fence.sourceRevision,
    scanned: finalState.cards.length,
    sourceCount: fence.sourceCount,
    groupCount: fence.groupCount,
    appliedGroupCount: current.appliedGroupCount,
    complete: true,
  };
});

export async function applyLegacyLibraryMigration(
  database: Firestore,
  ownerId: string,
  options: LegacyLibraryMigrationApplyOptions,
): Promise<LegacyLibraryMigrationOperatorResult> {
  const initialJob = await readMigrationJob(database, ownerId, options.jobId);
  if (initialJob.phase === 'complete') {
    const root = await backupRef(database, ownerId, options.jobId).get();
    if (!root.exists || root.data()?.sourceRevision !== options.sourceRevision
        || root.data()?.complete !== true
        || !isDiscoveryDigest(root.data()?.finalAggregateDigest)
        || !isDiscoveryDigest(options.sourceRevision)) {
      throw new LegacyLibraryDiscoveryStateChangedError();
    }
    const data = root.data() ?? {};
    return {
      ownerKey: '',
      jobId: options.jobId,
      phase: 'complete',
      sourceRevision: options.sourceRevision,
      scanned: safeCounter(data.finalCardCount ?? 0),
      sourceCount: safeCounter(data.sourceCount ?? initialJob.sourceCount),
      groupCount: safeCounter(data.groupCount ?? initialJob.groupCount),
      appliedGroupCount: safeCounter(data.groupCount ?? initialJob.groupCount),
      complete: true,
    };
  }
  let fence = await beginMigrationFence(database, ownerId, options, 'verify');
  try {
    const job = await readMigrationJob(database, ownerId, options.jobId);
    const groups = await readManifestGroups(database, ownerId, options.jobId);
    if (groups.length !== fence.groupCount) throw new LegacyLibraryDiscoveryStateChangedError();
    if (fence.appliedGroupCount === 0) {
      const fresh = await readFreshLibrary(database, ownerId);
      verifyFreshManifest(fresh, job, groups);
      await ensureBackupRoot(database, ownerId, fence);
      for (const group of groups) {
        fence = await renewMigrationFence(database, ownerId, fence);
        const groupSnapshot = await discoveryGroupRef(database, ownerId, options.jobId, group.normalizedWord).get();
        if (!groupSnapshot.exists) throw new LegacyLibraryDiscoveryStateChangedError();
        if (groupSnapshot.data()?.backupSealed === true) continue;
        await prepareGroupBackup(database, ownerId, fence, group);
      }
      fence = await enterApplyPhase(database, ownerId, fence);
    } else {
      await ensureBackupRoot(database, ownerId, fence);
    }
    for (const group of groups) {
      fence = await renewMigrationFence(database, ownerId, fence);
      const groupSnapshot = await discoveryGroupRef(database, ownerId, options.jobId, group.normalizedWord).get();
      if (groupSnapshot.data()?.status === 'applied') continue;
      if (groupSnapshot.data()?.backupSealed !== true) {
        await prepareGroupBackup(database, ownerId, fence, group);
      }
      fence = await applyMigrationGroup(database, ownerId, fence, group);
    }
    const finalState = await scanFinalLibrary(database, ownerId, fence, groups);
    return await finalizeMigration(database, ownerId, fence, groups, finalState);
  } catch (error) {
    if (fence.appliedGroupCount === 0) {
      await clearZeroProgressFence(database, ownerId, fence, 'discovered');
    }
    throw error;
  }
}

export async function abortLegacyLibraryMigration(
  database: Firestore,
  ownerId: string,
  jobId: string,
  sourceRevision: string,
): Promise<void> {
  if (!isDiscoveryDigest(sourceRevision)) throw new LegacyLibraryDiscoveryStateChangedError();
  await database.runTransaction(async transaction => {
    const [jobSnapshot, fenceSnapshot] = await Promise.all([
      transaction.get(discoveryJobRef(database, ownerId, jobId)),
      transaction.get(migrationFenceReference(database, ownerId)),
    ]);
    if (!fenceSnapshot.exists) return;
    const fence = fenceFromSnapshot(fenceSnapshot);
    if (fence.jobId !== jobId || fence.sourceRevision !== sourceRevision) {
      throw new LegacyLibraryDiscoveryStateChangedError();
    }
    assertFenceLease(fence, fence.token, fence.leaseOwner);
    if (fence.appliedGroupCount !== 0) {
      throw new LegacyLibraryMigrationConflictError('revision');
    }
    const job = validDiscoveryJob(jobSnapshot.data());
    const now = Timestamp.now();
    transaction.set(discoveryJobRef(database, ownerId, jobId), discoveryJobData({
      ...job,
      phase: 'blocked',
      blockedReason: 'operator-aborted',
      leaseOwner: null,
      leaseExpiresAt: null,
    }, now), { merge: false });
    transaction.delete(migrationFenceReference(database, ownerId));
  });
}

export function createFirestoreLegacyLibraryDiscoveryStore(
  database: Firestore,
): LegacyLibraryDiscoveryStore {
  const discovery: LegacyLibraryDiscoveryStore = {
    acquireDiscoveryLease: async (ownerId, request) => database.runTransaction(async transaction => {
      if (!isDiscoveryUuid(request.scanId) || !isDiscoveryLeaseOwner(request.leaseOwner)) {
        throw new Error('Legacy library discovery lease request is invalid.');
      }
      const reference = discoveryJobRef(database, ownerId, request.jobId);
      const [snapshot, fenceSnapshot] = await Promise.all([
        transaction.get(reference),
        transaction.get(migrationFenceReference(database, ownerId)),
      ]);
      const now = Timestamp.now();
      const nowMillis = now.toMillis();
      const current = snapshot.exists ? validDiscoveryJob(snapshot.data()) : null;
      if (current && current.phase !== 'discover') return current;
      if (fenceSnapshot.exists && isActiveMigrationFence(fenceSnapshot.data())) {
        throw new LegacyLibraryMigrationFenceError('active');
      }
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

  return discovery;
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

type RollbackPlan = DocumentData & {
  status?: unknown;
  sourceIds?: unknown;
  originalSourceIds?: unknown;
  primaryId?: unknown;
  loserIds?: unknown;
  beforeReservation?: unknown;
  beforeTombstones?: unknown;
  canonicalAfter?: unknown;
  reservationAfter?: unknown;
  tombstonesAfter?: unknown;
  absentSourceIds?: unknown;
  appliedDigest?: unknown;
};

const asRollbackPlan = (value: DocumentData): RollbackPlan => {
  if (
    value.schemaVersion !== 1
    || value.status !== 'applied' && value.status !== 'rolledBack'
    || typeof value.normalizedWord !== 'string'
    || typeof value.primaryId !== 'string'
    || !Array.isArray(value.sourceIds)
    || !Array.isArray(value.originalSourceIds)
    || !Array.isArray(value.loserIds)
    || typeof value.appliedDigest !== 'string'
  ) throw new LegacyLibraryRollbackConflictError(1, 1);
  return value as RollbackPlan;
};

const rollbackPlanSourceIds = (plan: RollbackPlan): string[] => {
  const ids = (plan.sourceIds as unknown[]).map(value => assertSafeSegment(String(value), 'Card ID'));
  if (ids.length === 0 || new Set(ids).size !== ids.length) {
    throw new LegacyLibraryRollbackConflictError(1, ids.length);
  }
  return ids;
};

const rollbackPlanOriginalSourceIds = (plan: RollbackPlan): string[] => {
  const ids = (plan.originalSourceIds as unknown[]).map(value => assertSafeSegment(String(value), 'Original card ID'));
  if (ids.length === 0 || new Set(ids).size !== ids.length) {
    throw new LegacyLibraryRollbackConflictError(1, ids.length);
  }
  return ids;
};

const rollbackAfterState = async (
  database: Firestore,
  ownerId: string,
  plan: RollbackPlan,
): Promise<{ digest: string; sourceCount: number }> => {
  const sourceIds = rollbackPlanSourceIds(plan);
  const primaryId = assertSafeSegment(String(plan.primaryId), 'Card ID');
  const references = sourceIds.map(cardId => cardsRef(database, ownerId).doc(cardId));
  const tombstoneReferences = sourceIds.map(cardId => tombstoneRef(database, ownerId, cardId));
  const [sourceSnapshots, reservationSnapshot, tombstoneSnapshots] = await Promise.all([
    database.getAll(...references),
    reservationRef(database, ownerId, String(plan.normalizedWord)).get(),
    database.getAll(...tombstoneReferences),
  ]);
  const canonical = sourceSnapshots.find(snapshot => snapshot.id === primaryId);
  if (!canonical?.exists) throw new LegacyLibraryRollbackConflictError(1, sourceIds.length);
  const loserIds = (plan.loserIds as unknown[]).map(value => assertSafeSegment(String(value), 'Card ID'));
  const absent = new Set(loserIds);
  if (sourceSnapshots.some(snapshot => absent.has(snapshot.id) && snapshot.exists)) {
    throw new LegacyLibraryRollbackConflictError(1, loserIds.length);
  }
  const tombstoneAfter = new Map<string, DocumentData | null>();
  if (Array.isArray(plan.tombstonesAfter)) {
    for (const value of plan.tombstonesAfter as unknown[]) {
      if (!value || typeof value !== 'object' || typeof (value as { cardId?: unknown }).cardId !== 'string') {
        throw new LegacyLibraryRollbackConflictError(1, loserIds.length);
      }
      const item = value as { cardId: string; data?: DocumentData | null };
      if (item.data !== null && (item.data === undefined || typeof item.data !== 'object')) {
        throw new LegacyLibraryRollbackConflictError(1, loserIds.length);
      }
      tombstoneAfter.set(item.cardId, item.data ?? null);
    }
  }
  if (tombstoneAfter.size !== sourceIds.length) {
    throw new LegacyLibraryRollbackConflictError(1, loserIds.length);
  }
  const currentTombstones = sourceIds.map((cardId, index) => ({
    cardId,
    data: tombstoneSnapshots[index]?.exists ? tombstoneSnapshots[index].data() ?? null : null,
  }));
  for (const item of currentTombstones) {
    const expected = tombstoneAfter.get(item.cardId) ?? null;
    if (digestLegacyLibraryValue(item.data) !== digestLegacyLibraryValue(expected)) {
      throw new LegacyLibraryRollbackConflictError(1, sourceIds.length);
    }
  }
  const expectedReservation = plan.reservationAfter ?? null;
  if (digestLegacyLibraryValue(reservationSnapshot.exists ? reservationSnapshot.data() : null)
      !== digestLegacyLibraryValue(expectedReservation)) {
    throw new LegacyLibraryRollbackConflictError(1, sourceIds.length);
  }
  const digest = digestAfterState({
    canonical: canonical.data() ?? null,
    reservation: reservationSnapshot.exists ? reservationSnapshot.data() ?? null : null,
    tombstones: currentTombstones,
    absentSourceIds: loserIds,
  });
  return { digest, sourceCount: sourceIds.length };
};

const preflightRollback = async (
  database: Firestore,
  ownerId: string,
  fence: MigrationFence,
): Promise<{
  plans: Array<{ reference: ReturnType<typeof planBackupRef>; plan: RollbackPlan }>;
  sourceCount: number;
  fence: MigrationFence;
}> => {
  const snapshot = await backupRef(database, ownerId, fence.jobId).collection('plans').get();
  const groups = await readManifestGroups(database, ownerId, fence.jobId);
  const groupsByWord = new Map(groups.map(group => [group.normalizedWord, group]));
  const plans: Array<{ reference: ReturnType<typeof planBackupRef>; plan: RollbackPlan }> = [];
  let sourceCount = 0;
  let totalCount = 0;
  let currentFence = fence;
  for (const document of snapshot.docs) {
    currentFence = await renewMigrationFence(database, ownerId, currentFence);
    const plan = asRollbackPlan(document.data());
    totalCount += 1;
    if (plan.status === 'rolledBack') continue;
    if (plan.sourceRevision !== fence.sourceRevision || safeCounter(plan.libraryEpoch) !== fence.libraryEpoch) {
      throw new LegacyLibraryRollbackConflictError(1, 1);
    }
    const group = groupsByWord.get(String(plan.normalizedWord));
    const originalSourceIds = rollbackPlanOriginalSourceIds(plan);
    if (!group
        || group.sources.length !== originalSourceIds.length
        || group.sources.some((source, index) => source.id !== originalSourceIds[index])) {
      throw new LegacyLibraryRollbackConflictError(1, originalSourceIds.length);
    }
    const sourceBackups = await database.getAll(...originalSourceIds.map(cardId => (
      backupRef(database, ownerId, fence.jobId).collection('sources').doc(cardId)
    )));
    if (sourceBackups.length !== group.sources.length || sourceBackups.some((backup, index) => (
      !backupSourceMatches(backup, group.sources[index])
    ))) throw new LegacyLibraryRollbackConflictError(1, originalSourceIds.length);
    const sourceIds = rollbackPlanSourceIds(plan);
    if (!Array.isArray(plan.beforeTombstones) || (plan.beforeTombstones as unknown[]).length !== sourceIds.length) {
      throw new LegacyLibraryRollbackConflictError(1, sourceIds.length);
    }
    const result = await rollbackAfterState(database, ownerId, plan);
    if (result.digest !== plan.appliedDigest) {
      throw new LegacyLibraryRollbackConflictError(1, result.sourceCount);
    }
    plans.push({
      reference: planBackupRef(database, ownerId, fence.jobId, String(plan.normalizedWord)),
      plan,
    });
    sourceCount += result.sourceCount;
  }
  if (totalCount !== fence.appliedGroupCount) {
    throw new LegacyLibraryRollbackConflictError(1, sourceCount);
  }
  return { plans, sourceCount, fence: currentFence };
};

const rollbackOneGroup = async (
  database: Firestore,
  ownerId: string,
  fence: MigrationFence,
  reference: ReturnType<typeof planBackupRef>,
): Promise<MigrationFence> => database.runTransaction(async transaction => {
  const planSnapshot = await transaction.get(reference);
  const fenceSnapshot = await transaction.get(migrationFenceReference(database, ownerId));
  const rootSnapshot = await transaction.get(backupRef(database, ownerId, fence.jobId));
  if (!planSnapshot.exists) throw new LegacyLibraryRollbackConflictError(1, 1);
  const plan = asRollbackPlan(planSnapshot.data() ?? {});
  const groupSnapshot = await transaction.get(
    discoveryGroupRef(database, ownerId, fence.jobId, String(plan.normalizedWord)),
  );
  const current = fenceFromSnapshot(fenceSnapshot);
  assertFenceLease(current, fence.token, fence.leaseOwner);
  if (!rootSnapshot.exists) throw new LegacyLibraryRollbackConflictError(1, 1);
  const rootData = rootSnapshot.data() ?? {};
  if (rootData.fenceToken !== current.token
      || rootData.leaseOwner !== current.leaseOwner
      || rootData.fenceRevision !== current.revision) {
    throw new LegacyLibraryRollbackConflictError(1, 1);
  }
  if (current.revision !== fence.revision) throw new LegacyLibraryRollbackConflictError(1, 1);
  if (plan.status === 'rolledBack') return current;
  const sourceIds = rollbackPlanSourceIds(plan);
  const originalSourceIds = rollbackPlanOriginalSourceIds(plan);
  if (!groupSnapshot.exists) throw new LegacyLibraryRollbackConflictError(1, sourceIds.length);
  const originalSources = parseDiscoveryGroup(groupSnapshot.data()).sources;
  if (originalSources.length !== originalSourceIds.length
      || originalSources.some((source, index) => source.id !== originalSourceIds[index])) {
    throw new LegacyLibraryRollbackConflictError(1, sourceIds.length);
  }
  const primaryId = assertSafeSegment(String(plan.primaryId), 'Card ID');
  const sourceReferences = sourceIds.map(cardId => cardsRef(database, ownerId).doc(cardId));
  const sourceBackups = sourceIds.map(cardId => backupRef(database, ownerId, fence.jobId).collection('sources').doc(cardId));
  const tombstoneReferences = sourceIds.map(cardId => tombstoneRef(database, ownerId, cardId));
  const [canonicalSnapshot, reservationSnapshot, ...snapshots] = await Promise.all([
    transaction.get(cardsRef(database, ownerId).doc(primaryId)),
    transaction.get(reservationRef(database, ownerId, String(plan.normalizedWord))),
    ...sourceReferences.map(ref => transaction.get(ref)),
    ...tombstoneReferences.map(ref => transaction.get(ref)),
    ...sourceBackups.map(ref => transaction.get(ref)),
  ]);
  const tombstoneSnapshots = snapshots.slice(sourceReferences.length, sourceReferences.length * 2);
  const backupSnapshots = snapshots.slice(sourceReferences.length * 2);
  const currentDigest = digestAfterState({
    canonical: canonicalSnapshot.exists ? canonicalSnapshot.data() ?? null : null,
    reservation: reservationSnapshot.exists ? reservationSnapshot.data() ?? null : null,
    tombstones: sourceIds.map((cardId, index) => ({
      cardId,
      data: tombstoneSnapshots[index]?.exists ? tombstoneSnapshots[index].data() ?? null : null,
    })),
    absentSourceIds: (plan.loserIds as unknown[]).map(value => String(value)),
  });
  if (currentDigest !== plan.appliedDigest) {
    throw new LegacyLibraryRollbackConflictError(1, sourceIds.length);
  }
  const beforeTombstones = Array.isArray(plan.beforeTombstones)
    ? plan.beforeTombstones as Array<{ cardId?: unknown; data?: unknown }>
    : [];
  if (beforeTombstones.length !== sourceIds.length) {
    throw new LegacyLibraryRollbackConflictError(1, sourceIds.length);
  }
  for (const [index, sourceId] of sourceIds.entries()) {
    const backup = backupSnapshots[index];
    if (originalSourceIds.includes(sourceId)) {
      const expected = originalSources.find(source => source.id === sourceId);
      if (!expected || !backupSourceMatches(backup, expected)) {
        throw new LegacyLibraryRollbackConflictError(1, sourceIds.length);
      }
    }
    if (!backup.exists) transaction.delete(sourceReferences[index]);
    else transaction.set(sourceReferences[index], backup.data()?.source ?? {}, { merge: false });
    const previous = beforeTombstones.find(item => item.cardId === sourceId)?.data;
    if (previous && typeof previous === 'object') transaction.set(tombstoneReferences[index], previous as DocumentData, { merge: false });
    else transaction.delete(tombstoneReferences[index]);
  }
  const beforeReservation = plan.beforeReservation;
  if (beforeReservation && typeof beforeReservation === 'object') {
    transaction.set(reservationRef(database, ownerId, String(plan.normalizedWord)), beforeReservation as DocumentData, { merge: false });
  } else transaction.delete(reservationRef(database, ownerId, String(plan.normalizedWord)));
  transaction.set(reference, { status: 'rolledBack', rolledBackAt: stableTimestamp(current) }, { merge: true });
  const next: MigrationFence = {
    ...current,
    phase: 'rollback',
    revision: current.revision + 1,
    leaseExpiresAt: Date.now() + DISCOVERY_LEASE_MS,
    rollbackGroupCount: current.rollbackGroupCount + 1,
  };
  transaction.set(migrationFenceReference(database, ownerId), fenceData(next, stableTimestamp(current)), { merge: false });
  transaction.set(backupRef(database, ownerId, fence.jobId), {
    fenceToken: next.token,
    leaseOwner: next.leaseOwner,
    fenceRevision: next.revision,
    updatedAt: stableTimestamp(next),
  }, { merge: true });
  return next;
});

export async function rollbackLegacyLibraryMigration(
  database: Firestore,
  ownerId: string,
  jobId: string,
  requestedSourceRevision?: string,
): Promise<{ rolledBack: number; complete: boolean }> {
  const root = backupRef(database, ownerId, jobId);
  const rootSnapshot = await root.get();
  if (!rootSnapshot.exists) throw new Error('Migration rollback snapshot does not exist.');
  const rootData = rootSnapshot.data() ?? {};
  const sourceRevision = requestedSourceRevision ?? String(rootData.sourceRevision ?? '');
  if (!isDiscoveryDigest(sourceRevision)) throw new LegacyLibraryRollbackConflictError(1, 0);
  const job = await readMigrationJob(database, ownerId, jobId);
  if (job.phase === 'rolled-back') return { rolledBack: 0, complete: true };
  const fenceOptions: LegacyLibraryMigrationApplyOptions = { jobId, sourceRevision };
  const fence = await beginMigrationFence(database, ownerId, fenceOptions, 'rollback');
  let current = fence;
  try {
    await ensureBackupRoot(database, ownerId, current);
    if (current.rollbackGroupCount === 0 && job.phase === 'complete') {
      await verifySealedFinalLibrary(database, ownerId, current);
    }
    const preflight = await preflightRollback(database, ownerId, current);
    current = preflight.fence;
    for (const plan of preflight.plans) current = await rollbackOneGroup(database, ownerId, current, plan.reference);
    await database.runTransaction(async transaction => {
      const [fenceSnapshot, jobSnapshot, rootSnapshot] = await Promise.all([
        transaction.get(migrationFenceReference(database, ownerId)),
        transaction.get(discoveryJobRef(database, ownerId, jobId)),
        transaction.get(root),
      ]);
      const active = fenceFromSnapshot(fenceSnapshot);
      assertFenceLease(active, current.token, current.leaseOwner);
      if (!rootSnapshot.exists) throw new LegacyLibraryRollbackConflictError(1, 1);
      const activeRoot = rootSnapshot.data() ?? {};
      if (activeRoot.fenceToken !== active.token
          || activeRoot.leaseOwner !== active.leaseOwner
          || activeRoot.fenceRevision !== active.revision) {
        throw new LegacyLibraryRollbackConflictError(1, 1);
      }
      const currentJob = validDiscoveryJob(jobSnapshot.data());
      restoreProfileDocument(transaction as never, migrationProgressRef(database, ownerId), rootData.previousProgress);
      restoreProfileDocument(transaction as never, facetsRef(database, ownerId), rootData.previousFacets);
      restoreProfileDocument(transaction as never, resourceUsageRef(database, ownerId), rootData.previousResourceUsage);
      transaction.set(root, {
        rolledBackAt: stableTimestamp(active),
        complete: false,
        fenceToken: active.token,
        leaseOwner: null,
        fenceRevision: active.revision,
      }, { merge: true });
      transaction.set(discoveryJobRef(database, ownerId, jobId), discoveryJobData({
        ...currentJob,
        phase: 'rolled-back',
        leaseOwner: null,
        leaseExpiresAt: null,
      }, stableTimestamp(active)), { merge: false });
      transaction.delete(migrationFenceReference(database, ownerId));
    });
    return { rolledBack: preflight.plans.length, complete: true };
  } catch (error) {
    if (current.rollbackGroupCount === 0
        && (job.phase === 'complete' || current.appliedGroupCount === 0)) {
      await clearZeroProgressFence(database, ownerId, current, 'complete');
    }
    throw error;
  }
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

export async function listMigrationManifestOwnerIds(database: Firestore, jobId: string): Promise<string[]> {
  assertSafeSegment(jobId, 'Migration job ID');
  const snapshot = await database.collectionGroup(DISCOVERY_JOB_COLLECTION).get();
  const owners = new Set<string>();
  for (const document of snapshot.docs) {
    if (document.id !== jobId) continue;
    const segments = document.ref.path.split('/');
    if (segments.length === 4 && segments[0] === 'users' && segments[2] === DISCOVERY_JOB_COLLECTION) {
      owners.add(assertSafeSegment(segments[1], 'Owner ID'));
    }
  }
  return [...owners].sort((left, right) => left.localeCompare(right, 'en-US'));
}
