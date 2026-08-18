const EVENTS = new Set(['app_start', 'catalog_install', 'catalog_query', 'migration_rehearsal', 'learning_session']);
const METRICS = new Set(['durationMs', 'resultCount', 'scanned', 'itemCount', 'failureCount']);

export function createOperationalEvent(name: string, input: Record<string, unknown>): {
  readonly name: string;
  readonly schemaVersion: 1;
  readonly metrics: Readonly<Record<string, number>>;
} {
  if (!EVENTS.has(name)) throw new TypeError('Operational event is not allowlisted.');
  const metrics: Record<string, number> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!METRICS.has(key)) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new TypeError(`Operational metric ${key} must be finite and non-negative.`);
    }
    metrics[key] = value;
  }
  return { name, schemaVersion: 1, metrics };
}

type OperationalEvent = ReturnType<typeof createOperationalEvent>;

export class OperationalEventBuffer {
  readonly #maximum: number;
  readonly #events: Array<{ correlationId: string; event: OperationalEvent }> = [];

  constructor(maximum = 100) {
    if (!Number.isInteger(maximum) || maximum < 1 || maximum > 1_000) throw new TypeError('Event buffer maximum must be 1..1000.');
    this.#maximum = maximum;
  }

  push(correlationId: string, event: OperationalEvent): void {
    if (!/^[a-zA-Z0-9._:-]{1,128}$/.test(correlationId)) throw new TypeError('Invalid privacy-safe correlation ID.');
    this.#events.push({ correlationId, event });
    if (this.#events.length > this.#maximum) this.#events.splice(0, this.#events.length - this.#maximum);
  }

  snapshot(): { readonly size: number; readonly eventCounts: Readonly<Record<string, number>> } {
    const eventCounts: Record<string, number> = {};
    for (const { event } of this.#events) eventCounts[event.name] = (eventCounts[event.name] ?? 0) + 1;
    return { size: this.#events.length, eventCounts };
  }
}

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
