import {
  createCanonicalCleanupCardId,
  normalizeCleanupWord,
  planLegacyIdentityGroup,
  type CleanupCard,
  type DuplicateCleanupPlan,
} from './duplicateCleanup.js';

export type LegacyLibraryReservation = {
  schemaVersion: 1;
  cardId: string;
  normalizedWord: string;
};

export type LegacyLibrarySnapshot = {
  libraryEpoch: number;
  cards: CleanupCard[];
  reservations: ReadonlyMap<string, unknown>;
  hasMore?: boolean;
  nextDocumentId?: string | null;
  initialCardCount?: number;
  scannedCardCount?: number;
  phase?: 'migration' | 'facets' | 'complete';
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

export type LegacyLibraryMigrationReadOptions = {
  jobId: string;
  batchSize: number;
  cursor?: string | null;
};

export interface LegacyLibraryMigrationStore {
  read(
    ownerId: string,
    options?: LegacyLibraryMigrationReadOptions,
  ): Promise<LegacyLibrarySnapshot>;
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
  advanceMigration?(
    ownerId: string,
    jobId: string,
    expectedEpoch: number,
    nextDocumentId: string | null,
  ): Promise<void>;
  beginFacetRebuild?(ownerId: string, jobId: string, expectedEpoch: number): Promise<void>;
  advanceFacetRebuild?(
    ownerId: string,
    jobId: string,
    expectedEpoch: number,
    nextDocumentId: string | null,
    cards: CleanupCard[],
  ): Promise<void>;
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
    complete: pendingSourceCount === 0 && invalidCardIds.length === 0 && !snapshot.hasMore,
  };
}

export async function inspectLegacyLibraryMigration(
  store: LegacyLibraryMigrationStore,
  ownerId: string,
  options: { jobId: string; batchSize: number },
): Promise<{ cards: number; invalid: number; requiresMigration: boolean }> {
  let cursor: string | null = null;
  let cards = 0;
  let invalid = 0;
  let requiresMigration = false;

  for (;;) {
    const snapshot = await store.read(ownerId, { ...options, cursor });
    const batch = buildLegacyLibraryMigrationBatch(snapshot, options);
    cards += snapshot.scannedCardCount ?? snapshot.cards.length;
    invalid += batch.invalidCardIds.length;
    requiresMigration ||= batch.pendingSourceCount > 0;
    if (!snapshot.hasMore) return { cards, invalid, requiresMigration };
    if (!snapshot.nextDocumentId) throw new Error('Migration page is missing its next cursor.');
    cursor = snapshot.nextDocumentId;
  }
}

export async function runLegacyLibraryMigration(
  store: LegacyLibraryMigrationStore,
  ownerId: string,
  options: { jobId: string; batchSize: number; dryRun: boolean },
): Promise<LegacyLibraryMigrationResult> {
  const snapshot = await store.read(ownerId, options);
  const scanned = snapshot.scannedCardCount ?? snapshot.cards.length;
  if (snapshot.phase === 'complete') {
    return { migrated: 0, merged: 0, scanned: 0, complete: true, remaining: 0, invalid: 0 };
  }
  if (snapshot.phase === 'facets') {
    if (options.dryRun) {
      return {
        migrated: 0,
        merged: 0,
        scanned,
        complete: false,
        remaining: snapshot.hasMore ? 1 : 0,
        invalid: 0,
      };
    }
    await store.advanceFacetRebuild?.(
      ownerId,
      options.jobId,
      snapshot.libraryEpoch,
      snapshot.nextDocumentId ?? null,
      snapshot.cards,
    );
    if (snapshot.hasMore) {
      return { migrated: 0, merged: 0, scanned, complete: false, remaining: 1, invalid: 0 };
    }
    await store.markComplete(ownerId, options.jobId, snapshot.cards);
    return { migrated: 0, merged: 0, scanned, complete: true, remaining: 0, invalid: 0 };
  }
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
        snapshot.initialCardCount ?? snapshot.cards.length,
      );
      if (store.beginFacetRebuild) {
        await store.beginFacetRebuild(ownerId, options.jobId, snapshot.libraryEpoch);
        return { migrated: 0, merged: 0, scanned, complete: false, remaining: 0, invalid: 0 };
      }
      await store.markComplete(ownerId, options.jobId, snapshot.cards);
    }
    return {
      migrated: 0,
      merged: 0,
      scanned,
      complete: true,
      remaining: 0,
      invalid: 0,
    };
  }
  if (options.dryRun) {
    return {
      migrated: 0,
      merged: batch.duplicateGroupCount,
      scanned,
      complete: false,
      remaining: Math.max(batch.pendingSourceCount, snapshot.hasMore ? 1 : 0),
      invalid: batch.invalidCardIds.length,
    };
  }

  const selectedIds = new Set(batch.plans.flatMap(plan => (
    [plan.primaryId, ...plan.loserIds]
  )));
  const sourceCards = snapshot.cards.filter(card => selectedIds.has(card.id));
  if (sourceCards.length > 0) {
    await store.backup(
      ownerId,
      options.jobId,
      sourceCards,
      snapshot.libraryEpoch,
      snapshot.initialCardCount ?? snapshot.cards.length,
    );
  }
  for (const plan of batch.plans) {
    await store.apply(ownerId, options.jobId, plan, snapshot.libraryEpoch);
  }
  await store.advanceMigration?.(
    ownerId,
    options.jobId,
    snapshot.libraryEpoch,
    snapshot.nextDocumentId ?? null,
  );
  return {
    migrated: batch.selectedSourceCount,
    merged: batch.duplicateGroupCount,
    scanned,
    complete: false,
    remaining: Math.max(batch.remainingSourceCount, snapshot.hasMore ? 1 : 0),
    invalid: 0,
  };
}

export async function runLegacyLibraryMigrationToCompletion(
  store: LegacyLibraryMigrationStore,
  ownerId: string,
  options: { jobId: string; batchSize: number; maximumBatches: number },
): Promise<LegacyLibraryMigrationResult> {
  const maximumBatches = Math.max(1, Math.min(100, Math.floor(options.maximumBatches)));
  let migrated = 0;
  let merged = 0;
  for (let attempt = 0; attempt <= maximumBatches * 2 + 2; attempt += 1) {
    const result = await runLegacyLibraryMigration(store, ownerId, {
      jobId: options.jobId,
      batchSize: options.batchSize,
      dryRun: false,
    });
    migrated += result.migrated;
    merged += result.merged;
    if (result.complete) {
      return { ...result, migrated, merged, scanned: migrated || result.scanned };
    }
  }

  throw new Error(`Legacy library migration did not converge within ${maximumBatches} batches.`);
}
