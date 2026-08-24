import { createHash, randomUUID } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import {
  createCanonicalCleanupCardId,
  normalizeCleanupWord,
  planLegacyIdentityGroup,
  type CleanupCard,
  type DuplicateCleanupPlan,
} from './duplicateCleanup.js';

export const LEGACY_LIBRARY_DISCOVERY_SCHEMA_VERSION = 3;
export const MAX_DISCOVERY_PAGE_DOCUMENTS = 100;
export const MAX_DISCOVERY_PAGE_BYTES = 8 * 1024 * 1024;
export const MAX_DISCOVERY_GROUP_SOURCES = 100;
export const MAX_DISCOVERY_GROUP_BYTES = 4 * 1024 * 1024;
export const DISCOVERY_LEASE_MS = 180_000;

export type LegacyLibrarySourceDocument = {
  readonly id: string;
  readonly data: Record<string, unknown>;
};

export type LegacyLibraryPage = {
  readonly documents: readonly LegacyLibrarySourceDocument[];
  readonly cursor: string | null;
  readonly terminal: boolean;
  readonly libraryEpoch: number;
};

export type LegacyLibrarySourceDescriptor = {
  readonly id: string;
  readonly sourceDigest: string;
  readonly sourceBytes: number;
};

export type LegacyLibraryIdentityGroup = {
  readonly normalizedWord: string;
  readonly sources: readonly LegacyLibrarySourceDescriptor[];
  readonly sourceBytes: number;
  readonly schemaVersion: 3;
  readonly scanId: string;
  readonly libraryEpoch: number;
  readonly sourceRevision: string;
};

export type LegacyLibraryDiscoveryJob = {
  readonly schemaVersion: 3;
  readonly scanId: string;
  readonly phase: 'discover' | 'discovered' | 'blocked' | 'verify';
  readonly cursor: string | null;
  readonly libraryEpoch: number | null;
  readonly sourceRevision: string;
  readonly scanned: number;
  readonly sourceCount: number;
  readonly groupCount: number;
  readonly lastPageDigest: string | null;
  readonly blockedReason?: string;
  readonly leaseOwner: string | null;
  readonly leaseExpiresAt: number | null;
};

export type LegacyLibraryDiscoveryCommit = {
  readonly jobId: string;
  readonly expectedJob: LegacyLibraryDiscoveryJob | null;
  readonly page: LegacyLibraryPage;
  readonly pageDigest: string;
  readonly groups: readonly LegacyLibraryIdentityGroup[];
  readonly nextJob: LegacyLibraryDiscoveryJob;
  readonly leaseOwner: string;
};

export interface LegacyLibraryDiscoveryStore {
  acquireDiscoveryLease(ownerId: string, request: {
    readonly jobId: string;
    readonly scanId: string;
    readonly leaseOwner: string;
  }): Promise<LegacyLibraryDiscoveryJob>;
  readPage(ownerId: string, options: {
    readonly limit: number;
    readonly cursor: string | null;
  }): Promise<LegacyLibraryPage>;
  readDiscoveryGroups(
    ownerId: string,
    jobId: string,
    normalizedWords: readonly string[],
  ): Promise<readonly LegacyLibraryIdentityGroup[]>;
  commitDiscoveryPage(
    ownerId: string,
    request: LegacyLibraryDiscoveryCommit,
  ): Promise<LegacyLibraryDiscoveryJob>;
}

class LegacyLibraryDiscoveryBlockedError extends Error {
  constructor(public readonly reason: string) {
    super(`Legacy library discovery blocked: ${reason}.`);
    this.name = 'LegacyLibraryDiscoveryBlockedError';
  }
}

const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value);

const compareUtf8 = (left: string, right: string): number => {
  const a = utf8(left);
  const b = utf8(right);
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
};

const timestampParts = (value: unknown): { seconds: string; nanoseconds: number } | null => {
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw new Error('Unsupported non-finite timestamp.');
    const millis = value.getTime();
    const seconds = Math.floor(millis / 1_000);
    const nanoseconds = (millis - seconds * 1_000) * 1_000_000;
    return { seconds: String(seconds), nanoseconds };
  }
  if (!(value instanceof Timestamp)) return null;
  const seconds = value.seconds;
  const nanoseconds = value.nanoseconds;
  if (
    (!Number.isSafeInteger(seconds) && !(typeof seconds === 'string' && /^-?\d+$/.test(seconds)))
    || !Number.isSafeInteger(nanoseconds)
    || Number(nanoseconds) < 0
    || Number(nanoseconds) > 999_999_999
  ) throw new Error('Unsupported timestamp value.');
  return { seconds: String(seconds), nanoseconds: Number(nanoseconds) };
};

type CanonicalLegacyLibraryValue = readonly [string, ...unknown[]];

const canonicalizeLegacyLibraryValue = (value: unknown, seen = new Set<object>()): CanonicalLegacyLibraryValue => {
  const timestamp = timestampParts(value);
  if (timestamp) {
    return ['timestamp', timestamp.seconds, timestamp.nanoseconds];
  }
  if (value === null) return ['null'];
  if (typeof value === 'string') return ['string', value];
  if (typeof value === 'boolean') return ['boolean', value];
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Unsupported non-finite number.');
    return ['number', Object.is(value, -0) ? '-0' : value];
  }
  if (typeof value !== 'object') throw new Error('Unsupported Firestore value.');
  if (seen.has(value)) throw new Error('Cyclic Firestore value.');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return ['array', value.map(item => canonicalizeLegacyLibraryValue(item, seen))];
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('Unsupported Firestore value.');
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort(compareUtf8);
    return ['map', keys.map(key => [key, canonicalizeLegacyLibraryValue(record[key], seen)])];
  } finally {
    seen.delete(value);
  }
};

export const canonicalLegacyLibraryUtf8Bytes = (value: unknown): Uint8Array => (
  utf8(JSON.stringify(canonicalizeLegacyLibraryValue(value)))
);

export const digestLegacyLibraryValue = (value: unknown): string => (
  createHash('sha256').update(canonicalLegacyLibraryUtf8Bytes(value)).digest('hex')
);

export const normalizedLegacyLibraryIdentity = (data: Record<string, unknown>): string => (
  data && typeof data === 'object' && !Array.isArray(data)
    ? normalizeCleanupWord(data.normalizedWord) || normalizeCleanupWord(data.word)
    : ''
);

export const createLegacyLibrarySourceDescriptor = (
  document: LegacyLibrarySourceDocument,
): LegacyLibrarySourceDescriptor => {
  if (
    typeof document.id !== 'string'
    || document.id.length === 0
    || document.id.includes('/')
    || utf8(document.id).byteLength > 1_500
  ) throw new LegacyLibraryDiscoveryBlockedError('unsafe-source-id');
  const bytes = canonicalLegacyLibraryUtf8Bytes(document.data);
  return {
    id: document.id,
    sourceDigest: createHash('sha256').update(bytes).digest('hex'),
    sourceBytes: bytes.byteLength,
  };
};

export const digestLegacyLibraryDiscoveryPage = (
  page: LegacyLibraryPage,
  beforeCursor: string | null,
  descriptors: readonly LegacyLibrarySourceDescriptor[],
): string => (
  digestLegacyLibraryValue({
    schemaVersion: LEGACY_LIBRARY_DISCOVERY_SCHEMA_VERSION,
    beforeCursor,
    afterCursor: page.cursor,
    terminal: page.terminal,
    libraryEpoch: page.libraryEpoch,
    descriptors,
  })
);

export const createLegacyLibraryInitialRevision = (scanId: string, libraryEpoch: number): string => (
  digestLegacyLibraryValue({
    schemaVersion: LEGACY_LIBRARY_DISCOVERY_SCHEMA_VERSION,
    scanId,
    libraryEpoch,
    cursor: null,
  })
);

export const nextLegacyLibrarySourceRevision = (previous: string, digest: string): string => (
  digestLegacyLibraryValue({
    schemaVersion: LEGACY_LIBRARY_DISCOVERY_SCHEMA_VERSION,
    previous,
    pageDigest: digest,
  })
);

const safeBatchSize = (value: number): number => (
  Math.max(1, Math.min(MAX_DISCOVERY_PAGE_DOCUMENTS, Math.floor(value)))
);

const buildProjectedGroups = (
  page: LegacyLibraryPage,
  descriptors: readonly LegacyLibrarySourceDescriptor[],
  previousGroups: readonly LegacyLibraryIdentityGroup[],
  scanId: string,
  sourceRevision: string,
): LegacyLibraryIdentityGroup[] => {
  const byWord = new Map(previousGroups.map(group => [group.normalizedWord, {
    ...group,
    sources: [...group.sources],
  }]));
  page.documents.forEach((document, index) => {
    const normalizedWord = normalizedLegacyLibraryIdentity(document.data);
    if (!normalizedWord || normalizedWord.length > 256) {
      throw new LegacyLibraryDiscoveryBlockedError('invalid-normalized-word');
    }
    const group = byWord.get(normalizedWord) ?? {
      normalizedWord,
      sources: [],
      sourceBytes: 0,
      schemaVersion: 3 as const,
      scanId,
      libraryEpoch: page.libraryEpoch,
      sourceRevision,
    };
    const sources = [...group.sources, descriptors[index]];
    const sourceBytes = sources.reduce((total, source) => total + source.sourceBytes, 0);
    if (sources.length > MAX_DISCOVERY_GROUP_SOURCES) {
      throw new LegacyLibraryDiscoveryBlockedError('identity-group-source-limit');
    }
    if (sourceBytes > MAX_DISCOVERY_GROUP_BYTES) {
      throw new LegacyLibraryDiscoveryBlockedError('identity-group-byte-limit');
    }
    byWord.set(normalizedWord, {
      ...group,
      sources,
      sourceBytes,
      scanId,
      libraryEpoch: page.libraryEpoch,
      sourceRevision,
    });
  });
  return [...byWord.values()];
};

const blockedDiscoveryJob = (
  existing: LegacyLibraryDiscoveryJob | null,
  reason: string,
): LegacyLibraryDiscoveryJob => ({
  schemaVersion: 3,
  scanId: existing?.scanId ?? randomUUID(),
  phase: 'blocked',
  cursor: existing?.cursor ?? null,
  libraryEpoch: existing?.libraryEpoch ?? null,
  sourceRevision: existing?.sourceRevision ?? '',
  scanned: existing?.scanned ?? 0,
  sourceCount: existing?.sourceCount ?? 0,
  groupCount: existing?.groupCount ?? 0,
  lastPageDigest: existing?.lastPageDigest ?? null,
  blockedReason: reason,
  leaseOwner: null,
  leaseExpiresAt: null,
});

export async function runLegacyLibraryDiscovery(
  store: LegacyLibraryDiscoveryStore,
  ownerId: string,
  options: { readonly jobId: string; readonly batchSize: number },
): Promise<LegacyLibraryMigrationResult> {
  const existingLeaseOwner = randomUUID();
  const acquired = await store.acquireDiscoveryLease(ownerId, {
    jobId: options.jobId,
    scanId: randomUUID(),
    leaseOwner: existingLeaseOwner,
  });
  const existing = acquired;
  if (existing?.phase === 'blocked') {
    return {
      migrated: 0,
      merged: 0,
      scanned: 0,
      complete: false,
      remaining: 0,
      invalid: 1,
      phase: 'blocked',
      sourceCount: existing.sourceCount,
      groupCount: existing.groupCount,
    };
  }
  if (existing?.phase === 'discovered' || existing?.phase === 'verify') {
    return {
      migrated: 0,
      merged: 0,
      scanned: 0,
      complete: false,
      remaining: 0,
      invalid: 0,
      phase: existing.phase,
      sourceCount: existing.sourceCount,
      groupCount: existing.groupCount,
    };
  }
  const cursor = existing?.cursor ?? null;
  const page = await store.readPage(ownerId, { limit: safeBatchSize(options.batchSize), cursor });
  const leaseOwner = existingLeaseOwner;
  let descriptors: LegacyLibrarySourceDescriptor[] = [];
  let groups: LegacyLibraryIdentityGroup[] = [];
  let reason: string | null = null;
  try {
    if (page.documents.length > MAX_DISCOVERY_PAGE_DOCUMENTS) throw new LegacyLibraryDiscoveryBlockedError('page-document-limit');
    if (!page.terminal && page.documents.length === 0) {
      throw new LegacyLibraryDiscoveryBlockedError('empty-nonterminal-page');
    }
    if (page.documents.length > 0 && page.cursor !== page.documents.at(-1)?.id) {
      throw new LegacyLibraryDiscoveryBlockedError('invalid-page-cursor');
    }
    if (page.documents.some((document, index) => (
      index > 0 && compareUtf8(page.documents[index - 1].id, document.id) >= 0
    ))) {
      throw new LegacyLibraryDiscoveryBlockedError('unordered-page');
    }
    if (page.documents.length > 0 && cursor !== null && compareUtf8(page.documents[0].id, cursor) <= 0) {
      throw new LegacyLibraryDiscoveryBlockedError('non-advancing-page-cursor');
    }
    try {
      descriptors = page.documents.map(createLegacyLibrarySourceDescriptor);
    } catch {
      throw new LegacyLibraryDiscoveryBlockedError('unsupported-source-value');
    }
    const pageBytes = descriptors.reduce((total, source) => total + source.sourceBytes, 0);
    if (pageBytes > MAX_DISCOVERY_PAGE_BYTES) throw new LegacyLibraryDiscoveryBlockedError('page-byte-limit');
    const normalizedWords = [...new Set(page.documents.map(document => normalizedLegacyLibraryIdentity(document.data)))];
    if (normalizedWords.some(word => !word || word.length > 256)) {
      throw new LegacyLibraryDiscoveryBlockedError('invalid-normalized-word');
    }
    const previousGroups = await store.readDiscoveryGroups(ownerId, options.jobId, normalizedWords);
    const scanId = existing?.scanId ?? randomUUID();
    const previousRevision = existing?.sourceRevision || createLegacyLibraryInitialRevision(scanId, page.libraryEpoch);
    if (existing.libraryEpoch !== null && existing.libraryEpoch !== page.libraryEpoch) {
      throw new LegacyLibraryDiscoveryBlockedError('library-epoch-changed');
    }
    const digest = digestLegacyLibraryDiscoveryPage(page, cursor, descriptors);
    const nextRevision = nextLegacyLibrarySourceRevision(previousRevision, digest);
    groups = buildProjectedGroups(page, descriptors, previousGroups, scanId, nextRevision);
    const nextJob: LegacyLibraryDiscoveryJob = {
      schemaVersion: 3,
      scanId,
      phase: page.terminal ? 'discovered' : 'discover',
      cursor: page.cursor,
      libraryEpoch: page.libraryEpoch,
      sourceRevision: nextRevision,
      scanned: (existing?.scanned ?? 0) + page.documents.length,
      sourceCount: (existing?.sourceCount ?? 0) + page.documents.length,
      groupCount: (existing?.groupCount ?? 0) + groups.length - previousGroups.length,
      lastPageDigest: digest,
      leaseOwner: page.terminal ? null : leaseOwner,
      leaseExpiresAt: null,
    };
    const committed = await store.commitDiscoveryPage(ownerId, {
      jobId: options.jobId,
      expectedJob: existing,
      page,
      pageDigest: digest,
      groups,
      nextJob,
      leaseOwner,
    });
    return {
      migrated: 0,
      merged: 0,
      scanned: page.documents.length,
      complete: false,
      remaining: committed.phase === 'discover' ? 1 : 0,
      invalid: committed.phase === 'blocked' ? 1 : 0,
      phase: committed.phase,
      sourceCount: committed.sourceCount,
      groupCount: committed.groupCount,
    };
  } catch (error) {
    if (!(error instanceof LegacyLibraryDiscoveryBlockedError)) throw error;
    reason = error.reason;
  }
  const blocked = await store.commitDiscoveryPage(ownerId, {
    jobId: options.jobId,
    expectedJob: existing,
    page,
    pageDigest: '',
    groups: [],
    nextJob: blockedDiscoveryJob(existing, reason),
    leaseOwner,
  });
  return {
    migrated: 0,
    merged: 0,
    scanned: 0,
    complete: false,
    remaining: 0,
    invalid: 1,
    phase: blocked.phase,
    sourceCount: blocked.sourceCount,
    groupCount: blocked.groupCount,
  };
}

export type LegacyLibraryReservation = {
  schemaVersion: 1;
  cardId: string;
  normalizedWord: string;
};

export type LegacyLibrarySnapshot = {
  libraryEpoch: number;
  cards: CleanupCard[];
  reservations: ReadonlyMap<string, unknown>;
};

export type LegacyLibraryMigrationBatch = {
  plans: DuplicateCleanupPlan[];
  invalidCardIds: string[];
  pendingSourceCount: number;
  selectedSourceCount: number;
  remainingSourceCount: number;
  duplicateGroupCount: number;
  complete: boolean;
};

export type LegacyLibraryMigrationResult = {
  migrated: number;
  merged: number;
  scanned: number;
  complete: boolean;
  remaining: number;
  invalid: number;
  phase?: LegacyLibraryDiscoveryJob['phase'];
  sourceCount?: number;
  groupCount?: number;
};

export type LegacyLibraryIntegrityCounts = {
  cards: number;
  canonicalIdentities: number;
  reservations: number;
  duplicateIdentities: number;
  invalidIdentities: number;
  missingReservations: number;
  mismatchedReservations: number;
};

export interface LegacyLibraryMigrationStore {
  read(ownerId: string): Promise<LegacyLibrarySnapshot>;
  backup(
    ownerId: string,
    jobId: string,
    cards: CleanupCard[],
    expectedEpoch: number,
    initialCardCount: number,
  ): Promise<void>;
  apply(
    ownerId: string,
    jobId: string,
    plan: DuplicateCleanupPlan,
    expectedEpoch: number,
  ): Promise<void>;
  markComplete(ownerId: string, jobId: string, cards: CleanupCard[]): Promise<void>;
}

export class LegacyLibraryInvalidCardsError extends Error {
  constructor(public readonly count: number) {
    super(`Legacy library contains ${count} card(s) without a valid word identity.`);
    this.name = 'LegacyLibraryInvalidCardsError';
  }
}

export function summarizeLegacyLibrarySnapshot(
  snapshot: LegacyLibrarySnapshot,
): LegacyLibraryIntegrityCounts {
  const groups = new Map<string, CleanupCard[]>();
  let invalidIdentities = 0;
  for (const card of snapshot.cards) {
    const normalizedWord = normalizeCleanupWord(card.normalizedWord)
      || normalizeCleanupWord(card.word);
    if (!normalizedWord || normalizedWord.length > 256) {
      invalidIdentities += 1;
      continue;
    }
    const group = groups.get(normalizedWord) ?? [];
    group.push(card);
    groups.set(normalizedWord, group);
  }
  let missingReservations = 0;
  let mismatchedReservations = 0;
  for (const [normalizedWord, cards] of groups) {
    const reservation = snapshot.reservations.get(normalizedWord);
    if (!reservation) {
      missingReservations += 1;
      continue;
    }
    const expectedCardId = createCanonicalCleanupCardId(normalizedWord);
    const reservationRecord = reservation as Record<string, unknown>;
    if (
      reservationRecord.schemaVersion !== 1
      || reservationRecord.cardId !== expectedCardId
      || reservationRecord.normalizedWord !== normalizedWord
      || cards.length !== 1
      || cards[0]?.id !== expectedCardId
    ) mismatchedReservations += 1;
  }
  return {
    cards: snapshot.cards.length,
    canonicalIdentities: groups.size,
    reservations: snapshot.reservations.size,
    duplicateIdentities: [...groups.values()].filter(cards => cards.length > 1).length,
    invalidIdentities,
    missingReservations,
    mismatchedReservations,
  };
}

const MAX_IDENTITY_GROUP_SIZE = 100;

const safeCounter = (value: unknown): number | null =>
  Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;

const hasValidCreatedAt = (value: unknown): boolean =>
  typeof value === 'string' && Number.isFinite(Date.parse(value));

const isMatchingReservation = (
  value: unknown,
  cardId: string,
  normalizedWord: string,
): value is LegacyLibraryReservation => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const reservation = value as Record<string, unknown>;
  return Object.keys(reservation).length === 3
    && reservation.schemaVersion === 1
    && reservation.cardId === cardId
    && reservation.normalizedWord === normalizedWord;
};

const isCurrentCanonicalGroup = (
  cards: readonly CleanupCard[],
  reservation: unknown,
  normalizedWord: string,
  libraryEpoch: number,
): boolean => {
  if (cards.length !== 1) return false;
  const card = cards[0];
  const canonicalId = createCanonicalCleanupCardId(normalizedWord);
  return card.id === canonicalId
    && card.word === normalizedWord
    && card.normalizedWord === normalizedWord
    && card.schemaVersion === 2
    && safeCounter(card.revision) !== null
    && safeCounter(card.libraryEpoch) === libraryEpoch
    && hasValidCreatedAt(card.createdAt)
    && typeof card.bookmarked === 'boolean'
    && Object.prototype.hasOwnProperty.call(card, 'customDeck')
    && ['easy', 'good', 'hard', 'unrated'].includes(String(card.difficulty))
    && isMatchingReservation(reservation, canonicalId, normalizedWord);
};

export function buildLegacyLibraryMigrationBatch(
  snapshot: LegacyLibrarySnapshot,
  options: { jobId: string; batchSize: number },
): LegacyLibraryMigrationBatch {
  const groups = new Map<string, CleanupCard[]>();
  const invalidCardIds: string[] = [];
  for (const card of snapshot.cards) {
    const normalizedWord = normalizeCleanupWord(card.normalizedWord)
      || normalizeCleanupWord(card.word);
    if (!normalizedWord || normalizedWord.length > 256) {
      invalidCardIds.push(card.id);
      continue;
    }
    const group = groups.get(normalizedWord) ?? [];
    group.push(card);
    groups.set(normalizedWord, group);
  }

  for (const [normalizedWord, cards] of groups) {
    if (cards.length > MAX_IDENTITY_GROUP_SIZE) {
      throw new Error(
        `Legacy identity "${normalizedWord}" contains ${cards.length} cards; `
        + `the maximum safe group size is ${MAX_IDENTITY_GROUP_SIZE}.`,
      );
    }
  }

  const pending = [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right, 'en-US'))
    .flatMap(([normalizedWord, cards]) => (
      isCurrentCanonicalGroup(
        cards,
        snapshot.reservations.get(normalizedWord),
        normalizedWord,
        snapshot.libraryEpoch,
      )
        ? []
        : [{ cards, plan: planLegacyIdentityGroup(cards, {
          jobId: options.jobId,
          libraryEpoch: snapshot.libraryEpoch,
        }) }]
    ));

  const batchSize = Math.max(1, Math.min(100, Math.floor(options.batchSize)));
  const selected: typeof pending = [];
  let selectedSourceCount = 0;
  for (const group of pending) {
    if (selectedSourceCount >= batchSize) break;
    selected.push(group);
    selectedSourceCount += group.cards.length;
  }
  const pendingSourceCount = pending.reduce((total, group) => total + group.cards.length, 0);

  return {
    plans: selected.map(group => group.plan),
    invalidCardIds: invalidCardIds.sort((left, right) => left.localeCompare(right, 'en-US')),
    pendingSourceCount,
    selectedSourceCount,
    remainingSourceCount: Math.max(0, pendingSourceCount - selectedSourceCount),
    duplicateGroupCount: selected.filter(group => group.cards.length > 1).length,
    complete: pendingSourceCount === 0 && invalidCardIds.length === 0,
  };
}

export async function runLegacyLibraryMigration(
  store: LegacyLibraryMigrationStore,
  ownerId: string,
  options: { jobId: string; batchSize: number; dryRun: boolean },
): Promise<LegacyLibraryMigrationResult> {
  const snapshot = await store.read(ownerId);
  const batch = buildLegacyLibraryMigrationBatch(snapshot, options);
  if (batch.invalidCardIds.length > 0 && !options.dryRun) {
    throw new LegacyLibraryInvalidCardsError(batch.invalidCardIds.length);
  }
  if (batch.complete) {
    if (!options.dryRun) {
      await store.backup(
        ownerId,
        options.jobId,
        [],
        snapshot.libraryEpoch,
        snapshot.cards.length,
      );
      await store.markComplete(ownerId, options.jobId, snapshot.cards);
    }
    return {
      migrated: 0,
      merged: 0,
      scanned: snapshot.cards.length,
      complete: true,
      remaining: 0,
      invalid: 0,
    };
  }
  if (options.dryRun) {
    return {
      migrated: 0,
      merged: batch.duplicateGroupCount,
      scanned: batch.selectedSourceCount,
      complete: false,
      remaining: batch.pendingSourceCount,
      invalid: batch.invalidCardIds.length,
    };
  }

  const selectedIds = new Set(batch.plans.flatMap(plan => (
    [plan.primaryId, ...plan.loserIds]
  )));
  const sourceCards = snapshot.cards.filter(card => selectedIds.has(card.id));
  await store.backup(
    ownerId,
    options.jobId,
    sourceCards,
    snapshot.libraryEpoch,
    snapshot.cards.length,
  );
  for (const plan of batch.plans) {
    await store.apply(ownerId, options.jobId, plan, snapshot.libraryEpoch);
  }
  return {
    migrated: batch.selectedSourceCount,
    merged: batch.duplicateGroupCount,
    scanned: batch.selectedSourceCount,
    complete: false,
    remaining: batch.remainingSourceCount,
    invalid: 0,
  };
}

const snapshotAfterAppliedPlans = (
  snapshot: LegacyLibrarySnapshot,
  plans: readonly DuplicateCleanupPlan[],
): LegacyLibrarySnapshot => {
  const replacedIds = new Set(plans.flatMap(plan => [plan.primaryId, ...plan.loserIds]));
  const reservations = new Map(snapshot.reservations);
  for (const plan of plans) {
    reservations.set(plan.normalizedWord, {
      schemaVersion: 1,
      cardId: plan.primaryId,
      normalizedWord: plan.normalizedWord,
    } satisfies LegacyLibraryReservation);
  }
  return {
    libraryEpoch: snapshot.libraryEpoch,
    cards: [
      ...snapshot.cards.filter(card => !replacedIds.has(card.id)),
      ...plans.map(plan => plan.merged),
    ],
    reservations,
  };
};

export async function runLegacyLibraryMigrationToCompletion(
  store: LegacyLibraryMigrationStore,
  ownerId: string,
  options: { jobId: string; batchSize: number; maximumBatches: number },
): Promise<LegacyLibraryMigrationResult> {
  let snapshot = await store.read(ownerId);
  const initialCardCount = snapshot.cards.length;
  const maximumBatches = Math.max(1, Math.min(100, Math.floor(options.maximumBatches)));
  let appliedBatches = 0;
  let migrated = 0;
  let merged = 0;
  let requiresVerificationRead = false;

  while (appliedBatches <= maximumBatches) {
    const batch = buildLegacyLibraryMigrationBatch(snapshot, options);
    if (batch.invalidCardIds.length > 0) {
      throw new LegacyLibraryInvalidCardsError(batch.invalidCardIds.length);
    }
    if (batch.complete) {
      if (requiresVerificationRead) {
        snapshot = await store.read(ownerId);
        requiresVerificationRead = false;
        continue;
      }
      await store.backup(
        ownerId,
        options.jobId,
        [],
        snapshot.libraryEpoch,
        initialCardCount,
      );
      await store.markComplete(ownerId, options.jobId, snapshot.cards);
      return {
        migrated,
        merged,
        scanned: migrated === 0 ? snapshot.cards.length : migrated,
        complete: true,
        remaining: 0,
        invalid: 0,
      };
    }
    if (appliedBatches >= maximumBatches) break;

    const selectedIds = new Set(batch.plans.flatMap(plan => (
      [plan.primaryId, ...plan.loserIds]
    )));
    const sourceCards = snapshot.cards.filter(card => selectedIds.has(card.id));
    await store.backup(
      ownerId,
      options.jobId,
      sourceCards,
      snapshot.libraryEpoch,
      initialCardCount,
    );
    for (const plan of batch.plans) {
      await store.apply(ownerId, options.jobId, plan, snapshot.libraryEpoch);
    }
    snapshot = snapshotAfterAppliedPlans(snapshot, batch.plans);
    migrated += batch.selectedSourceCount;
    merged += batch.duplicateGroupCount;
    appliedBatches += 1;
    requiresVerificationRead = true;
  }

  throw new Error(`Legacy library migration did not converge within ${maximumBatches} batches.`);
}
