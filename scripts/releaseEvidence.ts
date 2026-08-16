import {
  decideCanary,
  evaluateStagingSmoke,
  type CanarySample,
  type StagingSmokeEvidence,
} from '../src/features/releaseReadiness/operationalReadiness';

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

interface RolloutEvidenceBinding {
  readonly revision: string;
  readonly candidateSha256: string;
  readonly generatedAt: string;
  readonly sourceRef: string;
}

export interface StagingRolloutEvidenceInput extends RolloutEvidenceBinding {
  readonly environment: 'staging';
  readonly smoke: StagingSmokeEvidence;
}

export interface CanaryRolloutEvidenceInput extends RolloutEvidenceBinding {
  readonly environment: 'production-canary';
  readonly windowStartedAt: string;
  readonly windowEndedAt: string;
  readonly sample: CanarySample;
}

const hasExactKeys = (value: unknown, expected: readonly string[]): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  return actual.length === allowed.length && actual.every((key, index) => key === allowed[index]);
};

const parseUtcTimestamp = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.length > 32) throw new TypeError(`${label} must be an ISO-8601 UTC timestamp.`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new TypeError(`${label} must be an ISO-8601 UTC timestamp.`);
  }
  return value;
};

const normalizeRolloutBinding = (input: RolloutEvidenceBinding) => {
  const revision = input.revision.trim().toLowerCase();
  const candidateSha256 = input.candidateSha256.trim().toLowerCase();
  if (!isImmutableReleaseRevision(revision)) throw new TypeError('Rollout evidence requires an immutable revision.');
  if (!/^[a-f0-9]{64}$/.test(candidateSha256)) throw new TypeError('Rollout evidence requires a candidate SHA-256.');
  if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(input.sourceRef) || input.sourceRef.includes('://')) {
    throw new TypeError('Rollout evidence requires a bounded non-URL source reference.');
  }
  return {
    revision,
    candidateSha256,
    generatedAt: parseUtcTimestamp(input.generatedAt, 'generatedAt'),
    sourceRef: input.sourceRef,
  };
};

const boundedReasons = (reasons: readonly string[]) => {
  if (reasons.length > 16 || reasons.some(reason => !/^[a-z0-9:-]{1,64}$/.test(reason))) {
    throw new TypeError('Rollout evidence contains an invalid reason code.');
  }
  return [...reasons];
};

export const buildStagingRolloutEvidence = (input: StagingRolloutEvidenceInput) => {
  if (!hasExactKeys(input, ['revision', 'candidateSha256', 'generatedAt', 'sourceRef', 'environment', 'smoke'])) {
    throw new TypeError('Invalid staging rollout evidence schema.');
  }
  if (input.environment !== 'staging') throw new TypeError('Invalid staging rollout environment.');
  const binding = normalizeRolloutBinding(input);
  const expectedRevision = input.smoke.expectedRevision.trim().toLowerCase();
  if (!isImmutableReleaseRevision(expectedRevision) || expectedRevision !== binding.revision) {
    throw new TypeError('Staging rollout evidence revision must match the smoke-tested revision.');
  }
  const result = evaluateStagingSmoke(input.smoke);
  const probes = input.smoke.probes ?? [];
  return {
    schemaVersion: 1 as const,
    evidenceType: 'staging-smoke' as const,
    ...binding,
    environment: input.environment,
    metrics: {
      appStatus: input.smoke.appStatus,
      healthStatus: input.smoke.healthStatus,
      probeCount: probes.length,
      failedProbeCount: probes.filter(probe => !probe.passed).length,
    },
    result: { status: result.status, reasons: boundedReasons(result.reasons) },
  };
};

export const buildCanaryRolloutEvidence = (input: CanaryRolloutEvidenceInput) => {
  if (!hasExactKeys(input, [
    'revision', 'candidateSha256', 'generatedAt', 'sourceRef', 'environment',
    'windowStartedAt', 'windowEndedAt', 'sample',
  ])) throw new TypeError('Invalid canary rollout evidence schema.');
  if (input.environment !== 'production-canary') throw new TypeError('Invalid canary rollout environment.');
  const binding = normalizeRolloutBinding(input);
  const windowStartedAt = parseUtcTimestamp(input.windowStartedAt, 'windowStartedAt');
  const windowEndedAt = parseUtcTimestamp(input.windowEndedAt, 'windowEndedAt');
  if (windowStartedAt > windowEndedAt || windowEndedAt > binding.generatedAt) {
    throw new TypeError('Canary observation window must be chronological.');
  }
  const result = decideCanary(input.sample);
  if (input.sample.sampleSize > 10_000_000
    || input.sample.p95Ms > 31 * 24 * 60 * 60_000
    || input.sample.ageMs > 31 * 24 * 60 * 60_000
    || [input.sample.errorRate, input.sample.syncLossRate, input.sample.quotaUsageRate, input.sample.costRate]
      .some(value => value === undefined || value > 100)) {
    throw new TypeError('Canary aggregate metrics exceed evidence bounds.');
  }
  return {
    schemaVersion: 1 as const,
    evidenceType: 'canary-decision' as const,
    ...binding,
    environment: input.environment,
    observationWindow: { startedAt: windowStartedAt, endedAt: windowEndedAt },
    metrics: { ...input.sample },
    result: { action: result.action, reasons: boundedReasons(result.reasons) },
  };
};
