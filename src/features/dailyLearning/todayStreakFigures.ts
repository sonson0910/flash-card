import type { StreakView } from '../gamification/streakView';
import type { StudyRun } from './todayScreenFacts';

/**
 * The streak figures Today and the session recap show, read from the server's streak projection.
 * A study day counts only once the server accepted a review for it, so XP from a card create, a
 * practice round or a match never makes today count, and a run that has ended has length 0.
 */
export const verifiedStreakFigures = (view: Pick<StreakView, 'status' | 'length'>): { readonly streakDays: number; readonly run: StudyRun } => {
  const studiedToday = view.status === 'safe';
  return { streakDays: studiedToday ? view.length : 0, run: { studiedToday, days: view.length } };
};
