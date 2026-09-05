import {
  SkillEvidenceConflictError,
  SkillEvidenceValidationError,
  fingerprintSkillEvidenceV4,
  parseSkillEvidenceV4,
  type SkillEvidenceV4,
} from './skillEvidenceModel';

export { SkillEvidenceConflictError } from './skillEvidenceModel';

export interface SkillEvidencePersistencePort {
  activeOwner(): string | null;
  append(evidence: SkillEvidenceV4): Promise<'appended' | 'duplicate'>;
}

export type SkillEvidenceCommandOutcome =
  | { readonly status: 'appended' | 'duplicate'; readonly evidence: SkillEvidenceV4 }
  | { readonly status: 'no-active-owner' | 'stale-owner' };

export interface SkillEvidenceCommands {
  record(input: unknown): Promise<SkillEvidenceCommandOutcome>;
}

export interface SkillEvidenceControllerOptions {
  readonly persistence: SkillEvidencePersistencePort;
}

const MAXIMUM_COMPLETED_OUTCOMES = 500;

type CachedOutcome = {
  readonly fingerprint: string;
  readonly outcome: SkillEvidenceCommandOutcome;
};

type PendingOutcome = {
  readonly fingerprint: string;
  readonly promise: Promise<SkillEvidenceCommandOutcome>;
};

const operationKey = (ownerId: string, evidenceId: string): string => (
  JSON.stringify([ownerId, evidenceId])
);

const inputForOwner = (input: unknown, ownerId: string): SkillEvidenceV4 => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new SkillEvidenceValidationError('skillEvidence: expected object');
  }
  if (Object.prototype.hasOwnProperty.call(input, 'ownerId')) {
    throw new SkillEvidenceValidationError('skillEvidence.ownerId: caller must not supply ownerId');
  }
  return parseSkillEvidenceV4({ ...(input as Record<string, unknown>), ownerId });
};

export function createSkillEvidenceController({
  persistence,
}: SkillEvidenceControllerOptions): SkillEvidenceCommands {
  const inFlight = new Map<string, PendingOutcome>();
  const completed = new Map<string, CachedOutcome>();

  const remember = (key: string, cached: CachedOutcome): void => {
    completed.set(key, cached);
    while (completed.size > MAXIMUM_COMPLETED_OUTCOMES) {
      const oldestKey = completed.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      completed.delete(oldestKey);
    }
  };

  const record = async (input: unknown): Promise<SkillEvidenceCommandOutcome> => {
    const ownerId = persistence.activeOwner();
    if (!ownerId) return { status: 'no-active-owner' };

    const evidence = inputForOwner(input, ownerId);
    const fingerprint = fingerprintSkillEvidenceV4(evidence);
    const key = operationKey(ownerId, evidence.id);
    const cached = completed.get(key);
    if (cached) {
      if (cached.fingerprint !== fingerprint) throw new SkillEvidenceConflictError();
      return cached.outcome;
    }
    const pending = inFlight.get(key);
    if (pending) {
      if (pending.fingerprint !== fingerprint) throw new SkillEvidenceConflictError();
      return pending.promise;
    }

    const run = async (): Promise<SkillEvidenceCommandOutcome> => {
      if (persistence.activeOwner() !== ownerId) return { status: 'stale-owner' };
      const status = await persistence.append(evidence);
      if (persistence.activeOwner() !== ownerId) return { status: 'stale-owner' };
      return { status, evidence };
    };

    const promise = run()
      .then(outcome => {
        inFlight.delete(key);
        if (outcome.status !== 'stale-owner') remember(key, { fingerprint, outcome });
        return outcome;
      })
      .catch(error => {
        inFlight.delete(key);
        throw error;
      });
    inFlight.set(key, { fingerprint, promise });
    return promise;
  };

  return { record };
}
