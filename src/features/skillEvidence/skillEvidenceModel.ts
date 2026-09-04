import { SCHEMA_V3_LIMITS } from '../multilingual/schemaV3';

export const SKILL_EVIDENCE_LIMITS = Object.freeze({
  maximumRecords: 512,
  maximumObservationsPerDimension: 8,
} as const);

export type SkillEvidenceSkillV4 =
  | 'recognition'
  | 'listening'
  | 'context'
  | 'production'
  | 'pronunciation'
  | 'speech-match';

export type SkillEvidenceSourceV4 =
  | 'recognition'
  | 'listening'
  | 'context'
  | 'text-production'
  | 'browser-speech-match'
  | 'pronunciation-provider';

export interface SkillEvidenceTargetV4 {
  readonly kind: 'lexeme' | 'chunk';
  readonly id: string;
}

export interface SkillEvidenceV4 {
  readonly schemaVersion: 4;
  readonly id: string;
  readonly ownerId: string;
  readonly target: SkillEvidenceTargetV4;
  readonly skill: SkillEvidenceSkillV4;
  readonly source: SkillEvidenceSourceV4;
  readonly activityId: string;
  readonly score: number;
  readonly observedAt: string;
}

export interface SkillEvidenceLedgerV4 {
  readonly schemaVersion: 4;
  readonly ownerId: string;
  readonly records: readonly SkillEvidenceV4[];
}

export interface SkillDimensionStateV4 {
  readonly score: number | null;
  readonly observations: number;
  readonly confidence: number;
  readonly lastObservedAt: string | null;
}

export interface SkillStateV4 {
  readonly schemaVersion: 4;
  readonly ownerId: string;
  readonly target: SkillEvidenceTargetV4;
  readonly asOf: string | null;
  readonly dimensions: Readonly<{
    recognition: SkillDimensionStateV4;
    listening: SkillDimensionStateV4;
    context: SkillDimensionStateV4;
    production: SkillDimensionStateV4;
    pronunciation: SkillDimensionStateV4;
    speechMatch: SkillDimensionStateV4;
  }>;
}

type UnknownRecord = Record<string, unknown>;
type SkillDimension = keyof SkillStateV4['dimensions'];

const fail = (path: string, message: string): never => {
  throw new SkillEvidenceValidationError(`${path}: ${message}`);
};

const recordAt = (value: unknown, path: string, keys: readonly string[]): UnknownRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, 'expected object');
  }
  const record = value as UnknownRecord;
  const unknown = Object.keys(record).find(key => !keys.includes(key));
  if (unknown) fail(`${path}.${unknown}`, 'unknown field');
  return record;
};

const stringAt = (value: unknown, path: string, maximum: number): string => {
  if (typeof value !== 'string') fail(path, 'expected string');
  const parsed = value as string;
  if (!parsed || parsed.length > maximum) fail(path, `expected 1-${maximum} characters`);
  if (parsed !== parsed.normalize('NFKC').trim()) fail(path, 'must be canonical and trimmed');
  return parsed;
};

const idAt = (value: unknown, path: string): string => {
  const id = stringAt(value, path, SCHEMA_V3_LIMITS.id);
  if (id.includes('/') || /[\u0000-\u001F\u007F]/.test(id)) {
    fail(path, 'must not contain slash or control characters');
  }
  return id;
};

const enumAt = <T extends string>(
  value: unknown,
  path: string,
  values: readonly T[],
): T => {
  const parsed = stringAt(value, path, SCHEMA_V3_LIMITS.shortText);
  if (!values.includes(parsed as T)) fail(path, 'unsupported value');
  return parsed as T;
};

const schemaVersionAt = (value: unknown, path: string): 4 => {
  if (value !== 4) fail(path, 'expected schema version 4');
  return 4;
};

const timestampAt = (value: unknown, path: string): string => {
  const timestamp = stringAt(value, path, SCHEMA_V3_LIMITS.shortText);
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== timestamp) {
    fail(path, 'expected canonical ISO-8601 UTC timestamp');
  }
  return timestamp;
};

const scoreAt = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    fail(path, 'expected finite score between 0 and 1');
  }
  return value as number;
};

const targetAt = (value: unknown, path: string): SkillEvidenceTargetV4 => {
  const record = recordAt(value, path, ['kind', 'id']);
  return {
    kind: enumAt(record.kind, `${path}.kind`, ['lexeme', 'chunk'] as const),
    id: idAt(record.id, `${path}.id`),
  };
};

const SOURCE_SKILL: Readonly<Record<SkillEvidenceSourceV4, SkillEvidenceSkillV4>> = {
  recognition: 'recognition',
  listening: 'listening',
  context: 'context',
  'text-production': 'production',
  'browser-speech-match': 'speech-match',
  'pronunciation-provider': 'pronunciation',
};

export class SkillEvidenceValidationError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = 'SkillEvidenceValidationError';
  }
}

export class SkillEvidenceConflictError extends Error {
  constructor(message = 'Skill evidence ID already exists with different content.') {
    super(message);
    this.name = 'SkillEvidenceConflictError';
  }
}

export class SkillEvidenceLedgerOverflowError extends RangeError {
  constructor(message = 'Skill evidence ledger is full.') {
    super(message);
    this.name = 'SkillEvidenceLedgerOverflowError';
  }
}

export class SkillEvidenceOwnerMismatchError extends Error {
  constructor(message = 'Skill evidence owner does not match the ledger owner.') {
    super(message);
    this.name = 'SkillEvidenceOwnerMismatchError';
  }
}

export function parseSkillEvidenceV4(value: unknown): SkillEvidenceV4 {
  const record = recordAt(value, 'skillEvidence', [
    'schemaVersion', 'id', 'ownerId', 'target', 'skill', 'source', 'activityId', 'score', 'observedAt',
  ]);
  const source = enumAt(record.source, 'skillEvidence.source', [
    'recognition', 'listening', 'context', 'text-production',
    'browser-speech-match', 'pronunciation-provider',
  ] as const);
  const skill = enumAt(record.skill, 'skillEvidence.skill', [
    'recognition', 'listening', 'context', 'production', 'pronunciation', 'speech-match',
  ] as const);
  if (SOURCE_SKILL[source] !== skill) {
    fail('skillEvidence.source', `source does not support skill ${skill}`);
  }
  return {
    schemaVersion: schemaVersionAt(record.schemaVersion, 'skillEvidence.schemaVersion'),
    id: idAt(record.id, 'skillEvidence.id'),
    ownerId: idAt(record.ownerId, 'skillEvidence.ownerId'),
    target: targetAt(record.target, 'skillEvidence.target'),
    skill,
    source,
    activityId: idAt(record.activityId, 'skillEvidence.activityId'),
    score: scoreAt(record.score, 'skillEvidence.score'),
    observedAt: timestampAt(record.observedAt, 'skillEvidence.observedAt'),
  };
}

export function fingerprintSkillEvidenceV4(evidence: SkillEvidenceV4): string {
  return JSON.stringify({
    schemaVersion: evidence.schemaVersion,
    id: evidence.id,
    ownerId: evidence.ownerId,
    target: { kind: evidence.target.kind, id: evidence.target.id },
    skill: evidence.skill,
    source: evidence.source,
    activityId: evidence.activityId,
    score: evidence.score,
    observedAt: evidence.observedAt,
  });
}

export function appendSkillEvidence(
  ledger: SkillEvidenceLedgerV4,
  evidence: SkillEvidenceV4,
): { readonly status: 'appended' | 'duplicate'; readonly ledger: SkillEvidenceLedgerV4 } {
  if (ledger.schemaVersion !== 4 || evidence.schemaVersion !== 4) {
    throw new SkillEvidenceValidationError('schemaVersion: expected schema version 4');
  }
  if (ledger.ownerId !== evidence.ownerId) throw new SkillEvidenceOwnerMismatchError();

  const existing = ledger.records.find(record => record.id === evidence.id);
  if (existing) {
    if (fingerprintSkillEvidenceV4(existing) === fingerprintSkillEvidenceV4(evidence)) {
      return { status: 'duplicate', ledger };
    }
    throw new SkillEvidenceConflictError();
  }
  if (ledger.records.length >= SKILL_EVIDENCE_LIMITS.maximumRecords) {
    throw new SkillEvidenceLedgerOverflowError();
  }
  return {
    status: 'appended',
    ledger: { ...ledger, records: [...ledger.records, evidence] },
  };
}

const skillDimension = (skill: SkillEvidenceSkillV4): SkillDimension => (
  skill === 'speech-match' ? 'speechMatch' : skill
);

const emptyDimension = (): SkillDimensionStateV4 => ({
  score: null,
  observations: 0,
  confidence: 0,
  lastObservedAt: null,
});

const compareEvidence = (left: SkillEvidenceV4, right: SkillEvidenceV4): number => (
  left.observedAt < right.observedAt
    ? -1
    : left.observedAt > right.observedAt
      ? 1
      : left.id < right.id ? -1 : left.id > right.id ? 1 : 0
);

export function deriveSkillStateV4(
  records: readonly SkillEvidenceV4[],
  target: SkillEvidenceTargetV4,
  ownerId: string,
): SkillStateV4 {
  const matching = records.filter(record => (
    record.ownerId === ownerId
      && record.target.kind === target.kind
      && record.target.id === target.id
  ));
  const dimensions = {
    recognition: emptyDimension(),
    listening: emptyDimension(),
    context: emptyDimension(),
    production: emptyDimension(),
    pronunciation: emptyDimension(),
    speechMatch: emptyDimension(),
  };

  (Object.keys(dimensions) as SkillDimension[]).forEach(dimension => {
    const latest = matching
      .filter(record => skillDimension(record.skill) === dimension)
      .sort(compareEvidence)
      .slice(-SKILL_EVIDENCE_LIMITS.maximumObservationsPerDimension);
    if (latest.length === 0) return;
    const score = latest.reduce((sum, record) => sum + record.score, 0) / latest.length;
    const last = latest[latest.length - 1];
    dimensions[dimension] = {
      score,
      observations: latest.length,
      confidence: Math.min(1, latest.length / 5),
      lastObservedAt: last.observedAt,
    };
  });

  const latestOverall = [...matching].sort(compareEvidence).at(-1);
  return {
    schemaVersion: 4,
    ownerId,
    target,
    asOf: latestOverall?.observedAt ?? null,
    dimensions,
  };
}
