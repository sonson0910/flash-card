import {
  collection,
  documentId,
  getDocs,
  limit,
  orderBy,
  query,
  type Firestore,
} from 'firebase/firestore';

import { assertFirestoreDocumentSegment } from './firestoreDocumentIdentity';
import type { LearningStateV3 } from './schemaV3';
import { parseLearningStateV3 } from './schemaV3Validation';

export const CATALOG_LEARNING_STATE_READ_LIMIT = 10_000;

export interface CatalogLearningStateReadResult {
  readonly states: ReadonlyMap<string, LearningStateV3>;
  readonly rejected: number;
}

export interface CatalogLearningStateReader {
  read(ownerId: string | null, maximum?: number): Promise<CatalogLearningStateReadResult | null>;
}

const boundedMaximum = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError('maximum must be a positive safe integer.');
  }
  return Math.min(value, CATALOG_LEARNING_STATE_READ_LIMIT);
};

/**
 * Dedicated read-only catalog progress adapter. It intentionally does not
 * fetch or join Lexeme/TrackMembership documents.
 */
export function createCatalogLearningStateFirebaseReader(
  database: Firestore,
): CatalogLearningStateReader {
  return {
    async read(ownerId, maximum = CATALOG_LEARNING_STATE_READ_LIMIT) {
      if (ownerId === null) return null;
      const expectedOwnerId = assertFirestoreDocumentSegment(ownerId, 'ownerId');
      const safeMaximum = boundedMaximum(maximum);
      const snapshot = await getDocs(query(
        collection(database, 'users', expectedOwnerId, 'learning_states'),
        orderBy(documentId(), 'asc'),
        limit(safeMaximum),
      ));
      if (snapshot.docs.length > safeMaximum) {
        throw new Error('Learning State source violated the bounded query limit.');
      }

      const states = new Map<string, LearningStateV3>();
      let rejected = 0;
      for (const source of snapshot.docs) {
        try {
          const expectedLexemeId = assertFirestoreDocumentSegment(source.id, 'lexemeId');
          if (states.has(expectedLexemeId)) {
            throw new TypeError('Learning State query returned a duplicate Lexeme ID.');
          }
          states.set(expectedLexemeId, parseLearningStateV3(source.data(), {
            expectedOwnerId,
            expectedLexemeId,
          }));
        } catch {
          rejected += 1;
        }
      }
      return { states, rejected };
    },
  };
}
