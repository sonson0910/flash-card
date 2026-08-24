import {
  FieldPath,
  type DocumentData,
  type Firestore,
} from 'firebase-admin/firestore';
import {
  MAX_PAGE_DOCUMENTS,
  MAX_SEALED_MANIFEST_CHUNK_BYTES,
  MAX_SEALED_MANIFEST_CHUNK_ENTRIES,
  canonicalUtf8Bytes,
  digestCanonicalValue,
  type LegacySharedDeckDocument,
  type LegacySharedDeckInventoryStore,
  type LegacySharedDeckStreamPage,
} from './legacySharedDeckMigration.js';

export const LEGACY_SHARED_DECK_PUBLIC_COLLECTION = 'shared_decks';
export const LEGACY_SHARED_DECK_PRIVATE_COLLECTION = 'shared_deck_owners';
const MIGRATION_STATE_COLLECTION = 'admin_shared_deck_migration_jobs';
const MIGRATION_STATE_DOCUMENT = 'shared_deck_v2';
const MIGRATION_CHUNKS_SUBCOLLECTION = 'sealed_manifest_chunks';

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
  beginFreeze: async ({ ownerUid, revision, target, scanStartedAt }) => {
    const state = database.collection(MIGRATION_STATE_COLLECTION).doc(MIGRATION_STATE_DOCUMENT);
    return database.runTransaction(async transaction => {
      const snapshot = await transaction.get(state);
      if (snapshot.exists) {
        const data = snapshot.data();
        if (data?.phase === 'superseded' && data?.ownerUid === ownerUid && data?.target === target
          && data?.revision !== revision) {
          transaction.set(state, {
            schemaVersion: 2,
            ownerUid,
            phase: 'frozen',
            revision,
            target,
            scanStartedAt,
            inventoryDigest: null,
            ledgerReady: false,
          });
          return { scanStartedAt };
        }
        if (data?.ownerUid !== ownerUid || data?.revision !== revision || data?.target !== target
          || (data.phase !== 'frozen' && data.phase !== 'sealing' && data.phase !== 'sealed')) {
          throw new Error('Shared-deck migration state is already owned by another revision.');
        }
        if (typeof data.scanStartedAt !== 'string' || !Number.isFinite(Date.parse(data.scanStartedAt))) {
          throw new Error('Shared-deck migration scan context is missing.');
        }
        return { scanStartedAt: data.scanStartedAt };
      }
      transaction.create(state, {
        schemaVersion: 2,
        ownerUid,
        phase: 'frozen',
        revision,
        target,
        scanStartedAt,
        inventoryDigest: null,
        ledgerReady: false,
      });
      return { scanStartedAt };
    });
  },
  sealFreeze: async ({ ownerUid, revision, target, inventoryDigest, manifest, chunks }) => {
    const state = database.collection(MIGRATION_STATE_COLLECTION).doc(MIGRATION_STATE_DOCUMENT);
    const chunkCollection = state.collection(MIGRATION_CHUNKS_SUBCOLLECTION);
    const { rootDigest: _rootDigest, ...manifestWithoutRoot } = manifest;
    const seedDigest = digestCanonicalValue({
      domain: 'legacy-shared-deck-sealed-manifest-v2', ownerUid, target, revision,
      scanStartedAt: manifest.scanStartedAt, inventoryDigest,
    });
    if (manifest.ownerUid !== ownerUid || manifest.revision !== revision || manifest.target !== target
      || manifest.inventoryDigest !== inventoryDigest || manifest.schemaVersion !== 2
      || !/^[a-f0-9]{64}$/.test(manifest.chunkNamespace)
      || manifest.seedDigest !== seedDigest
      || manifest.rootDigest !== digestCanonicalValue(manifestWithoutRoot)
      || manifest.chunkCount !== chunks.length || manifest.entryCount !== chunks.reduce((total, chunk) => total + chunk.entries.length, 0)) {
      throw new Error('Shared-deck migration seal manifest is invalid.');
    }
    let previousDigest = seedDigest;
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index]!;
      if (Object.keys(chunk).length !== 9
        || chunk.schemaVersion !== 2 || chunk.ownerUid !== ownerUid || chunk.target !== target
        || chunk.revision !== revision || chunk.chunkNamespace !== manifest.chunkNamespace
        || chunk.index !== index || chunk.previousDigest !== previousDigest
        || chunk.entries.length > MAX_SEALED_MANIFEST_CHUNK_ENTRIES
        || canonicalUtf8Bytes(chunk).byteLength > MAX_SEALED_MANIFEST_CHUNK_BYTES
        || chunk.digest !== digestCanonicalValue({ chunkNamespace: chunk.chunkNamespace, index, previousDigest, entries: chunk.entries })) {
        throw new Error('Shared-deck migration seal chunk is invalid.');
      }
      previousDigest = chunk.digest;
      await database.runTransaction(async transaction => {
        const snapshot = await transaction.get(state);
        const data = snapshot.data();
        if (!snapshot.exists || data?.ownerUid !== ownerUid || data?.revision !== revision || data?.target !== target
          || data?.scanStartedAt !== manifest.scanStartedAt) {
          throw new Error('Shared-deck migration freeze is not active.');
        }
        const chunkRef = chunkCollection.doc(`${manifest.chunkNamespace}-${index}`);
        const existing = await transaction.get(chunkRef);
        if (data.phase === 'sealed') {
          if (!existing.exists || digestCanonicalValue(existing.data()) !== digestCanonicalValue(chunk)) {
            throw new Error('Shared-deck migration seal chunk changed.');
          }
          return;
        }
        if (data.phase !== 'frozen' && data.phase !== 'sealing') {
          throw new Error('Shared-deck migration freeze is not active.');
        }
        if (data.phase === 'frozen') {
          transaction.set(state, { ...data, phase: 'sealing', sealProgress: { nextChunk: 0 } });
        }
        const progress = data.phase === 'sealing' && data.sealProgress?.nextChunk !== undefined
          ? data.sealProgress.nextChunk : 0;
        if (existing.exists && digestCanonicalValue(existing.data()) !== digestCanonicalValue(chunk)) {
          throw new Error('Shared-deck migration seal chunk changed.');
        }
        if (index < progress) {
          if (!existing.exists) throw new Error('Shared-deck migration seal chunk is missing.');
          return;
        }
        if (index !== progress) throw new Error('Shared-deck migration seal progress changed.');
        if (!existing.exists) transaction.create(chunkRef, chunk);
        transaction.set(state, {
          ...data,
          phase: 'sealing',
          sealProgress: { nextChunk: index + 1 },
        });
      });
    }
    if (previousDigest !== manifest.lastChunkDigest) throw new Error('Shared-deck migration seal chain is invalid.');
    await database.runTransaction(async transaction => {
      const snapshot = await transaction.get(state);
      const data = snapshot.data();
      if (!snapshot.exists || data?.ownerUid !== ownerUid || data?.revision !== revision || data?.target !== target
        || data?.scanStartedAt !== manifest.scanStartedAt) {
        throw new Error('Shared-deck migration freeze is not active.');
      }
      if (data.phase === 'sealed') {
        if (data.inventoryDigest !== inventoryDigest || !data.manifest
          || digestCanonicalValue(data.manifest) !== digestCanonicalValue(manifest)) {
          throw new Error('Shared-deck migration seal digest changed.');
        }
        return;
      }
      if (chunks.length === 0 && data.phase === 'frozen') {
        transaction.set(state, {
          ...data,
          phase: 'sealed',
          inventoryDigest,
          ledgerReady: false,
          manifest,
          sealProgress: { nextChunk: 0 },
        });
        return;
      }
      if (data.phase !== 'sealing' || data.sealProgress?.nextChunk !== chunks.length) {
        throw new Error('Shared-deck migration seal is incomplete.');
      }
      transaction.set(state, {
        ...data,
        phase: 'sealed',
        inventoryDigest,
        ledgerReady: false,
        manifest,
        sealProgress: { nextChunk: chunks.length },
      });
    });
  },
});
