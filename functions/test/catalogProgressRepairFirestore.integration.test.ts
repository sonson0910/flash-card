import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { repairCatalogProgressForOwner } from '../src/catalogProgressPersistence.js';
import { LegacyLibraryMigrationFenceError } from '../src/legacyLibraryMigrationOwnerScope.js';

const describeWithEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const DATABASE_ID = 'ai-studio-945b4052-4462-4668-8936-277f09f07a37';
const OWNER_ID = 'catalog-progress-repair-owner';

describeWithEmulator('catalog progress repair', () => {
  let app: App;
  let database: Firestore;
  const owner = () => database.collection('users').doc(OWNER_ID);
  const progress = (lexemeId: string) => owner().collection('catalog_progress').doc(lexemeId);
  const lexemeCard = (lexemeId: string, extra: Record<string, unknown> = {}) => ({
    id: lexemeId, lexemeId, word: lexemeId, translation: 'nghĩa', language: 'en',
    schemaVersion: 2, revision: 3, libraryEpoch: 2, interval: 1, ...extra,
  });

  beforeAll(() => {
    app = initializeApp({ projectId: 'demo-lingoflash' }, 'catalog-progress-repair-integration');
    database = getFirestore(app, DATABASE_ID);
  });

  beforeEach(async () => {
    await database.recursiveDelete(owner());
    await owner().collection('profile').doc('library_state').set({ libraryEpoch: 2, schemaVersion: 2 });
  });

  afterAll(async () => {
    await database.recursiveDelete(owner());
    await database.terminate();
    await deleteApp(app);
  });

  it('writes the missing or outdated catalog progress of lexeme cards and nothing on a second run', async () => {
    const matching = {
      schemaVersion: 1, ownerId: OWNER_ID, lexemeId: 'lexeme-matching', targetLanguage: 'en',
      status: 'active', cardRevision: 1, libraryEpoch: 2, updatedAt: Timestamp.fromMillis(1_000),
    };
    const cards = owner().collection('cards');
    await Promise.all([
      // Mastered, added before the projection existed.
      cards.doc('lexeme-missing').set(lexemeCard('lexeme-missing', { interval: 30 })),
      // Mastered since, while the projection still says active.
      cards.doc('lexeme-outdated').set(lexemeCard('lexeme-outdated', { difficulty: 'easy' })),
      progress('lexeme-outdated').set({ ...matching, lexemeId: 'lexeme-outdated' }),
      // Edited after its last review: only the revision differs.
      cards.doc('lexeme-matching').set(lexemeCard('lexeme-matching')),
      progress('lexeme-matching').set(matching),
      // Cards that have no projection to keep.
      cards.doc('lexeme-old-library').set(lexemeCard('lexeme-old-library', { libraryEpoch: 1 })),
      cards.doc('word-plain').set({ id: 'word-plain', word: 'plain', translation: 'trơn', schemaVersion: 2 }),
    ]);

    await expect(repairCatalogProgressForOwner(database, OWNER_ID)).resolves.toEqual({ scanned: 5, repaired: 2 });

    expect((await progress('lexeme-missing').get()).data()).toMatchObject({
      schemaVersion: 1, ownerId: OWNER_ID, lexemeId: 'lexeme-missing', targetLanguage: 'en',
      status: 'mastered', cardRevision: 3, libraryEpoch: 2,
    });
    expect((await progress('lexeme-outdated').get()).data()).toMatchObject({ status: 'mastered', cardRevision: 3 });
    expect((await progress('lexeme-matching').get()).data()).toEqual(matching);
    expect((await progress('lexeme-old-library').get()).exists).toBe(false);
    expect((await owner().collection('catalog_progress').get()).size).toBe(3);

    await expect(repairCatalogProgressForOwner(database, OWNER_ID)).resolves.toEqual({ scanned: 5, repaired: 0 });
  });

  it('pages through a library larger than one page', async () => {
    const batch = database.batch();
    for (let index = 0; index < 205; index += 1) {
      const lexemeId = `lexeme-${String(index).padStart(3, '0')}`;
      batch.set(owner().collection('cards').doc(lexemeId), lexemeCard(lexemeId));
    }
    await batch.commit();

    await expect(repairCatalogProgressForOwner(database, OWNER_ID)).resolves.toEqual({ scanned: 205, repaired: 205 });
    expect((await owner().collection('catalog_progress').count().get()).data().count).toBe(205);
  });

  it('leaves a library under a migration fence untouched', async () => {
    await owner().collection('cards').doc('lexeme-missing').set(lexemeCard('lexeme-missing'));
    await owner().collection('profile').doc('library_migration_fence').set({
      schemaVersion: 1, active: true, phase: 'apply', jobId: 'query-v3', scanId: 'scan', token: 'token',
      leaseOwner: 'operator', leaseExpiresAt: Date.now() + 60_000, sourceRevision: 'e'.repeat(64),
      libraryEpoch: 2, revision: 1, appliedGroupCount: 0, appliedSourceCount: 0, sourceCount: 1, groupCount: 1,
      startedAt: Date.now(),
    });

    await expect(repairCatalogProgressForOwner(database, OWNER_ID)).rejects.toBeInstanceOf(LegacyLibraryMigrationFenceError);
    expect((await progress('lexeme-missing').get()).exists).toBe(false);
  });
});
