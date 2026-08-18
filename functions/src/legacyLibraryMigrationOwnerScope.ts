import { createHash } from 'node:crypto';

export type LegacyLibraryMigrationMode = 'dry-run' | 'apply' | 'rollback';

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
