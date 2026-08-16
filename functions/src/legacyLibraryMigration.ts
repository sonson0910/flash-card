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
};

export type LegacyLibraryMigrationPhase = 'apply' | 'verify' | 'complete';

export type LegacyLibraryMigrationProgressToken = {
  phase: Exclude<LegacyLibraryMigrationPhase, 'complete'>;
  cursor: string | null;
  scanned: number;
};

export type LegacyLibraryMigrationPage = {
  libraryEpoch: number;
  mutationGeneration: number;
  phase: LegacyLibraryMigrationPhase;
  sourceCards: CleanupCard[];
  canonicalCards: ReadonlyMap<string, CleanupCard>;
  reservations: ReadonlyMap<string, unknown>;
  /** Cursor persisted before this bounded page was read. */
  progressCursor: string | null;
  lastDocumentId: string | null;
  hasMore: boolean;
  scannedBefore: number;
  alreadyComplete: boolean;
};

export type LegacyLibraryMigrationBatch = {
  plans: DuplicateCleanupPlan[];
  backupCards: CleanupCard[];
  invalidCardIds: string[];
  scannedSourceCount: number;
  selectedSourceCount: number;
  duplicateGroupCount: number;
};

export type LegacyLibraryMigrationResult = {
  migrated: number;
  merged: number;
  scanned: number;
  complete: boolean;
  remaining: number;
  invalid: number;
};

type LegacyLibraryMigrationPageResult = LegacyLibraryMigrationResult & {
  transitioned?: boolean;
};

export type LegacyLibraryMigrationPreflightResult = {
  scanned: number;
  pending: number;
  merged: number;
  invalid: number;
  preflightComplete: boolean;
  migrationComplete: boolean;
};

export type LegacyLibraryMigrationPreflightEvidence = {
  result: LegacyLibraryMigrationPreflightResult;
  libraryEpoch: number;
  mutationGeneration: number;
};

export interface LegacyLibraryMigrationStore {
  readPage(
    ownerId: string,
    options: {
      jobId: string;
      batchSize: number;
      cursor?: string | null;
      scannedBefore?: number;
      phase?: Exclude<LegacyLibraryMigrationPhase, 'complete'>;
    },
  ): Promise<LegacyLibraryMigrationPage>;
  /** Optional persistent evidence for browser callables that resume the same migration. */
  readPreflight?(
    ownerId: string,
    jobId: string,
  ): Promise<LegacyLibraryMigrationPreflightEvidence | null>;
  storePreflight?(
    ownerId: string,
    jobId: string,
    evidence: LegacyLibraryMigrationPreflightEvidence,
  ): Promise<void>;
  backup(
    ownerId: string,
    jobId: string,
    cards: CleanupCard[],
    expectedEpoch: number,
    expectedMutationGeneration: number,
    expected: LegacyLibraryMigrationProgressToken,
  ): Promise<void>;
  apply(
    ownerId: string,
    jobId: string,
    plan: DuplicateCleanupPlan,
    expectedEpoch: number,
    expectedMutationGeneration: number,
    expected: LegacyLibraryMigrationProgressToken,
  ): Promise<void>;
  advanceProgress(
    ownerId: string,
    jobId: string,
    expectedEpoch: number,
    expectedMutationGeneration: number,
    expected: LegacyLibraryMigrationProgressToken,
    next: LegacyLibraryMigrationProgressToken,
  ): Promise<void>;
  markComplete(
    ownerId: string,
    jobId: string,
    expectedEpoch: number,
    expectedMutationGeneration: number,
    expected: LegacyLibraryMigrationProgressToken,
  ): Promise<void>;
}

export class LegacyLibraryInvalidCardsError extends Error {
  constructor(public readonly count: number) {
    super(`Legacy library contains ${count} card(s) without a valid word identity.`);
    this.name = 'LegacyLibraryInvalidCardsError';
  }
}

export class LegacyLibraryGenerationChangedError extends Error {
  constructor() {
    super('Library epoch or mutation generation changed while the Admin migration was running.');
    this.name = 'LegacyLibraryGenerationChangedError';
  }
}

export class LegacyLibrarySourceLimitError extends Error {
  constructor(public readonly maximumSourceCards = 10_000) {
    super(`Legacy library migration cannot scan more than ${maximumSourceCards.toLocaleString('en-US')} source cards in one phase.`);
    this.name = 'LegacyLibrarySourceLimitError';
  }
}

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

type PlannedGroup = {
  cards: CleanupCard[];
  sourceCards: CleanupCard[];
  normalizedWord: string;
};

const groupSourceCards = (cards: readonly CleanupCard[]): {
  groups: Map<string, CleanupCard[]>;
  invalidCardIds: string[];
} => {
  const groups = new Map<string, CleanupCard[]>();
  const invalidCardIds: string[] = [];
  for (const card of cards) {
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
  return { groups, invalidCardIds };
};

const buildBatch = (
  libraryEpoch: number,
  sourceCards: readonly CleanupCard[],
  canonicalCards: ReadonlyMap<string, CleanupCard>,
  reservations: ReadonlyMap<string, unknown>,
  jobId: string,
): LegacyLibraryMigrationBatch => {
  const { groups, invalidCardIds } = groupSourceCards(sourceCards);
  const pending: PlannedGroup[] = [];

  for (const [normalizedWord, group] of groups) {
    const canonical = canonicalCards.get(normalizedWord);
    const canonicalIdentity = canonical
      ? normalizeCleanupWord(canonical.normalizedWord) || normalizeCleanupWord(canonical.word)
      : normalizedWord;
    if (canonical && canonicalIdentity !== normalizedWord) {
      throw new Error(`Canonical card ID for "${normalizedWord}" is occupied by "${canonicalIdentity}".`);
    }
    const cards = canonical && !group.some(card => card.id === canonical.id)
      ? [...group, canonical]
      : [...group];
    if (!isCurrentCanonicalGroup(cards, reservations.get(normalizedWord), normalizedWord, libraryEpoch)) {
      pending.push({ cards, sourceCards: group, normalizedWord });
    }
  }

  const plans = pending
    .sort((left, right) => left.normalizedWord.localeCompare(right.normalizedWord, 'en-US'))
    .map(group => planLegacyIdentityGroup(group.cards, { jobId, libraryEpoch }));
  const backupCards = new Map<string, CleanupCard>();
  for (const group of pending) {
    for (const card of group.cards) backupCards.set(card.id, card);
  }

  return {
    plans,
    backupCards: [...backupCards.values()],
    invalidCardIds: invalidCardIds.sort((left, right) => left.localeCompare(right, 'en-US')),
    scannedSourceCount: sourceCards.length,
    selectedSourceCount: pending.reduce((total, group) => total + group.sourceCards.length, 0),
    duplicateGroupCount: pending.filter(group => group.cards.length > 1).length,
  };
};

/** Builds a batch from an in-memory test/preflight snapshot. */
export function buildLegacyLibraryMigrationBatch(
  snapshot: LegacyLibrarySnapshot,
  options: { jobId: string; batchSize: number },
): LegacyLibraryMigrationBatch {
  const batchSize = Math.max(1, Math.min(100, Math.floor(options.batchSize)));
  const selectedCards = snapshot.cards.slice(0, batchSize);
  const canonicalCards = new Map<string, CleanupCard>();
  for (const card of snapshot.cards) {
    const normalizedWord = normalizeCleanupWord(card.normalizedWord) || normalizeCleanupWord(card.word);
    if (normalizedWord && card.id === createCanonicalCleanupCardId(normalizedWord)) {
      canonicalCards.set(normalizedWord, card);
    }
  }
  return buildBatch(snapshot.libraryEpoch, selectedCards, canonicalCards, snapshot.reservations, options.jobId);
}

export function buildLegacyLibraryMigrationPageBatch(
  page: LegacyLibraryMigrationPage,
  jobId: string,
): LegacyLibraryMigrationBatch {
  return buildBatch(
    page.libraryEpoch,
    page.sourceCards,
    page.canonicalCards,
    page.reservations,
    jobId,
  );
}

export const MAX_LEGACY_LIBRARY_MIGRATION_SOURCE_CARDS = 10_000;
export const MAX_BROWSER_LEGACY_LIBRARY_MIGRATION_SOURCE_CARDS = 3_000;
export const MAX_AUTOMATIC_ROLLBACK_SOURCE_CARDS = 100;

const boundedBatchSize = (batchSize: number): number =>
  Math.max(1, Math.min(100, Math.floor(batchSize)));

const assertPageWithinSourceLimit = (
  page: LegacyLibraryMigrationPage,
  maximumSourceCards: number = MAX_LEGACY_LIBRARY_MIGRATION_SOURCE_CARDS,
): void => {
  if (page.scannedBefore + page.sourceCards.length > maximumSourceCards) {
    throw new LegacyLibrarySourceLimitError(maximumSourceCards);
  }
};

const pageToken = (page: LegacyLibraryMigrationPage): LegacyLibraryMigrationProgressToken => {
  if (page.phase === 'complete') throw new Error('A completed migration has no writable progress token.');
  return { phase: page.phase, cursor: page.progressCursor, scanned: page.scannedBefore };
};

const remainingIndicator = (page: LegacyLibraryMigrationPage): number => page.hasMore ? 1 : 0;

async function scanLegacyLibraryMigrationPreflight(
  store: LegacyLibraryMigrationStore,
  ownerId: string,
  options: {
    jobId: string;
    batchSize: number;
    maximumBatches: number;
    maximumSourceCards?: number;
  },
): Promise<LegacyLibraryMigrationPreflightEvidence> {
  const maximumSourceCards = Math.max(
    1,
    Math.min(
      MAX_LEGACY_LIBRARY_MIGRATION_SOURCE_CARDS,
      Math.floor(options.maximumSourceCards ?? MAX_LEGACY_LIBRARY_MIGRATION_SOURCE_CARDS),
    ),
  );
  const maximumBatches = Math.max(
    1,
    Math.min(
      Math.ceil(maximumSourceCards / boundedBatchSize(options.batchSize)) + 1,
      Math.floor(options.maximumBatches),
    ),
  );
  const sourceCards: CleanupCard[] = [];
  const canonicalCards = new Map<string, CleanupCard>();
  const reservations = new Map<string, unknown>();
  let cursor: string | null = null;
  let expectedEpoch: number | null = null;
  let expectedMutationGeneration: number | null = null;

  for (let batch = 0; batch < maximumBatches; batch += 1) {
    const page = await store.readPage(ownerId, {
      jobId: options.jobId,
      batchSize: boundedBatchSize(options.batchSize),
      cursor,
      scannedBefore: sourceCards.length,
      phase: 'apply',
    });
    if (expectedEpoch === null) {
      expectedEpoch = page.libraryEpoch;
      expectedMutationGeneration = page.mutationGeneration;
    } else if (
      page.libraryEpoch !== expectedEpoch
      || page.mutationGeneration !== expectedMutationGeneration
    ) {
      throw new LegacyLibraryGenerationChangedError();
    }

    assertPageWithinSourceLimit(page, maximumSourceCards);
    sourceCards.push(...page.sourceCards);
    for (const [normalizedWord, card] of page.canonicalCards) canonicalCards.set(normalizedWord, card);
    for (const [normalizedWord, reservation] of page.reservations) reservations.set(normalizedWord, reservation);

    if (page.sourceCards.length === 0 || !page.hasMore) {
      const planned = buildLegacyLibraryMigrationPageBatch({
        ...page,
        libraryEpoch: expectedEpoch,
        sourceCards,
        canonicalCards,
        reservations,
      }, options.jobId);
      const rollbackSourceCount = new Set(planned.backupCards.map(card => card.id)).size;
      if (rollbackSourceCount > MAX_AUTOMATIC_ROLLBACK_SOURCE_CARDS) {
        throw new LegacyLibrarySourceLimitError();
      }
      return {
        libraryEpoch: expectedEpoch,
        mutationGeneration: expectedMutationGeneration ?? page.mutationGeneration,
        result: {
          scanned: planned.scannedSourceCount,
          pending: planned.selectedSourceCount,
          merged: planned.duplicateGroupCount,
          invalid: planned.invalidCardIds.length,
          preflightComplete: true,
          migrationComplete: planned.selectedSourceCount === 0 && planned.invalidCardIds.length === 0,
        },
      };
    }
    if (!page.lastDocumentId) throw new Error('Migration page did not provide a cursor.');
    cursor = page.lastDocumentId;
  }
  throw new Error(`Legacy library migration preflight did not converge within ${maximumBatches} batches.`);
}

export async function runLegacyLibraryMigrationPreflight(
  store: LegacyLibraryMigrationStore,
  ownerId: string,
  options: { jobId: string; batchSize: number; maximumBatches: number },
): Promise<LegacyLibraryMigrationPreflightResult> {
  return (await scanLegacyLibraryMigrationPreflight(store, ownerId, options)).result;
}

async function runLegacyLibraryMigrationPage(
  store: LegacyLibraryMigrationStore,
  ownerId: string,
  options: { jobId: string; batchSize: number; dryRun: boolean },
  preflightEvidence?: LegacyLibraryMigrationPreflightEvidence,
): Promise<LegacyLibraryMigrationPageResult> {
  const page = await store.readPage(ownerId, {
    jobId: options.jobId,
    batchSize: boundedBatchSize(options.batchSize),
  });
  if (preflightEvidence && (
    page.libraryEpoch !== preflightEvidence.libraryEpoch
    || page.mutationGeneration !== preflightEvidence.mutationGeneration
  )) {
    throw new LegacyLibraryGenerationChangedError();
  }
  if (page.alreadyComplete) {
    return { migrated: 0, merged: 0, scanned: 0, complete: true, remaining: 0, invalid: 0 };
  }
  assertPageWithinSourceLimit(page);
  const batch = buildLegacyLibraryMigrationPageBatch(page, options.jobId);
  if (batch.invalidCardIds.length > 0 && !options.dryRun) {
    throw new LegacyLibraryInvalidCardsError(batch.invalidCardIds.length);
  }
  if (options.dryRun) {
    return {
      migrated: 0,
      merged: batch.duplicateGroupCount,
      scanned: batch.scannedSourceCount,
      complete: false,
      remaining: remainingIndicator(page),
      invalid: batch.invalidCardIds.length,
    };
  }

  const expected = pageToken(page);
  if (page.phase === 'apply') {
    await store.backup(
      ownerId,
      options.jobId,
      batch.backupCards,
      page.libraryEpoch,
      page.mutationGeneration,
      expected,
    );
    for (const plan of batch.plans) {
      await store.apply(
        ownerId,
        options.jobId,
        plan,
        page.libraryEpoch,
        page.mutationGeneration,
        expected,
      );
    }
    const next: LegacyLibraryMigrationProgressToken = page.hasMore
      ? {
        phase: 'apply',
        cursor: page.lastDocumentId,
        scanned: page.scannedBefore + batch.scannedSourceCount,
      }
      : { phase: 'verify', cursor: null, scanned: 0 };
    if (page.hasMore && !page.lastDocumentId) throw new Error('Migration page did not provide a cursor.');
    await store.advanceProgress(
      ownerId,
      options.jobId,
      page.libraryEpoch,
      page.mutationGeneration,
      expected,
      next,
    );
    return {
      migrated: batch.selectedSourceCount,
      merged: batch.duplicateGroupCount,
      scanned: batch.scannedSourceCount,
      complete: false,
      remaining: 1,
      invalid: 0,
      transitioned: !page.hasMore,
    };
  }

  if (batch.plans.length > 0) {
    await store.advanceProgress(
      ownerId,
      options.jobId,
      page.libraryEpoch,
      page.mutationGeneration,
      expected,
      { phase: 'apply', cursor: null, scanned: 0 },
    );
    return {
      migrated: 0,
      merged: batch.duplicateGroupCount,
      scanned: batch.scannedSourceCount,
      complete: false,
      remaining: 1,
      invalid: 0,
    };
  }

  if (!page.hasMore) {
    await store.markComplete(
      ownerId,
      options.jobId,
      page.libraryEpoch,
      page.mutationGeneration,
      expected,
    );
    return {
      migrated: 0,
      merged: 0,
      scanned: batch.scannedSourceCount,
      complete: true,
      remaining: 0,
      invalid: 0,
    };
  }
  if (!page.lastDocumentId) throw new Error('Migration verification page did not provide a cursor.');
  await store.advanceProgress(
    ownerId,
    options.jobId,
    page.libraryEpoch,
    page.mutationGeneration,
    expected,
    {
      phase: 'verify',
      cursor: page.lastDocumentId,
      scanned: page.scannedBefore + batch.scannedSourceCount,
    },
  );
  return {
    migrated: 0,
    merged: 0,
    scanned: batch.scannedSourceCount,
    complete: false,
    remaining: 1,
    invalid: 0,
  };
}

const preflightBatchLimit = (
  batchSize: number,
  maximumSourceCards = MAX_LEGACY_LIBRARY_MIGRATION_SOURCE_CARDS,
): number => Math.ceil(maximumSourceCards / boundedBatchSize(batchSize));

export const legacyLibraryMigrationCompletionBatchLimit = (batchSize: number): number =>
  preflightBatchLimit(batchSize) * 2;

const BROWSER_MIGRATION_PAGES_PER_CALL = 2;

const loadOrCreatePreflightEvidence = async (
  store: LegacyLibraryMigrationStore,
  ownerId: string,
  options: { jobId: string; batchSize: number },
): Promise<LegacyLibraryMigrationPreflightEvidence> => {
  const persisted = await store.readPreflight?.(ownerId, options.jobId);
  if (persisted) {
    if (persisted.result.scanned > MAX_BROWSER_LEGACY_LIBRARY_MIGRATION_SOURCE_CARDS) {
      throw new LegacyLibrarySourceLimitError(MAX_BROWSER_LEGACY_LIBRARY_MIGRATION_SOURCE_CARDS);
    }
    return persisted;
  }

  const evidence = await scanLegacyLibraryMigrationPreflight(store, ownerId, {
    jobId: options.jobId,
    batchSize: options.batchSize,
    // One read-only probe after the 3,000th source card proves an overflow before
    // preflight evidence or card/progress writes can be persisted.
    maximumBatches: preflightBatchLimit(
      options.batchSize,
      MAX_BROWSER_LEGACY_LIBRARY_MIGRATION_SOURCE_CARDS,
    ) + 1,
    maximumSourceCards: MAX_BROWSER_LEGACY_LIBRARY_MIGRATION_SOURCE_CARDS,
  });
  await store.storePreflight?.(ownerId, options.jobId, evidence);
  return evidence;
};

export async function runLegacyLibraryMigration(
  store: LegacyLibraryMigrationStore,
  ownerId: string,
  options: { jobId: string; batchSize: number; dryRun: boolean },
): Promise<LegacyLibraryMigrationResult> {
  if (options.dryRun) return runLegacyLibraryMigrationPage(store, ownerId, options);
  const preflightEvidence = await loadOrCreatePreflightEvidence(store, ownerId, options);
  if (preflightEvidence.result.invalid > 0) {
    throw new LegacyLibraryInvalidCardsError(preflightEvidence.result.invalid);
  }

  let migrated = 0;
  let merged = 0;
  let scanned = 0;
  for (let page = 0; page < BROWSER_MIGRATION_PAGES_PER_CALL; page += 1) {
    const result = await runLegacyLibraryMigrationPage(store, ownerId, options, preflightEvidence);
    migrated += result.migrated;
    merged += result.merged;
    scanned += result.scanned;
    if (result.complete) return { migrated, merged, scanned, complete: true, remaining: 0, invalid: 0 };
    // Do not cross from apply into verification in the same call. It leaves
    // an observable resumable checkpoint for generation restarts.
    if (result.transitioned && page + 1 < BROWSER_MIGRATION_PAGES_PER_CALL) break;
  }
  return { migrated, merged, scanned, complete: false, remaining: 1, invalid: 0 };
}

export async function runLegacyLibraryMigrationToCompletion(
  store: LegacyLibraryMigrationStore,
  ownerId: string,
  options: { jobId: string; batchSize: number; maximumBatches: number },
): Promise<LegacyLibraryMigrationResult> {
  const maximumBatches = Math.max(
    1,
    Math.min(
      legacyLibraryMigrationCompletionBatchLimit(options.batchSize),
      Math.floor(options.maximumBatches),
    ),
  );
  const preflightEvidence = await scanLegacyLibraryMigrationPreflight(store, ownerId, {
    jobId: options.jobId,
    batchSize: options.batchSize,
    maximumBatches: preflightBatchLimit(options.batchSize),
  });
  if (preflightEvidence.result.invalid > 0) {
    throw new LegacyLibraryInvalidCardsError(preflightEvidence.result.invalid);
  }
  let migrated = 0;
  let merged = 0;
  let scanned = 0;

  for (let batch = 0; batch < maximumBatches; batch += 1) {
    const result = await runLegacyLibraryMigrationPage(store, ownerId, {
      jobId: options.jobId,
      batchSize: options.batchSize,
      dryRun: false,
    }, preflightEvidence);
    migrated += result.migrated;
    merged += result.merged;
    scanned += result.scanned;
    if (result.invalid > 0) throw new LegacyLibraryInvalidCardsError(result.invalid);
    if (result.complete) return { migrated, merged, scanned, complete: true, remaining: 0, invalid: 0 };
  }
  throw new Error(`Legacy library migration did not converge within ${maximumBatches} batches.`);
}
