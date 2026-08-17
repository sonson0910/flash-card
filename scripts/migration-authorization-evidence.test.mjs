import { describe, expect, it } from 'vitest';
import { validateMigrationAuthorizationEvidence } from './migration-authorization-evidence.mjs';

const keyVersion = 'projects/backup-security/locations/global/keyRings/lingoflash/cryptoKeys/rollback/cryptoKeyVersions/1';
const rollbackSnapshotObject = {
  schemaVersion: 1,
  provider: 'gcs',
  bucket: 'sonflash-rollback-archive',
  object: 'production/reservations/snapshot.enc',
  generation: '1755216000123456',
  sizeBytes: 27,
  sha256: 'c'.repeat(64),
};
const validEvidence = {
  schemaVersion: 2,
  purpose: 'reservation-migration-authorization',
  operation: 'cutover',
  migrationMode: 'apply',
  migrationRunId: '123456789',
  migrationRunAttempt: 1,
  enforcementRunId: '987654321',
  enforcementRunAttempt: 2,
  enforcementEvidenceSha256: 'e'.repeat(64),
  projectId: 'project-production',
  databaseId: 'database-production',
  compatibleClientRevision: 'a'.repeat(40),
  rulesSha256: 'b'.repeat(64),
  rollbackSnapshotCiphertextSha256: 'c'.repeat(64),
  rollbackSnapshotEncryption: {
    scheme: 'gcp-kms-v1',
    keyVersion,
  },
  rollbackSnapshotObject,
  ownerCommitment: 'd'.repeat(64),
  authorizedAt: '2026-08-15T00:00:00.000Z',
  writeFreezeConfirmed: true,
  maxAutomaticRollbackSourceCards: 100,
};

const options = {
  operation: 'cutover',
  migrationMode: 'apply',
  migrationRunId: '123456789',
  migrationRunAttempt: 1,
  enforcementRunId: '987654321',
  enforcementRunAttempt: 2,
  enforcementEvidenceSha256: 'e'.repeat(64),
  projectId: 'project-production',
  databaseId: 'database-production',
  clientRevision: 'a'.repeat(40),
  rulesSha256: 'b'.repeat(64),
  rollbackSnapshotCiphertextSha256: 'c'.repeat(64),
  rollbackSnapshotObject,
  rollbackSnapshotObjectPrefix: 'production/reservations/',
  rollbackKmsKeyVersion: keyVersion,
  ownerCommitment: 'd'.repeat(64),
  now: new Date('2026-08-15T00:05:00.000Z'),
};

describe('reservation migration authorization evidence', () => {
  it('accepts a fresh externally sealed apply authorization', () => {
    expect(validateMigrationAuthorizationEvidence(validEvidence, options)).toEqual([]);
  });

  it('requires the migration mode to match the authorized Rules operation', () => {
    expect(validateMigrationAuthorizationEvidence({
      ...validEvidence,
      migrationMode: 'rollback',
    }, options)).toEqual(expect.arrayContaining([
      expect.stringMatching(/migration mode/i),
      expect.stringMatching(/operation/i),
    ]));
  });

  it('rejects replay under a different workflow run or attempt', () => {
    expect(validateMigrationAuthorizationEvidence({
      ...validEvidence,
      migrationRunId: '987654321',
      migrationRunAttempt: 2,
    }, options)).toEqual(expect.arrayContaining([
      expect.stringMatching(/workflow run ID/i),
      expect.stringMatching(/workflow run attempt/i),
    ]));
  });

  it('rejects authorization from a different strict-enforcement run', () => {
    expect(validateMigrationAuthorizationEvidence({
      ...validEvidence,
      enforcementRunId: '111111111',
      enforcementRunAttempt: 3,
      enforcementEvidenceSha256: 'f'.repeat(64),
    }, options)).toEqual(expect.arrayContaining([
      expect.stringMatching(/enforcement run ID/i),
      expect.stringMatching(/enforcement run attempt/i),
      expect.stringMatching(/enforcement digest/i),
    ]));
  });

  it('rejects a different owner, rollback snapshot, or rollback cap', () => {
    expect(validateMigrationAuthorizationEvidence({
      ...validEvidence,
      ownerCommitment: 'e'.repeat(64),
      rollbackSnapshotCiphertextSha256: 'f'.repeat(64),
      maxAutomaticRollbackSourceCards: 101,
    }, options)).toEqual(expect.arrayContaining([
      expect.stringMatching(/owner commitment/i),
      expect.stringMatching(/rollback snapshot ciphertext/i),
      expect.stringMatching(/rollback source cap/i),
    ]));
  });

  it('rejects a different immutable rollback snapshot object generation', () => {
    expect(validateMigrationAuthorizationEvidence({
      ...validEvidence,
      rollbackSnapshotObject: {
        ...rollbackSnapshotObject,
        generation: '1755216000123457',
      },
    }, options)).toEqual(expect.arrayContaining([
      expect.stringMatching(/immutable archive object/i),
    ]));
  });

  it('rejects stale evidence and unknown fields', () => {
    expect(validateMigrationAuthorizationEvidence({
      ...validEvidence,
      authorizedAt: '2026-08-14T23:00:00.000Z',
      approved: true,
    }, options)).toEqual(expect.arrayContaining([
      expect.stringMatching(/unknown fields/i),
      expect.stringMatching(/fresh/i),
    ]));
  });
});
