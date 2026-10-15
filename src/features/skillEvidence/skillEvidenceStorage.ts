import {
  appendSkillEvidence,
  parseSkillEvidenceV4,
  SkillEvidenceOwnerMismatchError,
  SkillEvidenceValidationError,
  type SkillEvidenceLedgerV4,
  type SkillEvidenceV4,
} from './skillEvidenceModel';
import type { SkillEvidencePersistencePort } from './skillEvidenceController';

export type SkillEvidenceStorage = Pick<Storage, 'getItem' | 'setItem'>
  & Partial<Pick<Storage, 'removeItem'>>;

const STORAGE_PREFIX = 'lingoflash_skill_evidence_v4_';

const browserStorage = (): SkillEvidenceStorage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

export const skillEvidenceStorageKey = (ownerId: string): string => (
  `${STORAGE_PREFIX}${encodeURIComponent(ownerId)}`
);

const emptyLedger = (ownerId: string): SkillEvidenceLedgerV4 => ({
  schemaVersion: 4,
  ownerId,
  records: [],
});

const parseLedger = (value: unknown, ownerId: string): SkillEvidenceLedgerV4 => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SkillEvidenceValidationError('skillEvidenceLedger: expected object');
  }
  const record = value as Record<string, unknown>;
  const keys = ['schemaVersion', 'ownerId', 'records'];
  const unknown = Object.keys(record).find(key => !keys.includes(key));
  if (unknown) throw new SkillEvidenceValidationError(`skillEvidenceLedger.${unknown}: unknown field`);
  if (record.schemaVersion !== 4) throw new SkillEvidenceValidationError('skillEvidenceLedger.schemaVersion: expected schema version 4');
  if (record.ownerId !== ownerId) throw new SkillEvidenceOwnerMismatchError();
  if (!Array.isArray(record.records)) throw new SkillEvidenceValidationError('skillEvidenceLedger.records: expected array');
  let ledger = emptyLedger(ownerId);
  for (const [index, item] of record.records.entries()) {
    const evidence = parseSkillEvidenceV4(item);
    try {
      ledger = appendSkillEvidence(ledger, evidence).ledger;
    } catch (error) {
      throw new SkillEvidenceValidationError(`skillEvidenceLedger.records[${index}]: ${error instanceof Error ? error.message : 'invalid record'}`);
    }
  }
  return ledger;
};

export function readLocalSkillEvidenceLedger(
  storage: SkillEvidenceStorage | null | undefined,
  ownerId: string,
): SkillEvidenceLedgerV4 {
  if (!storage) return emptyLedger(ownerId);
  const key = skillEvidenceStorageKey(ownerId);
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return emptyLedger(ownerId);
  }
  if (raw === null) return emptyLedger(ownerId);
  try {
    return parseLedger(JSON.parse(raw) as unknown, ownerId);
  } catch {
    try {
      storage.removeItem?.(key);
    } catch {
      // Storage cleanup is best effort; malformed data is still never accepted.
    }
    return emptyLedger(ownerId);
  }
}

export const readBrowserSkillEvidenceLedger = (ownerId: string): SkillEvidenceLedgerV4 => (
  readLocalSkillEvidenceLedger(browserStorage(), ownerId)
);

const writeLedger = (
  storage: SkillEvidenceStorage | null,
  ledger: SkillEvidenceLedgerV4,
): void => {
  if (!storage) return;
  storage.setItem(skillEvidenceStorageKey(ledger.ownerId), JSON.stringify(ledger));
};

export interface LocalSkillEvidencePersistenceOptions {
  readonly activeOwner: () => string | null;
  readonly storage?: SkillEvidenceStorage | null;
}

export interface LocalSkillEvidenceRecorderOptions {
  readonly activeOwner: () => string | null;
  readonly storage?: SkillEvidenceStorage | null;
}

export type LocalSkillEvidenceInput = Omit<SkillEvidenceV4, 'ownerId'>;

const LOCAL_EVIDENCE_KEYS = [
  'schemaVersion', 'id', 'target', 'skill', 'source', 'activityId', 'score', 'observedAt',
] as const;

const hasExactKeys = (record: Record<string, unknown>, keys: readonly string[]): boolean => (
  Object.keys(record).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(record, key))
);

const isCanonicalId = (value: unknown): value is string => (
  typeof value === 'string'
  && value.length > 0
  && value.length <= 128
  && value === value.normalize('NFKC').trim()
  && !value.includes('/')
  && !/[\u0000-\u001F\u007F]/.test(value)
);

const isCanonicalTimestamp = (value: unknown): value is string => (
  typeof value === 'string'
  && value.length > 0
  && value.length <= 256
  && value === value.normalize('NFKC').trim()
  && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === value
);

const isValidListenEvidence = (value: unknown, ownerId?: string): value is LocalSkillEvidenceInput => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const target = record.target;
  const keys = ownerId === undefined ? LOCAL_EVIDENCE_KEYS : [...LOCAL_EVIDENCE_KEYS, 'ownerId'];
  if (!hasExactKeys(record, keys)
    || record.schemaVersion !== 4
    || (ownerId !== undefined && (!isCanonicalId(record.ownerId) || record.ownerId !== ownerId))
    || !isCanonicalId(record.id)
    || !isCanonicalId(record.activityId)
    || record.skill !== 'listening'
    || record.source !== 'listening'
    || typeof record.score !== 'number'
    || !Number.isFinite(record.score)
    || record.score < 0
    || record.score > 1
    || !isCanonicalTimestamp(record.observedAt)
    || typeof target !== 'object'
    || target === null
    || Array.isArray(target)) return false;
  const targetRecord = target as Record<string, unknown>;
  return hasExactKeys(targetRecord, ['kind', 'id'])
    && targetRecord.kind === 'chunk'
    && isCanonicalId(targetRecord.id);
};

const isStoredListenEvidence = (value: unknown, ownerId: string): value is SkillEvidenceV4 => {
  if (!isValidListenEvidence(value, ownerId)) return false;
  return true;
};

const readStoredListenEvidence = (
  storage: SkillEvidenceStorage | null,
  ownerId: string,
): SkillEvidenceV4[] => {
  if (!storage) return [];
  try {
    const raw = storage.getItem(skillEvidenceStorageKey(ownerId));
    if (raw === null) return [];
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
    const ledger = value as Record<string, unknown>;
    if (ledger.schemaVersion !== 4 || ledger.ownerId !== ownerId || !Array.isArray(ledger.records)) return [];
    if (!ledger.records.every(record => isStoredListenEvidence(record, ownerId))) return [];
    return ledger.records.slice(-512) as SkillEvidenceV4[];
  } catch {
    return [];
  }
};

const sameListenEvidence = (stored: SkillEvidenceV4, incoming: LocalSkillEvidenceInput): boolean => (
  stored.schemaVersion === incoming.schemaVersion
  && stored.target.kind === incoming.target.kind
  && stored.target.id === incoming.target.id
  && stored.skill === incoming.skill
  && stored.source === incoming.source
  && stored.activityId === incoming.activityId
  && stored.score === incoming.score
  && stored.observedAt === incoming.observedAt
);

/**
 * Small runtime adapter for audio-first evidence. The full model/controller
 * remains the validation seam; this callback only stores already-created,
 * listening-scoped evidence for the active learner.
 */
export function createLocalSkillEvidenceRecorder({
  activeOwner,
  storage: suppliedStorage,
}: LocalSkillEvidenceRecorderOptions): (evidence: LocalSkillEvidenceInput) => void {
  const storage = suppliedStorage === undefined ? browserStorage() : suppliedStorage;
  const memory = new Map<string, SkillEvidenceV4[]>();
  return evidence => {
    if (!isValidListenEvidence(evidence)) return;
    const ownerId = activeOwner();
    if (ownerId === null) return;
    const records = memory.get(ownerId) ?? readStoredListenEvidence(storage, ownerId);
    const existing = records.find(record => record.id === evidence.id);
    if (existing) {
      const isDuplicate = sameListenEvidence(existing, evidence);
      // A reused ID with changed payload is a conflict, not a duplicate. Ignore
      // it so a stale/replayed callback cannot overwrite learner-owned data.
      if (isDuplicate) return;
      return;
    }
    const next = [...records, { ...evidence, ownerId }].slice(-512);
    memory.set(ownerId, next);
    try {
      storage?.setItem(skillEvidenceStorageKey(ownerId), JSON.stringify({
        schemaVersion: 4,
        ownerId,
        records: next,
      }));
    } catch {
      // Learner-owned progress remains in memory when Web Storage is denied.
    }
  };
}

export function createLocalSkillEvidencePersistence({
  activeOwner,
  storage: suppliedStorage,
}: LocalSkillEvidencePersistenceOptions): SkillEvidencePersistencePort {
  const storage = suppliedStorage === undefined ? browserStorage() : suppliedStorage;
  const memory = new Map<string, SkillEvidenceLedgerV4>();

  const read = (ownerId: string): SkillEvidenceLedgerV4 => {
    const cached = memory.get(ownerId);
    if (cached) return cached;
    const ledger = readLocalSkillEvidenceLedger(storage, ownerId);
    memory.set(ownerId, ledger);
    return ledger;
  };

  const append = async (evidence: SkillEvidenceV4): Promise<'appended' | 'duplicate'> => {
    const ownerId = activeOwner();
    if (ownerId === null || ownerId !== evidence.ownerId) throw new SkillEvidenceOwnerMismatchError();
    const result = appendSkillEvidence(read(ownerId), evidence);
    if (result.status === 'appended') {
      memory.set(ownerId, result.ledger);
      try {
        writeLedger(storage, result.ledger);
      } catch {
        // The in-memory learner-owned copy remains usable when Web Storage is denied.
      }
    }
    return result.status;
  };

  return { activeOwner, append };
}
