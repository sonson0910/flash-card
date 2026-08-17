import { describe, expect, it } from 'vitest';
import {
  createMigrationOwnerKey,
  selectExplicitMigrationOwner,
} from '../src/legacyLibraryMigrationOwnerScope.js';

describe('legacy library migration operator owner scope', () => {
  it('uses a stable 12-character SHA-256 owner key without exposing the owner ID', () => {
    expect(createMigrationOwnerKey('owner-1')).toMatch(/^[a-f0-9]{12}$/);
    expect(createMigrationOwnerKey('owner-1')).toBe(createMigrationOwnerKey('owner-1'));
    expect(createMigrationOwnerKey('owner-1')).not.toContain('owner-1');
  });

  it('requires an explicit valid owner for every bounded operator mode', () => {
    expect(() => selectExplicitMigrationOwner(undefined, 'dry-run', undefined))
      .toThrow('MIGRATION_OWNER_ID must be a valid explicit owner ID.');
    expect(() => selectExplicitMigrationOwner('bad/path', 'dry-run', undefined))
      .toThrow('MIGRATION_OWNER_ID must be a valid explicit owner ID.');
    expect(selectExplicitMigrationOwner('owner-1', 'dry-run', undefined)).toBe('owner-1');
  });

  it('requires a matching owner key for apply and rollback', () => {
    expect(() => selectExplicitMigrationOwner('owner-1', 'apply', undefined))
      .toThrow('Apply and rollback require a 12-character MIGRATION_OWNER_KEY.');
    expect(() => selectExplicitMigrationOwner('owner-1', 'rollback', '000000000000'))
      .toThrow('MIGRATION_OWNER_KEY does not match MIGRATION_OWNER_ID.');

    const ownerKey = createMigrationOwnerKey('owner-1');
    expect(selectExplicitMigrationOwner('owner-1', 'apply', ownerKey)).toBe('owner-1');
    expect(selectExplicitMigrationOwner('owner-1', 'rollback', ownerKey)).toBe('owner-1');
  });
});
