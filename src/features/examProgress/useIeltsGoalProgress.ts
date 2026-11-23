import { useEffect, useState } from 'react';
import type { Firestore } from 'firebase/firestore';
import type { Course } from '../courses/courseModel';
import { resolveStudyTimeZone, studyDayInZone } from '../dailyGoals/studyDayCountdown';
import { activeIeltsGoal, buildIeltsGoalModel, type IeltsGoalModel, type IeltsPathCounts } from './ieltsGoalModel';
import { readIeltsPathCounts } from './ieltsPathProgress';
import { IELTS_PATH_LANGUAGE, readIeltsPathLexemeIds } from './ieltsPathReader';
import { readLatestExamScore, subscribeToLatestExamScores } from './latestExamScore';

export interface IeltsGoalProgressOptions {
  readonly ownerId: string | null;
  readonly database: Firestore | null;
  /** The verified library epoch; progress projections from another epoch are ignored. */
  readonly libraryEpoch: number | null;
  /** The active course. The panel reads its active IELTS goal, whatever other goals the course has. */
  readonly course: Course | null;
  readonly isOffline: boolean;
  readonly rewardTimeZone?: string;
  /** A fixed clock for fixtures and tests. */
  readonly now?: Date;
}

export type IeltsGoalProgress =
  | { readonly status: 'loading' }
  /** Not an IELTS goal, no installed path, offline, or the read failed: the panel is omitted. */
  | { readonly status: 'hidden' }
  | { readonly status: 'ready'; readonly model: IeltsGoalModel; readonly courseId: string; readonly goalId: string; readonly latestScore: string | null };

interface Loaded {
  readonly key: string;
  readonly counts: IeltsPathCounts | null;
  readonly latestScore: string | null;
}

/** Loads the IELTS path progress and the learner's latest score once per goal, owner and epoch. */
export function useIeltsGoalProgress(options: IeltsGoalProgressOptions): IeltsGoalProgress {
  const { ownerId, database, libraryEpoch, course, isOffline } = options;
  const goal = activeIeltsGoal(course);
  const eligible = Boolean(ownerId && database && libraryEpoch !== null && !isOffline && course
    && course.targetLanguage === IELTS_PATH_LANGUAGE && goal !== null);
  const courseId = course?.id ?? '';
  const goalId = goal?.id ?? '';
  const key = eligible ? `${ownerId}\u0000${libraryEpoch}\u0000${courseId}\u0000${goalId}` : '';
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!key || !ownerId || !database || libraryEpoch === null) return undefined;
    let cancelled = false;
    const target = { ownerId, courseId, goalId };
    void (async () => {
      try {
        const lexemeIds = await readIeltsPathLexemeIds();
        const [counts, latestScore] = await Promise.all([
          lexemeIds ? readIeltsPathCounts({ database, ownerId, libraryEpoch, lexemeIds, now: new Date() }) : null,
          lexemeIds ? readLatestExamScore(database, target) : null,
        ]);
        if (!cancelled) setLoaded({ key, counts, latestScore });
      } catch (error) {
        if (cancelled) return;
        console.warn('IELTS goal progress could not be loaded.', { errorName: error instanceof Error ? error.name : 'UnknownError' });
        setLoaded({ key, counts: null, latestScore: null });
      }
    })();
    const unsubscribe = subscribeToLatestExamScores(saved => {
      if (cancelled || saved.ownerId !== ownerId || saved.courseId !== courseId || saved.goalId !== goalId) return;
      setLoaded(current => (current?.key === key ? { ...current, latestScore: saved.latestScore } : current));
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [key, ownerId, database, libraryEpoch, courseId, goalId]);

  if (!eligible || !goal) return { status: 'hidden' };
  if (loaded?.key !== key) return { status: 'loading' };
  if (!loaded.counts) return { status: 'hidden' };
  const today = studyDayInZone(options.now ?? new Date(), resolveStudyTimeZone(options.rewardTimeZone));
  const model = buildIeltsGoalModel({
    counts: loaded.counts,
    goal: { kind: goal.kind, level: goal.level, targetDate: goal.targetDate },
    latestScore: loaded.latestScore,
    today,
  });
  return model ? { status: 'ready', model, courseId, goalId, latestScore: loaded.latestScore } : { status: 'hidden' };
}
