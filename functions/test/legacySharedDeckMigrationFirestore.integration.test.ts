import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { FieldPath, getFirestore, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { purgeAccountData } from '../src/accountData.js';
import { parseCreateSharedDeckRequest } from '../src/inputValidation.js';
import { createFirestoreLegacySharedDeckInventoryStore } from '../src/legacySharedDeckInventoryFirestore.js';
import {
  applyLegacySharedDeckMigration,
  canonicalLegacySharedDeckBackupManifest,
  createFrozenLegacySharedDeckInventory,
  digestCanonicalValue,
  LegacySharedDeckApplyError,
  readSealedLegacySharedDeckInventory,
  supersedeLegacySharedDeckMigration,
  SUPERSEDE_SHARED_DECK_CONFIRMATION,
  verifyLegacySharedDeckCutover,
  type LegacySharedDeckInventory,
} from '../src/legacySharedDeckMigration.js';
import {
  runLegacySharedDeckApplyOperator,
  runLegacySharedDeckVerification,
} from '../src/legacySharedDeckMigrationOperator.js';
import {
  buildSharedDeckDocuments,
  createSharedDeckAtomically,
  revokeSharedDeckAtomically,
  SharedDeckMigrationRequiredError,
} from '../src/sharedDeckPersistence.js';

const describeWithEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const PROJECT_ID = 'demo-lingoflash';
const DAY_MS = 24 * 60 * 60 * 1_000;
const ownerUid = 'canonical-owner';
const sealingRevision = 'a'.repeat(40);
const laterRevision = 'b'.repeat(40);
const { privateKey: backupSigningKey, publicKey: backupVerificationKey } = generateKeyPairSync('ed25519');

const legacyCard = {
  word: 'hello', translation: 'xin chào', explanation: '', explanationTranslation: '', phonetic: '',
  category: '', partOfSpeech: '', cefrLevel: '', exampleSentence: '', exampleTranslation: '',
  collocations: [], synonyms: [], antonyms: [], register: '', commonMistake: '', imageSearchQuery: '',
  emoji: '', audioUrl: null, imageUrl: null,
};
const legacyShareData = { category: 'Basics', cards: [legacyCard], createdAt: '2023-11-14T22:13:20.000Z' };

const signedBackupManifest = (inventory: LegacySharedDeckInventory) => {
  const unsigned = {
    schemaVersion: 2 as const,
    backupObjectId: 'gs://verified-backup/owner-a/manifest.json',
    backupGeneration: '1700000000000000',
    backupDigest: 'd'.repeat(64),
    inventoryDigest: inventory.inventoryDigest,
    target: inventory.target,
    revision: inventory.revision,
    ownerUid,
    verifiedAt: new Date().toISOString(),
  };
  return {
    ...unsigned,
    signature: sign(null, canonicalLegacySharedDeckBackupManifest(unsigned), backupSigningKey).toString('base64'),
  };
};

const preparedIndexes = (target: string, revision: string) => {
  const report = {
    schemaVersion: 1 as const,
    indexDigest: 'e'.repeat(64),
    target,
    revision,
    active: true as const,
    completedAt: new Date(Date.now() - 1_000).toISOString(),
    operationIds: ['operations/1'],
  };
  return { workflowRunId: '123', reportSha256: digestCanonicalValue(report), report };
};

const applyOptions = (inventory: LegacySharedDeckInventory) => ({
  ownerUid,
  revision: inventory.revision,
  target: inventory.target,
  confirmation: 'APPLY_SHARED_DECK_V2',
  backupManifest: signedBackupManifest(inventory),
  backupPublicKey: backupVerificationKey,
  indexPreparation: preparedIndexes(inventory.target, inventory.revision),
});

/** Lets the first transactions commit, then fails like an apply job that was cancelled or timed out. */
const stoppingAfterTransactions = (database: Firestore, allowed: number): Firestore => {
  let count = 0;
  return new Proxy(database, {
    get(source, property) {
      if (property === 'runTransaction') {
        return (...parameters: Parameters<Firestore['runTransaction']>) => {
          count += 1;
          if (count > allowed) return Promise.reject(new Error('apply job stopped'));
          return source.runTransaction(...parameters);
        };
      }
      const value = Reflect.get(source, property, source) as unknown;
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(source) : value;
    },
  });
};

/** Runs `before` ahead of the numbered transaction, like activity that lands while a job is running. */
const beforeTransaction = (database: Firestore, number: number, before: () => Promise<void>): Firestore => {
  let count = 0;
  return new Proxy(database, {
    get(source, property) {
      if (property === 'runTransaction') {
        return async (...parameters: Parameters<Firestore['runTransaction']>) => {
          count += 1;
          if (count === number) await before();
          return source.runTransaction(...parameters);
        };
      }
      const value = Reflect.get(source, property, source) as unknown;
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(source) : value;
    },
  });
};

describeWithEmulator('Firestore legacy shared-deck migration', () => {
  let app: App;
  let database: Firestore;
  let target: string;
  const databases: Firestore[] = [];

  const stateDocument = () => database.collection('admin_shared_deck_migration_jobs').doc('shared_deck_v2');
  const usageDocument = () => database.collection('users').doc(ownerUid).collection('profile').doc('shared_deck_usage');
  const publicShare = (shareId: string) => database.collection('shared_decks').doc(shareId);
  const privateShare = (shareId: string) => database.collection('shared_deck_owners').doc(shareId);
  const state = async () => (await stateDocument().get()).data();
  const usage = async () => (await usageDocument().get()).data();

  const seedLegacyShares = (...shareIds: string[]) => Promise.all(
    shareIds.map(shareId => publicShare(shareId).set(legacyShareData)),
  );
  const share = async (learner: string, shareId: string, now = Timestamp.now(), card: Record<string, unknown> = {}) => {
    const documents = buildSharedDeckDocuments(
      parseCreateSharedDeckRequest({ category: 'Basics', cards: [{ word: 'hello', translation: 'xin chào', ...card }] }),
      learner,
      now,
      Timestamp.fromMillis(now.toMillis() + 30 * DAY_MS),
    );
    await createSharedDeckAtomically(database, publicShare(shareId), privateShare(shareId), documents, { now });
    return documents;
  };
  const removeAsExpired = (shareId: string) => Promise.all([publicShare(shareId).delete(), privateShare(shareId).delete()]);
  const longAgo = () => Timestamp.fromMillis(Date.now() - 40 * DAY_MS);
  /** A share from the owner whose thirty days ran out before the scan; the TTL policy has not removed it yet. */
  const expiredShare = (shareId: string) => share(ownerUid, shareId, longAgo());
  /** An owner-free legacy share whose first-generation owner record has already expired. */
  const seedExpiredLegacyShare = async (shareId: string) => {
    await publicShare(shareId).set(legacyShareData);
    await privateShare(shareId).set({
      ownerUid,
      createdAt: Timestamp.fromMillis(Date.parse(legacyShareData.createdAt)),
      expiresAt: Timestamp.fromMillis(Date.now() - 10 * DAY_MS),
      schemaVersion: 1,
    });
  };
  const quarantineCopy = (shareId: string) => database.collection('admin_shared_deck_migration_quarantine').doc(shareId);
  const seal = (revision: string, scanStartedAt = new Date().toISOString()) => createFrozenLegacySharedDeckInventory({
    store: createFirestoreLegacySharedDeckInventoryStore(database),
    ownerUid,
    runId: revision,
    revision,
    target,
    scanStartedAt,
  });
  const cutOver = async (scanStartedAt?: string) => {
    await seedLegacyShares('legacy-a', 'legacy-b', 'legacy-c');
    const inventory = await seal(sealingRevision, scanStartedAt);
    await applyLegacySharedDeckMigration(database, inventory, applyOptions(inventory));
    await expect(verifyLegacySharedDeckCutover(database, inventory)).resolves.toMatchObject({ verified: true });
    return inventory;
  };
  const applyOperator = (inventoryRevision: string, releaseRevision: string, backup: LegacySharedDeckInventory) => {
    const indexes = preparedIndexes(target, releaseRevision);
    return runLegacySharedDeckApplyOperator({
      ownerUid,
      revision: releaseRevision,
      sourceRevision: inventoryRevision === releaseRevision ? '' : inventoryRevision,
      target,
      applyConfirmation: 'APPLY_SHARED_DECK_V2',
      backupManifest: JSON.stringify(signedBackupManifest(backup)),
      backupPublicKey: backupVerificationKey.export({ type: 'spki', format: 'pem' }).toString(),
      indexPreparationRunId: '123',
      indexPreparationReportSha256: indexes.reportSha256,
      indexPreparationReport: JSON.stringify(indexes.report),
    }, {
      read: expected => readSealedLegacySharedDeckInventory(database, expected),
      apply: (inventory, options) => applyLegacySharedDeckMigration(database, inventory, options),
      verify: inventory => verifyLegacySharedDeckCutover(database, inventory),
    });
  };

  beforeAll(() => {
    app = initializeApp({ projectId: PROJECT_ID }, 'legacy-shared-deck-migration-integration');
  });

  // The migration state is one document per database and fences every share
  // write in it, so each case runs in a database of its own.
  beforeEach(() => {
    const databaseId = `share-migration-${randomUUID()}`;
    database = getFirestore(app, databaseId);
    databases.push(database);
    target = `${PROJECT_ID}/${databaseId}`;
  });

  afterAll(async () => {
    await Promise.all(databases.map(used => used.terminate()));
    await deleteApp(app);
  });

  describe('apply with an owner ledger that already exists', () => {
    it('completes when the share callable created the ledger before the inventory', async () => {
      await seedLegacyShares('legacy-a', 'legacy-b');
      const current = await share(ownerUid, 'current-share');
      expect(Object.keys((await usage())!.shares as object)).toEqual(['current-share']);

      const inventory = await seal(sealingRevision);
      expect(inventory.applyEligible).toBe(true);
      const report = await applyLegacySharedDeckMigration(database, inventory, applyOptions(inventory));
      await expect(verifyLegacySharedDeckCutover(database, inventory))
        .resolves.toEqual({ verified: true, validLegacyPublicCount: 0, activeLedgerCount: 3 });

      expect(await state()).toMatchObject({ phase: 'verified', ledgerReady: true });
      const ledger = await usage();
      expect(ledger).toEqual(report.ledger);
      expect(Object.keys(ledger!.shares as object).sort()).toEqual(['current-share', 'legacy-a', 'legacy-b']);
      expect(ledger!.shares).toMatchObject({
        'current-share': { payloadBytes: current.ownership.payloadBytes, expiresAt: current.ownership.expiresAt },
      });
      // The rebuilt ledger is the one the share callables keep working from.
      await expect(revokeSharedDeckAtomically(database, publicShare('legacy-a'), privateShare('legacy-a'), ownerUid))
        .resolves.toBe(true);
      await expect(share('another-learner', 'after-cutover')).resolves.toBeDefined();
    }, 30_000);

    it('drops a ledger entry whose share expired and was removed before the scan', async () => {
      await share(ownerUid, 'expired-share', Timestamp.fromMillis(Date.now() - 40 * DAY_MS));
      await removeAsExpired('expired-share');
      await seedLegacyShares('legacy-a');

      const inventory = await seal(sealingRevision);
      await applyLegacySharedDeckMigration(database, inventory, applyOptions(inventory));
      await expect(verifyLegacySharedDeckCutover(database, inventory)).resolves.toMatchObject({ verified: true });

      expect(await state()).toMatchObject({ phase: 'verified', ledgerReady: true });
      expect(await usage()).toMatchObject({ activeCount: 1, shares: { 'legacy-a': {} } });
      expect(Object.keys((await usage())!.shares as object)).toEqual(['legacy-a']);
    }, 30_000);

    it('completes when the owner shared between the stamped scan time and the freeze', async () => {
      await seedLegacyShares('legacy-a');
      const sharedAt = Timestamp.now();
      await share(ownerUid, 'current-share', sharedAt);
      // The workflow stamps the scan time some seconds before the freeze closes sharing.
      const scanStartedAt = new Date(sharedAt.toMillis() - 5_000).toISOString();
      const sealedExpiry = Timestamp.fromMillis(Date.parse(scanStartedAt) + 30 * DAY_MS);

      const inventory = await seal(sealingRevision, scanStartedAt);
      expect(inventory.applyEligible).toBe(true);
      await applyLegacySharedDeckMigration(database, inventory, applyOptions(inventory));
      await expect(verifyLegacySharedDeckCutover(database, inventory))
        .resolves.toEqual({ verified: true, validLegacyPublicCount: 0, activeLedgerCount: 2 });

      // A migrated share keeps at most thirty days from the scan, and its ledger entry follows it.
      expect((await usage())!.shares).toMatchObject({ 'current-share': { expiresAt: sealedExpiry } });
      expect((await publicShare('current-share').get()).data()).toMatchObject({ expiresAt: sealedExpiry });
      expect((await privateShare('current-share').get()).data()).toMatchObject({ expiresAt: sealedExpiry });
      await expect(revokeSharedDeckAtomically(database, publicShare('current-share'), privateShare('current-share'), ownerUid))
        .resolves.toBe(true);
    }, 30_000);

    it('completes when the TTL policy had removed only the owner record of an expired share', async () => {
      await expiredShare('half-removed');
      await privateShare('half-removed').delete();
      await seedLegacyShares('legacy-a');

      const inventory = await seal(sealingRevision);
      expect(inventory.applyEligible).toBe(true);
      await applyLegacySharedDeckMigration(database, inventory, applyOptions(inventory));
      await expect(verifyLegacySharedDeckCutover(database, inventory))
        .resolves.toEqual({ verified: true, validLegacyPublicCount: 0, activeLedgerCount: 1 });

      // The remaining half is not rewritten and gets no owner record back: the policy removes it.
      expect((await privateShare('half-removed').get()).exists).toBe(false);
      expect(Object.keys((await usage())!.shares as object)).toEqual(['legacy-a']);
      await expect(share('another-learner', 'after-cutover')).resolves.toBeDefined();
    }, 30_000);

    it('still stops when a ledger entry carries another expiry than its share', async () => {
      await seedLegacyShares('legacy-a');
      const current = await share(ownerUid, 'current-share');
      await usageDocument().update(
        new FieldPath('shares', 'current-share', 'expiresAt'),
        Timestamp.fromMillis((current.ownership.expiresAt as Timestamp).toMillis() - DAY_MS),
      );

      const inventory = await seal(sealingRevision);
      await expect(applyLegacySharedDeckMigration(database, inventory, applyOptions(inventory)))
        .rejects.toThrow('Existing shared-deck ledger does not match inventory.');
      expect(await state()).toMatchObject({ phase: 'sealed' });
    }, 30_000);

    it('still stops before any write when the ledger counts a live share the inventory does not hold', async () => {
      await share(ownerUid, 'vanished-share');
      await removeAsExpired('vanished-share');
      await seedLegacyShares('legacy-a');

      const inventory = await seal(sealingRevision);
      await expect(applyLegacySharedDeckMigration(database, inventory, applyOptions(inventory)))
        .rejects.toThrow('Existing shared-deck ledger does not match inventory.');

      expect(await state()).toMatchObject({ phase: 'sealed' });
      expect((await publicShare('legacy-a').get()).data()).toEqual(legacyShareData);
      expect(Object.keys((await usage())!.shares as object)).toEqual(['vanished-share']);
    }, 30_000);
  });

  describe('verification of a migration that is already verified', () => {
    it('passes after learners shared, the owner revoked and expired shares were removed', async () => {
      // Migrated shares keep at most thirty days from the scan, so this cutover's shares have expired.
      const inventory = await cutOver(new Date(Date.now() - 31 * DAY_MS).toISOString());
      await share('another-learner', 'after-cutover');
      await share(ownerUid, 'owner-after-cutover');
      await removeAsExpired('legacy-a');
      await publicShare('legacy-b').delete();
      const before = await state();

      await expect(verifyLegacySharedDeckCutover(database, inventory))
        .resolves.toEqual({ verified: true, validLegacyPublicCount: 0, activeLedgerCount: 1 });

      expect(await state()).toEqual(before);
      await expect(share('third-learner', 'later-share')).resolves.toBeDefined();
    }, 30_000);

    it('passes after the owner revoked a migrated share that had not expired', async () => {
      const inventory = await cutOver();
      await expect(revokeSharedDeckAtomically(database, publicShare('legacy-a'), privateShare('legacy-a'), ownerUid))
        .resolves.toBe(true);
      await share('another-learner', 'after-cutover');

      await expect(verifyLegacySharedDeckCutover(database, inventory))
        .resolves.toEqual({ verified: true, validLegacyPublicCount: 0, activeLedgerCount: 2 });
    }, 30_000);

    it('reports a legacy-shaped share written after the cutover without closing sharing', async () => {
      const inventory = await cutOver();
      await share('another-learner', 'after-cutover');
      await publicShare('late-legacy').set(legacyShareData);
      const before = await state();

      await expect(verifyLegacySharedDeckCutover(database, inventory)).rejects.toBeInstanceOf(LegacySharedDeckApplyError);

      expect(await state()).toEqual(before);
      expect(before).toMatchObject({ phase: 'verified', verificationProgress: { active: false } });
      await expect(share('third-learner', 'later-share')).resolves.toBeDefined();
    }, 30_000);

    it('reports a live migrated share that lost one side', async () => {
      const inventory = await cutOver();
      await privateShare('legacy-b').delete();

      await expect(verifyLegacySharedDeckCutover(database, inventory)).rejects.toBeInstanceOf(LegacySharedDeckApplyError);
      await expect(share('another-learner', 'after-cutover')).resolves.toBeDefined();
    }, 30_000);

    it('does not treat a share that expired while the run was reading as live', async () => {
      // The migrated shares run out a few seconds after the cutover.
      const inventory = await cutOver(new Date(Date.now() - 30 * DAY_MS + 8_000).toISOString());
      const expiry = Date.parse(inventory.scanStartedAt) + 30 * DAY_MS;
      expect(Date.now()).toBeLessThan(expiry - 500);
      // The run has started; before its first page the shares expire and the owner's next share drops them from the ledger.
      const reading = beforeTransaction(database, 2, async () => {
        await new Promise(resolve => { setTimeout(resolve, Math.max(0, expiry - Date.now()) + 100); });
        await share(ownerUid, 'owner-later');
      });

      await expect(verifyLegacySharedDeckCutover(reading, inventory))
        .resolves.toEqual({ verified: true, validLegacyPublicCount: 0, activeLedgerCount: 1 });
      expect(Object.keys((await usage())!.shares as object)).toEqual(['owner-later']);
    }, 40_000);

    it('reports an expired migrated share whose remaining side is not in the migrated form', async () => {
      const inventory = await cutOver(new Date(Date.now() - 31 * DAY_MS).toISOString());
      const migrated = (await publicShare('legacy-b').get()).data()!;
      await privateShare('legacy-b').delete();
      await publicShare('legacy-b').set({
        authorUid: ownerUid,
        category: migrated.category,
        cards: migrated.cards,
        createdAt: migrated.createdAt,
        expiresAt: migrated.expiresAt,
        schemaVersion: 1,
      });

      await expect(verifyLegacySharedDeckCutover(database, inventory)).rejects.toBeInstanceOf(LegacySharedDeckApplyError);
      await expect(share('another-learner', 'after-cutover')).resolves.toBeDefined();
    }, 30_000);

    it('reports an expired one-sided record outside the inventory that is not a current-format share', async () => {
      const inventory = await cutOver();
      await publicShare('stray-share').set({
        authorUid: 'another-learner',
        category: 'Basics',
        cards: [],
        createdAt: longAgo(),
        expiresAt: Timestamp.fromMillis(Date.now() - DAY_MS),
        schemaVersion: 2,
      });

      await expect(verifyLegacySharedDeckCutover(database, inventory)).rejects.toBeInstanceOf(LegacySharedDeckApplyError);
    }, 30_000);

    it('accepts a learner share whose text the length limit cut right after a space', async () => {
      const inventory = await cutOver();
      const documents = await share('another-learner', 'cut-at-a-space', Timestamp.now(), {
        imageSearchQuery: `${'a'.repeat(119)} b`,
      });
      expect((documents.sharedDeck.cards as { imageSearchQuery: string }[])[0]!.imageSearchQuery).toBe(`${'a'.repeat(119)} `);

      await expect(verifyLegacySharedDeckCutover(database, inventory)).resolves.toMatchObject({ verified: true });
    }, 30_000);

    it('passes after the migrated owner deleted their account', async () => {
      // An empty legacy share is copied to quarantine, which account deletion clears with the owner's data.
      await publicShare('empty-share').set({ category: 'Basics', cards: [], createdAt: legacyShareData.createdAt });
      const inventory = await cutOver();
      expect((await quarantineCopy('empty-share').get()).data()).toMatchObject({ ownerUid, shareId: 'empty-share' });
      for (const shareId of ['legacy-a', 'legacy-b', 'legacy-c']) {
        await revokeSharedDeckAtomically(database, publicShare(shareId), privateShare(shareId), ownerUid);
      }
      await purgeAccountData(database, ownerUid, 'owner-pid', null);
      expect((await usageDocument().get()).exists).toBe(false);
      expect((await quarantineCopy('empty-share').get()).exists).toBe(false);
      await share('another-learner', 'after-cutover');
      const before = await state();

      await expect(verifyLegacySharedDeckCutover(database, inventory))
        .resolves.toEqual({ verified: true, validLegacyPublicCount: 0, activeLedgerCount: 0 });
      expect(await state()).toEqual(before);
    }, 30_000);

    it('reports a live migrated share that is still there when the owner ledger is gone', async () => {
      const inventory = await cutOver();
      await usageDocument().delete();

      await expect(verifyLegacySharedDeckCutover(database, inventory)).rejects.toBeInstanceOf(LegacySharedDeckApplyError);
    }, 30_000);

    it('reports a missing quarantine copy while the owner account still exists', async () => {
      await publicShare('empty-share').set({ category: 'Basics', cards: [], createdAt: legacyShareData.createdAt });
      const inventory = await cutOver();
      await quarantineCopy('empty-share').delete();

      await expect(verifyLegacySharedDeckCutover(database, inventory)).rejects.toBeInstanceOf(LegacySharedDeckApplyError);
    }, 30_000);

    it('issues the report again for the revision that sealed the migration, after learners used sharing', async () => {
      const inventory = await cutOver();
      await share('another-learner', 'after-cutover');
      await revokeSharedDeckAtomically(database, publicShare('legacy-a'), privateShare('legacy-a'), ownerUid);
      // Apply cannot finish from here: the ledger no longer equals the sealed one.
      await expect(applyOperator(sealingRevision, sealingRevision, inventory)).rejects.toBeInstanceOf(LegacySharedDeckApplyError);

      const report = JSON.parse(await runLegacySharedDeckVerification(
        { ownerUid, revision: sealingRevision, sourceRevision: sealingRevision, target },
        expected => readSealedLegacySharedDeckInventory(database, expected),
        sealed => verifyLegacySharedDeckCutover(database, sealed),
      )) as Record<string, unknown>;

      expect(report).toMatchObject({ revision: sealingRevision, migrationRevision: sealingRevision, verified: true });
    }, 30_000);

    it('releases the fence that an interrupted verification run left on a verified migration', async () => {
      const inventory = await cutOver();
      await share('another-learner', 'after-cutover');
      await stateDocument().update({
        verificationProgress: {
          active: true, publicCursor: null, privateCursor: null, publicTerminal: false, privateTerminal: false,
          sealedCursor: 0, validLegacyPublicCount: 0,
        },
      });
      await expect(share('third-learner', 'while-fenced')).rejects.toBeInstanceOf(SharedDeckMigrationRequiredError);

      await expect(verifyLegacySharedDeckCutover(database, inventory)).resolves.toMatchObject({ verified: true });

      expect(await state()).toMatchObject({ phase: 'verified', verificationProgress: { active: false } });
      await expect(share('third-learner', 'later-share')).resolves.toBeDefined();
    }, 30_000);
  });

  describe('a migration that stopped after the default branch moved on', () => {
    it('resumes from the later revision and reaches verified', async () => {
      await seedLegacyShares('legacy-a', 'legacy-b');
      const inventory = await seal(sealingRevision);
      // Ledger preflight, two source checks, the sealed -> applying step and the first source commit.
      await expect(applyLegacySharedDeckMigration(stoppingAfterTransactions(database, 5), inventory, applyOptions(inventory)))
        .rejects.toThrow('apply job stopped');
      expect(await state()).toMatchObject({ phase: 'applying', revision: sealingRevision, progress: { nextEntry: 1 } });
      await expect(share('another-learner', 'while-fenced')).rejects.toBeInstanceOf(SharedDeckMigrationRequiredError);

      const report = JSON.parse(await applyOperator(sealingRevision, laterRevision, inventory)) as Record<string, unknown>;

      expect(report).toMatchObject({
        revision: laterRevision, migrationRevision: sealingRevision, migratedCount: 2, verified: true,
      });
      expect(await state()).toMatchObject({
        phase: 'verified', revision: sealingRevision, ledgerReady: true, verificationProgress: { active: false },
      });
      expect(await usage()).toMatchObject({ activeCount: 2, shares: { 'legacy-a': {}, 'legacy-b': {} } });
      expect((await privateShare('legacy-b').get()).data()).toMatchObject({ ownerUid, schemaVersion: 2 });
      await expect(share('another-learner', 'after-cutover')).resolves.toBeDefined();
    }, 30_000);

    it('finishes after expired shares were removed while the apply was stopped', async () => {
      await seedLegacyShares('a-live', 'f-live');
      await expiredShare('b-expired-current');
      await publicShare('c-expired-transitional').set({
        authorUid: ownerUid,
        category: 'Basics',
        cards: [legacyCard],
        createdAt: longAgo(),
        expiresAt: Timestamp.fromMillis(Date.now() - 10 * DAY_MS),
        schemaVersion: 1,
      });
      await seedExpiredLegacyShare('d-expired-legacy');
      await privateShare('e-expired-orphan').set({
        ownerUid, createdAt: longAgo(), expiresAt: Timestamp.fromMillis(Date.now() - 10 * DAY_MS), schemaVersion: 1,
      });
      const inventory = await seal(sealingRevision);
      expect(inventory.applyEligible).toBe(true);
      expect(inventory.entries.map(entry => entry.shareId)).toEqual([
        'a-live', 'b-expired-current', 'c-expired-transitional', 'd-expired-legacy', 'e-expired-orphan', 'f-live',
      ]);
      // Ledger preflight, six source checks, the sealed -> applying step and the first source commit.
      await expect(applyLegacySharedDeckMigration(stoppingAfterTransactions(database, 9), inventory, applyOptions(inventory)))
        .rejects.toThrow('apply job stopped');
      expect(await state()).toMatchObject({ phase: 'applying', progress: { nextEntry: 1 } });

      // While the job waits for its next approval the TTL policy removes expired records, one document at a time.
      await removeAsExpired('b-expired-current');
      await publicShare('c-expired-transitional').delete();
      await privateShare('d-expired-legacy').delete();
      await privateShare('e-expired-orphan').delete();

      const report = JSON.parse(await applyOperator(sealingRevision, laterRevision, inventory)) as Record<string, unknown>;

      expect(report).toMatchObject({ revision: laterRevision, migrationRevision: sealingRevision, verified: true });
      expect(await state()).toMatchObject({ phase: 'verified', ledgerReady: true, verificationProgress: { active: false } });
      expect(Object.keys((await usage())!.shares as object).sort()).toEqual(['a-live', 'f-live']);
      // The legacy record that outlived its owner record is still rewritten, so the TTL policy can remove it.
      expect((await publicShare('d-expired-legacy').get()).data()).toMatchObject({ schemaVersion: 2 });
      expect((await privateShare('d-expired-legacy').get()).data()).toMatchObject({ ownerUid, schemaVersion: 2 });
      expect((await publicShare('b-expired-current').get()).exists).toBe(false);
      expect((await quarantineCopy('e-expired-orphan').get()).exists).toBe(false);
      await expect(share('another-learner', 'after-cutover')).resolves.toBeDefined();
    }, 30_000);

    it('verifies after expired shares were removed between the apply and its verification', async () => {
      await seedLegacyShares('a-live');
      await expiredShare('b-expired-current');
      await seedExpiredLegacyShare('d-expired-legacy');
      await privateShare('e-expired-orphan').set({
        ownerUid, createdAt: longAgo(), expiresAt: Timestamp.fromMillis(Date.now() - 10 * DAY_MS), schemaVersion: 1,
      });
      const inventory = await seal(sealingRevision);
      await applyLegacySharedDeckMigration(database, inventory, applyOptions(inventory));
      expect(await state()).toMatchObject({ phase: 'applied' });
      await expect(share('another-learner', 'while-fenced')).rejects.toBeInstanceOf(SharedDeckMigrationRequiredError);
      expect((await quarantineCopy('e-expired-orphan').get()).data()).toMatchObject({ reasonCode: 'orphan-private' });

      await removeAsExpired('b-expired-current');
      await privateShare('d-expired-legacy').delete();
      await privateShare('e-expired-orphan').delete();

      const report = JSON.parse(await applyOperator(sealingRevision, laterRevision, inventory)) as Record<string, unknown>;

      expect(report).toMatchObject({ revision: laterRevision, migrationRevision: sealingRevision, verified: true });
      expect(await state()).toMatchObject({ phase: 'verified', verificationProgress: { active: false } });
      expect((await quarantineCopy('e-expired-orphan').get()).exists).toBe(true);
      await expect(share('another-learner', 'after-cutover')).resolves.toBeDefined();
    }, 30_000);

    it('finishes after an expired quarantined record was removed while the apply was stopped', async () => {
      await seedLegacyShares('a-live');
      await publicShare('b-empty-expired').set({
        category: 'Basics', cards: [], createdAt: longAgo(), expiresAt: Timestamp.fromMillis(Date.now() - 10 * DAY_MS),
      });
      const inventory = await seal(sealingRevision);
      expect(inventory.entries.find(entry => entry.shareId === 'b-empty-expired')).toMatchObject({ action: 'quarantine' });
      await expect(applyLegacySharedDeckMigration(stoppingAfterTransactions(database, 5), inventory, applyOptions(inventory)))
        .rejects.toThrow('apply job stopped');
      expect(await state()).toMatchObject({ phase: 'applying', progress: { nextEntry: 1 } });
      await publicShare('b-empty-expired').delete();

      const report = JSON.parse(await applyOperator(sealingRevision, laterRevision, inventory)) as Record<string, unknown>;

      expect(report).toMatchObject({ revision: laterRevision, migrationRevision: sealingRevision, verified: true });
      expect((await quarantineCopy('b-empty-expired').get()).exists).toBe(false);
      await expect(share('another-learner', 'after-cutover')).resolves.toBeDefined();
    }, 30_000);

    it('removes the owner record of an expired share whose public record the TTL policy removed first', async () => {
      await seedLegacyShares('a-live');
      const createdAt = longAgo();
      const expiresAt = Timestamp.fromMillis(Date.now() - 10 * DAY_MS);
      await publicShare('c-expired-transitional').set({
        authorUid: ownerUid, category: 'Basics', cards: [legacyCard], createdAt, expiresAt, schemaVersion: 1,
      });
      await privateShare('c-expired-transitional').set({ ownerUid, createdAt, expiresAt, schemaVersion: 1 });
      const inventory = await seal(sealingRevision);
      expect(inventory.entries.find(entry => entry.shareId === 'c-expired-transitional'))
        .toMatchObject({ disposition: 'migrate-transitional' });
      await publicShare('c-expired-transitional').delete();

      await applyLegacySharedDeckMigration(database, inventory, applyOptions(inventory));
      await expect(verifyLegacySharedDeckCutover(database, inventory)).resolves.toMatchObject({ verified: true });

      // The first-generation owner record is not left for the cutover report or the owner to trip over.
      const report = JSON.parse(await runLegacySharedDeckVerification(
        { ownerUid, revision: sealingRevision, sourceRevision: sealingRevision, target },
        expected => readSealedLegacySharedDeckInventory(database, expected),
        sealed => verifyLegacySharedDeckCutover(database, sealed),
      )) as Record<string, unknown>;
      expect(report).toMatchObject({ verified: true });
      expect((await privateShare('c-expired-transitional').get()).exists).toBe(false);
      await expect(revokeSharedDeckAtomically(
        database, publicShare('c-expired-transitional'), privateShare('c-expired-transitional'), ownerUid,
      )).resolves.toBe(false);
    }, 30_000);

    it('still stops when a quarantined record that has no expiry disappears before it was copied', async () => {
      await seedLegacyShares('a-live');
      await publicShare('b-empty').set({ category: 'Basics', cards: [], createdAt: legacyShareData.createdAt });
      const inventory = await seal(sealingRevision);
      await expect(applyLegacySharedDeckMigration(stoppingAfterTransactions(database, 5), inventory, applyOptions(inventory)))
        .rejects.toThrow('apply job stopped');
      expect(await state()).toMatchObject({ phase: 'applying', progress: { nextEntry: 1 } });
      await publicShare('b-empty').delete();

      await expect(applyOperator(sealingRevision, laterRevision, inventory)).rejects.toThrow('Quarantined source changed for b-empty.');
    }, 30_000);

    it('still stops when a share that has not expired disappears while the apply is stopped', async () => {
      await seedLegacyShares('a-live', 'f-live');
      const inventory = await seal(sealingRevision);
      await expect(applyLegacySharedDeckMigration(stoppingAfterTransactions(database, 5), inventory, applyOptions(inventory)))
        .rejects.toThrow('apply job stopped');
      await publicShare('f-live').delete();

      await expect(applyOperator(sealingRevision, laterRevision, inventory)).rejects.toBeInstanceOf(LegacySharedDeckApplyError);
      expect(await state()).toMatchObject({ phase: 'applying', progress: { nextEntry: 1 } });
    }, 30_000);

    it('still stops verification when a migrated share that has not expired lost one side', async () => {
      await seedLegacyShares('a-live', 'f-live');
      const inventory = await seal(sealingRevision);
      await applyLegacySharedDeckMigration(database, inventory, applyOptions(inventory));
      await privateShare('f-live').delete();

      await expect(verifyLegacySharedDeckCutover(database, inventory)).rejects.toBeInstanceOf(LegacySharedDeckApplyError);
      expect(await state()).toMatchObject({ phase: 'applied' });
    }, 30_000);

    it('does not apply a sealed inventory that never started from a later revision', async () => {
      await seedLegacyShares('legacy-a');
      const inventory = await seal(sealingRevision);

      await expect(applyOperator(sealingRevision, laterRevision, inventory)).rejects.toBeInstanceOf(LegacySharedDeckApplyError);

      expect(await state()).toMatchObject({ phase: 'sealed', revision: sealingRevision });
      expect((await publicShare('legacy-a').get()).data()).toEqual(legacyShareData);
    }, 30_000);

    it('can be superseded and inventoried again when it stopped before writing any source', async () => {
      await seedLegacyShares('legacy-a', 'legacy-b');
      const inventory = await seal(sealingRevision);
      // Ledger preflight, two source checks and the sealed -> applying step.
      await expect(applyLegacySharedDeckMigration(stoppingAfterTransactions(database, 4), inventory, applyOptions(inventory)))
        .rejects.toThrow('apply job stopped');
      expect(await state()).toMatchObject({ phase: 'applying', progress: { nextEntry: 0 } });

      const superseded = await supersedeLegacySharedDeckMigration(database, {
        ownerUid,
        revision: sealingRevision,
        target,
        inventoryDigest: inventory.inventoryDigest,
        rootDigest: inventory.sealedManifest!.rootDigest,
        confirmation: SUPERSEDE_SHARED_DECK_CONFIRMATION,
      });

      expect(superseded.superseded).toBe(true);
      expect(await state()).toMatchObject({ phase: 'superseded', revision: sealingRevision });
      expect((await publicShare('legacy-a').get()).data()).toEqual(legacyShareData);
      expect((await privateShare('legacy-a').get()).exists).toBe(false);

      const fresh = await seal(laterRevision);
      const report = JSON.parse(await applyOperator(laterRevision, laterRevision, fresh)) as Record<string, unknown>;
      expect(report).toMatchObject({ revision: laterRevision, migrationRevision: laterRevision, verified: true });
      expect(await state()).toMatchObject({ phase: 'verified', revision: laterRevision });
    }, 30_000);

    it.each([
      ['frozen', 1],
      ['sealing', 2],
    ] as const)('is inventoried again from the later revision when the inventory stopped while %s', async (phase, allowed) => {
      await seedLegacyShares('legacy-a', 'legacy-b');
      // The freeze, then one transaction per sealed chunk, then the seal itself.
      await expect(createFrozenLegacySharedDeckInventory({
        store: createFirestoreLegacySharedDeckInventoryStore(stoppingAfterTransactions(database, allowed)),
        ownerUid,
        runId: sealingRevision,
        revision: sealingRevision,
        target,
        scanStartedAt: new Date().toISOString(),
      })).rejects.toThrow('apply job stopped');
      expect(await state()).toMatchObject({ phase, revision: sealingRevision });
      await expect(share('another-learner', 'while-fenced')).rejects.toBeInstanceOf(SharedDeckMigrationRequiredError);

      const fresh = await seal(laterRevision);
      expect(await state()).toMatchObject({ phase: 'sealed', revision: laterRevision });
      const report = JSON.parse(await applyOperator(laterRevision, laterRevision, fresh)) as Record<string, unknown>;

      expect(report).toMatchObject({ revision: laterRevision, migrationRevision: laterRevision, migratedCount: 2, verified: true });
      expect(await state()).toMatchObject({ phase: 'verified', revision: laterRevision });
      await expect(share('another-learner', 'after-cutover')).resolves.toBeDefined();
    }, 30_000);

    it('refuses to supersede once a source has been written', async () => {
      await seedLegacyShares('legacy-a', 'legacy-b');
      const inventory = await seal(sealingRevision);
      await expect(applyLegacySharedDeckMigration(stoppingAfterTransactions(database, 5), inventory, applyOptions(inventory)))
        .rejects.toThrow('apply job stopped');

      await expect(supersedeLegacySharedDeckMigration(database, {
        ownerUid,
        revision: sealingRevision,
        target,
        inventoryDigest: inventory.inventoryDigest,
        rootDigest: inventory.sealedManifest!.rootDigest,
        confirmation: SUPERSEDE_SHARED_DECK_CONFIRMATION,
      })).rejects.toBeInstanceOf(LegacySharedDeckApplyError);
      expect(await state()).toMatchObject({ phase: 'applying', progress: { nextEntry: 1 } });
    }, 30_000);
  });
});
