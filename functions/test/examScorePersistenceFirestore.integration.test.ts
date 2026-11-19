import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyticsPseudonym } from '../src/analyticsEvents.js';
import { exportAccountData, purgeAccountData } from '../src/accountData.js';
import { parseSetLatestExamScoreRequest, setLatestExamScore } from '../src/exam-score-persistence.js';

const describeWithEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const key = 'exam-score-test-secret'.padEnd(32, 'x');
const createdAt = '2026-09-25T00:00:00.000Z';

const profileFor = (goalId: string) => ({
  courses: [{
    id: 'course-en',
    targetLanguage: 'en',
    nativeLanguage: 'vi',
    status: 'active',
    goals: [{ id: goalId, kind: 'ielts', level: '7.0', targetDate: null, status: 'active', createdAt }],
    preferences: { pronunciationVariant: null, showRomanization: false, zhScript: null },
    createdAt,
  }],
  activeCourseId: 'course-en',
});

describeWithEmulator('latest exam scores in Firestore', () => {
  let app: App;
  let database: Firestore;
  beforeAll(() => {
    app = initializeApp({ projectId: 'demo-lingoflash' }, 'exam-score-integration');
    database = getFirestore(app, 'ai-studio-945b4052-4462-4668-8936-277f09f07a37');
  });
  afterAll(async () => { await database.terminate(); await deleteApp(app); });

  const seedOwner = async () => {
    const ownerId = `exam-score-${randomUUID()}`;
    const goalId = `goal-${randomUUID()}`;
    await database.doc(`users/${ownerId}/profile/courses`).set(profileFor(goalId));
    return { ownerId, goalId, scores: database.doc(`users/${ownerId}/profile/exam_scores`) };
  };
  const send = (ownerId: string, goalId: string, latestScore: string | null, now = '2026-11-19T08:00:00.000Z') => (
    setLatestExamScore(database, ownerId, parseSetLatestExamScoreRequest({
      ownerId, courseId: 'course-en', goalId, latestScore,
    }), { now: () => now })
  );

  it('stores, repeats without a change, clears, and refuses another account goal', async () => {
    const { ownerId, goalId, scores } = await seedOwner();
    const other = await seedOwner();
    await send(ownerId, goalId, '6,5');
    const first = (await scores.get()).data();
    expect(first).toEqual({
      schemaVersion: 1,
      goals: { [goalId]: { courseId: 'course-en', band: '6.5', updatedAt: '2026-11-19T08:00:00.000Z' } },
    });
    await send(ownerId, goalId, '6.5', '2026-11-20T08:00:00.000Z');
    expect((await scores.get()).data()).toEqual(first);
    await expect(send(ownerId, other.goalId, '7.0')).rejects.toMatchObject({ reason: 'goal-not-found' });
    expect((await other.scores.get()).exists).toBe(false);
    await send(ownerId, goalId, null);
    expect((await scores.get()).exists).toBe(false);
  });

  it('is part of the account data download and is removed by account deletion', async () => {
    const { ownerId, goalId, scores } = await seedOwner();
    await send(ownerId, goalId, '5.5');
    const exported = await exportAccountData(database, ownerId, key) as { profile: Array<{ id: string }> };
    expect(exported.profile).toContainEqual({
      id: 'exam_scores',
      schemaVersion: 1,
      goals: { [goalId]: { courseId: 'course-en', band: '5.5', updatedAt: '2026-11-19T08:00:00.000Z' } },
    });
    await purgeAccountData(database, ownerId, analyticsPseudonym(ownerId, key));
    expect((await scores.get()).exists).toBe(false);
  });
});
