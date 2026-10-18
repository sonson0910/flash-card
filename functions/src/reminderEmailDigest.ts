import { randomUUID } from 'node:crypto';
import { Timestamp, type DocumentReference, type Firestore } from 'firebase-admin/firestore';
import { InputValidationError } from './inputValidation.js';
import { nextReminderAfterScheduledDay, quietHoursEndAfter, studiedOnLocalDay } from './reminderSchedule.js';
import { reminderTodayUrl } from './reminderAppOrigin.js';

// Queued mail holds the learner's address; the collection TTL removes it after delivery.
export const MAIL_RETENTION_MS = 30 * 24 * 60 * 60_000;

const ownerFromStatePath = (path: string): string => {
  const match = /^users\/([^/]+)\/reminderState\/current$/.exec(path);
  if (!match) throw new InputValidationError('Reminder state path is invalid.');
  return match[1];
};

export async function enqueueWeeklyDigest(
  database: Firestore,
  stateRef: DocumentReference,
  getVerifiedEmail: (ownerId: string) => Promise<string | null>,
  projectId: string,
  now: Date,
): Promise<boolean> {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new InputValidationError('Reminder time is invalid.');
  }
  const ownerId = ownerFromStatePath(stateRef.path);
  const owner = database.collection('users').doc(ownerId);
  const due = await owner.collection('cards').where('nextReviewDate', '<=', now.toISOString()).count().get();
  const dueCount = due.data().count;
  if (!Number.isSafeInteger(dueCount) || dueCount < 0) throw new InputValidationError('Reminder due count is invalid.');
  const email = dueCount > 0 ? await getVerifiedEmail(ownerId) : null;
  return database.runTransaction(async transaction => {
    const state = (await transaction.get(stateRef)).data();
    const eligibleAt = state?.nextWeeklyDigestAt instanceof Timestamp ? state.nextWeeklyDigestAt.toMillis() : null;
    if (state?.channels?.emailDigest !== true || eligibleAt === null || eligibleAt > now.getTime()) return false;
    if (typeof state.nextWeeklyDigestLocalDay !== 'string') {
      throw new InputValidationError('Weekly digest scheduled day is invalid.');
    }
    const schedule = {
      days: [0], sendAtLocal: state.sendAtLocal, timezone: state.timezone,
      ...(state.quietHours ? { quietHours: state.quietHours } : {}),
    };
    const quietEnd = quietHoursEndAfter(schedule, now);
    if (quietEnd && now.getTime() - eligibleAt <= 24 * 60 * 60_000) {
      transaction.update(stateRef, {
        nextWeeklyDigestAt: Timestamp.fromDate(quietEnd), updatedAt: Timestamp.fromDate(now),
      });
      return false;
    }
    const next = nextReminderAfterScheduledDay(schedule, now, state.nextWeeklyDigestLocalDay);
    const receiptId = `${state.nextWeeklyDigestLocalDay}_emailDigest`;
    const receiptRef = owner.collection('reminderReceipts').doc(receiptId);
    const receipt = await transaction.get(receiptRef);
    const stats = (await transaction.get(owner.collection('profile').doc('stats'))).data();
    const studiedAt = stats?.lastVerifiedReviewAt instanceof Timestamp ? stats.lastVerifiedReviewAt : null;
    const studiedToday = studiedAt && state.onlyIfNotStudiedToday !== false
      ? studiedOnLocalDay(studiedAt.toDate(), now, state.timezone) : false;
    const stale = now.getTime() - eligibleAt > 24 * 60 * 60_000;
    transaction.update(stateRef, {
      nextWeeklyDigestAt: Timestamp.fromDate(next.at),
      nextWeeklyDigestLocalDay: next.scheduledDay,
      updatedAt: Timestamp.fromDate(now),
    });
    if (dueCount === 0 || receipt.exists || !email || !studiedAt || studiedToday || stale) return false;

    const streakValue = stats?.verifiedStreak;
    const streak = Number.isSafeInteger(streakValue) && typeof streakValue === 'number' && streakValue >= 0
      ? streakValue : 0;
    const vi = state.locale === 'vi';
    const subject = vi ? 'Tổng kết tuần học SonFlash' : 'Your SonFlash weekly recap';
    const todayUrl = reminderTodayUrl(projectId, state.locale);
    const text = vi
      ? `Tuần này bạn có ${dueCount} thẻ đến hạn ôn tập. Chuỗi học hiện tại: ${streak} ngày. Mở SonFlash để tiếp tục: ${todayUrl}`
      : `You have ${dueCount} ${dueCount === 1 ? 'card' : 'cards'} ready for review. Current study streak: ${streak} days. Continue on SonFlash: ${todayUrl}`;
    transaction.create(receiptRef, {
      claimedAt: Timestamp.fromDate(now), channel: 'emailDigest', opId: randomUUID(),
    });
    transaction.create(database.collection('mail').doc(`${ownerId}_${receiptId}`), {
      ownerId, to: [email], message: { subject, text },
      expiresAt: Timestamp.fromDate(new Date(now.getTime() + MAIL_RETENTION_MS)),
    });
    return true;
  });
}

export async function sweepDueWeeklyDigests(
  database: Firestore,
  getVerifiedEmail: (ownerId: string) => Promise<string | null>,
  projectId: string,
  now = new Date(),
): Promise<number> {
  const query = database.collectionGroup('reminderState')
    .where('channels.emailDigest', '==', true)
    .where('nextWeeklyDigestAt', '<=', Timestamp.fromDate(now))
    .orderBy('nextWeeklyDigestAt');
  let queued = 0;
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
          if (await enqueueWeeklyDigest(database, candidate.ref, getVerifiedEmail, projectId, candidateNow)) queued++;
        } catch (error) {
          failed++;
          console.error('Weekly digest candidate failed.', {
            errorName: error instanceof Error ? error.name : 'UnknownError',
          });
        }
      }));
    }
    if (budgetExhausted || candidates.docs.length < 100) break;
    cursor = candidates.docs[candidates.docs.length - 1];
  }
  if (budgetExhausted) console.warn('Weekly digest sweep reached its time budget.', { processed, failed });
  return queued;
}
