import { createHash } from 'node:crypto';

export type LegacyLibraryMigrationMode = 'dry-run' | 'apply' | 'rollback';

const OWNER_ID_PATTERN = /^[a-zA-Z0-9:_-]{1,128}$/;

export function createMigrationOwnerKey(ownerId: string): string {
  return createHash('sha256').update(ownerId).digest('hex').slice(0, 12);
}

/**
 * The operator accepts one explicitly supplied owner. Discovering owners from a
 * cards collection group turns a single-owner action into an unbounded read.
 */
export function selectExplicitMigrationOwner(
  requestedOwnerId: string | undefined,
  mode: LegacyLibraryMigrationMode,
  requestedOwnerKey: string | undefined,
): string {
  if (!requestedOwnerId || !OWNER_ID_PATTERN.test(requestedOwnerId)) {
    throw new Error('MIGRATION_OWNER_ID must be a valid explicit owner ID.');
  }
  if (mode === 'dry-run') return requestedOwnerId;
  if (!requestedOwnerKey || !/^[a-f0-9]{12}$/.test(requestedOwnerKey)) {
    throw new Error('Apply and rollback require a 12-character MIGRATION_OWNER_KEY.');
  }
  if (createMigrationOwnerKey(requestedOwnerId) !== requestedOwnerKey) {
    throw new Error('MIGRATION_OWNER_KEY does not match MIGRATION_OWNER_ID.');
  }
  return requestedOwnerId;
}
