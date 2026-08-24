import {
  FieldPath,
  type DocumentData,
  type Firestore,
} from 'firebase-admin/firestore';
import {
  MAX_PAGE_DOCUMENTS,
  type LegacySharedDeckDocument,
  type LegacySharedDeckInventoryStore,
  type LegacySharedDeckStreamPage,
} from './legacySharedDeckMigration.js';

export const LEGACY_SHARED_DECK_PUBLIC_COLLECTION = 'shared_decks';
export const LEGACY_SHARED_DECK_PRIVATE_COLLECTION = 'shared_deck_owners';

const page = async (
  collection: ReturnType<Firestore['collection']>,
  cursor: string | null,
  limit: number,
): Promise<{
  documents: LegacySharedDeckDocument[];
  cursor: string | null;
  terminal: boolean;
}> => {
  let query = collection.orderBy(FieldPath.documentId()).limit(limit);
  if (cursor !== null) query = query.startAfter(cursor);
  const snapshot = await query.get();
  const documents = snapshot.docs.map(document => ({
    id: document.id,
    data: (document.data() ?? {}) as DocumentData,
  }));
  return {
    documents,
    cursor: documents.at(-1)?.id ?? cursor,
    terminal: documents.length < limit,
  };
};

export const createFirestoreLegacySharedDeckInventoryStore = (
  database: Firestore,
): LegacySharedDeckInventoryStore => ({
  readPage: async ({ source = 'public', after = null, limit }): Promise<LegacySharedDeckStreamPage> => {
    const boundedLimit = limit === MAX_PAGE_DOCUMENTS ? limit : MAX_PAGE_DOCUMENTS;
    const stream = source === 'private'
      ? LEGACY_SHARED_DECK_PRIVATE_COLLECTION
      : LEGACY_SHARED_DECK_PUBLIC_COLLECTION;
    const result = await page(database.collection(stream), after, boundedLimit);
    return {
      documents: result.documents,
      cursor: result.cursor,
      terminal: result.terminal,
    };
  },
});
