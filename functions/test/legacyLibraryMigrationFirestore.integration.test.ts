import { createHash, randomUUID } from 'node:crypto';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { DocumentReference, FieldValue, getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { canonicalCard, createCardForOwner } from '../src/cardPersistence.js';
import { runLegacyLibraryDiscovery } from '../src/legacyLibraryMigration.js';
import {
  applyLegacyLibraryMigration,
  clearZeroProgressFence,
  createFirestoreLegacyLibraryDiscoveryStore,
  LegacyLibraryDiscoveryLeaseError,
  LegacyLibraryDiscoveryStateChangedError,
  LegacyLibraryGenerationChangedError,
  LegacyLibraryRollbackConflictError,
  rollbackLegacyLibraryMigration,
} from '../src/legacyLibraryMigrationFirestore.js';
import { assertOwnerLibraryWriteAllowed } from '../src/legacyLibraryMigrationOwnerScope.js';

const describeWithEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const DATABASE_ID = 'ai-studio-945b4052-4462-4668-8936-277f09f07a37';
const OWNER_ID = 'migration-integration-owner';

describeWithEmulator('Firestore Admin legacy library migration', () => {
  let app: App;
  let database: Firestore;

  beforeAll(() => {
    app = initializeApp({ projectId: 'demo-lingoflash' }, 'legacy-migration-integration');
    database = getFirestore(app, DATABASE_ID);
  });

  beforeEach(async () => {
    await database.recursiveDelete(database.collection('users').doc(OWNER_ID));
    await database.collection('users').doc(OWNER_ID).collection('profile').doc('library_state').set({
      libraryEpoch: 2,
      schemaVersion: 2,
    });
    const cards = database.collection('users').doc(OWNER_ID).collection('cards');
    await Promise.all([
      cards.doc('legacy-capital').set({ id: 'legacy-capital', word: 'Migrate', translation: 'di chuyển' }),
      cards.doc('duplicate-weak').set({ id: 'duplicate-weak', word: 'Quite', translation: 'khá', reviews: 1 }),
      cards.doc('duplicate-strong').set({
        id: 'duplicate-strong', word: ' quite ', translation: 'hoàn toàn', reviews: 8,
        createdAt: '2025-01-01T00:00:00.000Z',
      }),
    ]);
  });

  afterAll(async () => {
    await database.recursiveDelete(database.collection('users').doc(OWNER_ID));
    await database.terminate();
    await deleteApp(app);
  });

  it('discovers ordered pages into a trusted query-v3 manifest without live writes', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    const store = createFirestoreLegacyLibraryDiscoveryStore(database);

    const first = await runLegacyLibraryDiscovery(store, OWNER_ID, {
      jobId: 'query-v3', batchSize: 2,
    });
    const second = await runLegacyLibraryDiscovery(store, OWNER_ID, {
      jobId: 'query-v3', batchSize: 2,
    });

    expect(first).toMatchObject({ migrated: 0, scanned: 2, complete: false, invalid: 0 });
    expect(second).toMatchObject({ migrated: 0, scanned: 1, complete: false, phase: 'discovered', invalid: 0 });
    expect((await owner.collection('admin_library_migration_jobs').doc('query-v3').get()).data())
      .toMatchObject({ schemaVersion: 3, phase: 'discovered', cursor: 'legacy-capital', leaseOwner: null });
    expect((await owner.collection('admin_library_migration_jobs').doc('query-v3').collection('groups').get()).size)
      .toBe(2);
    expect((await owner.collection('card_reservations').get()).empty).toBe(true);
    expect((await owner.collection('card_tombstones').get()).empty).toBe(true);
    expect((await owner.collection('cards').get()).size).toBe(3);
  });

  it('applies and rolls back same-word lexemes without collapsing their identities', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    const lexeme = (senseKey: string) => {
      const bytes = Buffer.from(JSON.stringify(['en', 'lead', 'noun', senseKey])).toString('hex');
      const value = `\u0000${bytes}`;
      const slug = value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);
      return {
        word: 'lead', normalizedWord: 'lead', language: 'en', normalizedLemma: 'lead',
        partOfSpeech: 'noun', senseKey,
        lexemeId: `lexeme-${slug}-${createHash('sha256').update(value).digest('hex').slice(0, 24)}`,
      };
    };
    const metal = lexeme('metal');
    const guide = lexeme('guide');
    await Promise.all([
      owner.collection('cards').doc('lead-metal').set({ id: 'lead-metal', ...metal }),
      owner.collection('cards').doc('lead-guide').set({ id: 'lead-guide', ...guide }),
    ]);
    const store = createFirestoreLegacyLibraryDiscoveryStore(database);
    let discovery = await runLegacyLibraryDiscovery(store, OWNER_ID, { jobId: 'lexeme-apply-v3', batchSize: 100 });
    while (discovery.phase === 'discover') {
      discovery = await runLegacyLibraryDiscovery(store, OWNER_ID, { jobId: 'lexeme-apply-v3', batchSize: 100 });
    }
    const sourceRevision = String((await owner.collection('admin_library_migration_jobs').doc('lexeme-apply-v3').get()).data()?.sourceRevision ?? '');
    await applyLegacyLibraryMigration(database, OWNER_ID, { jobId: 'lexeme-apply-v3', sourceRevision });
    expect((await owner.collection('cards').doc(metal.lexemeId).get()).data()).toMatchObject(metal);
    expect((await owner.collection('cards').doc(guide.lexemeId).get()).data()).toMatchObject(guide);
    const reservationIds = (await owner.collection('card_reservations').get()).docs.map(document => document.id);
    expect(reservationIds).toContain(createHash('sha256').update(`lexeme:${metal.lexemeId}`).digest('hex'));
    expect(reservationIds).toContain(createHash('sha256').update(`lexeme:${guide.lexemeId}`).digest('hex'));
    expect(reservationIds).not.toContain(createHash('sha256').update(metal.lexemeId).digest('hex'));

    await rollbackLegacyLibraryMigration(database, OWNER_ID, 'lexeme-apply-v3', sourceRevision);
    expect((await owner.collection('cards').orderBy('__name__').get()).docs.map(document => document.id))
      .toContain('lead-metal');
    expect((await owner.collection('cards').orderBy('__name__').get()).docs.map(document => document.id))
      .toContain('lead-guide');
  });

  it('keeps the catalog progress of migrated lexeme cards in step with them and restores it on rollback', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    const lexeme = (senseKey: string) => {
      const bytes = Buffer.from(JSON.stringify(['en', 'lead', 'noun', senseKey])).toString('hex');
      const value = `\u0000${bytes}`;
      const slug = value.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);
      return {
        word: 'lead', normalizedWord: 'lead', language: 'en', normalizedLemma: 'lead',
        partOfSpeech: 'noun', senseKey,
        lexemeId: `lexeme-${slug}-${createHash('sha256').update(value).digest('hex').slice(0, 24)}`,
      };
    };
    const metal = lexeme('metal');
    const guide = lexeme('guide');
    const progress = owner.collection('catalog_progress');
    // Two cards of one lexeme: the merged card is mastered while the stored
    // projection still says what the weaker card said. The other lexeme card
    // was written before projections existed and has none.
    const staleProjection = {
      schemaVersion: 1, ownerId: OWNER_ID, lexemeId: metal.lexemeId, targetLanguage: 'en',
      status: 'active', cardRevision: 1, libraryEpoch: 2, updatedAt: Timestamp.fromMillis(1_000),
    };
    await Promise.all([
      owner.collection('cards').doc('lead-metal-weak').set({
        id: 'lead-metal-weak', ...metal, translation: 'chì', reviews: 1, interval: 1, revision: 1,
      }),
      owner.collection('cards').doc('lead-metal-strong').set({
        id: 'lead-metal-strong', ...metal, translation: 'chì', reviews: 9, interval: 30,
        difficulty: 'good', revision: 4,
      }),
      owner.collection('cards').doc('lead-guide').set({
        id: 'lead-guide', ...guide, translation: 'dẫn', reviews: 2, interval: 3,
      }),
      progress.doc(metal.lexemeId).set(staleProjection),
    ]);
    const jobId = 'lexeme-progress-v3';
    const store = createFirestoreLegacyLibraryDiscoveryStore(database);
    let discovery = await runLegacyLibraryDiscovery(store, OWNER_ID, { jobId, batchSize: 100 });
    while (discovery.phase === 'discover') {
      discovery = await runLegacyLibraryDiscovery(store, OWNER_ID, { jobId, batchSize: 100 });
    }
    const sourceRevision = String((await owner.collection('admin_library_migration_jobs').doc(jobId).get()).data()?.sourceRevision ?? '');
    await expect(applyLegacyLibraryMigration(database, OWNER_ID, { jobId, sourceRevision }))
      .resolves.toMatchObject({ complete: true });

    const metalCard = (await owner.collection('cards').doc(metal.lexemeId).get()).data();
    const guideCard = (await owner.collection('cards').doc(guide.lexemeId).get()).data();
    expect((await progress.doc(metal.lexemeId).get()).data()).toMatchObject({
      schemaVersion: 1, ownerId: OWNER_ID, lexemeId: metal.lexemeId, targetLanguage: 'en',
      status: 'mastered', cardRevision: metalCard?.revision, libraryEpoch: 2,
    });
    expect((await progress.doc(guide.lexemeId).get()).data()).toMatchObject({
      lexemeId: guide.lexemeId, status: 'active', cardRevision: guideCard?.revision, libraryEpoch: 2,
    });

    await rollbackLegacyLibraryMigration(database, OWNER_ID, jobId, sourceRevision);
    expect((await progress.doc(metal.lexemeId).get()).data()).toEqual(staleProjection);
    expect((await progress.doc(guide.lexemeId).get()).exists).toBe(false);
  });

  it('replays a terminal discovery byte-for-byte without reopening writes', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    const store = createFirestoreLegacyLibraryDiscoveryStore(database);
    let result = await runLegacyLibraryDiscovery(store, OWNER_ID, { jobId: 'terminal-replay-v3', batchSize: 2 });
    while (result.phase === 'discover') {
      result = await runLegacyLibraryDiscovery(store, OWNER_ID, { jobId: 'terminal-replay-v3', batchSize: 2 });
    }
    const jobReference = owner.collection('admin_library_migration_jobs').doc('terminal-replay-v3');
    const groupReference = jobReference.collection('groups');
    const beforeJob = (await jobReference.get()).data();
    const beforeGroups = (await groupReference.get()).docs.map(document => [document.id, document.data()]);
    await expect(runLegacyLibraryDiscovery(store, OWNER_ID, { jobId: 'terminal-replay-v3', batchSize: 2 }))
      .resolves.toMatchObject({ phase: 'discovered', scanned: 0 });
    expect((await jobReference.get()).data()).toEqual(beforeJob);
    expect((await groupReference.get()).docs.map(document => [document.id, document.data()])).toEqual(beforeGroups);
  });

  it('keeps expired apply and rollback jobs immutable to discovery acquire and commit', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    const store = createFirestoreLegacyLibraryDiscoveryStore(database);
    const jobReference = owner.collection('admin_library_migration_jobs').doc('expired-fence-v3');
    const leaseOwner = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const job = {
      schemaVersion: 3, scanId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', phase: 'apply',
      cursor: null, libraryEpoch: 2, sourceRevision: 'a'.repeat(64), scanned: 3,
      sourceCount: 3, groupCount: 2, lastPageDigest: 'b'.repeat(64), leaseOwner,
      leaseExpiresAt: Timestamp.fromMillis(Date.now() - 1), fenceToken: 'token-a',
      appliedGroupCount: 1, appliedSourceCount: 2,
    };
    const fence = {
      schemaVersion: 1, active: true, phase: 'apply', jobId: 'expired-fence-v3',
      scanId: job.scanId, token: 'token-a', leaseOwner, leaseExpiresAt: Date.now() - 1,
      sourceRevision: job.sourceRevision, libraryEpoch: 2, revision: 2,
      appliedGroupCount: 1, appliedSourceCount: 2, sourceCount: 3, groupCount: 2,
      startedAt: Date.now() - 10_000,
    };
    await Promise.all([
      jobReference.set(job),
      owner.collection('profile').doc('library_migration_fence').set(fence),
    ]);
    const before = (await jobReference.get()).data();
    await expect(store.acquireDiscoveryLease(OWNER_ID, {
      jobId: 'expired-fence-v3', scanId: job.scanId, leaseOwner: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    })).resolves.toMatchObject({ phase: 'apply', leaseOwner });
    await expect(store.commitDiscoveryPage(OWNER_ID, {
      jobId: 'expired-fence-v3', expectedJob: before as never,
      page: { documents: [], cursor: null, terminal: true, libraryEpoch: 2 },
      pageDigest: '', groups: [], nextJob: job as never,
      leaseOwner: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    })).resolves.toMatchObject({ phase: 'apply', leaseOwner });
    expect((await jobReference.get()).data()).toEqual(before);

    await jobReference.set({ ...job, phase: 'rollback' });
    await owner.collection('profile').doc('library_migration_fence').set({ ...fence, phase: 'rollback' });
    const rollbackBefore = (await jobReference.get()).data();
    await expect(store.acquireDiscoveryLease(OWNER_ID, {
      jobId: 'expired-fence-v3', scanId: job.scanId, leaseOwner: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    })).resolves.toMatchObject({ phase: 'rollback', leaseOwner });
    await expect(store.commitDiscoveryPage(OWNER_ID, {
      jobId: 'expired-fence-v3', expectedJob: rollbackBefore as never,
      page: { documents: [], cursor: null, terminal: true, libraryEpoch: 2 },
      pageDigest: '', groups: [], nextJob: { ...job, phase: 'rollback' } as never,
      leaseOwner: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    })).resolves.toMatchObject({ phase: 'rollback', leaseOwner });
    expect((await jobReference.get()).data()).toEqual(rollbackBefore);
  });

  it('keeps a terminal scan provisional when a source is inserted before its cursor', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    const store = createFirestoreLegacyLibraryDiscoveryStore(database);

    await expect(runLegacyLibraryDiscovery(store, OWNER_ID, {
      jobId: 'precursor-v3', batchSize: 2,
    })).resolves.toMatchObject({ phase: 'discover', complete: false, scanned: 2 });
    await owner.collection('cards').doc('aaa-before').set({ word: 'inserted before cursor' });

    const terminal = await runLegacyLibraryDiscovery(store, OWNER_ID, {
      jobId: 'precursor-v3', batchSize: 2,
    });
    expect(terminal).toMatchObject({ phase: 'discovered', complete: false, scanned: 1, sourceCount: 3 });
    expect((await owner.collection('cards').get()).size).toBe(4);
    // Task 7 must fresh-verify the full card range and CAS before promoting/applying.
  });

  it('applies query-v3 behind a durable fence and rolls back with group CAS', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    const previousProgress = {
      migrationVersion: 1, complete: false, scanned: 1, lastDocumentId: 'legacy-capital',
    };
    const previousFacets = {
      categories: { Existing: 7 }, complete: false, version: 1,
    };
    const previousResourceUsage = { schemaVersion: 1, cardCount: 3, imported: 4 };
    await Promise.all([
      owner.collection('profile').doc('query_migration').set(previousProgress),
      owner.collection('profile').doc('library_facets').set(previousFacets),
      owner.collection('profile').doc('resource_usage').set(previousResourceUsage),
      owner.collection('card_reservations').doc(createHash('sha256').update('migrate').digest('hex')).set({
        schemaVersion: 1, cardId: 'legacy-capital', normalizedWord: 'migrate',
      }),
    ]);
    const store = createFirestoreLegacyLibraryDiscoveryStore(database);
    let discovery = await runLegacyLibraryDiscovery(store, OWNER_ID, {
      jobId: 'query-v3-apply', batchSize: 2,
    });
    while (discovery.phase === 'discover') {
      discovery = await runLegacyLibraryDiscovery(store, OWNER_ID, {
        jobId: 'query-v3-apply', batchSize: 2,
      });
    }
    const job = await owner.collection('admin_library_migration_jobs').doc('query-v3-apply').get();
    const sourceRevision = String(job.data()?.sourceRevision ?? '');
    const result = await applyLegacyLibraryMigration(database, OWNER_ID, {
      jobId: 'query-v3-apply', sourceRevision,
    });
    expect(result).toMatchObject({ complete: true, phase: 'complete', groupCount: 2 });
    expect((await owner.collection('profile').doc('library_migration_fence').get()).exists).toBe(false);
    expect((await owner.collection('profile').doc('resource_usage').get()).data())
      .toMatchObject({ schemaVersion: 1, cardCount: 2 });
    expect((await owner.collection('card_reservations').get()).size).toBe(2);
    expect((await owner.collection('card_reservations').doc(createHash('sha256').update('migrate').digest('hex')).get()).data())
      .toEqual({ schemaVersion: 1, cardId: 'word-migrate', normalizedWord: 'migrate' });
    expect((await owner.collection('card_reservations').doc(createHash('sha256').update('word:migrate').digest('hex')).get()).exists)
      .toBe(false);
    expect((await owner.collection('profile').doc('library_facets').get()).data())
      .toMatchObject({ complete: true, categories: { Other: 2 } });
    await expect(applyLegacyLibraryMigration(database, OWNER_ID, {
      jobId: 'query-v3-apply', sourceRevision: 'a'.repeat(64),
    })).rejects.toThrow();

    await rollbackLegacyLibraryMigration(database, OWNER_ID, 'query-v3-apply', sourceRevision);
    expect((await owner.collection('cards').orderBy('__name__').get()).docs.map(document => document.id))
      .toEqual(['duplicate-strong', 'duplicate-weak', 'legacy-capital']);
    expect((await owner.collection('profile').doc('query_migration').get()).data()).toEqual(previousProgress);
    expect((await owner.collection('profile').doc('library_facets').get()).data()).toEqual(previousFacets);
    expect((await owner.collection('profile').doc('resource_usage').get()).data()).toEqual(previousResourceUsage);
    expect((await owner.collection('card_reservations').doc(createHash('sha256').update('migrate').digest('hex')).get()).data())
      .toEqual({ schemaVersion: 1, cardId: 'legacy-capital', normalizedWord: 'migrate' });
  });

  it('keeps same-spelling words of different target languages apart and matches the ids a card create uses', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    const jobId = 'target-language-v3';
    const sha = (value: string) => createHash('sha256').update(value).digest('hex');
    const japanese = await createCardForOwner(database, OWNER_ID, { word: '水', translation: 'nước', language: 'ja' });
    const chinese = await createCardForOwner(database, OWNER_ID, { word: '水', translation: 'water', language: 'zh' });
    const legacyKorean = { id: 'legacy-mul', word: '물', translation: 'nước', language: 'ko' };
    await owner.collection('cards').doc('legacy-mul').set(legacyKorean);
    const koreanId = String(canonicalCard({ word: '물', language: 'ko' }).id);
    const store = createFirestoreLegacyLibraryDiscoveryStore(database);
    let discovery = await runLegacyLibraryDiscovery(store, OWNER_ID, { jobId, batchSize: 100 });
    while (discovery.phase === 'discover') {
      discovery = await runLegacyLibraryDiscovery(store, OWNER_ID, { jobId, batchSize: 100 });
    }
    expect(discovery).toMatchObject({ phase: 'discovered', sourceCount: 6, groupCount: 5 });
    const sourceRevision = String((await owner.collection('admin_library_migration_jobs').doc(jobId).get())
      .data()?.sourceRevision ?? '');

    await expect(applyLegacyLibraryMigration(database, OWNER_ID, { jobId, sourceRevision }))
      .resolves.toMatchObject({ complete: true, groupCount: 5 });

    expect((await owner.collection('cards').orderBy('__name__').get()).docs.map(document => document.id).sort())
      .toEqual([String(japanese.card.id), String(chinese.card.id), koreanId, 'word-migrate', 'word-quite'].sort());
    expect((await owner.collection('cards').doc(String(japanese.card.id)).get()).data())
      .toMatchObject({ word: '水', language: 'ja', translation: 'nước' });
    expect((await owner.collection('cards').doc(String(chinese.card.id)).get()).data())
      .toMatchObject({ word: '水', language: 'zh', translation: 'water' });
    expect((await owner.collection('cards').doc(koreanId).get()).data())
      .toMatchObject({ id: koreanId, word: '물', normalizedWord: '물', language: 'ko' });
    expect((await owner.collection('card_reservations').doc(sha('ja\u0000水')).get()).data())
      .toEqual({ schemaVersion: 1, cardId: japanese.card.id, normalizedWord: '水', targetLanguage: 'ja' });
    expect((await owner.collection('card_reservations').doc(sha('zh\u0000水')).get()).data())
      .toEqual({ schemaVersion: 1, cardId: chinese.card.id, normalizedWord: '水', targetLanguage: 'zh' });
    expect((await owner.collection('card_reservations').doc(sha('ko\u0000물')).get()).data())
      .toEqual({ schemaVersion: 1, cardId: koreanId, normalizedWord: '물', targetLanguage: 'ko' });
    expect((await owner.collection('card_reservations').doc(sha('물')).get()).exists).toBe(false);
    expect((await owner.collection('card_reservations').doc(sha('水')).get()).exists).toBe(false);
    // Adding the same Korean word again finds the migrated card instead of making a second one.
    await expect(createCardForOwner(database, OWNER_ID, { word: '물', translation: 'water', language: 'ko' }))
      .resolves.toMatchObject({ created: false, card: { id: koreanId, translation: 'nước' } });

    await rollbackLegacyLibraryMigration(database, OWNER_ID, jobId, sourceRevision);
    expect((await owner.collection('cards').doc('legacy-mul').get()).data()).toEqual(legacyKorean);
    expect((await owner.collection('cards').doc(koreanId).get()).exists).toBe(false);
    expect((await owner.collection('card_reservations').doc(sha('ko\u0000물')).get()).exists).toBe(false);
    expect((await owner.collection('card_reservations').doc(sha('ja\u0000水')).get()).data())
      .toMatchObject({ cardId: japanese.card.id, targetLanguage: 'ja' });
  });

  it('applies no group of a manifest that files an unchanged card under an identity it no longer has', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    const jobId = 'earlier-identity-rules-v3';
    await owner.collection('cards').doc('legacy-mul').set({
      id: 'legacy-mul', word: '물', translation: 'nước', language: 'ko',
    });
    const store = createFirestoreLegacyLibraryDiscoveryStore(database);
    let discovery = await runLegacyLibraryDiscovery(store, OWNER_ID, { jobId, batchSize: 100 });
    while (discovery.phase === 'discover') {
      discovery = await runLegacyLibraryDiscovery(store, OWNER_ID, { jobId, batchSize: 100 });
    }
    const jobReference = owner.collection('admin_library_migration_jobs').doc(jobId);
    const sourceRevision = String((await jobReference.get()).data()?.sourceRevision ?? '');
    // A manifest scanned before identities were scoped by target language
    // stored the Korean word as a language-less group.
    const sha = (value: string) => createHash('sha256').update(value).digest('hex');
    const scoped = await jobReference.collection('groups').doc(sha('ko\u0000물')).get();
    expect(scoped.exists).toBe(true);
    await jobReference.collection('groups').doc(sha('물')).set({ ...scoped.data(), identity: 'word:물' });
    await scoped.ref.delete();

    await expect(applyLegacyLibraryMigration(database, OWNER_ID, { jobId, sourceRevision }))
      .rejects.toBeInstanceOf(LegacyLibraryGenerationChangedError);

    expect((await owner.collection('profile').doc('library_migration_fence').get()).exists).toBe(false);
    expect((await owner.collection('cards').orderBy('__name__').get()).docs.map(document => document.id))
      .toEqual(['duplicate-strong', 'duplicate-weak', 'legacy-capital', 'legacy-mul']);
    expect((await owner.collection('card_reservations').get()).empty).toBe(true);
  });

  it('migrates a card with its headword casing and stored learner fields intact', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    const jobId = 'stored-fields-v3';
    const stored = {
      origin: 'ai',
      mnemonic: 'birds migrate',
      wordFamily: { noun: 'migration' },
      masteredAt: '2026-05-02T10:00:00.000Z',
      appliedReviewOperationIds: ['review-op-1', 'review-op-2'],
      tags: ['verbs'],
      learnerDifficulty: 'medium',
      translationAlternatives: ['di cư'],
      // A photo from the learner's own files.
      imageUrl: `https://firebasestorage.googleapis.com/v0/b/encoded-hangout-433912-h2.firebasestorage.app/o/users%2F${OWNER_ID}%2Ffiles%2FAbCdEfGhIjKlMnOpQrSt?alt=media&token=0b0f1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d`,
    };
    const original = { id: 'legacy-capital', word: 'Migrate', translation: 'di chuyển', ...stored };
    await owner.collection('cards').doc('legacy-capital').set(original);
    const store = createFirestoreLegacyLibraryDiscoveryStore(database);
    let discovery = await runLegacyLibraryDiscovery(store, OWNER_ID, { jobId, batchSize: 2 });
    while (discovery.phase === 'discover') {
      discovery = await runLegacyLibraryDiscovery(store, OWNER_ID, { jobId, batchSize: 2 });
    }
    const sourceRevision = String((await owner.collection('admin_library_migration_jobs').doc(jobId).get())
      .data()?.sourceRevision ?? '');

    await expect(applyLegacyLibraryMigration(database, OWNER_ID, { jobId, sourceRevision }))
      .resolves.toMatchObject({ complete: true });

    expect((await owner.collection('cards').doc('word-migrate').get()).data()).toMatchObject({
      id: 'word-migrate', word: 'Migrate', normalizedWord: 'migrate', translation: 'di chuyển', ...stored,
    });
    expect((await owner.collection('cards').doc('word-quite').get()).data())
      .toMatchObject({ word: 'quite', normalizedWord: 'quite', translation: 'hoàn toàn' });

    await rollbackLegacyLibraryMigration(database, OWNER_ID, jobId, sourceRevision);
    expect((await owner.collection('cards').doc('legacy-capital').get()).data()).toEqual(original);
  });

  it('completes and rolls back when the owner still holds a reservation for a deleted card', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    const jobId = 'leftover-reservation-v3';
    // Reservations outlive their cards: this one remains from a card the learner deleted.
    const leftoverReference = owner.collection('card_reservations')
      .doc(createHash('sha256').update('bye').digest('hex'));
    const leftover = { schemaVersion: 1, cardId: 'word-bye', normalizedWord: 'bye' };
    await leftoverReference.set(leftover);
    const store = createFirestoreLegacyLibraryDiscoveryStore(database);
    let discovery = await runLegacyLibraryDiscovery(store, OWNER_ID, { jobId, batchSize: 2 });
    while (discovery.phase === 'discover') {
      discovery = await runLegacyLibraryDiscovery(store, OWNER_ID, { jobId, batchSize: 2 });
    }
    const sourceRevision = String((await owner.collection('admin_library_migration_jobs').doc(jobId).get())
      .data()?.sourceRevision ?? '');

    await expect(applyLegacyLibraryMigration(database, OWNER_ID, { jobId, sourceRevision }))
      .resolves.toMatchObject({ complete: true, phase: 'complete', groupCount: 2 });

    expect((await owner.collection('profile').doc('library_migration_fence').get()).exists).toBe(false);
    expect((await owner.collection('profile').doc('library_state').get()).data()?.libraryMigrationFenceActive)
      .toBeUndefined();
    expect((await owner.collection('cards').orderBy('__name__').get()).docs.map(document => document.id))
      .toEqual(['word-migrate', 'word-quite']);
    expect((await owner.collection('card_reservations').get()).size).toBe(3);
    expect((await leftoverReference.get()).data()).toEqual(leftover);

    await expect(rollbackLegacyLibraryMigration(database, OWNER_ID, jobId, sourceRevision))
      .resolves.toMatchObject({ complete: true });
    expect((await owner.collection('cards').orderBy('__name__').get()).docs.map(document => document.id))
      .toEqual(['duplicate-strong', 'duplicate-weak', 'legacy-capital']);
    expect((await leftoverReference.get()).data()).toEqual(leftover);
  });

  it('refuses before any change when another word\'s reservation names a card the migration would keep', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    const jobId = 'foreign-reservation-v3';
    await owner.collection('card_reservations').doc(createHash('sha256').update('relocate').digest('hex'))
      .set({ schemaVersion: 1, cardId: 'word-migrate', normalizedWord: 'relocate' });
    const store = createFirestoreLegacyLibraryDiscoveryStore(database);
    let discovery = await runLegacyLibraryDiscovery(store, OWNER_ID, { jobId, batchSize: 2 });
    while (discovery.phase === 'discover') {
      discovery = await runLegacyLibraryDiscovery(store, OWNER_ID, { jobId, batchSize: 2 });
    }
    const sourceRevision = String((await owner.collection('admin_library_migration_jobs').doc(jobId).get())
      .data()?.sourceRevision ?? '');

    await expect(applyLegacyLibraryMigration(database, OWNER_ID, { jobId, sourceRevision }))
      .rejects.toMatchObject({ name: 'LegacyLibraryMigrationConflictError', reason: 'reservation' });

    expect((await owner.collection('profile').doc('library_migration_fence').get()).exists).toBe(false);
    expect((await owner.collection('cards').orderBy('__name__').get()).docs.map(document => document.id))
      .toEqual(['duplicate-strong', 'duplicate-weak', 'legacy-capital']);
    expect((await owner.collection('card_tombstones').get()).empty).toBe(true);
  });

  it('resumes legacy identity-less groups and plans, including a 256-character word', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    const word = 'a'.repeat(256);
    await owner.collection('cards').doc('long-word').set({ id: 'long-word', word, translation: 'dài' });
    const store = createFirestoreLegacyLibraryDiscoveryStore(database);
    let discovery = await runLegacyLibraryDiscovery(store, OWNER_ID, {
      jobId: 'legacy-identityless-v3', batchSize: 100,
    });
    while (discovery.phase === 'discover') {
      discovery = await runLegacyLibraryDiscovery(store, OWNER_ID, {
        jobId: 'legacy-identityless-v3', batchSize: 100,
      });
    }
    const jobReference = owner.collection('admin_library_migration_jobs').doc('legacy-identityless-v3');
    const groups = await jobReference.collection('groups').get();
    await Promise.all(groups.docs.map(group => group.ref.set({ identity: FieldValue.delete() }, { merge: true })));
    const sourceRevision = String((await jobReference.get()).data()?.sourceRevision ?? '');
    expect(sourceRevision).toMatch(/^[a-f0-9]{64}$/);

    await applyLegacyLibraryMigration(database, OWNER_ID, { jobId: 'legacy-identityless-v3', sourceRevision });
    const canonical = (await owner.collection('cards').where('normalizedWord', '==', word).get()).docs[0];
    expect(canonical?.exists).toBe(true);
    expect((await owner.collection('card_reservations').doc(createHash('sha256').update(word).digest('hex')).get()).data())
      .toEqual({ schemaVersion: 1, cardId: canonical?.id, normalizedWord: word });

    const plans = await owner.collection('admin_library_migration_backups').doc('legacy-identityless-v3')
      .collection('plans').get();
    await Promise.all(plans.docs.map(plan => plan.ref.set({ identity: FieldValue.delete() }, { merge: true })));
    await rollbackLegacyLibraryMigration(database, OWNER_ID, 'legacy-identityless-v3', sourceRevision);
    expect((await owner.collection('cards').doc('long-word').get()).data()).toMatchObject({ word });
  });

  it('rolls back applied groups when final sealing was interrupted', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    const store = createFirestoreLegacyLibraryDiscoveryStore(database);
    let discovery = await runLegacyLibraryDiscovery(store, OWNER_ID, {
      jobId: 'partial-apply-rollback-v3', batchSize: 2,
    });
    while (discovery.phase === 'discover') {
      discovery = await runLegacyLibraryDiscovery(store, OWNER_ID, {
        jobId: 'partial-apply-rollback-v3', batchSize: 2,
      });
    }
    const jobReference = owner.collection('admin_library_migration_jobs')
      .doc('partial-apply-rollback-v3');
    const rootReference = owner.collection('admin_library_migration_backups')
      .doc('partial-apply-rollback-v3');
    const sourceRevision = String((await jobReference.get()).data()?.sourceRevision ?? '');
    await applyLegacyLibraryMigration(database, OWNER_ID, {
      jobId: 'partial-apply-rollback-v3', sourceRevision,
    });
    await Promise.all([
      jobReference.set({
        phase: 'apply',
        leaseOwner: null,
        leaseExpiresAt: null,
      }, { merge: true }),
      rootReference.set({
        complete: false,
        finalAggregateDigest: FieldValue.delete(),
        completedAt: FieldValue.delete(),
      }, { merge: true }),
    ]);

    const appliedPlan = (await rootReference.collection('plans').limit(1).get()).docs[0].data();
    const canonicalReference = owner.collection('cards').doc(String(appliedPlan.primaryId));
    await canonicalReference.set({ translation: 'conflict during interrupted apply' }, { merge: true });
    await expect(rollbackLegacyLibraryMigration(
      database, OWNER_ID, 'partial-apply-rollback-v3', sourceRevision,
    )).rejects.toBeInstanceOf(LegacyLibraryRollbackConflictError);
    const fenceReference = owner.collection('profile').doc('library_migration_fence');
    expect((await fenceReference.get()).data())
      .toMatchObject({ active: true, phase: 'rollback' });
    await canonicalReference.set(appliedPlan.canonicalAfter, { merge: false });
    const expiredAt = Date.now() - 1;
    await Promise.all([
      fenceReference.set({ leaseExpiresAt: expiredAt }, { merge: true }),
      jobReference.set({ leaseExpiresAt: Timestamp.fromMillis(expiredAt) }, { merge: true }),
    ]);

    await expect(rollbackLegacyLibraryMigration(
      database, OWNER_ID, 'partial-apply-rollback-v3', sourceRevision,
    )).resolves.toMatchObject({ complete: true });
    expect((await owner.collection('cards').orderBy('__name__').get()).docs
      .map(document => document.id))
      .toEqual(['duplicate-strong', 'duplicate-weak', 'legacy-capital']);
    expect((await owner.collection('profile').doc('library_migration_fence').get()).exists)
      .toBe(false);
  });

  it('rejects rollback after a post-completion extra identity without mutating live state', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    const store = createFirestoreLegacyLibraryDiscoveryStore(database);
    let discovery = await runLegacyLibraryDiscovery(store, OWNER_ID, {
      jobId: 'rollback-extra-identity-v3', batchSize: 2,
    });
    while (discovery.phase === 'discover') {
      discovery = await runLegacyLibraryDiscovery(store, OWNER_ID, {
        jobId: 'rollback-extra-identity-v3', batchSize: 2,
      });
    }
    const jobReference = owner.collection('admin_library_migration_jobs').doc('rollback-extra-identity-v3');
    const sourceRevision = String((await jobReference.get()).data()?.sourceRevision ?? '');
    await applyLegacyLibraryMigration(database, OWNER_ID, {
      jobId: 'rollback-extra-identity-v3', sourceRevision,
    });
    await owner.collection('cards').doc('post-completion-extra').set({
      id: 'post-completion-extra', word: 'new identity', translation: 'mới',
    });
    const cardsBefore = (await owner.collection('cards').orderBy('__name__').get()).docs
      .map(document => [document.id, document.data()]);
    const facetsBefore = (await owner.collection('profile').doc('library_facets').get()).data();
    const resourceUsageBefore = (await owner.collection('profile').doc('resource_usage').get()).data();

    await expect(rollbackLegacyLibraryMigration(
      database, OWNER_ID, 'rollback-extra-identity-v3', sourceRevision,
    )).rejects.toBeInstanceOf(LegacyLibraryRollbackConflictError);

    expect((await owner.collection('cards').orderBy('__name__').get()).docs
      .map(document => [document.id, document.data()])).toEqual(cardsBefore);
    expect((await owner.collection('profile').doc('library_facets').get()).data()).toEqual(facetsBefore);
    expect((await owner.collection('profile').doc('resource_usage').get()).data()).toEqual(resourceUsageBefore);
    expect((await owner.collection('profile').doc('library_migration_fence').get()).exists).toBe(false);
    expect((await jobReference.get()).data()).toMatchObject({ phase: 'complete' });
  });

  const discoverToEnd = async (jobId: string) => {
    const store = createFirestoreLegacyLibraryDiscoveryStore(database);
    let discovery = await runLegacyLibraryDiscovery(store, OWNER_ID, { jobId, batchSize: 2 });
    while (discovery.phase === 'discover') {
      discovery = await runLegacyLibraryDiscovery(store, OWNER_ID, { jobId, batchSize: 2 });
    }
    const job = (await database.collection('users').doc(OWNER_ID)
      .collection('admin_library_migration_jobs').doc(jobId).get()).data() ?? {};
    return { discovery, sourceRevision: String(job.sourceRevision ?? '') };
  };

  it('reopens discovery when a card changed after the scan, so the new library can be approved and applied', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    const jobId = 'changed-after-scan-v3';
    const jobReference = owner.collection('admin_library_migration_jobs').doc(jobId);
    const first = await discoverToEnd(jobId);
    // What a review does to a card between the scan and the operator's apply.
    await owner.collection('cards').doc('legacy-capital').set({
      id: 'legacy-capital', word: 'Migrate', translation: 'di chuyển', reviews: 1,
    });

    await expect(applyLegacyLibraryMigration(database, OWNER_ID, { jobId, sourceRevision: first.sourceRevision }))
      .rejects.toBeInstanceOf(LegacyLibraryGenerationChangedError);

    expect((await owner.collection('profile').doc('library_migration_fence').get()).exists).toBe(false);
    expect((await owner.collection('profile').doc('library_state').get()).data()?.libraryMigrationFenceActive)
      .not.toBe(true);
    expect((await owner.collection('admin_library_migration_backups').doc(jobId).get()).exists).toBe(false);
    expect((await jobReference.get()).data()).toMatchObject({
      phase: 'discover', cursor: null, sourceRevision: '', scanned: 0, sourceCount: 0, groupCount: 0,
    });
    expect((await jobReference.collection('groups').get()).size).toBe(0);
    expect((await owner.collection('cards').doc('legacy-capital').get()).data()?.reviews).toBe(1);

    const second = await discoverToEnd(jobId);
    expect(second.discovery).toMatchObject({ phase: 'discovered', sourceCount: 3, groupCount: 2 });
    expect(second.sourceRevision).toMatch(/^[a-f0-9]{64}$/);
    expect(second.sourceRevision).not.toBe(first.sourceRevision);
    // The retired revision stays unusable; only the newly reported one applies.
    await expect(applyLegacyLibraryMigration(database, OWNER_ID, { jobId, sourceRevision: first.sourceRevision }))
      .rejects.toBeInstanceOf(LegacyLibraryDiscoveryStateChangedError);
    await expect(applyLegacyLibraryMigration(database, OWNER_ID, { jobId, sourceRevision: second.sourceRevision }))
      .resolves.toMatchObject({ complete: true, groupCount: 2 });

    expect((await owner.collection('profile').doc('library_migration_fence').get()).exists).toBe(false);
    expect((await jobReference.get()).data()?.phase).toBe('complete');
    expect((await owner.collection('cards').doc('word-migrate').get()).data())
      .toMatchObject({ word: 'Migrate', reviews: 1 });
  });

  it('reopens discovery when the library was cleared and refilled after the scan', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    const jobId = 'cleared-after-scan-v3';
    const jobReference = owner.collection('admin_library_migration_jobs').doc(jobId);
    const first = await discoverToEnd(jobId);
    await owner.collection('profile').doc('library_state').set({ libraryEpoch: 3 }, { merge: true });

    await expect(applyLegacyLibraryMigration(database, OWNER_ID, { jobId, sourceRevision: first.sourceRevision }))
      .rejects.toBeInstanceOf(LegacyLibraryGenerationChangedError);

    expect((await owner.collection('profile').doc('library_migration_fence').get()).exists).toBe(false);
    expect((await jobReference.get()).data()).toMatchObject({ phase: 'discover', sourceRevision: '', libraryEpoch: null });

    const second = await discoverToEnd(jobId);
    expect(second.sourceRevision).not.toBe(first.sourceRevision);
    expect((await jobReference.get()).data()).toMatchObject({ phase: 'discovered', libraryEpoch: 3 });
    await expect(applyLegacyLibraryMigration(database, OWNER_ID, { jobId, sourceRevision: second.sourceRevision }))
      .resolves.toMatchObject({ complete: true, groupCount: 2 });
    expect((await owner.collection('profile').doc('library_migration_fence').get()).exists).toBe(false);
  });

  it('applies the new scan over backups a failed attempt on the retired scan left behind', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    const jobId = 'leftover-backups-v3';
    const jobReference = owner.collection('admin_library_migration_jobs').doc(jobId);
    await owner.collection('cards').doc('legacy-zebra').set({ id: 'legacy-zebra', word: 'Zebra', translation: 'ngựa vằn' });
    const first = await discoverToEnd(jobId);
    // A first attempt backs up the later groups, then stops before applying any group.
    const [unprepared, edited, removed] = (await jobReference.collection('groups').orderBy('__name__').get()).docs;
    await unprepared.ref.set({ backupSealed: true }, { merge: true });
    await expect(applyLegacyLibraryMigration(database, OWNER_ID, { jobId, sourceRevision: first.sourceRevision }))
      .rejects.toBeInstanceOf(LegacyLibraryDiscoveryStateChangedError);
    const sourceIds = (group: typeof edited) => (group.data().sources as { id: string }[]).map(source => source.id);
    const editedId = sourceIds(edited)[0];
    const backups = owner.collection('admin_library_migration_backups').doc(jobId).collection('sources');
    expect((await backups.doc(editedId).get()).exists).toBe(true);
    // The learner then edits one backed-up card and deletes every card of another word.
    const editedCard = { ...(await owner.collection('cards').doc(editedId).get()).data(), translation: 'edited after the failed attempt' };
    await owner.collection('cards').doc(editedId).set(editedCard);
    await Promise.all(sourceIds(removed).map(id => owner.collection('cards').doc(id).delete()));

    await expect(applyLegacyLibraryMigration(database, OWNER_ID, { jobId, sourceRevision: first.sourceRevision }))
      .rejects.toBeInstanceOf(LegacyLibraryGenerationChangedError);
    const second = await discoverToEnd(jobId);
    expect(second.discovery).toMatchObject({ phase: 'discovered', groupCount: 2 });
    expect((await jobReference.collection('groups').get()).size).toBe(2);
    await expect(applyLegacyLibraryMigration(database, OWNER_ID, { jobId, sourceRevision: second.sourceRevision }))
      .resolves.toMatchObject({ complete: true, groupCount: 2 });

    // The backup now holds the card as it was when the applied scan ran.
    await rollbackLegacyLibraryMigration(database, OWNER_ID, jobId, second.sourceRevision);
    expect((await owner.collection('cards').doc(editedId).get()).data()).toEqual(editedCard);
    for (const id of sourceIds(removed)) {
      expect((await owner.collection('cards').doc(id).get()).exists).toBe(false);
    }
  });

  it('rolls back to the library the applied scan saw, not to a card a retired scan backed up', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    const jobId = 'retired-backup-rollback-v3';
    const jobReference = owner.collection('admin_library_migration_jobs').doc(jobId);
    // One copy of the word already sits at the id the migration keeps.
    await owner.collection('cards').doc('word-quite').set({ id: 'word-quite', word: 'quite', translation: 'khá là' });
    const first = await discoverToEnd(jobId);
    // A first attempt backs up that card, then stops before applying any group.
    const [unprepared] = (await jobReference.collection('groups').orderBy('__name__').get()).docs;
    expect(unprepared.data().normalizedWord).not.toBe('quite');
    await unprepared.ref.set({ backupSealed: true }, { merge: true });
    await expect(applyLegacyLibraryMigration(database, OWNER_ID, { jobId, sourceRevision: first.sourceRevision }))
      .rejects.toBeInstanceOf(LegacyLibraryDiscoveryStateChangedError);
    const backups = owner.collection('admin_library_migration_backups').doc(jobId).collection('sources');
    expect((await backups.doc('word-quite').get()).exists).toBe(true);
    // The learner then deletes that card; its duplicates stay.
    const learnerTombstone = {
      cardId: 'word-quite', opId: 'learner-delete', libraryEpoch: 2,
      revision: 1, deletedAt: '2026-06-01T00:00:00.000Z',
    };
    await Promise.all([
      owner.collection('cards').doc('word-quite').delete(),
      owner.collection('card_tombstones').doc('word-quite').set(learnerTombstone),
    ]);
    const libraryBeforeApply = (await owner.collection('cards').orderBy('__name__').get()).docs
      .map(document => [document.id, document.data()]);

    await expect(applyLegacyLibraryMigration(database, OWNER_ID, { jobId, sourceRevision: first.sourceRevision }))
      .rejects.toBeInstanceOf(LegacyLibraryGenerationChangedError);
    const second = await discoverToEnd(jobId);
    await expect(applyLegacyLibraryMigration(database, OWNER_ID, { jobId, sourceRevision: second.sourceRevision }))
      .resolves.toMatchObject({ complete: true, groupCount: 2 });
    expect((await owner.collection('cards').doc('word-quite').get()).data())
      .toMatchObject({ translation: 'hoàn toàn' });

    await rollbackLegacyLibraryMigration(database, OWNER_ID, jobId, second.sourceRevision);

    expect((await owner.collection('cards').orderBy('__name__').get()).docs
      .map(document => [document.id, document.data()])).toEqual(libraryBeforeApply);
    expect((await owner.collection('cards').doc('word-quite').get()).exists).toBe(false);
    expect((await owner.collection('card_tombstones').doc('word-quite').get()).data()).toEqual(learnerTombstone);
  });

  it('scans and applies past groups of a retired scan that were never cleaned up', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    const jobId = 'retired-scan-groups-v3';
    const jobReference = owner.collection('admin_library_migration_jobs').doc(jobId);
    await discoverToEnd(jobId);
    // The job was reopened for a new scan, but the process stopped before the
    // retired scan's groups were removed; one of its words has no card any more.
    await owner.collection('cards').doc('legacy-capital').delete();
    await jobReference.set({
      schemaVersion: 3, scanId: randomUUID(), phase: 'discover', cursor: null, libraryEpoch: null,
      sourceRevision: '', scanned: 0, sourceCount: 0, groupCount: 0, lastPageDigest: null,
      leaseOwner: null, leaseExpiresAt: null,
    });
    expect((await jobReference.collection('groups').get()).size).toBe(2);

    const second = await discoverToEnd(jobId);
    expect(second.discovery).toMatchObject({ phase: 'discovered', sourceCount: 2, groupCount: 1 });
    await expect(applyLegacyLibraryMigration(database, OWNER_ID, { jobId, sourceRevision: second.sourceRevision }))
      .resolves.toMatchObject({ complete: true, groupCount: 1 });
    expect((await owner.collection('cards').get()).docs.map(document => document.id)).toEqual(['word-quite']);
  });

  it('recaptures profile metadata after a zero-progress apply retry', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    const store = createFirestoreLegacyLibraryDiscoveryStore(database);
    let discovery = await runLegacyLibraryDiscovery(store, OWNER_ID, {
      jobId: 'apply-profile-retry-v3', batchSize: 2,
    });
    while (discovery.phase === 'discover') {
      discovery = await runLegacyLibraryDiscovery(store, OWNER_ID, {
        jobId: 'apply-profile-retry-v3', batchSize: 2,
      });
    }
    const jobReference = owner.collection('admin_library_migration_jobs').doc('apply-profile-retry-v3');
    const sourceRevision = String((await jobReference.get()).data()?.sourceRevision ?? '');
    const groups = await jobReference.collection('groups').get();
    const firstGroup = groups.docs[0];
    await Promise.all([
      owner.collection('profile').doc('query_migration').set({ version: 'before-failure' }),
      owner.collection('profile').doc('library_facets').set({ version: 'before-failure' }),
      owner.collection('profile').doc('resource_usage').set({ version: 'before-failure' }),
      firstGroup.ref.set({ backupSealed: true }, { merge: true }),
    ]);

    await expect(applyLegacyLibraryMigration(database, OWNER_ID, {
      jobId: 'apply-profile-retry-v3', sourceRevision,
    })).rejects.toBeInstanceOf(LegacyLibraryDiscoveryStateChangedError);
    expect((await owner.collection('profile').doc('library_migration_fence').get()).exists).toBe(false);

    await Promise.all([
      owner.collection('profile').doc('query_migration').set({ version: 'after-failure' }),
      owner.collection('profile').doc('library_facets').set({ version: 'after-failure' }),
      owner.collection('profile').doc('resource_usage').set({ version: 'after-failure' }),
      firstGroup.ref.set({ backupSealed: false }, { merge: true }),
    ]);
    await applyLegacyLibraryMigration(database, OWNER_ID, { jobId: 'apply-profile-retry-v3', sourceRevision });
    await rollbackLegacyLibraryMigration(database, OWNER_ID, 'apply-profile-retry-v3', sourceRevision);

    expect((await owner.collection('profile').doc('query_migration').get()).data())
      .toEqual({ version: 'after-failure' });
    expect((await owner.collection('profile').doc('library_facets').get()).data())
      .toEqual({ version: 'after-failure' });
    expect((await owner.collection('profile').doc('resource_usage').get()).data())
      .toEqual({ version: 'after-failure' });
  });

  it('does not let stale zero-progress cleanup clear a newer fence revision', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    const store = createFirestoreLegacyLibraryDiscoveryStore(database);
    let discovery = await runLegacyLibraryDiscovery(store, OWNER_ID, {
      jobId: 'stale-fence-cleanup-v3', batchSize: 2,
    });
    while (discovery.phase === 'discover') {
      discovery = await runLegacyLibraryDiscovery(store, OWNER_ID, {
        jobId: 'stale-fence-cleanup-v3', batchSize: 2,
      });
    }
    const jobReference = owner.collection('admin_library_migration_jobs').doc('stale-fence-cleanup-v3');
    const job = (await jobReference.get()).data() ?? {};
    const token = 'stale-cleanup-token';
    const leaseOwner = 'stale-cleanup-worker';
    const currentFence = {
      schemaVersion: 1, active: true, phase: 'apply', jobId: jobReference.id,
      scanId: job.scanId, token, leaseOwner, leaseExpiresAt: Date.now() + 60_000,
      sourceRevision: job.sourceRevision, libraryEpoch: 2, revision: 3,
      appliedGroupCount: 0, appliedSourceCount: 0, sourceCount: job.sourceCount,
      groupCount: job.groupCount, startedAt: Date.now(), rollbackGroupCount: 0,
    };
    await Promise.all([
      owner.collection('profile').doc('library_migration_fence').set(currentFence),
      jobReference.set({ phase: 'apply', fenceToken: token, leaseOwner,
        leaseExpiresAt: Timestamp.fromMillis(currentFence.leaseExpiresAt),
        appliedGroupCount: 0, appliedSourceCount: 0 }, { merge: true }),
    ]);

    await clearZeroProgressFence(database, OWNER_ID, {
      ...currentFence, revision: currentFence.revision - 1,
    } as never, 'discovered');

    expect((await owner.collection('profile').doc('library_migration_fence').get()).data())
      .toMatchObject({ token, leaseOwner, revision: currentFence.revision });
    expect((await jobReference.get()).data()).toMatchObject({ phase: 'apply', fenceToken: token });
  });

  it('round-trips a pre-existing canonical tombstone through apply and rollback', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    const canonicalTombstone = {
      cardId: 'word-migrate', opId: 'existing-canonical-delete', libraryEpoch: 2,
      revision: 4, deletedAt: '2026-01-01T00:00:00.000Z',
    };
    const sourceTombstone = {
      cardId: 'duplicate-weak', opId: 'existing-source-delete', libraryEpoch: 2,
      revision: 7, deletedAt: '2026-01-02T00:00:00.000Z',
    };
    await Promise.all([
      owner.collection('card_tombstones').doc('word-migrate').set(canonicalTombstone),
      owner.collection('card_tombstones').doc('duplicate-weak').set(sourceTombstone),
    ]);
    const store = createFirestoreLegacyLibraryDiscoveryStore(database);
    let discovery = await runLegacyLibraryDiscovery(store, OWNER_ID, {
      jobId: 'canonical-tombstone-v3', batchSize: 2,
    });
    while (discovery.phase === 'discover') {
      discovery = await runLegacyLibraryDiscovery(store, OWNER_ID, {
        jobId: 'canonical-tombstone-v3', batchSize: 2,
      });
    }
    const sourceRevision = String((await owner.collection('admin_library_migration_jobs')
      .doc('canonical-tombstone-v3').get()).data()?.sourceRevision ?? '');
    await applyLegacyLibraryMigration(database, OWNER_ID, {
      jobId: 'canonical-tombstone-v3', sourceRevision,
    });
    expect((await owner.collection('card_tombstones').doc('word-migrate').get()).exists).toBe(false);
    expect((await owner.collection('card_tombstones').doc('duplicate-weak').get()).data()?.revision).toBe(7);
    await rollbackLegacyLibraryMigration(database, OWNER_ID, 'canonical-tombstone-v3', sourceRevision);
    expect((await owner.collection('card_tombstones').doc('word-migrate').get()).data()).toEqual(canonicalTombstone);
    expect((await owner.collection('card_tombstones').doc('duplicate-weak').get()).data()).toEqual(sourceTombstone);
  });

  it('resumes a persisted sealed-backup state without rewriting source backups', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    const store = createFirestoreLegacyLibraryDiscoveryStore(database);
    let discovery = await runLegacyLibraryDiscovery(store, OWNER_ID, {
      jobId: 'sealed-resume-v3', batchSize: 2,
    });
    while (discovery.phase === 'discover') {
      discovery = await runLegacyLibraryDiscovery(store, OWNER_ID, {
        jobId: 'sealed-resume-v3', batchSize: 2,
      });
    }
    const jobReference = owner.collection('admin_library_migration_jobs').doc('sealed-resume-v3');
    const sourceRevision = String((await jobReference.get()).data()?.sourceRevision ?? '');
    await applyLegacyLibraryMigration(database, OWNER_ID, { jobId: 'sealed-resume-v3', sourceRevision });
    const sourceBackupReference = owner.collection('admin_library_migration_backups')
      .doc('sealed-resume-v3').collection('sources').doc('legacy-capital');
    const sealedBefore = await sourceBackupReference.get();
    const sealedUpdateTime = sealedBefore.updateTime?.toMillis();

    await rollbackLegacyLibraryMigration(database, OWNER_ID, 'sealed-resume-v3', sourceRevision);
    const rolledBackJob = (await jobReference.get()).data() ?? {};
    const groups = await jobReference.collection('groups').get();
    await Promise.all(groups.docs.map(document => document.ref.set({ status: 'pending' }, { merge: true })));
    await jobReference.set({
      ...rolledBackJob,
      phase: 'discovered',
      fenceToken: null,
      leaseOwner: null,
      leaseExpiresAt: null,
      appliedGroupCount: 0,
      appliedSourceCount: 0,
    });

    await applyLegacyLibraryMigration(database, OWNER_ID, { jobId: 'sealed-resume-v3', sourceRevision });
    const sealedAfter = await sourceBackupReference.get();
    expect(sealedAfter.updateTime?.toMillis()).toBe(sealedUpdateTime);
    expect(sealedAfter.data()?.sealed).toBe(true);
  });

  it('preflights every rollback group and restores none after one applied-state conflict', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    const store = createFirestoreLegacyLibraryDiscoveryStore(database);
    let discovery = await runLegacyLibraryDiscovery(store, OWNER_ID, {
      jobId: 'rollback-preflight-v3', batchSize: 2,
    });
    while (discovery.phase === 'discover') {
      discovery = await runLegacyLibraryDiscovery(store, OWNER_ID, {
        jobId: 'rollback-preflight-v3', batchSize: 2,
      });
    }
    const sourceRevision = String((await owner.collection('admin_library_migration_jobs')
      .doc('rollback-preflight-v3').get()).data()?.sourceRevision ?? '');
    await applyLegacyLibraryMigration(database, OWNER_ID, {
      jobId: 'rollback-preflight-v3', sourceRevision,
    });
    const canonical = owner.collection('cards').doc('word-migrate');
    await canonical.set({ ...(await canonical.get()).data(), translation: 'changed after apply' });

    await expect(rollbackLegacyLibraryMigration(
      database, OWNER_ID, 'rollback-preflight-v3', sourceRevision,
    )).rejects.toBeInstanceOf(LegacyLibraryRollbackConflictError);
    expect((await owner.collection('cards').doc('legacy-capital').get()).exists).toBe(false);
    expect((await owner.collection('profile').doc('query_migration').get()).data())
      .toMatchObject({ complete: true });
    expect((await owner.collection('profile').doc('library_migration_fence').get()).exists).toBe(false);
    expect((await owner.collection('admin_library_migration_jobs').doc('rollback-preflight-v3').get()).data())
      .toMatchObject({ phase: 'complete' });
  });

  it('refuses rollback before any restore when an original source backup is missing', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    const store = createFirestoreLegacyLibraryDiscoveryStore(database);
    let discovery = await runLegacyLibraryDiscovery(store, OWNER_ID, {
      jobId: 'missing-backup-v3', batchSize: 2,
    });
    while (discovery.phase === 'discover') {
      discovery = await runLegacyLibraryDiscovery(store, OWNER_ID, {
        jobId: 'missing-backup-v3', batchSize: 2,
      });
    }
    const sourceRevision = String((await owner.collection('admin_library_migration_jobs')
      .doc('missing-backup-v3').get()).data()?.sourceRevision ?? '');
    await applyLegacyLibraryMigration(database, OWNER_ID, {
      jobId: 'missing-backup-v3', sourceRevision,
    });
    await owner.collection('admin_library_migration_backups').doc('missing-backup-v3')
      .collection('sources').doc('duplicate-weak').delete();
    await expect(rollbackLegacyLibraryMigration(database, OWNER_ID, 'missing-backup-v3', sourceRevision))
      .rejects.toBeInstanceOf(LegacyLibraryRollbackConflictError);
    expect((await owner.collection('cards').doc('duplicate-weak').get()).exists).toBe(false);
    expect((await owner.collection('profile').doc('library_migration_fence').get()).exists).toBe(false);
    expect((await owner.collection('admin_library_migration_jobs').doc('missing-backup-v3').get()).data())
      .toMatchObject({ phase: 'complete' });
  });

  it('keeps a rollback fence after persisted rollback progress is nonzero', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    const store = createFirestoreLegacyLibraryDiscoveryStore(database);
    let discovery = await runLegacyLibraryDiscovery(store, OWNER_ID, {
      jobId: 'rollback-partial-fence-v3', batchSize: 2,
    });
    while (discovery.phase === 'discover') {
      discovery = await runLegacyLibraryDiscovery(store, OWNER_ID, {
        jobId: 'rollback-partial-fence-v3', batchSize: 2,
      });
    }
    const jobReference = owner.collection('admin_library_migration_jobs').doc('rollback-partial-fence-v3');
    const sourceRevision = String((await jobReference.get()).data()?.sourceRevision ?? '');
    await applyLegacyLibraryMigration(database, OWNER_ID, {
      jobId: 'rollback-partial-fence-v3', sourceRevision,
    });
    const job = (await jobReference.get()).data() ?? {};
    const rootReference = owner.collection('admin_library_migration_backups').doc('rollback-partial-fence-v3');
    const token = 'rollback-partial-token';
    const fence = {
      schemaVersion: 1, active: true, phase: 'rollback', jobId: 'rollback-partial-fence-v3',
      scanId: job.scanId, token, leaseOwner: 'rollback-worker', leaseExpiresAt: Date.now() - 1,
      sourceRevision, libraryEpoch: 2, revision: 100, appliedGroupCount: job.groupCount,
      appliedSourceCount: job.sourceCount, sourceCount: job.sourceCount, groupCount: job.groupCount,
      startedAt: Date.now() - 10_000, rollbackGroupCount: 1,
    };
    await Promise.all([
      owner.collection('profile').doc('library_migration_fence').set(fence),
      rootReference.set({ fenceToken: token, leaseOwner: fence.leaseOwner, fenceRevision: fence.revision }, { merge: true }),
      jobReference.set({ phase: 'rollback', fenceToken: token, leaseOwner: fence.leaseOwner,
        leaseExpiresAt: Timestamp.fromMillis(fence.leaseExpiresAt) }, { merge: true }),
      owner.collection('cards').doc('word-migrate').set({
        ...(await owner.collection('cards').doc('word-migrate').get()).data(), translation: 'changed after partial rollback',
      }),
    ]);

    await expect(rollbackLegacyLibraryMigration(
      database, OWNER_ID, 'rollback-partial-fence-v3', sourceRevision,
    )).rejects.toBeInstanceOf(LegacyLibraryRollbackConflictError);
    expect((await owner.collection('profile').doc('library_migration_fence').get()).data())
      .toMatchObject({ active: true, phase: 'rollback', rollbackGroupCount: 1 });
  });

  it('releases the fence when a resumed rollback of a completed migration is refused before any restore', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    const store = createFirestoreLegacyLibraryDiscoveryStore(database);
    const jobId = 'resumed-rollback-refused-v3';
    let discovery = await runLegacyLibraryDiscovery(store, OWNER_ID, { jobId, batchSize: 2 });
    while (discovery.phase === 'discover') {
      discovery = await runLegacyLibraryDiscovery(store, OWNER_ID, { jobId, batchSize: 2 });
    }
    const jobReference = owner.collection('admin_library_migration_jobs').doc(jobId);
    const fenceReference = owner.collection('profile').doc('library_migration_fence');
    const sourceRevision = String((await jobReference.get()).data()?.sourceRevision ?? '');
    await applyLegacyLibraryMigration(database, OWNER_ID, { jobId, sourceRevision });
    // The fence is gone after completion, so the learner can change a migrated card.
    const canonical = owner.collection('cards').doc('word-migrate');
    await canonical.set({ translation: 'learner edit after completion' }, { merge: true });

    // The first rollback commits its fence and then its runner dies: no later
    // transaction runs, so neither the restore nor the cleanup happens.
    const runTransaction = database.runTransaction.bind(database);
    let transactions = 0;
    (database as unknown as { runTransaction: unknown }).runTransaction = async (...args: unknown[]) => {
      transactions += 1;
      if (transactions > 1) throw new Error('runner stopped after the fence commit');
      return (runTransaction as (...values: unknown[]) => Promise<unknown>)(...args);
    };
    try {
      await expect(rollbackLegacyLibraryMigration(database, OWNER_ID, jobId, sourceRevision))
        .rejects.toThrow('runner stopped after the fence commit');
    } finally {
      delete (database as unknown as { runTransaction?: unknown }).runTransaction;
    }
    expect((await fenceReference.get()).data())
      .toMatchObject({ active: true, phase: 'rollback', rollbackGroupCount: 0 });
    expect((await jobReference.get()).data()).toMatchObject({ phase: 'rollback' });
    const expiredAt = Date.now() - 1;
    await Promise.all([
      fenceReference.set({ leaseExpiresAt: expiredAt }, { merge: true }),
      jobReference.set({ leaseExpiresAt: Timestamp.fromMillis(expiredAt) }, { merge: true }),
    ]);

    await expect(rollbackLegacyLibraryMigration(database, OWNER_ID, jobId, sourceRevision))
      .rejects.toBeInstanceOf(LegacyLibraryRollbackConflictError);

    expect((await fenceReference.get()).exists).toBe(false);
    expect((await owner.collection('profile').doc('library_state').get()).data()?.libraryMigrationFenceActive)
      .toBeUndefined();
    expect((await jobReference.get()).data()).toMatchObject({ phase: 'complete' });
    expect((await canonical.get()).data()?.translation).toBe('learner edit after completion');
    await expect(database.runTransaction(transaction => (
      assertOwnerLibraryWriteAllowed(transaction, database, OWNER_ID)
    ))).resolves.toBeUndefined();
  });

  it('refuses a resumed rollback of a completed migration once the learner has added a card', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    const jobId = 'resumed-rollback-new-card-v3';
    const jobReference = owner.collection('admin_library_migration_jobs').doc(jobId);
    const fenceReference = owner.collection('profile').doc('library_migration_fence');
    const { sourceRevision } = await discoverToEnd(jobId);
    await applyLegacyLibraryMigration(database, OWNER_ID, { jobId, sourceRevision });
    // After completion the learner adds a word no migrated group covers; its
    // reservation, facet count and card count are written with it.
    await createCardForOwner(database, OWNER_ID, { word: 'banana', translation: 'chuối' });
    const snapshotLibrary = async () => ({
      cards: (await owner.collection('cards').orderBy('__name__').get()).docs
        .map(document => [document.id, document.data()]),
      facets: (await owner.collection('profile').doc('library_facets').get()).data(),
      resourceUsage: (await owner.collection('profile').doc('resource_usage').get()).data(),
    });
    const libraryBefore = await snapshotLibrary();
    expect(libraryBefore.cards.map(([id]) => id)).toContain('word-banana');

    // The first rollback commits its fence and then its runner dies.
    const runTransaction = database.runTransaction.bind(database);
    let transactions = 0;
    (database as unknown as { runTransaction: unknown }).runTransaction = async (...args: unknown[]) => {
      transactions += 1;
      if (transactions > 1) throw new Error('runner stopped after the fence commit');
      return (runTransaction as (...values: unknown[]) => Promise<unknown>)(...args);
    };
    try {
      await expect(rollbackLegacyLibraryMigration(database, OWNER_ID, jobId, sourceRevision))
        .rejects.toThrow('runner stopped after the fence commit');
    } finally {
      delete (database as unknown as { runTransaction?: unknown }).runTransaction;
    }
    expect((await jobReference.get()).data()).toMatchObject({ phase: 'rollback' });
    const expiredAt = Date.now() - 1;
    await Promise.all([
      fenceReference.set({ leaseExpiresAt: expiredAt }, { merge: true }),
      jobReference.set({ leaseExpiresAt: Timestamp.fromMillis(expiredAt) }, { merge: true }),
    ]);

    await expect(rollbackLegacyLibraryMigration(database, OWNER_ID, jobId, sourceRevision))
      .rejects.toBeInstanceOf(LegacyLibraryRollbackConflictError);

    expect(await snapshotLibrary()).toEqual(libraryBefore);
    expect((await fenceReference.get()).exists).toBe(false);
    expect((await jobReference.get()).data()).toMatchObject({ phase: 'complete' });
  });

  it('refuses a rollback that read the backup before the migration completed once the learner has added a card', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    const jobId = 'rollback-read-before-completion-v3';
    const jobReference = owner.collection('admin_library_migration_jobs').doc(jobId);
    const fenceReference = owner.collection('profile').doc('library_migration_fence');
    const rootReference = owner.collection('admin_library_migration_backups').doc(jobId);
    const { sourceRevision } = await discoverToEnd(jobId);
    await applyLegacyLibraryMigration(database, OWNER_ID, { jobId, sourceRevision });
    // The rollback read the backup root while the apply was still sealing it,
    // so what it read says the migration had not completed yet.
    const { complete: _complete, finalAggregateDigest: _digest, finalCardCount: _count, ...unsealed } =
      (await rootReference.get()).data() ?? {};
    // Then the apply completed and the learner added a word no migrated group covers.
    await createCardForOwner(database, OWNER_ID, { word: 'banana', translation: 'chuối' });
    const snapshotLibrary = async () => ({
      cards: (await owner.collection('cards').orderBy('__name__').get()).docs
        .map(document => [document.id, document.data()]),
      facets: (await owner.collection('profile').doc('library_facets').get()).data(),
      resourceUsage: (await owner.collection('profile').doc('resource_usage').get()).data(),
    });
    const libraryBefore = await snapshotLibrary();

    const prototype = DocumentReference.prototype as unknown as { get: (...args: unknown[]) => Promise<unknown> };
    const get = prototype.get;
    let staleReads = 0;
    prototype.get = function (this: DocumentReference, ...args: unknown[]) {
      if (this.path === rootReference.path && staleReads === 0) {
        staleReads += 1;
        return Promise.resolve({ exists: true, id: this.id, ref: this, data: () => ({ ...unsealed, complete: false }) });
      }
      return get.apply(this, args);
    };
    try {
      await expect(rollbackLegacyLibraryMigration(database, OWNER_ID, jobId, sourceRevision))
        .rejects.toBeInstanceOf(LegacyLibraryRollbackConflictError);
    } finally {
      prototype.get = get;
    }

    expect(staleReads).toBe(1);
    expect(await snapshotLibrary()).toEqual(libraryBefore);
    expect((await fenceReference.get()).exists).toBe(false);
    expect((await jobReference.get()).data()).toMatchObject({ phase: 'complete' });
  });

  it('rejects a concurrent discovery lease before reading a page', async () => {
    const store = createFirestoreLegacyLibraryDiscoveryStore(database);
    await store.acquireDiscoveryLease(OWNER_ID, {
      jobId: 'lease-test', scanId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', leaseOwner: 'holder-a',
    });
    await expect(store.acquireDiscoveryLease(OWNER_ID, {
      jobId: 'lease-test', scanId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', leaseOwner: 'holder-b',
    })).rejects.toBeInstanceOf(LegacyLibraryDiscoveryLeaseError);
  });

  it('retries the same committed page idempotently without duplicating manifest sources', async () => {
    const store = createFirestoreLegacyLibraryDiscoveryStore(database);
    const commit = store.commitDiscoveryPage.bind(store);
    let loseResponse = true;
    store.commitDiscoveryPage = async (ownerId, request) => {
      const committed = await commit(ownerId, request);
      if (loseResponse) {
        loseResponse = false;
        throw new Error('simulated network loss after commit');
      }
      return committed;
    };

    await expect(runLegacyLibraryDiscovery(store, OWNER_ID, {
      jobId: 'idempotent-v3', batchSize: 2,
    })).rejects.toThrow('simulated network loss after commit');
    await expect(runLegacyLibraryDiscovery(store, OWNER_ID, {
      jobId: 'idempotent-v3', batchSize: 2,
    })).resolves.toMatchObject({ phase: 'discovered', complete: false, scanned: 1 });

    const owner = database.collection('users').doc(OWNER_ID);
    expect((await owner.collection('admin_library_migration_jobs').doc('idempotent-v3').get()).data())
      .toMatchObject({ phase: 'discovered', scanned: 3, sourceCount: 3 });
    const groups = await owner.collection('admin_library_migration_jobs').doc('idempotent-v3')
      .collection('groups').get();
    const sourceIds = groups.docs.flatMap(document => (
      (document.data().sources as Array<{ id: string }>).map(source => source.id)
    ));
    expect(sourceIds).toHaveLength(3);
    expect(new Set(sourceIds).size).toBe(3);
  });

  it('blocks the trusted job when the library epoch changes between discovery pages', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    const store = createFirestoreLegacyLibraryDiscoveryStore(database);
    await expect(runLegacyLibraryDiscovery(store, OWNER_ID, {
      jobId: 'epoch-v3', batchSize: 2,
    })).resolves.toMatchObject({ complete: false, invalid: 0 });
    await owner.collection('profile').doc('library_state').set({ libraryEpoch: 3 }, { merge: true });

    await expect(runLegacyLibraryDiscovery(store, OWNER_ID, {
      jobId: 'epoch-v3', batchSize: 2,
    })).resolves.toMatchObject({ complete: false, phase: 'blocked', invalid: 1, migrated: 0 });
    expect((await owner.collection('admin_library_migration_jobs').doc('epoch-v3').get()).data())
      .toMatchObject({ phase: 'blocked', blockedReason: 'library-epoch-changed' });
    expect((await owner.collection('cards').get()).size).toBe(3);
    expect((await owner.collection('card_reservations').get()).empty).toBe(true);
  });

  it('discovers and applies a word whose cards are pages apart', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    const jobId = 'pages-apart-v3';
    const store = createFirestoreLegacyLibraryDiscoveryStore(database);
    // Card ids order the scan: the two "quite" cards come first, then "Migrate",
    // then a third "quite" two pages after the group was last written.
    await owner.collection('cards').doc('legacy-zz-quite').set({ id: 'legacy-zz-quite', word: 'QUITE', translation: 'khá' });
    let discovery = await runLegacyLibraryDiscovery(store, OWNER_ID, { jobId, batchSize: 1 });
    for (let page = 1; discovery.phase === 'discover' && page < 10; page += 1) {
      discovery = await runLegacyLibraryDiscovery(store, OWNER_ID, { jobId, batchSize: 1 });
    }

    expect(discovery).toMatchObject({ phase: 'discovered', sourceCount: 4, groupCount: 2 });
    const job = (await owner.collection('admin_library_migration_jobs').doc(jobId).get()).data() ?? {};
    await expect(applyLegacyLibraryMigration(database, OWNER_ID, { jobId, sourceRevision: String(job.sourceRevision) }))
      .resolves.toMatchObject({ complete: true, groupCount: 2 });
    expect((await owner.collection('cards').get()).size).toBe(2);
  });

});
