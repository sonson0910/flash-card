import { randomUUID } from 'node:crypto';
import { Timestamp, type DocumentReference, type Firestore } from 'firebase-admin/firestore';
import { AGE_RESTRICTION_DOCUMENT_ID } from './account-profile-contract.js';
import { InputValidationError } from './inputValidation.js';
import { disableEmailDigest } from './reminderSettingsPersistence.js';
import { nextReminderAfterScheduledDay, quietHoursEndAfter, studiedOnStudyDay } from './reminderSchedule.js';
import { reminderTodayUrl } from './reminderAppOrigin.js';
import { parseStreakState, streakStatus } from './streak-rules.js';
import { isCount, isStudyDay, studyDaysBetween } from './study-day-rules.js';

// Queued mail holds the learner's address; the collection TTL removes it after delivery.
export const MAIL_RETENTION_MS = 30 * 24 * 60 * 60_000;

const ownerFromStatePath = (path: string): string => {
  const match = /^users\/([^/]+)\/reminderState\/current$/.exec(path);
  if (!match) throw new InputValidationError('Reminder state path is invalid.');
  return match[1];
};

const studyDayIn = (now: Date, timeZone: unknown): string | null => {
  if (typeof timeZone !== 'string' || !timeZone) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const day = ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-');
    return isStudyDay(day) ? day : null;
  } catch {
    return null;
  }
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
      ? studiedOnStudyDay(studiedAt.toDate(), now, stats?.rewardTimeZone, state.timezone) : false;
    const stale = now.getTime() - eligibleAt > 24 * 60 * 60_000;
    const sends = dueCount > 0 && !receipt.exists && Boolean(email) && Boolean(studiedAt) && !studiedToday && !stale;
    // Read only when a send is otherwise due. A restricted account keeps no digest schedule.
    if (sends && (await transaction.get(owner.collection('profile').doc(AGE_RESTRICTION_DOCUMENT_ID))).exists) {
      disableEmailDigest(transaction, stateRef, now);
      return false;
    }
    // The run as the next review would find it: missed days use held freezes, and a gap they cannot
    // bridge ends the run. The stored count alone still shows a run that has already ended.
    const run = isCount(stats?.verifiedStreak) ? stats.verifiedStreak : 0;
    const lastStudyDay = isStudyDay(stats?.lastVerifiedStudyDay) ? stats.lastVerifiedStudyDay : null;
    const today = studyDayIn(now, stats?.rewardTimeZone) ?? studyDayIn(now, state.timezone);
    const streakRecord = parseStreakState(stats?.streakV1);
    // Until the server writes the record, freezes are still held in the rewards document.
    const needsLegacyFreezes = sends && !streakRecord && run > 0 && lastStudyDay !== null && today !== null
      && studyDaysBetween(lastStudyDay, today) > 1;
    const legacyFreezes = needsLegacyFreezes
      ? (await transaction.get(owner.collection('profile').doc('rewards'))).data()?.streakFreezes : 0;
    transaction.update(stateRef, {
      nextWeeklyDigestAt: Timestamp.fromDate(next.at),
      nextWeeklyDigestLocalDay: next.scheduledDay,
      updatedAt: Timestamp.fromDate(now),
    });
    if (!sends || !email) return false;

    const streak = today === null ? run : streakStatus({
      run, lastStudyDay, today, state: streakRecord, legacyFreezes: isCount(legacyFreezes) ? legacyFreezes : 0,
    }).length;
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
