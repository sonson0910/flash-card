import { createHash, randomUUID } from 'node:crypto';
import { Timestamp, type DocumentReference, type Firestore } from 'firebase-admin/firestore';
import { InputValidationError } from './inputValidation.js';
import { nextReminderAfterScheduledDay, quietHoursEndAfter, studiedOnLocalDay, type ReminderSchedule } from './reminderSchedule.js';

export type PushReminderClaim = {
  readonly ownerId: string;
  readonly scheduledDay: string;
  readonly dueCount: number;
  readonly locale: 'en' | 'vi';
  readonly tokens: readonly { id: string; token: string; registryId: string; bindingId: string }[];
  readonly receiptRef: DocumentReference;
};

export async function currentPushTokensForClaim(
  database: Firestore,
  claim: PushReminderClaim,
): Promise<PushReminderClaim['tokens']> {
  if (claim.tokens.length === 0) return [];
  const owners = await database.getAll(...claim.tokens.map(token =>
    database.collection('pushTokenOwners').doc(token.registryId)));
  return claim.tokens.filter((token, index) => {
    const owner = owners[index].data();
    return owner?.ownerId === claim.ownerId && owner.bindingId === token.bindingId;
  });
}

const asTime = (value: unknown): number | null => value instanceof Timestamp ? value.toMillis() : null;

const ownerFromStatePath = (path: string): string => {
  const match = /^users\/([^/]+)\/reminderState\/current$/.exec(path);
  if (!match) throw new InputValidationError('Reminder state path is invalid.');
  return match[1];
};

/** Claims at most one push per selected local day; sending occurs after the transaction commits. */
export async function claimDuePushReminder(
  database: Firestore,
  stateRef: DocumentReference,
  now: Date,
): Promise<PushReminderClaim | null> {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new InputValidationError('Reminder time is invalid.');
  }
  const ownerId = ownerFromStatePath(stateRef.path);
  const owner = database.collection('users').doc(ownerId);
  // Count is outside the transaction to avoid locking every due card. The
  // transaction still rechecks consent and the latest verified review time.
  const dueSnapshot = await owner.collection('cards').where('nextReviewDate', '<=', now.toISOString()).count().get();
  const dueCount = dueSnapshot.data().count;
  if (!Number.isSafeInteger(dueCount) || dueCount < 0) throw new InputValidationError('Reminder due count is invalid.');

  return database.runTransaction(async transaction => {
    const state = (await transaction.get(stateRef)).data();
    const eligibleAt = asTime(state?.nextEligibleSendAt);
    if (state?.channels?.push !== true || eligibleAt === null || eligibleAt > now.getTime()) return null;
    if (typeof state.nextEligibleLocalDay !== 'string') throw new InputValidationError('Reminder scheduled day is invalid.');
    const schedule: ReminderSchedule = {
      days: state.days, sendAtLocal: state.sendAtLocal, timezone: state.timezone,
      ...(state.quietHours ? { quietHours: state.quietHours } : {}),
    };
    const quietEnd = quietHoursEndAfter(schedule, now);
    if (quietEnd && now.getTime() - eligibleAt <= 60 * 60_000) {
      transaction.update(stateRef, {
        nextEligibleSendAt: Timestamp.fromDate(quietEnd), updatedAt: Timestamp.fromDate(now),
      });
      return null;
    }
    const next = nextReminderAfterScheduledDay(schedule, now, state.nextEligibleLocalDay);
    const stats = (await transaction.get(owner.collection('profile').doc('stats'))).data();
    const studiedAt = stats?.lastVerifiedReviewAt instanceof Timestamp ? stats.lastVerifiedReviewAt : null;
    const previousReceiptId = state.lastPushReceiptId;
    if (previousReceiptId !== null && previousReceiptId !== undefined
      && (typeof previousReceiptId !== 'string' || !/^\d{4}-\d{2}-\d{2}_push$/.test(previousReceiptId))) {
      throw new InputValidationError('Previous reminder receipt is invalid.');
    }
    const previousReceipt = previousReceiptId
      ? (await transaction.get(owner.collection('reminderReceipts').doc(previousReceiptId))).data() : undefined;
    const previousSentAt = asTime(previousReceipt?.sentAt);
    const evaluatedAt = asTime(state.lastEvaluatedSentAt);
    let ignored = Number.isSafeInteger(state.consecutiveIgnored) && state.consecutiveIgnored >= 0
      ? Math.min(state.consecutiveIgnored, 7) : 0;
    let skipNext = state.backoffSkipNext === true;
    let nextEvaluatedAt = evaluatedAt;
    if (previousSentAt !== null && (evaluatedAt === null || previousSentAt > evaluatedAt)) {
      ignored = studiedAt && studiedAt.toMillis() > previousSentAt ? 0 : Math.min(ignored + 1, 7);
      nextEvaluatedAt = previousSentAt;
    }
    if (studiedAt && nextEvaluatedAt !== null && studiedAt.toMillis() > nextEvaluatedAt) {
      ignored = 0;
      skipNext = false;
    }

    const receiptId = `${state.nextEligibleLocalDay}_push`;
    const receiptRef = owner.collection('reminderReceipts').doc(receiptId);
    const duplicate = (await transaction.get(receiptRef)).exists;
    const studiedToday = studiedAt && state.onlyIfNotStudiedToday !== false
      ? studiedOnLocalDay(studiedAt.toDate(), now, schedule.timezone) : false;
    const stale = now.getTime() - eligibleAt > 60 * 60_000;
    const backoffSkip = ignored >= 3 && ignored < 7 && skipNext;
    const canSend = Boolean(studiedAt) && dueCount > 0 && !studiedToday && !stale
      && ignored < 7 && !backoffSkip && !duplicate;
    const tokenSnapshot = canSend ? await transaction.get(owner.collection('pushTokens').limit(20)) : null;
    const tokenCandidates = tokenSnapshot?.docs.flatMap(doc => {
      const token = doc.data().token;
      return typeof token === 'string' && token.length >= 32 && token.length <= 4096
        ? (() => {
          const registryId = createHash('sha256').update(token).digest('hex');
          return [{ id: doc.id, token, registryId, ownerRef: database.collection('pushTokenOwners').doc(registryId) }];
        })() : [];
    }) ?? [];
    const tokenOwners = await Promise.all(tokenCandidates.map(candidate => transaction.get(candidate.ownerRef)));
    const tokens = tokenCandidates.flatMap((candidate, index) => {
      const owner = tokenOwners[index].data();
      return owner?.ownerId === ownerId && typeof owner.bindingId === 'string' && owner.bindingId.length > 0
        ? [{ id: candidate.id, token: candidate.token, registryId: candidate.registryId, bindingId: owner.bindingId }] : [];
    });
    const claim = canSend && tokens.length > 0;
    transaction.update(stateRef, {
      nextEligibleSendAt: Timestamp.fromDate(next.at),
      nextEligibleLocalDay: next.scheduledDay,
      consecutiveIgnored: ignored,
      lastEvaluatedSentAt: nextEvaluatedAt === null ? null : Timestamp.fromMillis(nextEvaluatedAt),
      backoffSkipNext: ignored >= 3 && ignored < 7 ? (claim ? true : backoffSkip ? false : skipNext) : false,
      ...(claim ? { lastPushReceiptId: receiptId } : {}),
      updatedAt: Timestamp.fromDate(now),
    });
    if (!claim) return null;
    transaction.create(receiptRef, { claimedAt: Timestamp.fromDate(now), channel: 'push', opId: randomUUID() });
    return { ownerId, scheduledDay: state.nextEligibleLocalDay, dueCount,
      locale: state.locale === 'vi' ? 'vi' : 'en', tokens, receiptRef };
  });
}

export async function sweepDuePushReminders(
  database: Firestore,
  send: (claim: PushReminderClaim) => Promise<number>,
  now = new Date(),
): Promise<{ claimed: number; sent: number }> {
  const query = database.collectionGroup('reminderState')
    .where('channels.push', '==', true)
    .where('nextEligibleSendAt', '<=', Timestamp.fromDate(now))
    .orderBy('nextEligibleSendAt');
  let claimed = 0;
  let sent = 0;
  let processed = 0;
  let failed = 0;
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined;
  const startedAt = performance.now();
  const outOfTime = () => performance.now() - startedAt >= 240_000;
  let budgetExhausted = false;
  for (;;) {
    if (outOfTime()) { budgetExhausted = true; break; }
    const candidates = await (cursor ? query.startAfter(cursor) : query).limit(100).get();
    for (let offset = 0; offset < candidates.docs.length; offset += 5) {
      if (outOfTime()) { budgetExhausted = true; break; }
      await Promise.all(candidates.docs.slice(offset, offset + 5).map(async candidate => {
        processed++;
        try {
          const candidateNow = new Date(now.getTime() + performance.now() - startedAt);
          const claim = await claimDuePushReminder(database, candidate.ref, candidateNow);
          if (!claim) return;
          claimed++;
          const successes = await send(claim);
          if (successes > 0) {
            await claim.receiptRef.update({ sentAt: Timestamp.fromDate(new Date()) });
            sent++;
          }
        } catch (error) {
          failed++;
          console.error('Push reminder candidate failed.', {
            errorName: error instanceof Error ? error.name : 'UnknownError',
          });
        }
      }));
    }
    if (budgetExhausted || candidates.docs.length < 100) break;
    cursor = candidates.docs[candidates.docs.length - 1];
  }
  if (budgetExhausted) console.warn('Push reminder sweep reached its time budget.', { processed, failed });
  return { claimed, sent };
}
