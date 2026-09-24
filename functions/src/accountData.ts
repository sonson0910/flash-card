import type { Auth } from 'firebase-admin/auth';
import { FieldValue, type DocumentData, type Firestore, type Query } from 'firebase-admin/firestore';
import { analyticsPseudonym } from './analyticsEvents.js';
import { budgetDocumentId } from './rateLimiter.js';
import { revokeSharedDeckAtomically, SharedDeckMigrationRequiredError } from './sharedDeckPersistence.js';

const HOUR = 3_600_000;
export const ACCOUNT_RATE_SCOPES = [
  'gamification-save', 'library-facets-update', 'ai-card', 'ai-story', 'ai-translate',
  'gemini-owner', 'image', 'image-provider-owner', 'card-create', 'card-report',
  'purchase-intent', 'card-review', 'shared-deck-create', 'shared-deck-create-service-owner',
  'shared-deck-revoke', 'legacy-library-migration', 'account-export',
] as const;

const jsonValue = (value: unknown): unknown => {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object' && 'toDate' in value
    && typeof (value as { toDate?: unknown }).toDate === 'function') {
    return (value as { toDate(): Date }).toDate().toISOString();
  }
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, jsonValue(item)]));
  return value;
};
const rows = async (query: Query) => (await query.get()).docs.map(doc => ({ id: doc.id, ...doc.data() }));

export async function exportAccountData(database: Firestore, uid: string, key: string) {
  const owner = database.collection('users').doc(uid);
  const pid = analyticsPseudonym(uid, key);
  const [profile, entitlements, aiUsage, aiDaily, xpStreams, reports, events] = await Promise.all([
    rows(owner.collection('profile')), rows(owner.collection('entitlements')),
    rows(owner.collection('ai_usage')), rows(owner.collection('ai_daily')),
    rows(owner.collection('xp_streams')),
    rows(database.collection('card_reports').where('uid', '==', uid)),
    database.collection('analytics_events').where('pid', '==', pid).count().get(),
  ]);
  return jsonValue({ exportedAt: new Date(), profile, entitlements, aiUsage, aiDaily,
    xpStreams, cardReports: reports, analyticsEventCount: events.data().count });
}

export const tombstoneRef = (database: Firestore, uid: string, key: string) =>
  database.collection('account_tombstones').doc(analyticsPseudonym(uid, key));

export async function isAccountDeleting(database: Firestore, uid: string, key: string): Promise<boolean> {
  return (await tombstoneRef(database, uid, key).get()).exists;
}

async function deleteQuery(database: Firestore, query: Query): Promise<void> {
  const snapshot = await query.get();
  if (snapshot.empty) return;
  const writer = database.bulkWriter();
  const writes = snapshot.docs.map(doc => writer.delete(doc.ref));
  await writer.close();
  await Promise.all(writes);
}

async function revokeOwnSharedDecks(database: Firestore, uid: string): Promise<void> {
  const owned = await database.collection('shared_deck_owners').where('ownerUid', '==', uid).get();
  for (const ownership of owned.docs) {
    const deck = database.collection('shared_decks').doc(ownership.id);
    try { await revokeSharedDeckAtomically(database, deck, ownership.ref, uid); }
    catch (error) {
      if (!(error instanceof SharedDeckMigrationRequiredError)
        || ownership.data().ownerUid !== uid || ownership.data().schemaVersion !== 1) throw error;
      await deck.delete();
      await ownership.ref.delete();
    }
  }
  const legacy = await database.collection('shared_decks').where('authorUid', '==', uid).get();
  for (const deck of legacy.docs) {
    if (!(await database.collection('shared_deck_owners').doc(deck.id).get()).exists) await deck.ref.delete();
  }
}

export async function purgeAccountData(database: Firestore, uid: string, pid: string): Promise<void> {
  await database.recursiveDelete(database.collection('users').doc(uid));
  await deleteQuery(database, database.collection('ai_cost_ledger').where('uid', '==', uid));
  await deleteQuery(database, database.collection('card_reports').where('uid', '==', uid));
  await deleteQuery(database, database.collection('analytics_events').where('pid', '==', pid));
  const budgetRefs = ACCOUNT_RATE_SCOPES.map(scope => database.collection('_functionRateLimitBudgets')
    .doc(budgetDocumentId(uid, scope)));
  const writer = database.bulkWriter();
  const writes = budgetRefs.map(ref => writer.delete(ref));
  await writer.close();
  await Promise.all(writes);
}

const missingUser = (error: unknown): boolean => Boolean(error && typeof error === 'object'
  && 'code' in error && (error as { code?: unknown }).code === 'auth/user-not-found');
const asDate = (value: unknown): Date | null => value instanceof Date ? value
  : value && typeof value === 'object' && 'toDate' in value
    && typeof (value as { toDate?: unknown }).toDate === 'function'
    ? (value as { toDate(): Date }).toDate() : null;

export async function resumeAccountDeletion(database: Firestore, auth: Auth, pid: string,
  now = new Date()): Promise<'waiting' | 'done'> {
  if (!/^[a-f0-9]{32}$/.test(pid)) throw new Error('Deletion pid is invalid.');
  const ref = database.collection('account_tombstones').doc(pid);
  const snapshot = await ref.get();
  const job = snapshot.data() as DocumentData | undefined;
  if (!job) throw new Error('Deletion job was not found.');
  if (job.status === 'done') return 'done';
  if (typeof job.uid !== 'string' || !job.uid) throw new Error('Deletion job has no owner.');
  const uid = job.uid;
  if (job.status === 'deleting') {
    await revokeOwnSharedDecks(database, uid);
    await purgeAccountData(database, uid, pid);
    try { await auth.deleteUser(uid); } catch (error) { if (!missingUser(error)) throw error; }
    await ref.update({ status: 'auth-deleted' });
  } else if (job.status !== 'auth-deleted') throw new Error('Deletion status is invalid.');
  const purgeAfter = asDate(job.purgeAfter);
  if (!purgeAfter) throw new Error('Deletion purge deadline is invalid.');
  if (now < purgeAfter) return 'waiting';
  await purgeAccountData(database, uid, pid);
  await ref.update({ status: 'done', uid: FieldValue.delete() });
  return 'done';
}

export async function beginAccountDeletion(database: Firestore, auth: Auth, uid: string,
  key: string, now = new Date()): Promise<'waiting' | 'done'> {
  const pid = analyticsPseudonym(uid, key);
  await auth.revokeRefreshTokens(uid);
  const ref = database.collection('account_tombstones').doc(pid);
  await database.runTransaction(async transaction => {
    const existing = await transaction.get(ref);
    if (existing.exists) {
      if (existing.data()?.uid !== uid) throw new Error('Deletion job owner mismatch.');
      return;
    }
    transaction.create(ref, { uid, status: 'deleting', startedAt: now,
      purgeAfter: new Date(now.getTime() + 65 * 60_000),
      expiresAt: new Date(now.getTime() + 30 * 24 * HOUR) });
  });
  return resumeAccountDeletion(database, auth, pid, now);
}

export async function finalizeDueDeletions(database: Firestore, auth: Auth,
  now = new Date()): Promise<number> {
  const jobs = await database.collection('account_tombstones').get();
  let completed = 0;
  for (const job of jobs.docs) {
    const data = job.data();
    const purgeAfter = asDate(data.purgeAfter);
    if (data.status !== 'done' && purgeAfter && purgeAfter <= now) {
      try {
        if (await resumeAccountDeletion(database, auth, job.id, now) === 'done') completed += 1;
      } catch (error) {
        console.error('account-final-purge-failed', { pid: job.id,
          errorName: error instanceof Error ? error.name : 'UnknownError' });
      }
    }
  }
  return completed;
}
