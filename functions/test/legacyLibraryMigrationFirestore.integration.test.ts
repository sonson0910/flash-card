import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { runLegacyLibraryDiscovery } from '../src/legacyLibraryMigration.js';
import {
  applyLegacyLibraryMigration,
  clearZeroProgressFence,
  createFirestoreLegacyLibraryDiscoveryStore,
  LegacyLibraryDiscoveryLeaseError,
  LegacyLibraryDiscoveryStateChangedError,
  LegacyLibraryRollbackConflictError,
  rollbackLegacyLibraryMigration,
} from '../src/legacyLibraryMigrationFirestore.js';

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

  it('clears an apply fence after a zero-progress preflight rejection', async () => {
    const owner = database.collection('users').doc(OWNER_ID);
    const store = createFirestoreLegacyLibraryDiscoveryStore(database);
    let discovery = await runLegacyLibraryDiscovery(store, OWNER_ID, {
      jobId: 'apply-preflight-failure-v3', batchSize: 2,
    });
    while (discovery.phase === 'discover') {
      discovery = await runLegacyLibraryDiscovery(store, OWNER_ID, {
        jobId: 'apply-preflight-failure-v3', batchSize: 2,
      });
    }
    const jobReference = owner.collection('admin_library_migration_jobs').doc('apply-preflight-failure-v3');
    const sourceRevision = String((await jobReference.get()).data()?.sourceRevision ?? '');
    await owner.collection('cards').doc('legacy-capital').set({
      id: 'legacy-capital', word: 'Migrate', translation: 'changed before apply',
    });

    await expect(applyLegacyLibraryMigration(database, OWNER_ID, {
      jobId: 'apply-preflight-failure-v3', sourceRevision,
    })).rejects.toBeInstanceOf(Error);

    expect((await owner.collection('profile').doc('library_migration_fence').get()).exists).toBe(false);
    expect((await jobReference.get()).data()).toMatchObject({
      phase: 'discovered', appliedGroupCount: 0, appliedSourceCount: 0,
    });
    expect((await owner.collection('cards').doc('legacy-capital').get()).data()?.translation)
      .toBe('changed before apply');
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

});
