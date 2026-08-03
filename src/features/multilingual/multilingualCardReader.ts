import type { CardData } from '../../types/card';
import { readCardDocumentV2V3 } from './dualRead';
import { assertFirestoreDocumentSegment } from './firestoreDocumentIdentity';

const MAXIMUM_LIBRARY_READ = 100;

export interface RawMultilingualCardSource {
  readonly documentId: string;
  readonly learningState: unknown;
  readonly lexeme: unknown;
  readonly memberships: unknown;
}

export interface MultilingualCardSourcePort {
  fetchSources(
    ownerId: string,
    maximum: number,
  ): Promise<readonly RawMultilingualCardSource[]>;
}

export interface RejectedMultilingualCard {
  readonly documentId: string;
  readonly reason: string;
}

export interface MultilingualCardReadResult {
  readonly cards: readonly CardData[];
  readonly rejected: readonly RejectedMultilingualCard[];
}

const boundedMaximum = (maximum: number): number => {
  if (!Number.isFinite(maximum)) return MAXIMUM_LIBRARY_READ;
  return Math.min(MAXIMUM_LIBRARY_READ, Math.max(1, Math.trunc(maximum)));
};

const errorMessage = (error: unknown): string => (
  error instanceof Error ? error.message : 'Unknown multilingual card validation error.'
);

export const createMultilingualCardReader = (port: MultilingualCardSourcePort) => ({
  async readOwnerLibrary(ownerId: string, maximum: number): Promise<MultilingualCardReadResult> {
    const expectedOwnerId = assertFirestoreDocumentSegment(ownerId, 'ownerId');
    const sources = await port.fetchSources(expectedOwnerId, boundedMaximum(maximum));
    const cards: CardData[] = [];
    const rejected: RejectedMultilingualCard[] = [];

    for (const source of sources) {
      try {
        cards.push(readCardDocumentV2V3({
          schemaVersion: 3,
          lexeme: source.lexeme,
          memberships: source.memberships,
          learningState: source.learningState,
        }, source.documentId, {
          expectedOwnerId,
          requireLearningState: true,
        }).card);
      } catch (error) {
        rejected.push({ documentId: source.documentId, reason: errorMessage(error) });
      }
    }

    return { cards, rejected };
  },
});
