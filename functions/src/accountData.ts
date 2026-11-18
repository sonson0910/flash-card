import type { Auth } from 'firebase-admin/auth';
import { FieldValue, type DocumentData, type Firestore, type Query } from 'firebase-admin/firestore';
import { analyticsPseudonym } from './analyticsEvents.js';
import { budgetDocumentId } from './rateLimiter.js';
import {
  revokeSharedDeckAtomically, SharedDeckMigrationRequiredError, SharedDeckUsageStateError,
} from './sharedDeckPersistence.js';

const HOUR = 3_600_000;
export const ACCOUNT_RATE_SCOPES = [
  'gamification-save', 'library-facets-update', 'ai-card', 'ai-story', 'ai-translate',
  'gemini-owner', 'image', 'image-provider-owner', 'card-create', 'card-report',
  'purchase-intent', 'card-review', 'shared-deck-create', 'shared-deck-create-service-owner',
  'shared-deck-revoke', 'legacy-library-migration', 'account-export', 'practice-session-start',
  'practice-session-complete', 'reward-frame-equip',
  'clear-library-page', 'card-headword-rename', 'bulk-card-mutation', 'course-profile',
  'reminder-settings', 'push-token-revoke', 'push-session-end', 'ai-card-cancel', 'ai-tutor-turn',
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
  const [profile, entitlements, paymentReceipts, catalogProgress, aiUsage, aiDaily, xpStreams, reviewReceipts, reviewXpAwards, cardCreateReceipts, practiceSessions,
    reminderState, reminderReceipts, pushTokens, pushTokenSessionCutoffs, pushTokenOwners,
    mail, reports, events] = await Promise.all([
    rows(owner.collection('profile')), rows(owner.collection('entitlements')),
    rows(owner.collection('payment_receipts')), rows(owner.collection('catalog_progress')),
    rows(owner.collection('ai_usage')), rows(owner.collection('ai_daily')),
    rows(owner.collection('xp_streams')),
    rows(owner.collection('review_receipts')),
    rows(owner.collection('review_xp_awards')),
    rows(owner.collection('card_create_receipts')), rows(owner.collection('practice_sessions')),
    rows(owner.collection('reminderState')), rows(owner.collection('reminderReceipts')),
    rows(owner.collection('pushTokens')),
    rows(owner.collection('pushTokenSessionCutoffs')),
    rows(database.collection('pushTokenOwners').where('ownerId', '==', uid)),
    rows(database.collection('mail').where('ownerId', '==', uid)),
    rows(database.collection('card_reports').where('uid', '==', uid)),
    database.collection('analytics_events').where('pid', '==', pid).count().get(),
  ]);
  return jsonValue({ exportedAt: new Date(), profile, entitlements, paymentReceipts, catalogProgress, aiUsage, aiDaily,
    xpStreams, reviewReceipts, reviewXpAwards, cardCreateReceipts, practiceSessions,
    reminderState, reminderReceipts, pushTokens, pushTokenSessionCutoffs, pushTokenOwners,
    mail, cardReports: reports,
    analyticsEventCount: events.data().count });
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
      // A confirmed owner's own deletion must not stall on the deck's migration or usage
      // state: the deck and its ownership record are removed directly instead of retrying
      // a revoke that will keep failing (a migration fence or a corrupted usage document).
      if (!(error instanceof SharedDeckMigrationRequiredError || error instanceof SharedDeckUsageStateError)
        || ownership.data().ownerUid !== uid) throw error;
      await deck.delete();
      await ownership.ref.delete();
    }
  }
  const legacy = await database.collection('shared_decks').where('authorUid', '==', uid).get();
  for (const deck of legacy.docs) {
    if (!(await database.collection('shared_deck_owners').doc(deck.id).get()).exists) await deck.ref.delete();
  }
}

async function deleteOwnedPushRegistrations(database: Firestore, uid: string): Promise<void> {
  const registrations = database.collection('pushTokenOwners').where('ownerId', '==', uid);
  for (;;) {
    const snapshot = await registrations.limit(100).get();
    if (snapshot.empty) return;
    for (const candidate of snapshot.docs) {
      await database.runTransaction(async transaction => {
        const current = await transaction.get(candidate.ref);
        if (current.data()?.ownerId === uid) transaction.delete(candidate.ref);
      });
    }
  }
}

export async function purgeAccountData(database: Firestore, uid: string, pid: string): Promise<void> {
  await deleteOwnedPushRegistrations(database, uid);
  await database.recursiveDelete(database.collection('users').doc(uid));
  await deleteQuery(database, database.collection('ai_cost_ledger').where('uid', '==', uid));
  await deleteQuery(database, database.collection('card_reports').where('uid', '==', uid));
  await deleteQuery(database, database.collection('mail').where('ownerId', '==', uid));
  await deleteQuery(database, database.collection('analytics_events').where('pid', '==', pid));
  // payment_settlements stay: they hold only the pid and back the books for ten years.
  await deleteQuery(database, database.collection('admin_shared_deck_migration_quarantine')
    .where('ownerUid', '==', uid));
  await database.collection('_serviceConfig').doc('pilotExclusions')
    .set({ uids: FieldValue.arrayRemove(uid) }, { merge: true });
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
    const originalPurgeAfter = asDate(job.purgeAfter);
    if (!originalPurgeAfter) throw new Error('Deletion purge deadline is invalid.');
    if (originalPurgeAfter <= now && !job.disabledAt) {
      // The job sat in "deleting" past its own deadline without ever running: a device
      // could still sign in and write through Rules the whole time. Lock the account out
      // right away and restart the 65-minute window before purging, instead of purging and
      // deleting the Auth user in the same call the guard is meant to separate.
      try { await auth.updateUser(uid, { disabled: true }); } catch (error) { if (!missingUser(error)) throw error; }
      const purgeAfter = new Date(Math.max(originalPurgeAfter.getTime(), now.getTime() + 65 * 60_000));
      await ref.update({ purgeAfter, disabledAt: now });
      return 'waiting';
    }
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
  const jobs = await database.collection('account_tombstones')
    .where('status', 'in', ['deleting', 'auth-deleted'])
    .where('purgeAfter', '<=', now)
    .get();
  let completed = 0;
  for (const job of jobs.docs) {
    try {
      if (await resumeAccountDeletion(database, auth, job.id, now) === 'done') completed += 1;
    } catch (error) {
      console.error('account-final-purge-failed', { pid: job.id,
        errorName: error instanceof Error ? error.name : 'UnknownError' });
    }
  }
  return completed;
}
