export interface ReleaseReadinessEvidenceInput {
  readonly revision: string;
  readonly generatedAt: string;
  readonly verified: boolean;
  readonly sourceSnapshot?: {
    readonly headRevision: string;
    readonly porcelainStatus: string;
  };
}

export const isImmutableReleaseRevision = (revision: string): boolean => (
  /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(revision)
);

export function buildReleaseReadinessEvidence(input: ReleaseReadinessEvidenceInput) {
  const revision = input.revision.trim();
  if (!isImmutableReleaseRevision(revision)) {
    throw new TypeError('Release evidence requires a full 40- or 64-character commit revision.');
  }
  if (input.verified) {
    if (!input.sourceSnapshot) {
      throw new TypeError('Verified release evidence requires a source snapshot.');
    }
    const headRevision = input.sourceSnapshot.headRevision.trim().toLowerCase();
    if (!isImmutableReleaseRevision(headRevision) || headRevision !== revision.toLowerCase()) {
      throw new TypeError('Verified release evidence source HEAD must exactly match the release revision.');
    }
    if (input.sourceSnapshot.porcelainStatus.length > 0) {
      throw new TypeError('Verified release evidence requires a clean source worktree.');
    }
  }
  const generatedAt = new Date(input.generatedAt);
  if (!Number.isFinite(generatedAt.getTime()) || generatedAt.toISOString() !== input.generatedAt) {
    throw new TypeError('Release evidence generatedAt must be an ISO-8601 UTC timestamp.');
  }
  return {
    schemaVersion: 2 as const,
    revision: revision.toLowerCase(),
    generatedAt: input.generatedAt,
    localVerification: input.verified ? 'passed' as const : 'unattested' as const,
    releaseEligible: input.verified,
    externalGates: {
      stagingSmoke: 'blocked-human-gate' as const,
      canary: 'blocked-human-gate' as const,
      production: 'blocked-human-gate' as const,
    },
  };
}
