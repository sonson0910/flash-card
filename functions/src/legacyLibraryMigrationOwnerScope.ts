import { createHash } from 'node:crypto';
import type { Firestore, Transaction } from 'firebase-admin/firestore';

export type LegacyLibraryMigrationMode = 'dry-run' | 'apply' | 'rollback';

export const LIBRARY_MIGRATION_FENCE_SCHEMA_VERSION = 1 as const;
export const LIBRARY_MIGRATION_FENCE_COLLECTION = 'profile';
export const LIBRARY_MIGRATION_FENCE_DOCUMENT = 'library_migration_fence';

export type LegacyLibraryMigrationFence = {
  schemaVersion: 1;
  active: boolean;
  phase: 'verify' | 'apply' | 'rollback';
  jobId: string;
  scanId: string;
  token: string;
  leaseOwner: string;
  leaseExpiresAt: number;
  sourceRevision: string;
  libraryEpoch: number;
  revision: number;
  appliedGroupCount: number;
  appliedSourceCount: number;
  sourceCount: number;
  groupCount: number;
  startedAt: number;
};

export class LegacyLibraryMigrationFenceError extends Error {
  constructor(public readonly reason = 'library-migration-fenced') {
    super(`Library writes are blocked while migration is ${reason}.`);
    this.name = 'LegacyLibraryMigrationFenceError';
  }
}

export const migrationFenceReference = (database: Firestore, ownerId: string) =>
  database.collection('users').doc(ownerId).collection(LIBRARY_MIGRATION_FENCE_COLLECTION)
    .doc(LIBRARY_MIGRATION_FENCE_DOCUMENT);

export const isActiveMigrationFence = (value: unknown): value is LegacyLibraryMigrationFence => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const fence = value as Record<string, unknown>;
  return fence.schemaVersion === LIBRARY_MIGRATION_FENCE_SCHEMA_VERSION
    && fence.active === true;
};

/** Admin callables must enforce the same durable fence as direct Rules writes. */
export async function assertOwnerLibraryWriteAllowed(
  transaction: Transaction,
  database: Firestore,
  ownerId: string,
): Promise<void> {
  const snapshot = await transaction.get(migrationFenceReference(database, ownerId));
  if (snapshot.exists && isActiveMigrationFence(snapshot.data())) {
    throw new LegacyLibraryMigrationFenceError();
  }
}

export function createMigrationOwnerKey(ownerId: string): string {
  return createHash('sha256').update(ownerId).digest('hex').slice(0, 12);
}

export function selectMigrationOwnerIds(
  ownerIds: readonly string[],
  mode: LegacyLibraryMigrationMode,
  requestedOwnerKey: string | undefined,
): string[] {
  if (mode === 'dry-run') return [...ownerIds];
  if (!requestedOwnerKey || !/^[a-f0-9]{12}$/.test(requestedOwnerKey)) {
    throw new Error('Apply and rollback require a 12-character MIGRATION_OWNER_KEY.');
  }
  const matches = ownerIds.filter(ownerId => createMigrationOwnerKey(ownerId) === requestedOwnerKey);
  if (matches.length !== 1) {
    throw new Error(
      `MIGRATION_OWNER_KEY must match exactly one discovered owner; matched ${matches.length}.`,
    );
  }
  return matches;
}
