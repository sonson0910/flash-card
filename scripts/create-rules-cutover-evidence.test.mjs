import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { createRulesCutoverEvidence } from './create-rules-cutover-evidence.mjs';

const makeFixture = () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lingoflash-evidence-'));
  fs.writeFileSync(path.join(directory, 'rules'), 'rules_version = "2";');
  fs.writeFileSync(path.join(directory, 'snapshot.enc'), 'ciphertext');
  fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify({
    mode: 'final-delta',
    counts: {
      cards: 2,
      canonicalIdentities: 2,
      reservations: 2,
      duplicateIdentities: 0,
      invalidIdentities: 0,
      missingReservations: 0,
      mismatchedReservations: 0,
    },
    finalDeltaVerified: true,
    rollbackVerified: false,
  }));
  return directory;
};

describe('create rules cutover evidence', () => {
  it('creates exact, digest-bound evidence from aggregate report and ciphertext only', () => {
    const directory = makeFixture();
    try {
      const evidence = createRulesCutoverEvidence({
        report: path.join(directory, 'report.json'),
        rules: path.join(directory, 'rules'),
        snapshot: path.join(directory, 'snapshot.enc'),
        revision: 'a'.repeat(40),
        projectId: 'project-production',
        databaseId: 'database-production',
        kmsKeyVersion: 'projects/backup-security/locations/global/keyRings/lingoflash/cryptoKeys/rollback/cryptoKeyVersions/1',
        operation: 'cutover',
        writeFreezeConfirmed: 'true',
        finalDeltaVerification: 'true',
        rollbackVerification: 'false',
      });
      expect(evidence).toMatchObject({
        schemaVersion: 1,
        status: 'cutover-ready',
        writeFreezeConfirmed: true,
        finalDeltaVerification: true,
        counts: { cards: 2, reservations: 2 },
      });
      expect(JSON.stringify(evidence)).not.toContain('owner-');
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('fails closed when migration integrity findings remain', () => {
    const directory = makeFixture();
    const reportPath = path.join(directory, 'report.json');
    fs.writeFileSync(reportPath, JSON.stringify({
      mode: 'final-delta',
      counts: {
        cards: 2, canonicalIdentities: 1, reservations: 1,
        duplicateIdentities: 1, invalidIdentities: 0,
        missingReservations: 0, mismatchedReservations: 0,
      },
      finalDeltaVerified: true,
      rollbackVerified: false,
    }));
    try {
      expect(() => createRulesCutoverEvidence({
        report: reportPath,
        rules: path.join(directory, 'rules'),
        snapshot: path.join(directory, 'snapshot.enc'),
        revision: 'a'.repeat(40),
        projectId: 'project-production',
        databaseId: 'database-production',
        kmsKeyVersion: 'projects/backup-security/locations/global/keyRings/lingoflash/cryptoKeys/rollback/cryptoKeyVersions/1',
        operation: 'cutover',
        writeFreezeConfirmed: 'true',
        finalDeltaVerification: 'true',
        rollbackVerification: 'false',
      })).toThrow(/integrity findings/);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
