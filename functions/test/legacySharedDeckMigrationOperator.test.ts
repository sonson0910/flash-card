import { describe, expect, it } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  canonicalLegacySharedDeckBackupManifest,
  parseLegacySharedDeckOperatorMode,
  runLegacySharedDeckApplyAndVerify,
  runLegacySharedDeckSupersedeOperator,
  validateLegacySharedDeckOperatorEnvironment,
  verifyLegacySharedDeckBackupManifest,
} from '../src/legacySharedDeckMigrationOperator.js';
import type { LegacySharedDeckSupersedeOptions } from '../src/legacySharedDeckMigration.js';

describe('legacy shared-deck migration operator', () => {
  it('accepts apply only with the exact confirmation', () => {
    expect(parseLegacySharedDeckOperatorMode({ MIGRATION_MODE: 'inventory' })).toBe('inventory');
    expect(parseLegacySharedDeckOperatorMode({
      MIGRATION_MODE: 'apply',
      APPLY_CONFIRMATION: 'APPLY_SHARED_DECK_V2',
    })).toBe('apply');
    expect(() => parseLegacySharedDeckOperatorMode({
      MIGRATION_MODE: 'apply',
      APPLY_CONFIRMATION: 'APPLY_SHARED_DECK_V1',
    })).toThrow(/confirmation/i);
    expect(parseLegacySharedDeckOperatorMode({
      MIGRATION_MODE: 'supersede',
      SUPERSEDE_CONFIRMATION: 'SUPERSEDE_SHARED_DECK_V2',
    })).toBe('supersede');
    expect(parseLegacySharedDeckOperatorMode({
      MIGRATION_MODE: 'prepare-indexes',
      PREPARE_INDEXES_CONFIRMATION: 'PREPARE_INDEXES_V2',
    })).toBe('prepare-indexes');
  });

  it('requires a non-placeholder backup manifest bound to the owner and revision', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const unsigned = {
      schemaVersion: 2 as const,
      backupObjectId: 'gs://verified-backup/manifest.json',
      backupGeneration: '1700000000000000',
      backupDigest: 'c'.repeat(64),
      inventoryDigest: 'd'.repeat(64),
      target: 'encoded-hangout-433912-h2/ai-studio-945b4052-4462-4668-8936-277f09f07a37',
      revision: 'd'.repeat(40),
      ownerUid: 'protected-owner',
      verifiedAt: '2026-08-24T00:00:00.000Z',
    };
    const expected = { digest: unsigned.inventoryDigest, target: unsigned.target, revision: unsigned.revision, ownerUid: unsigned.ownerUid };
    const manifest = {
      ...unsigned,
      signature: sign(null, canonicalLegacySharedDeckBackupManifest(unsigned), privateKey).toString('base64'),
    };
    expect(verifyLegacySharedDeckBackupManifest(manifest, expected, publicKey, Date.parse(unsigned.verifiedAt))).toBe(true);
    expect(() => verifyLegacySharedDeckBackupManifest({ ...manifest, target: 'other' }, expected, publicKey, Date.parse(unsigned.verifiedAt)))
      .toThrow(/backup/i);
  });

  it('requires immutable index-preparation provenance before apply', () => {
    const base = {
      FIREBASE_PROJECT_ID: 'encoded-hangout-433912-h2',
      FIRESTORE_DATABASE_ID: 'ai-studio-945b4052-4462-4668-8936-277f09f07a37',
      OWNER_UID: 'protected-owner',
      MIGRATION_REVISION: 'a'.repeat(40),
      SCAN_STARTED_AT: '2026-08-24T00:00:00.000Z',
      MIGRATION_MODE: 'apply',
      APPLY_CONFIRMATION: 'APPLY_SHARED_DECK_V2',
      BACKUP_MANIFEST_JSON: '{}',
      BACKUP_PUBLIC_KEY: 'trusted',
    } as NodeJS.ProcessEnv;
    expect(() => validateLegacySharedDeckOperatorEnvironment(base)).toThrow(/index-preparation/i);
    expect(validateLegacySharedDeckOperatorEnvironment({
      ...base,
      INDEX_PREPARATION_RUN_ID: '123',
      INDEX_PREPARATION_REPORT_SHA256: 'a'.repeat(64),
      INDEX_PREPARATION_REPORT_JSON: '{}',
    })).toMatchObject({ mode: 'apply', indexPreparationRunId: '123' });
  });

  it('requires an immutable source revision for a supersede handoff', () => {
    const base = {
      FIREBASE_PROJECT_ID: 'encoded-hangout-433912-h2',
      FIRESTORE_DATABASE_ID: 'ai-studio-945b4052-4462-4668-8936-277f09f07a37',
      OWNER_UID: 'protected-owner',
      MIGRATION_REVISION: 'b'.repeat(40),
      SCAN_STARTED_AT: '2026-08-25T00:00:00.000Z',
      MIGRATION_MODE: 'supersede',
      SUPERSEDE_CONFIRMATION: 'SUPERSEDE_SHARED_DECK_V2',
      SUPERSEDE_INVENTORY_DIGEST: 'c'.repeat(64),
      SUPERSEDE_ROOT_DIGEST: 'd'.repeat(64),
    } as NodeJS.ProcessEnv;
    expect(() => validateLegacySharedDeckOperatorEnvironment(base)).toThrow(/source revision/i);
    expect(() => validateLegacySharedDeckOperatorEnvironment({
      ...base,
      SUPERSEDE_SOURCE_REVISION: base.MIGRATION_REVISION,
    })).toThrow(/source revision/i);
    expect(validateLegacySharedDeckOperatorEnvironment({
      ...base,
      SUPERSEDE_SOURCE_REVISION: 'a'.repeat(40),
    })).toMatchObject({ mode: 'supersede', supersedeSourceRevision: 'a'.repeat(40) });
  });

  it('resumes an active verification through the operator apply-then-verify path', async () => {
    const calls: string[] = [];
    const result = await runLegacySharedDeckApplyAndVerify(
      async () => { calls.push('apply-validation'); return { applied: true }; },
      async () => { calls.push('verify-resume'); return { verified: true }; },
    );
    expect(calls).toEqual(['apply-validation', 'verify-resume']);
    expect(result).toEqual({ verified: true });
  });

  it('retries supersede through the operator branch from exact sealed evidence', async () => {
    const calls: string[] = [];
    const environment = {
      ownerUid: 'protected-owner',
      revision: 'a'.repeat(40),
      target: 'project/database',
      inventoryDigest: 'b'.repeat(64),
      rootDigest: 'c'.repeat(64),
      confirmation: 'SUPERSEDE_SHARED_DECK_V2',
    } as const;
    const invoke = async (options: LegacySharedDeckSupersedeOptions) => {
      calls.push(`${options.inventoryDigest}:${options.rootDigest}`);
      return { superseded: true as const, historyPath: 'history/retry' };
    };
    const first = await runLegacySharedDeckSupersedeOperator(environment, invoke);
    const retry = await runLegacySharedDeckSupersedeOperator(environment, invoke);
    expect(first).toBe(retry);
    expect(calls).toEqual([
      `${environment.inventoryDigest}:${environment.rootDigest}`,
      `${environment.inventoryDigest}:${environment.rootDigest}`,
    ]);
  });
});
