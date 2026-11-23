import { randomUUID } from 'node:crypto';
import { deleteApp, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { activeIeltsGoal, buildIeltsGoalModel } from '../../src/features/examProgress/ieltsGoalModel';
import { parseStoredLatestExamScore } from '../../src/features/examProgress/latestExamScore';
import { parseCourseProfile } from '../src/course-profile-contract.js';
import {
  applyCourseProfileMutation,
  createdCourseIds,
  parseCourseProfileMutationRequest,
} from '../src/course-profile-persistence.js';
import { parseSetLatestExamScoreRequest, setLatestExamScore } from '../src/exam-score-persistence.js';

const describeWithEmulator = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const createdAt = '2026-09-25T00:00:00.000Z';
const pathCounts = { total: 40, started: 6, mastered: 2, masteredLast7: 1 };

describeWithEmulator('course goals in Firestore, read the way the IELTS panel reads them', () => {
  let app: App;
  let database: Firestore;
  beforeAll(() => {
    app = initializeApp({ projectId: 'demo-lingoflash' }, 'course-profile-integration');
    database = getFirestore(app, 'ai-studio-945b4052-4462-4668-8936-277f09f07a37');
  });
  afterAll(async () => { await database.terminate(); await deleteApp(app); });

  const mutate = (ownerId: string, operation: Parameters<typeof parseCourseProfileMutationRequest>[0], payload: object) => {
    const request = parseCourseProfileMutationRequest(operation, { ownerId, ...payload });
    return applyCourseProfileMutation(database, ownerId, request).then(profile => ({ profile, request }));
  };
  const saveLatest = (ownerId: string, courseId: string, goalId: string, latestScore: string) => (
    setLatestExamScore(database, ownerId, parseSetLatestExamScoreRequest({ ownerId, courseId, goalId, latestScore }))
  );
  /** The client's path: the stored course profile, the active course, its IELTS goal and the stored latest score. */
  const readPanel = async (ownerId: string) => {
    const profileDocuments = database.collection('users').doc(ownerId).collection('profile');
    const [courses, scores] = await Promise.all([profileDocuments.doc('courses').get(), profileDocuments.doc('exam_scores').get()]);
    const profile = parseCourseProfile(courses.data());
    const course = profile.courses.find(candidate => candidate.id === profile.activeCourseId) ?? null;
    const goal = activeIeltsGoal(course);
    if (!course || !goal) return { course, goal, model: null };
    const latestScore = scores.exists ? parseStoredLatestExamScore(scores.data(), course.id, goal.id) : null;
    const model = buildIeltsGoalModel({
      counts: pathCounts,
      goal: { kind: goal.kind, level: goal.level, targetDate: goal.targetDate },
      latestScore,
      today: '2026-11-19',
    });
    return { course, goal, model };
  };

  it('finishes an English onboarding on a new account and shows the latest score against the target band', async () => {
    const ownerId = `course-onboarding-${randomUUID()}`;
    const { profile, request } = await mutate(ownerId, 'createCourse', {
      input: {
        targetLanguage: 'en', nativeLanguage: 'vi', activateOnCreate: true, operationId: `course-${randomUUID()}`,
        goals: [{ kind: 'ielts', level: '7.0', targetDate: '2027-03-01' }],
      },
    });
    const created = createdCourseIds(profile, request);
    expect(created).toEqual({ courseId: profile.activeCourseId, goals: [{ kind: 'ielts', id: expect.any(String) }] });
    // The new course is the account's only English course; there is no second English course beside it.
    expect(profile.courses.filter(course => course.targetLanguage === 'en')).toHaveLength(1);

    await saveLatest(ownerId, created!.courseId, created!.goals[0].id, '6.5');
    const panel = await readPanel(ownerId);
    expect(panel.goal?.id).toBe(created!.goals[0].id);
    expect(panel.model).toMatchObject({ targetBand: '7.0', latestScore: '6.5', examDate: '2027-03-01' });

    // A replay of the same create answers with the same ids and changes nothing.
    const replay = await mutate(ownerId, 'createCourse', { input: request.operation === 'createCourse' ? request.input : {} });
    expect(createdCourseIds(replay.profile, replay.request)).toEqual(created);
  });

  it('shows the band the goal editor writes when the course lists another goal first', async () => {
    const ownerId = `course-goals-${randomUUID()}`;
    await database.doc(`users/${ownerId}/profile/courses`).set({
      courses: [{
        id: 'course-en', targetLanguage: 'en', nativeLanguage: 'vi', status: 'active',
        goals: [{ id: 'goal-talk', kind: 'conversation', level: null, targetDate: null, status: 'active', createdAt }],
        preferences: { pronunciationVariant: null, showRomanization: false, zhScript: null },
        createdAt,
      }],
      activeCourseId: 'course-en',
    });
    const added = await mutate(ownerId, 'addGoal', { courseId: 'course-en', input: { kind: 'ielts', level: null, targetDate: null } });
    const ieltsGoal = added.profile.courses[0].goals.find(goal => goal.kind === 'ielts')!;
    expect(added.profile.courses[0].goals[0].id).toBe('goal-talk');
    expect((await readPanel(ownerId)).model).toMatchObject({ targetBand: null, latestScore: null });

    // The band picker sends the band it shows; the server stores the canonical band.
    await mutate(ownerId, 'updateGoal', { courseId: 'course-en', goalId: ieltsGoal.id, input: { level: '7,5' } });
    await saveLatest(ownerId, 'course-en', ieltsGoal.id, '6.0');
    const panel = await readPanel(ownerId);
    expect(panel.goal?.id).toBe(ieltsGoal.id);
    expect(panel.model).toMatchObject({ targetBand: '7.5', latestScore: '6.0' });
  });
});
