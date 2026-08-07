import type { CardData } from '../../types/card';
import {
  applyCatalogMigration,
  applyV2Rollback,
  type AtomicCatalogPort,
  type AtomicV2RollbackPort,
} from '../multilingual/migrationApplication';
import {
  createLearningStateV3Store,
  type AtomicDocumentPort,
} from '../multilingual/learningStateV3Store';
import {
  createMigrationFingerprint,
  planV2CardMigrationResult,
  type V2MigrationBundle,
  type V2MigrationQuarantineReason,
} from '../multilingual/v2Migration';

export const MAX_MIGRATION_REHEARSAL_ITEMS = 10_000;

export interface MigrationRehearsalRecord {
  readonly ownerId?: string;
  readonly sourceDocumentId: string;
  readonly card: Partial<CardData>;
  readonly senseKey?: string;
}

export interface MigrationRehearsalInput {
  readonly ownerId: string;
  readonly migratedAt: string;
  readonly records: readonly MigrationRehearsalRecord[];
}

type RehearsalItem =
  | { readonly status: 'migratable'; readonly bundle: V2MigrationBundle }
  | {
      readonly status: 'quarantined';
      readonly reasons: readonly (V2MigrationQuarantineReason | 'duplicate-progress')[];
    };

export interface MigrationRehearsalEvidence {
  readonly schemaVersion: 1;
  readonly migrationVersion: 1;
  readonly rehearsalId: string;
  readonly generatedAt: string;
  readonly counts: {
    readonly total: number;
    readonly migratable: number;
    readonly quarantined: number;
    readonly duplicateProgress: number;
  };
}

export interface MigrationRehearsalPlan {
  readonly ownerId: string;
  readonly evidence: MigrationRehearsalEvidence;
  readonly items: readonly RehearsalItem[];
  readonly hasCrossOwnerInput: boolean;
}

const nonEmpty = (value: string, label: string): string => {
  const result = value.normalize('NFKC').trim();
  if (!result) throw new TypeError(`${label} is required.`);
  return result;
};

export function createMigrationRehearsal(input: MigrationRehearsalInput): MigrationRehearsalPlan {
  const ownerId = nonEmpty(input.ownerId, 'ownerId');
  if (input.records.length > MAX_MIGRATION_REHEARSAL_ITEMS) {
    throw new RangeError(`A migration rehearsal cannot exceed ${MAX_MIGRATION_REHEARSAL_ITEMS.toLocaleString('en-US')} records.`);
  }
  const migratedAt = new Date(input.migratedAt).toISOString();
  const ordered = [...input.records].sort((left, right) =>
    left.sourceDocumentId.localeCompare(right.sourceDocumentId));
  const claimedProgress = new Set<string>();
  let duplicateProgress = 0;
  let hasCrossOwnerInput = false;
  const items: RehearsalItem[] = ordered.map(record => {
    const recordOwner = record.ownerId === undefined ? ownerId : nonEmpty(record.ownerId, 'record.ownerId');
    if (recordOwner !== ownerId) hasCrossOwnerInput = true;
    const result = planV2CardMigrationResult({
      ownerId: recordOwner,
      sourceDocumentId: record.sourceDocumentId,
      card: record.card,
      senseKey: record.senseKey,
      migratedAt,
    });
    if (result.status === 'quarantined') {
      return { status: 'quarantined', reasons: result.reasons };
    }
    const progressKey = `${result.bundle.learningState.ownerId}:${result.bundle.learningState.lexemeId}`;
    if (claimedProgress.has(progressKey)) {
      duplicateProgress += 1;
      return { status: 'quarantined', reasons: ['duplicate-progress'] };
    }
    claimedProgress.add(progressKey);
    return { status: 'migratable', bundle: result.bundle };
  });
  const migratable = items.filter(item => item.status === 'migratable').length;
  const counts = {
    total: items.length,
    migratable,
    quarantined: items.length - migratable,
    duplicateProgress,
  } as const;
  const rehearsalId = createMigrationFingerprint('migration', {
    migrationVersion: 1,
    generatedAt: migratedAt,
    counts,
    itemFingerprints: items.map(item => item.status === 'migratable'
      ? item.bundle.migrationId
      : [...item.reasons].sort()),
  });
  return {
    ownerId,
    items,
    hasCrossOwnerInput,
    evidence: {
      schemaVersion: 1,
      migrationVersion: 1,
      rehearsalId,
      generatedAt: migratedAt,
      counts,
    },
  };
}

export function serializeMigrationEvidence(evidence: MigrationRehearsalEvidence): string {
  return JSON.stringify({
    schemaVersion: evidence.schemaVersion,
    migrationVersion: evidence.migrationVersion,
    rehearsalId: evidence.rehearsalId,
    generatedAt: evidence.generatedAt,
    counts: evidence.counts,
  });
}

export interface MigrationRehearsalApplicationPorts {
  readonly activeOwner: () => string | null;
  readonly catalog: AtomicCatalogPort;
  readonly learningDocuments: AtomicDocumentPort;
}

export type MigrationRehearsalApplicationResult =
  | { readonly status: 'rejected'; readonly reason: 'cross-owner-input' }
  | { readonly status: 'stale-owner'; readonly processed: number }
  | {
      readonly status: 'completed';
      readonly processed: number;
      readonly applied: number;
      readonly unchanged: number;
      readonly conflicts: number;
      readonly quarantined: number;
    };

const equivalent = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

export async function applyMigrationRehearsal(
  plan: MigrationRehearsalPlan,
  ports: MigrationRehearsalApplicationPorts,
): Promise<MigrationRehearsalApplicationResult> {
  if (plan.hasCrossOwnerInput) return { status: 'rejected', reason: 'cross-owner-input' };
  const states = createLearningStateV3Store(ports.learningDocuments);
  let processed = 0;
  let applied = 0;
  let unchanged = 0;
  let conflicts = 0;
  const quarantined = plan.items.filter(item => item.status === 'quarantined').length;
  for (const item of plan.items) {
    if (item.status === 'quarantined') continue;
    if (ports.activeOwner() !== plan.ownerId) return { status: 'stale-owner', processed };
    const catalog = await applyCatalogMigration(item.bundle, ports.catalog);
    if (catalog.status === 'conflict') {
      conflicts += 1;
      processed += 1;
      continue;
    }
    if (ports.activeOwner() !== plan.ownerId) return { status: 'stale-owner', processed };
    const learning = await states.create(item.bundle.learningState);
    processed += 1;
    if (learning.status === 'exists' && !equivalent(learning.current, item.bundle.learningState)) {
      conflicts += 1;
    } else if (catalog.status === 'applied' || learning.status === 'created') {
      applied += 1;
    } else {
      unchanged += 1;
    }
  }
  return { status: 'completed', processed, applied, unchanged, conflicts, quarantined };
}

export interface MigrationRehearsalRollbackPorts {
  readonly activeOwner: () => string | null;
  readonly documents: AtomicV2RollbackPort;
}

export type MigrationRehearsalRollbackResult =
  | { readonly status: 'stale-owner'; readonly processed: number }
  | {
      readonly status: 'completed';
      readonly processed: number;
      readonly restored: number;
      readonly unchanged: number;
      readonly missing: number;
      readonly conflicts: number;
    };

export async function rollbackMigrationRehearsal(
  plan: MigrationRehearsalPlan,
  ports: MigrationRehearsalRollbackPorts,
): Promise<MigrationRehearsalRollbackResult> {
  let processed = 0;
  let restored = 0;
  let unchanged = 0;
  let missing = 0;
  let conflicts = 0;
  for (const item of plan.items) {
    if (item.status === 'quarantined') continue;
    if (ports.activeOwner() !== plan.ownerId) return { status: 'stale-owner', processed };
    const bundle = item.bundle;
    const result = await applyV2Rollback({
      snapshot: bundle.rollback,
      trustedContext: {
        expectedOwnerId: bundle.source.ownerId,
        expectedSourceDocumentId: bundle.source.documentId,
        expectedSourceFingerprint: bundle.source.fingerprint,
      },
      expectedRevision: bundle.source.revision ?? 0,
      expectedLibraryEpoch: bundle.source.libraryEpoch ?? 0,
    }, ports.documents);
    processed += 1;
    if (result.status === 'restored') restored += 1;
    else if (result.status === 'unchanged') unchanged += 1;
    else if (result.status === 'missing') missing += 1;
    else conflicts += 1;
  }
  return { status: 'completed', processed, restored, unchanged, missing, conflicts };
}
