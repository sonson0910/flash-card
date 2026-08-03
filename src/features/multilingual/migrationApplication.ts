import { normalizeCardData } from '../../lib/cardNormalization';
import type { CardData } from '../../types/card';
import { parseLexemeAggregateV3 } from './schemaV3Validation';
import {
  createMigrationFingerprint,
  restoreV2Card,
  type V2MigrationBundle,
  type V2RollbackSnapshot,
  type V2RollbackTrustedContext,
} from './v2Migration';

export type CatalogCreateIfAbsentResult =
  | { readonly status: 'created' }
  | { readonly status: 'exists'; readonly current: unknown };

/** Implementations must make the existence check and optional create atomic. */
export interface AtomicCatalogPort {
  createIfAbsent(path: string, value: unknown): Promise<CatalogCreateIfAbsentResult>;
}

export type CatalogMigrationApplicationResult =
  | { readonly status: 'applied'; readonly created: readonly string[] }
  | { readonly status: 'unchanged' }
  | {
      readonly status: 'conflict';
      readonly entity: 'lexeme' | 'membership';
      readonly id: string;
      readonly expectedFingerprint: string;
      readonly currentFingerprint: string;
    };

const catalogFingerprint = (entity: 'lexeme' | 'membership', value: unknown): string =>
  createMigrationFingerprint(entity, value);

export async function applyCatalogMigration(
  bundle: V2MigrationBundle,
  catalog: AtomicCatalogPort,
): Promise<CatalogMigrationApplicationResult> {
  const aggregate = parseLexemeAggregateV3({
    schemaVersion: 3,
    lexeme: bundle.lexeme,
    memberships: bundle.memberships,
    learningState: bundle.learningState,
  }, { expectedOwnerId: bundle.source.ownerId });
  const created: string[] = [];
  const applyEntity = async (
    entity: 'lexeme' | 'membership',
    id: string,
    value: unknown,
  ): Promise<CatalogMigrationApplicationResult | null> => {
    const path = entity === 'lexeme' ? `lexemes/${id}` : `track_memberships/${id}`;
    const expectedFingerprint = catalogFingerprint(entity, value);
    const result = await catalog.createIfAbsent(path, value);
    if (result.status === 'created') {
      created.push(path);
      return null;
    }
    const currentFingerprint = catalogFingerprint(entity, result.current);
    return currentFingerprint === expectedFingerprint
      ? null
      : { status: 'conflict', entity, id, expectedFingerprint, currentFingerprint };
  };

  const lexemeResult = await applyEntity('lexeme', aggregate.lexeme.id, aggregate.lexeme);
  if (lexemeResult) return lexemeResult;
  for (const membership of aggregate.memberships) {
    const membershipResult = await applyEntity('membership', membership.id, membership);
    if (membershipResult) return membershipResult;
  }
  return created.length > 0 ? { status: 'applied', created } : { status: 'unchanged' };
}

export type MigrationAtomicDecision<Result> =
  | { readonly kind: 'keep'; readonly result: Result }
  | { readonly kind: 'set'; readonly value: CardData; readonly result: Result };

export interface AtomicV2RollbackPort {
  runAtomic<Result>(
    ownerId: string,
    sourceDocumentId: string,
    operation: (current: unknown | null) => MigrationAtomicDecision<Result>,
  ): Promise<Result>;
}

export interface V2RollbackApplicationCommand {
  readonly snapshot: V2RollbackSnapshot;
  readonly trustedContext: V2RollbackTrustedContext;
  readonly expectedRevision: number;
  readonly expectedLibraryEpoch: number;
}

export type V2RollbackApplicationResult =
  | { readonly status: 'restored'; readonly card: CardData }
  | { readonly status: 'unchanged'; readonly card: CardData }
  | { readonly status: 'missing' }
  | {
      readonly status: 'conflict';
      readonly currentRevision: number;
      readonly currentLibraryEpoch: number;
    };

const safeCounter = (value: unknown): number =>
  Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;

const requireCounter = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label}: expected non-negative safe integer`);
  }
  return value;
};

export async function applyV2Rollback(
  command: V2RollbackApplicationCommand,
  documents: AtomicV2RollbackPort,
): Promise<V2RollbackApplicationResult> {
  const restoredCard = restoreV2Card(command.snapshot, command.trustedContext);
  const expectedRevision = requireCounter(command.expectedRevision, 'expectedRevision');
  const expectedLibraryEpoch = requireCounter(command.expectedLibraryEpoch, 'expectedLibraryEpoch');
  if (
    safeCounter(restoredCard.revision) !== expectedRevision
    || safeCounter(restoredCard.libraryEpoch) !== expectedLibraryEpoch
  ) {
    throw new TypeError('Rollback preconditions do not match the trusted source snapshot.');
  }

  return documents.runAtomic<V2RollbackApplicationResult>(
    command.trustedContext.expectedOwnerId,
    command.trustedContext.expectedSourceDocumentId,
    currentDocument => {
      if (currentDocument === null) {
        return { kind: 'keep', result: { status: 'missing' } as const };
      }
      if (typeof currentDocument !== 'object' || Array.isArray(currentDocument)) {
        return {
          kind: 'keep',
          result: { status: 'conflict', currentRevision: 0, currentLibraryEpoch: 0 } as const,
        };
      }
      const current = normalizeCardData(
        currentDocument as Partial<CardData>,
        command.trustedContext.expectedSourceDocumentId,
      );
      const currentRevision = safeCounter(current.revision);
      const currentLibraryEpoch = safeCounter(current.libraryEpoch);
      if (currentRevision !== expectedRevision || currentLibraryEpoch !== expectedLibraryEpoch) {
        return {
          kind: 'keep',
          result: { status: 'conflict', currentRevision, currentLibraryEpoch } as const,
        };
      }
      const currentFingerprint = createMigrationFingerprint('v2', {
        sourceDocumentId: command.trustedContext.expectedSourceDocumentId,
        card: current,
      });
      if (currentFingerprint === command.trustedContext.expectedSourceFingerprint) {
        return { kind: 'keep', result: { status: 'unchanged', card: current } as const };
      }
      return {
        kind: 'set',
        value: restoredCard,
        result: { status: 'restored', card: restoredCard } as const,
      };
    },
  );
}
