import { describe, expect, it } from 'vitest';
import { buildReleaseReadinessEvidence } from './releaseEvidence';

describe('revision-bound release readiness evidence', () => {
  it.each(['', 'local', 'abc1234', 'a'.repeat(39), 'a'.repeat(41)])(
    'rejects a non-immutable revision %s',
    (revision) => {
      expect(() => buildReleaseReadinessEvidence({
        revision,
        generatedAt: '2026-08-10T00:00:00.000Z',
        verified: true,
      })).toThrow(/40- or 64-character/);
    },
  );

  it('rejects verified evidence without a source snapshot', () => {
    expect(() => buildReleaseReadinessEvidence({
      revision: 'a'.repeat(40),
      generatedAt: '2026-08-10T00:00:00.000Z',
      verified: true,
    })).toThrow(/source snapshot/i);
  });

  it('rejects verified evidence when the source HEAD does not exactly match the revision', () => {
    const input = {
      revision: 'a'.repeat(40),
      generatedAt: '2026-08-10T00:00:00.000Z',
      verified: true,
      sourceSnapshot: {
        headRevision: 'b'.repeat(40),
        porcelainStatus: '',
      },
    };

    expect(() => buildReleaseReadinessEvidence(input)).toThrow(/source HEAD.*revision/i);
  });

  it('rejects verified evidence from a dirty source worktree', () => {
    const input = {
      revision: 'a'.repeat(40),
      generatedAt: '2026-08-10T00:00:00.000Z',
      verified: true,
      sourceSnapshot: {
        headRevision: 'a'.repeat(40),
        porcelainStatus: ' M scripts/releaseEvidence.ts\n?? artifacts/local-report.json',
      },
    };

    expect(() => buildReleaseReadinessEvidence(input)).toThrow(/clean source worktree/i);
  });

  it('binds verified evidence to a full immutable revision from a clean source snapshot', () => {
    const input = {
      revision: 'a'.repeat(40),
      generatedAt: '2026-08-10T00:00:00.000Z',
      verified: true,
      sourceSnapshot: {
        headRevision: 'a'.repeat(40),
        porcelainStatus: '',
      },
    };

    expect(buildReleaseReadinessEvidence(input)).toEqual({
      schemaVersion: 2,
      revision: 'a'.repeat(40),
      generatedAt: '2026-08-10T00:00:00.000Z',
      localVerification: 'passed',
      releaseEligible: true,
      externalGates: {
        stagingSmoke: 'blocked-human-gate',
        canary: 'blocked-human-gate',
        production: 'blocked-human-gate',
      },
    });
  });

  it('keeps unverified evidence unattested without requiring source state', () => {
    expect(buildReleaseReadinessEvidence({
      revision: 'a'.repeat(40),
      generatedAt: '2026-08-10T00:00:00.000Z',
      verified: false,
    })).toMatchObject({
      localVerification: 'unattested',
      releaseEligible: false,
    });
  });
});
