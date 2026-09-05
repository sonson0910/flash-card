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
