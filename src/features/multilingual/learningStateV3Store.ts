import type { LearningStateV3 } from './schemaV3';
import { parseLearningStateV3 } from './schemaV3Validation';

export type AtomicDocumentDecision<Result> =
  | { readonly kind: 'keep'; readonly result: Result }
  | { readonly kind: 'set'; readonly value: unknown; readonly result: Result };

/** Infrastructure adapters must implement this callback as one document transaction. */
export interface AtomicDocumentPort {
  read(path: string): Promise<unknown | null>;
  runAtomic<Result>(
    path: string,
    operation: (current: unknown | null) => AtomicDocumentDecision<Result>,
  ): Promise<Result>;
}

export type LearningStateV3CreateResult =
  | { readonly status: 'created'; readonly state: LearningStateV3 }
  | { readonly status: 'exists'; readonly current: LearningStateV3 };

export type LearningStateV3CompareAndSetResult =
  | { readonly status: 'updated'; readonly state: LearningStateV3 }
  | { readonly status: 'conflict'; readonly current: LearningStateV3 }
  | { readonly status: 'missing' };

export interface LearningStateV3Precondition {
  readonly expectedRevision: number;
  readonly expectedLibraryEpoch: number;
}

export interface LearningStateV3Store {
  load(ownerId: string, lexemeId: string): Promise<LearningStateV3 | null>;
  create(state: LearningStateV3): Promise<LearningStateV3CreateResult>;
  compareAndSet(
    state: LearningStateV3,
    precondition: LearningStateV3Precondition,
  ): Promise<LearningStateV3CompareAndSetResult>;
}

const assertDocumentSegment = (value: string, label: 'ownerId' | 'lexemeId'): string => {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 128
    || value.includes('/')
    || value === '.'
    || value === '..'
    || /^__.*__$/.test(value)
    || (label === 'lexemeId' && !/^[a-zA-Z0-9_-]+$/.test(value))
  ) {
    throw new TypeError(`${label}: invalid Firestore document segment`);
  }
  return value;
};

export function learningStateV3DocumentPath(ownerId: string, lexemeId: string): string {
  return `users/${assertDocumentSegment(ownerId, 'ownerId')}/learning_states/${
    assertDocumentSegment(lexemeId, 'lexemeId')
  }`;
}

const compactDocument = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(compactDocument);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, compactDocument(entry)]),
  );
};

const validateState = (
  value: unknown,
  ownerId: string,
  lexemeId: string,
): LearningStateV3 => compactDocument(parseLearningStateV3(value, {
  expectedOwnerId: ownerId,
  expectedLexemeId: lexemeId,
})) as LearningStateV3;

const nonNegativeInteger = (value: number, label: string): number => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label}: expected non-negative safe integer`);
  }
  return value;
};

const revisionOf = (state: LearningStateV3): number => state.revision ?? 0;
const libraryEpochOf = (state: LearningStateV3): number => state.libraryEpoch ?? 0;

export function createLearningStateV3Store(documents: AtomicDocumentPort): LearningStateV3Store {
  return {
    async load(ownerId, lexemeId) {
      const path = learningStateV3DocumentPath(ownerId, lexemeId);
      const current = await documents.read(path);
      return current === null ? null : validateState(current, ownerId, lexemeId);
    },

    async create(input) {
      const ownerId = assertDocumentSegment(input.ownerId, 'ownerId');
      const lexemeId = assertDocumentSegment(input.lexemeId, 'lexemeId');
      const next = validateState(input, ownerId, lexemeId);
      const path = learningStateV3DocumentPath(ownerId, lexemeId);
      return documents.runAtomic<LearningStateV3CreateResult>(path, current => {
        if (current !== null) {
          return {
            kind: 'keep',
            result: {
              status: 'exists',
              current: validateState(current, ownerId, lexemeId),
            } as const,
          };
        }
        return {
          kind: 'set',
          value: next,
          result: { status: 'created', state: next } as const,
        };
      });
    },

    async compareAndSet(input, precondition) {
      const ownerId = assertDocumentSegment(input.ownerId, 'ownerId');
      const lexemeId = assertDocumentSegment(input.lexemeId, 'lexemeId');
      const expectedRevision = nonNegativeInteger(
        precondition.expectedRevision,
        'expectedRevision',
      );
      const expectedLibraryEpoch = nonNegativeInteger(
        precondition.expectedLibraryEpoch,
        'expectedLibraryEpoch',
      );
      const next = validateState(input, ownerId, lexemeId);
      if (revisionOf(next) !== expectedRevision + 1) {
        throw new TypeError('revision: compare-and-set must advance exactly once');
      }
      if (libraryEpochOf(next) !== expectedLibraryEpoch) {
        throw new TypeError('libraryEpoch: compare-and-set cannot cross epochs');
      }
      const path = learningStateV3DocumentPath(ownerId, lexemeId);
      return documents.runAtomic<LearningStateV3CompareAndSetResult>(path, currentDocument => {
        if (currentDocument === null) {
          return { kind: 'keep', result: { status: 'missing' } as const };
        }
        const current = validateState(currentDocument, ownerId, lexemeId);
        if (
          revisionOf(current) !== expectedRevision
          || libraryEpochOf(current) !== expectedLibraryEpoch
        ) {
          return {
            kind: 'keep',
            result: { status: 'conflict', current } as const,
          };
        }
        return {
          kind: 'set',
          value: next,
          result: { status: 'updated', state: next } as const,
        };
      });
    },
  };
}
