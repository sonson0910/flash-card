import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertRollbackSnapshotCiphertextFile,
  MAX_ROLLBACK_SNAPSHOT_CIPHERTEXT_BYTES,
  validateRulesCutoverEvidence,
} from './rules-cutover-evidence.mjs';

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
  schemaVersion: 1,
  operation: 'cutover',
  status: 'cutover-ready',
  projectId: 'project-production',
  databaseId: 'database-production',
  compatibleClientRevision: 'a'.repeat(40),
  rulesSha256: 'b'.repeat(64),
  rollbackSnapshotCiphertextSha256: 'c'.repeat(64),
  rollbackSnapshotEncryption: {
    scheme: 'gcp-kms-v1',
    keyVersion: 'projects/backup-security/locations/global/keyRings/lingoflash/cryptoKeys/rollback/cryptoKeyVersions/1',
  },
  rollbackSnapshotObject,
  verifiedAt: '2026-08-10T00:00:00.000Z',
  writeFreezeConfirmed: true,
  finalDeltaVerification: true,
  counts: {
    cards: 4,
    canonicalIdentities: 3,
    reservations: 3,
    duplicateIdentities: 0,
    invalidIdentities: 0,
    missingReservations: 0,
    mismatchedReservations: 0,
  },
};

describe('Rules cutover evidence', () => {
  it('rejects an empty, non-regular, or oversized rollback ciphertext artifact', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingoflash-rollback-ciphertext-'));
    const emptyFile = path.join(directory, 'empty.enc');
    fs.writeFileSync(emptyFile, '');
    try {
      expect(() => assertRollbackSnapshotCiphertextFile(emptyFile)).toThrow(/must not be empty/i);
      expect(() => assertRollbackSnapshotCiphertextFile(directory)).toThrow(/regular file/i);
      fs.writeFileSync(emptyFile, 'encrypted bytes');
      expect(() => assertRollbackSnapshotCiphertextFile(emptyFile)).not.toThrow();
      fs.truncateSync(emptyFile, MAX_ROLLBACK_SNAPSHOT_CIPHERTEXT_BYTES + 1);
      expect(() => assertRollbackSnapshotCiphertextFile(emptyFile)).toThrow(/exceeds 10 GiB/i);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('accepts fresh, project-bound, complete migration evidence', () => {
    expect(validateRulesCutoverEvidence(validEvidence, {
      operation: 'cutover',
      projectId: 'project-production',
      databaseId: 'database-production',
      clientRevision: 'a'.repeat(40),
      rulesSha256: 'b'.repeat(64),
      rollbackSnapshotCiphertextSha256: 'c'.repeat(64),
      rollbackSnapshotObject,
      rollbackSnapshotObjectPrefix: 'production/reservations/',
      rollbackKmsKeyVersion: validEvidence.rollbackSnapshotEncryption.keyVersion,
      now: new Date('2026-08-10T00:05:00.000Z'),
    })).toEqual([]);
  });

  it('rejects final-state verification timestamped before migration completion', () => {
    expect(validateRulesCutoverEvidence(validEvidence, {
      operation: 'cutover',
      projectId: 'project-production',
      databaseId: 'database-production',
      clientRevision: 'a'.repeat(40),
      rulesSha256: 'b'.repeat(64),
      rollbackSnapshotCiphertextSha256: 'c'.repeat(64),
      rollbackSnapshotObject,
      rollbackSnapshotObjectPrefix: 'production/reservations/',
      rollbackKmsKeyVersion: validEvidence.rollbackSnapshotEncryption.keyVersion,
      now: new Date('2026-08-10T00:05:00.000Z'),
      notBefore: new Date('2026-08-10T00:01:00.000Z'),
    })).toContain('Rules cutover evidence predates the completed migration.');
  });

  it('requires final-state verification strictly after migration completion', () => {
    const options = {
      operation: 'cutover',
      projectId: 'project-production',
      databaseId: 'database-production',
      clientRevision: 'a'.repeat(40),
      rulesSha256: 'b'.repeat(64),
      rollbackSnapshotCiphertextSha256: 'c'.repeat(64),
      rollbackSnapshotObject,
      rollbackSnapshotObjectPrefix: 'production/reservations/',
      rollbackKmsKeyVersion: validEvidence.rollbackSnapshotEncryption.keyVersion,
      now: new Date('2026-08-10T00:05:00.000Z'),
    };
    const completion = new Date(validEvidence.verifiedAt);

    expect(validateRulesCutoverEvidence(validEvidence, {
      ...options,
      notBefore: completion,
    })).toContain('Rules cutover evidence predates the completed migration.');
    expect(validateRulesCutoverEvidence({
      ...validEvidence,
      verifiedAt: '2026-08-10T00:00:00.001Z',
    }, {
      ...options,
      notBefore: completion,
    })).toEqual([]);
  });

  it('rejects a different immutable rollback snapshot object generation', () => {
    expect(validateRulesCutoverEvidence({
      ...validEvidence,
      rollbackSnapshotObject: {
        ...rollbackSnapshotObject,
        generation: '1755216000123457',
      },
    }, {
      operation: 'cutover',
      projectId: 'project-production',
      databaseId: 'database-production',
      clientRevision: 'a'.repeat(40),
      rulesSha256: 'b'.repeat(64),
      rollbackSnapshotCiphertextSha256: 'c'.repeat(64),
      rollbackSnapshotObject,
      rollbackSnapshotObjectPrefix: 'production/reservations/',
      rollbackKmsKeyVersion: validEvidence.rollbackSnapshotEncryption.keyVersion,
      now: new Date('2026-08-10T00:05:00.000Z'),
    })).toContain('Rules cutover evidence rollback snapshot object does not match the retained immutable object.');
  });

  it('rejects a different syntactically valid rollback KMS key version', () => {
    expect(validateRulesCutoverEvidence(validEvidence, {
      operation: 'cutover',
      projectId: 'project-production',
      databaseId: 'database-production',
      clientRevision: 'a'.repeat(40),
      rulesSha256: 'b'.repeat(64),
      rollbackSnapshotCiphertextSha256: 'c'.repeat(64),
      rollbackSnapshotObject,
      rollbackSnapshotObjectPrefix: 'production/reservations/',
      rollbackKmsKeyVersion: 'projects/backup-security/locations/global/keyRings/lingoflash/cryptoKeys/rollback/cryptoKeyVersions/2',
      now: new Date('2026-08-10T00:05:00.000Z'),
    })).toContain('Rules cutover evidence KMS key version does not match the protected rollback key.');
  });

  it('rejects evidence whose rollback digest does not match the retained snapshot', () => {
    expect(validateRulesCutoverEvidence(validEvidence, {
      operation: 'cutover',
      projectId: 'project-production',
      databaseId: 'database-production',
      clientRevision: 'a'.repeat(40),
      rulesSha256: 'b'.repeat(64),
      rollbackSnapshotCiphertextSha256: 'd'.repeat(64),
      rollbackKmsKeyVersion: validEvidence.rollbackSnapshotEncryption.keyVersion,
      now: new Date('2026-08-10T00:05:00.000Z'),
    })).toContain('Rules cutover evidence rollback snapshot ciphertext does not match the retained ciphertext.');
  });

  it('rejects evidence that does not attest a supported external-KMS encryption scheme', () => {
    expect(validateRulesCutoverEvidence({
      ...validEvidence,
      rollbackSnapshotEncryption: {
        scheme: 'plaintext',
        keyVersion: 'local-key',
      },
    }, {
      operation: 'cutover',
      projectId: 'project-production',
      databaseId: 'database-production',
      clientRevision: 'a'.repeat(40),
      rulesSha256: 'b'.repeat(64),
      rollbackSnapshotCiphertextSha256: 'c'.repeat(64),
      rollbackSnapshotObject,
      rollbackSnapshotObjectPrefix: 'production/reservations/',
      rollbackKmsKeyVersion: validEvidence.rollbackSnapshotEncryption.keyVersion,
      now: new Date('2026-08-10T00:05:00.000Z'),
    })).toContain('Rules cutover evidence requires a supported external-KMS rollback snapshot encryption key.');
  });

  it('fails closed for incomplete migration or a stale/unbound snapshot', () => {
    expect(validateRulesCutoverEvidence({
      ...validEvidence,
      writeFreezeConfirmed: false,
      counts: { ...validEvidence.counts, missingReservations: 1 },
    }, {
      operation: 'cutover',
      projectId: 'wrong-project',
      databaseId: 'database-production',
      clientRevision: 'a'.repeat(40),
      rulesSha256: 'b'.repeat(64),
      rollbackSnapshotCiphertextSha256: 'c'.repeat(64),
      rollbackSnapshotObject,
      rollbackSnapshotObjectPrefix: 'production/reservations/',
      rollbackKmsKeyVersion: validEvidence.rollbackSnapshotEncryption.keyVersion,
      now: new Date('2026-08-10T01:00:00.000Z'),
    })).toEqual(expect.arrayContaining([
      expect.stringMatching(/project/),
      expect.stringMatching(/write freeze/),
      expect.stringMatching(/missing reservations/),
      expect.stringMatching(/fresh/),
    ]));
  });

  it('rejects unknown fields rather than trusting operator-controlled data', () => {
    expect(validateRulesCutoverEvidence({ ...validEvidence, approved: true }, {
      operation: 'cutover',
      projectId: 'project-production',
      databaseId: 'database-production',
      clientRevision: 'a'.repeat(40),
      rulesSha256: 'b'.repeat(64),
      rollbackSnapshotCiphertextSha256: 'c'.repeat(64),
      rollbackSnapshotObject,
      rollbackSnapshotObjectPrefix: 'production/reservations/',
      rollbackKmsKeyVersion: validEvidence.rollbackSnapshotEncryption.keyVersion,
      now: new Date('2026-08-10T00:05:00.000Z'),
    })).toContain('Rules cutover evidence contains unknown fields.');
  });

  it('rejects empty or malformed protected deployment targets even when evidence matches them', () => {
    const emptyTargetErrors = validateRulesCutoverEvidence({
      ...validEvidence,
      projectId: '',
      databaseId: '',
    }, {
      operation: 'cutover',
      projectId: '',
      databaseId: '',
      clientRevision: 'a'.repeat(40),
      rulesSha256: 'b'.repeat(64),
      rollbackSnapshotCiphertextSha256: 'c'.repeat(64),
      rollbackSnapshotObject,
      rollbackSnapshotObjectPrefix: 'production/reservations/',
      rollbackKmsKeyVersion: validEvidence.rollbackSnapshotEncryption.keyVersion,
      now: new Date('2026-08-10T00:05:00.000Z'),
    });
    expect(emptyTargetErrors).toEqual(expect.arrayContaining([
      expect.stringMatching(/protected production project/),
      expect.stringMatching(/protected production database/),
    ]));

    const malformedTargetErrors = validateRulesCutoverEvidence({
      ...validEvidence,
      projectId: 'UPPERCASE_PROJECT',
      databaseId: '../database',
    }, {
      operation: 'cutover',
      projectId: 'UPPERCASE_PROJECT',
      databaseId: '../database',
      clientRevision: 'a'.repeat(40),
      rulesSha256: 'b'.repeat(64),
      rollbackSnapshotCiphertextSha256: 'c'.repeat(64),
      rollbackSnapshotObject,
      rollbackSnapshotObjectPrefix: 'production/reservations/',
      rollbackKmsKeyVersion: validEvidence.rollbackSnapshotEncryption.keyVersion,
      now: new Date('2026-08-10T00:05:00.000Z'),
    });
    expect(malformedTargetErrors).toEqual(expect.arrayContaining([
      expect.stringMatching(/protected production project/),
      expect.stringMatching(/protected production database/),
    ]));
  });
});
