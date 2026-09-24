import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { analyticsPseudonym } from '../src/analyticsEvents.js';
import { ACCOUNT_RATE_SCOPES, beginAccountDeletion, exportAccountData,
  finalizeDueDeletions, isAccountDeleting, resumeAccountDeletion } from '../src/accountData.js';
import { budgetDocumentId } from '../src/rateLimiter.js';
import { resumeDeletionWithAudit } from '../src/pilotOperator.js';
import { assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { readFile } from 'node:fs/promises';

const describeWithEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const key = 'deletion-test-secret'.padEnd(32, 'x');
const now = new Date('2026-09-24T00:00:00.000Z');

describeWithEmulator('account export and deletion', () => {
  let app: App;
  let database: Firestore;
  beforeAll(() => {
    app = initializeApp({ projectId: 'demo-lingoflash' }, 'account-data-integration');
    database = getFirestore(app, 'ai-studio-945b4052-4462-4668-8936-277f09f07a37');
  });
  afterAll(async () => { await database.terminate(); await deleteApp(app); });

  const fakeAuth = () => {
    const revokeRefreshTokens = vi.fn(async (_uid: string) => undefined);
    const deleteUser = vi.fn(async (_uid: string) => undefined);
    return { auth: { revokeRefreshTokens, deleteUser } as unknown as Auth,
      revokeRefreshTokens, deleteUser };
  };

  it('exports only the requesting owner, then purges every pilot collection and late writes', async () => {
    const uid = `erase-${randomUUID()}`;
    const other = `keep-${randomUUID()}`;
    const pid = analyticsPseudonym(uid, key);
    const owner = database.collection('users').doc(uid);
    await owner.set({ displayName: 'private owner' });
    for (const [collection, id] of [
      ['cards', 'card-1'], ['card_reservations', 'reserve-1'], ['card_tombstones', 'card-1'],
      ['profile', 'stats'], ['profile', 'xp_history'], ['profile', 'plan'],
      ['xp_streams', 'stream-1'], ['review_receipts', 'card-1:op'],
      ['ai_usage', 'free-2026-09'], ['ai_operations', 'op-1'], ['ai_daily', '2026-09-24'],
      ['entitlements', 'pro-1'], ['analytics_rate', 'current'], ['library_facet_receipts', 'op-1'],
    ] as const) await owner.collection(collection).doc(id).set({ ownerId: uid, value: 'private value' });
    await database.collection('card_reports').doc(`report-${uid}`).set({ uid, card: { word: 'private' } });
    await database.collection('ai_cost_ledger').doc(`cost-${uid}`).set({ uid, estimatedUsdMicros: 3 });
    await database.collection('analytics_events').doc(`event-${uid}`).set({ pid, name: 'purchase_intent' });
    for (const scope of ACCOUNT_RATE_SCOPES) {
      await database.collection('_functionRateLimitBudgets').doc(budgetDocumentId(uid, scope))
        .set({ scope, calls: 1 });
    }
    await database.collection('users').doc(other).collection('profile').doc('stats').set({ ownerId: other });
    await database.collection('card_reports').doc(`report-${other}`).set({ uid: other });
    const exportResult = await exportAccountData(database, uid, key);
    expect(JSON.stringify(exportResult)).toContain('private value');
    expect(JSON.stringify(exportResult)).not.toContain(other);
    expect((exportResult as { analyticsEventCount: number }).analyticsEventCount).toBe(1);

    const expiry = new Date(now.getTime() - 60_000);
    await database.collection('shared_decks').doc(`owned-${uid}`).set({ schemaVersion: 2 });
    await database.collection('shared_deck_owners').doc(`owned-${uid}`).set({
      ownerUid: uid, schemaVersion: 2, createdAt: new Date(expiry.getTime() - 60_000),
      expiresAt: expiry, payloadBytes: 1,
    });
    await database.collection('shared_decks').doc(`legacy-${uid}`).set({ authorUid: uid });
    await database.collection('shared_decks').doc(`metadata-legacy-${uid}`).set({ schemaVersion: 1 });
    await database.collection('shared_deck_owners').doc(`metadata-legacy-${uid}`).set({
      ownerUid: uid, schemaVersion: 1, createdAt: new Date(expiry.getTime() - 60_000), expiresAt: expiry,
    });
    process.env.ANALYTICS_PSEUDONYM_KEY = key;
    const { exportMyData, deleteMyAccount, getPilotOffer } = await import('../src/index.js');
    await expect(exportMyData.run({ data: {} } as never)).rejects.toMatchObject({ code: 'unauthenticated' });
    for (let count = 0; count < 5; count++) {
      const ownExport = await exportMyData.run({ auth: { uid }, data: {} } as never);
      expect(JSON.stringify(ownExport)).not.toContain(other);
    }
    await expect(exportMyData.run({ auth: { uid }, data: {} } as never))
      .rejects.toMatchObject({ code: 'resource-exhausted' });
    await expect(deleteMyAccount.run({ auth: { uid, token: { auth_time: 1 } },
      data: { confirmation: 'XÓA TÀI KHOẢN' } } as never))
      .rejects.toMatchObject({ code: 'failed-precondition' });
    await expect(deleteMyAccount.run({ auth: { uid, token: { auth_time: Math.floor(Date.now() / 1000) } },
      data: { confirmation: 'wrong' } } as never))
      .rejects.toMatchObject({ code: 'invalid-argument' });
    const { auth, revokeRefreshTokens, deleteUser } = fakeAuth();
    expect(await beginAccountDeletion(database, auth, uid, key, now)).toBe('waiting');
    expect(revokeRefreshTokens).toHaveBeenCalledWith(uid);
    expect(deleteUser).toHaveBeenCalledWith(uid);
    expect(await isAccountDeleting(database, uid, key)).toBe(true);
    await expect(getPilotOffer.run({ auth: { uid }, data: {} } as never))
      .rejects.toMatchObject({ code: 'permission-denied' });
    expect((await database.collection('shared_decks').doc(`owned-${uid}`).get()).exists).toBe(false);
    expect((await database.collection('shared_deck_owners').doc(`owned-${uid}`).get()).exists).toBe(false);
    expect((await database.collection('shared_decks').doc(`legacy-${uid}`).get()).exists).toBe(false);
    expect((await database.collection('shared_decks').doc(`metadata-legacy-${uid}`).get()).exists).toBe(false);
    expect((await database.collection('shared_deck_owners').doc(`metadata-legacy-${uid}`).get()).exists).toBe(false);
    expect((await database.collection('users').doc(other).collection('profile').doc('stats').get()).exists).toBe(true);
    expect((await database.collection('card_reports').doc(`report-${other}`).get()).exists).toBe(true);
    expect((await owner.listCollections()).length).toBe(0);
    expect((await database.collection('ai_cost_ledger').where('uid', '==', uid).get()).empty).toBe(true);
    expect((await database.collection('card_reports').where('uid', '==', uid).get()).empty).toBe(true);
    expect((await database.collection('analytics_events').where('pid', '==', pid).get()).empty).toBe(true);
    for (const scope of ACCOUNT_RATE_SCOPES) expect((await database.collection('_functionRateLimitBudgets')
      .doc(budgetDocumentId(uid, scope)).get()).exists).toBe(false);

    // A second device still has an unexpired ID token and can race a direct Firestore write.
    await owner.collection('cards').doc('late-card').set({ ownerId: uid });
    expect(await isAccountDeleting(database, uid, key)).toBe(true);
    await expect(getPilotOffer.run({ auth: { uid }, data: {} } as never))
      .rejects.toMatchObject({ code: 'permission-denied' });
    expect(await finalizeDueDeletions(database, auth, new Date(now.getTime() + 66 * 60_000))).toBe(1);
    expect((await owner.listCollections()).length).toBe(0);
    expect((await database.collection('account_tombstones').doc(pid).get()).data())
      .toMatchObject({ status: 'done' });
    expect((await database.collection('account_tombstones').doc(pid).get()).data()).not.toHaveProperty('uid');
  }, 40_000);

  it('resumes after Auth deletion failed and after the Auth user is gone', async () => {
    const uid = `resume-${randomUUID()}`;
    const pid = analyticsPseudonym(uid, key);
    const { auth, deleteUser } = fakeAuth();
    deleteUser.mockRejectedValueOnce(new Error('temporary Auth failure'));
    await expect(beginAccountDeletion(database, auth, uid, key, now)).rejects.toThrow('temporary Auth failure');
    expect((await database.collection('account_tombstones').doc(pid).get()).data()?.status).toBe('deleting');
    expect(await resumeDeletionWithAudit(database, auth, {
      pid, reason: 'Resume after Auth failure', target: 'staging', operator: 'test-operator',
    }, now)).toBe('waiting');
    expect((await database.collection('account_tombstones').doc(pid).get()).data()?.status).toBe('auth-deleted');
    expect(await resumeDeletionWithAudit(database, auth, {
      pid, reason: 'Complete final purge', target: 'staging', operator: 'test-operator',
    }, new Date(now.getTime() + 66 * 60_000))).toBe('done');
    expect(await resumeAccountDeletion(database, auth, pid, new Date(now.getTime() + 67 * 60_000))).toBe('done');
    const audits = (await database.collection('operator_audit').where('pid', '==', pid).get()).docs
      .map(snapshot => snapshot.data());
    expect(audits).toHaveLength(2);
    expect(audits.map(audit => audit.result.status).sort()).toEqual(['done', 'waiting']);
    expect(audits.every(audit => audit.mode === 'resume-deletion' && audit.operator === 'test-operator'
      && audit.target === 'staging' && !Object.hasOwn(audit, 'uid'))).toBe(true);
  }, 30_000);

  it('purges a profile write from a second authenticated device with an old token', async () => {
    const uid = `device-${randomUUID()}`;
    const appForRules = initializeApp({ projectId: 'demo-lingoflash' }, 'account-two-devices');
    const admin = getFirestore(appForRules);
    const rules = await readFile(new URL('../../firestore.rules', import.meta.url), 'utf8');
    const environment = await initializeTestEnvironment({ projectId: 'demo-lingoflash', firestore: { rules } });
    const { auth } = fakeAuth();
    try {
      const deviceB = environment.authenticatedContext(uid).firestore();
      expect(await beginAccountDeletion(admin, auth, uid, key, now)).toBe('waiting');
      const state = doc(deviceB, 'users', uid, 'profile', 'library_state');
      await assertSucceeds(setDoc(state, { schemaVersion: 2, libraryEpoch: 0 }));
      expect((await getDoc(state)).exists()).toBe(true);
      expect(await finalizeDueDeletions(admin, auth, new Date(now.getTime() + 66 * 60_000))).toBe(1);
      expect((await getDoc(state)).exists()).toBe(false);
    } finally {
      await environment.cleanup();
      await admin.terminate();
      await deleteApp(appForRules);
    }
  }, 30_000);

  (process.env.FIREBASE_AUTH_EMULATOR_HOST ? it : it.skip)(
    'deletes the Auth identity so a later sign-in starts with a new uid', async () => {
      const email = `deleted-${randomUUID()}@example.test`;
      const uid = `auth-${randomUUID()}`;
      const auth = getAuth(app);
      await auth.createUser({ uid, email });
      expect(await beginAccountDeletion(database, auth, uid, key, now)).toBe('waiting');
      await expect(auth.getUser(uid)).rejects.toMatchObject({ code: 'auth/user-not-found' });
      const replacement = await auth.createUser({ email });
      expect(replacement.uid).not.toBe(uid);
      await auth.deleteUser(replacement.uid);
    }, 20_000,
  );
});
