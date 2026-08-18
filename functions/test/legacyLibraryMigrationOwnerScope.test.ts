import { describe, expect, it } from 'vitest';
import {
  createMigrationOwnerKey,
  selectMigrationOwnerIds,
} from '../src/legacyLibraryMigrationOwnerScope.js';

describe('legacy library migration operator owner scope', () => {
  it('uses a stable 12-character SHA-256 owner key without exposing the owner ID', () => {
    expect(createMigrationOwnerKey('owner-1')).toMatch(/^[a-f0-9]{12}$/);
    expect(createMigrationOwnerKey('owner-1')).toBe(createMigrationOwnerKey('owner-1'));
    expect(createMigrationOwnerKey('owner-1')).not.toContain('owner-1');
  });

  it('allows a dry-run to report all discovered owners', () => {
    expect(selectMigrationOwnerIds(['owner-2', 'owner-1'], 'dry-run', undefined))
      .toEqual(['owner-2', 'owner-1']);
  });

  it('requires apply and rollback to target exactly one hashed owner key', () => {
    expect(() => selectMigrationOwnerIds(['owner-1'], 'apply', undefined))
      .toThrow('Apply and rollback require a 12-character MIGRATION_OWNER_KEY.');
    expect(() => selectMigrationOwnerIds(['owner-1'], 'rollback', 'not-a-key'))
      .toThrow('Apply and rollback require a 12-character MIGRATION_OWNER_KEY.');
  });

  it('selects only the owner matching the requested key', () => {
    const selectedKey = createMigrationOwnerKey('owner-2');
    expect(selectMigrationOwnerIds(['owner-1', 'owner-2'], 'apply', selectedKey))
      .toEqual(['owner-2']);
  });

  it('fails closed when the requested key has no unique owner match', () => {
    expect(() => selectMigrationOwnerIds(
      ['owner-1', 'owner-2'],
      'apply',
      '000000000000',
    )).toThrow('MIGRATION_OWNER_KEY must match exactly one discovered owner; matched 0.');

    const duplicateOwnerIds = ['owner-1', 'owner-1'];
    expect(() => selectMigrationOwnerIds(
      duplicateOwnerIds,
      'rollback',
      createMigrationOwnerKey('owner-1'),
    )).toThrow('MIGRATION_OWNER_KEY must match exactly one discovered owner; matched 2.');
  });
});
