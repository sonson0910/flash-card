import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
  type Firestore,
} from 'firebase/firestore';
import { mapWithConcurrency } from '../../lib/asyncPool';
import {
  createMultilingualCardReader,
  type MultilingualCardSourcePort,
  type RawMultilingualCardSource,
} from './multilingualCardReader';
import { SCHEMA_V3_LIMITS } from './schemaV3';

const FIRESTORE_IN_LIMIT = 30;

const isExpectedUnreadableCatalogError = (error: unknown): boolean => {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : '';
  return code === 'permission-denied'
    || code === 'firestore/permission-denied'
    || code === 'not-found'
    || code === 'firestore/not-found';
};

const chunksOf = <T>(items: readonly T[], size: number): readonly T[][] => {
  const chunks: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size) {
    chunks.push(items.slice(offset, offset + size));
  }
  return chunks;
};

export const createMultilingualFirebaseSourcePort = (
  database: Firestore,
): MultilingualCardSourcePort => ({
  async fetchSources(ownerId, maximum) {
    const stateSnapshot = await getDocs(query(
      collection(database, 'users', ownerId, 'learning_states'),
      orderBy(documentId(), 'asc'),
      limit(maximum),
    ));
    const states = stateSnapshot.docs.map(stateDocument => ({
      lexemeId: stateDocument.id,
      value: stateDocument.data(),
    }));
    const lexemeIds = states.map(state => state.lexemeId);

    const lexemes = await mapWithConcurrency(lexemeIds, 8, async lexemeId => {
      try {
        const snapshot = await getDoc(doc(database, 'lexemes', lexemeId));
        return [lexemeId, snapshot.exists() ? snapshot.data() : null] as const;
      } catch (error) {
        if (isExpectedUnreadableCatalogError(error)) {
          // Rules intentionally hide draft catalog content; the domain reader quarantines this join.
          return [lexemeId, null] as const;
        }
        throw error;
      }
    });
    const lexemesById = new Map(lexemes);

    const membershipGroups = await mapWithConcurrency(
      chunksOf(lexemeIds, FIRESTORE_IN_LIMIT),
      4,
      async lexemeIdChunk => getDocs(query(
        collection(database, 'track_memberships'),
        where('lexemeId', 'in', lexemeIdChunk),
        where('editorialStatus', '==', 'published'),
        where('schemaVersion', '==', 3),
          limit(lexemeIdChunk.length * SCHEMA_V3_LIMITS.memberships),
      )),
    );
    const membershipsByLexeme = new Map<string, unknown[]>();
    for (const membershipDocument of membershipGroups.flatMap(group => group.docs)) {
      const value = membershipDocument.data();
      const lexemeId = typeof value.lexemeId === 'string' ? value.lexemeId : '';
      const memberships = membershipsByLexeme.get(lexemeId) ?? [];
      memberships.push(value);
      membershipsByLexeme.set(lexemeId, memberships);
    }

    return states.map(({ lexemeId, value }): RawMultilingualCardSource => ({
      documentId: lexemeId,
      learningState: value,
      lexeme: lexemesById.get(lexemeId) ?? null,
      memberships: membershipsByLexeme.get(lexemeId) ?? [],
    }));
  },
});

export const createMultilingualFirebaseReader = (database: Firestore) => (
  createMultilingualCardReader(createMultilingualFirebaseSourcePort(database))
);
