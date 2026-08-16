import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateFirestoreEnforcementEvidence } from './firestore-enforcement-evidence.mjs';

const rules = 'rules_version = "2";\n';
const rulesSha256 = createHash('sha256').update(rules).digest('hex');
const evidence = {
  schemaVersion: 1,
  revision: 'a'.repeat(40),
  candidateRunId: 101,
  candidateSha256: 'b'.repeat(64),
  productionDeploymentRunId: 202,
  productionDeploymentRunAttempt: 2,
  enforcementRunId: 303,
  enforcementRunAttempt: 3,
  strictRulesSha256: rulesSha256,
  projectId: 'encoded-hangout-433912-h2',
  databaseId: 'ai-studio-945b4052-4462-4668-8936-277f09f07a37',
  recordedAt: '2026-08-16T08:00:00.000Z',
};

const options = {
  revision: evidence.revision,
  candidateRunId: '101',
  candidateSha256: evidence.candidateSha256,
  productionDeploymentRunId: '202',
  productionDeploymentRunAttempt: '2',
  enforcementRunId: '303',
  enforcementRunAttempt: '3',
  projectId: evidence.projectId,
  databaseId: evidence.databaseId,
};

describe('Firestore enforcement evidence', () => {
  it('accepts an exact immutable post-deployment envelope', () => {
    expect(validateFirestoreEnforcementEvidence(evidence, options)).toEqual([]);
  });

  it('rejects unknown fields and mismatched run provenance', () => {
    const invalid = { ...evidence, enforcementRunAttempt: 4, message: 'deployed' };
    expect(validateFirestoreEnforcementEvidence(invalid, options)).toEqual(expect.arrayContaining([
      'Firestore enforcement evidence has unknown or missing fields.',
      'Firestore enforcement enforcementRunAttempt does not match.',
    ]));
  });

  it('rejects malformed timestamps and strict Rules digests', () => {
    const invalid = { ...evidence, recordedAt: '2026-02-31T08:00:00.000Z', strictRulesSha256: 'nope' };
    expect(validateFirestoreEnforcementEvidence(invalid, options)).toEqual(expect.arrayContaining([
      'Strict Rules SHA-256 is invalid.',
      'Enforcement recordedAt timestamp is invalid.',
    ]));
  });

  it('requires numeric run identity fields in the evidence envelope', () => {
    const invalid = {
      ...evidence,
      candidateRunId: '101',
      enforcementRunAttempt: '3',
    };
    expect(validateFirestoreEnforcementEvidence(invalid, options)).toEqual(expect.arrayContaining([
      'Candidate run ID is invalid.',
      'Enforcement run attempt is invalid.',
    ]));
  });

  it('rejects evidence whose raw-byte digest differs from the reviewed digest', () => {
    const rawEvidence = Buffer.from(`${JSON.stringify(evidence)}\n`);
    expect(validateFirestoreEnforcementEvidence(evidence, {
      ...options,
      rawEvidence,
      evidenceSha256: 'c'.repeat(64),
    })).toContain('Firestore enforcement evidence SHA-256 does not match.');
  });

  it('verifies a regular evidence file and rejects a symlink at the CLI boundary', () => {
    const directory = mkdtempSync(join(tmpdir(), 'firestore-enforcement-evidence-'));
    try {
      const evidenceFile = join(directory, 'enforcement.json');
      const linkedEvidenceFile = join(directory, 'enforcement-link.json');
      const rulesFile = join(directory, 'firestore.rules');
      const rawEvidence = Buffer.from(`${JSON.stringify(evidence)}\n`);
      writeFileSync(evidenceFile, rawEvidence);
      writeFileSync(rulesFile, rules);
      symlinkSync(evidenceFile, linkedEvidenceFile);
      const script = fileURLToPath(new URL('./firestore-enforcement-evidence.mjs', import.meta.url));
      const args = [
        script,
        'verify',
        '--revision', options.revision,
        '--candidate-run-id', options.candidateRunId,
        '--candidate-sha256', options.candidateSha256,
        '--production-deploy-run-id', options.productionDeploymentRunId,
        '--production-deploy-run-attempt', options.productionDeploymentRunAttempt,
        '--enforcement-run-id', options.enforcementRunId,
        '--enforcement-run-attempt', options.enforcementRunAttempt,
        '--project-id', options.projectId,
        '--database-id', options.databaseId,
        '--rules-file', rulesFile,
      ];

      const verified = spawnSync(process.execPath, [...args, '--file', evidenceFile], { encoding: 'utf8' });
      expect(verified.status, verified.stderr).toBe(0);

      const rejected = spawnSync(process.execPath, [...args, '--file', linkedEvidenceFile], { encoding: 'utf8' });
      expect(rejected.status).toBe(1);
      expect(rejected.stderr).toMatch(/regular file/i);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
