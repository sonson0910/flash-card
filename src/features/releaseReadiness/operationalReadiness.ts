export interface CanarySample {
  readonly sampleSize: number;
  readonly errorRate: number;
  readonly p95Ms: number;
  readonly ageMs: number;
  readonly syncLossRate?: number;
  readonly quotaUsageRate?: number;
  readonly costRate?: number;
}

const CANARY_FIELDS = [
  'sampleSize',
  'errorRate',
  'p95Ms',
  'ageMs',
  'syncLossRate',
  'quotaUsageRate',
  'costRate',
] as const;

export function decideCanary(sample: CanarySample): {
  readonly action: 'promote' | 'hold' | 'rollback';
  readonly reasons: readonly string[];
} {
  if (!sample || typeof sample !== 'object' || Array.isArray(sample)) {
    throw new TypeError('Invalid canary evidence schema.');
  }
  const record = sample as unknown as Record<string, unknown>;
  const knownFields = new Set<string>(CANARY_FIELDS);
  if (Object.keys(record).some(key => !knownFields.has(key))) {
    throw new TypeError('Invalid canary evidence schema.');
  }
  const presentValues = CANARY_FIELDS
    .filter(field => field in record)
    .map(field => record[field]);
  if (presentValues.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0)) {
    throw new TypeError('Invalid canary evidence.');
  }
  if ('sampleSize' in record && !Number.isInteger(record.sampleSize)) {
    throw new TypeError('Canary sampleSize must be a non-negative integer.');
  }
  if (CANARY_FIELDS.some(field => !(field in record))) {
    return { action: 'hold', reasons: ['missing-evidence'] };
  }
  const reasons: string[] = [];
  if (sample.errorRate > 0.01) reasons.push('error-rate');
  if (sample.p95Ms > 2_000) reasons.push('latency');
  if ((sample.syncLossRate ?? 0) > 0) reasons.push('sync-loss');
  if ((sample.quotaUsageRate ?? 0) > 0.9) reasons.push('quota');
  if ((sample.costRate ?? 0) > 1) reasons.push('cost');
  if (reasons.length > 0) return { action: 'rollback', reasons };
  if (sample.sampleSize < 100) reasons.push('sample-size');
  if (sample.ageMs > 5 * 60_000) reasons.push('stale-evidence');
  return { action: reasons.length === 0 ? 'promote' : 'hold', reasons };
}

export interface StagingSmokeEvidence {
  readonly origin?: string;
  readonly appStatus: number;
  readonly expectedRevision: string;
  readonly actualRevision: string;
  readonly healthStatus: number;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly releaseManifestCacheControl: string;
  readonly probes?: readonly { readonly name: string; readonly passed: boolean }[];
}

export function evaluateStagingSmoke(evidence: StagingSmokeEvidence): {
  readonly status: 'passed' | 'failed';
  readonly reasons: readonly string[];
} {
  const headers = Object.fromEntries(Object.entries(evidence.headers).map(([key, value]) => [key.toLowerCase(), value]));
  const reasons: string[] = [];
  if (evidence.origin !== undefined && !evidence.origin.startsWith('https://')) reasons.push('https');
  if (evidence.appStatus < 200 || evidence.appStatus >= 300) reasons.push('app');
  if (!evidence.expectedRevision || evidence.actualRevision !== evidence.expectedRevision) reasons.push('revision');
  if (evidence.healthStatus !== 200) reasons.push('health');
  if (!headers['content-security-policy']) reasons.push('content-security-policy');
  if (headers['x-content-type-options'] !== 'nosniff') reasons.push('x-content-type-options');
  if (!headers['referrer-policy']) reasons.push('referrer-policy');
  const releaseManifestCacheDirectives = new Set(
    evidence.releaseManifestCacheControl
      .split(',')
      .map(directive => directive.trim().toLowerCase())
      .filter(Boolean),
  );
  const releaseManifestCacheIsSafe = ['no-cache', 'no-store', 'must-revalidate']
    .every(directive => releaseManifestCacheDirectives.has(directive))
    && !releaseManifestCacheDirectives.has('immutable');
  if (!releaseManifestCacheIsSafe) reasons.push('release-manifest-cache');
  if (evidence.probes !== undefined) {
    if (evidence.probes.length > 8) reasons.push('probe-bound');
    for (const probe of evidence.probes.slice(0, 8)) {
      if (!/^[a-z0-9-]{1,32}$/.test(probe.name)) reasons.push('probe-name');
      else if (!probe.passed) reasons.push(`probe:${probe.name}`);
    }
  }
  return { status: reasons.length === 0 ? 'passed' : 'failed', reasons };
}
