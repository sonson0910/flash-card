import { msg } from '@lingui/core/macro';
import type { MessageDescriptor } from '@lingui/core';
import {
  LATE_REVIEW_END_HOUR,
  LATE_REVIEW_START_HOUR,
  type AchievementMetric,
  type AchievementRecord,
  type AchievementTier,
} from '../../../functions/src/achievement-rules';
import { buildAchievementsView, levelProgress, type AchievementBadgeView, type LevelProgressView } from '../../features/gamification/achievementsView';
import { buildStreakView } from '../../features/gamification/streakView';
import { buildStudyTimeView } from '../../features/gamification/studyTimeView';
import type { LibraryStatsViewModel } from '../../features/library/libraryViewModel';
import { getDateTimeFormat } from '../../lib/format';
import type { AchievementsLearnerLevel } from './AchievementsMatrixLearner';

/** Visual/eligibility state of a badge, derived only from real progress numbers — no invented gating conditions. */
export type AchievementBadgeVisualState = 'earned' | 'in-progress' | 'locked';

/** Stable, locale-independent grouping key for the badge tiers. */
export type AchievementBadgeTierKey = AchievementTier;

/** Numeric identity of every badge the board works out from library statistics, stable across locales and callers. */
export type AchievementBadgeId = 'streak_3' | 'mastery_10' | 'mastery_50' | 'xp_100' | 'xp_total_500' | 'night_owl';

export interface AchievementBadgeStat {
  readonly id: AchievementBadgeId;
  readonly unlocked: boolean;
  readonly progress: number;
  readonly current: number;
  readonly target: number;
}

/**
 * A badge is `earned` once unlocked, `in-progress` once the learner has made any real progress
 * toward it, and `locked` only when there is no progress signal yet (current === 0). This never
 * invents a prerequisite/gate — every badge here is always achievable — it just distinguishes
 * "not started" from "actively working on it" so the grid can show three distinct states.
 */
export function resolveAchievementBadgeState(stat: Pick<AchievementBadgeStat, 'unlocked' | 'current'>): AchievementBadgeVisualState {
  if (stat.unlocked) return 'earned';
  return stat.current > 0 ? 'in-progress' : 'locked';
}

/**
 * Locale-independent badge math shared by the achievements board (before the server records
 * badges) and the weekly recap milestones strip, so both read the exact same thresholds from
 * the exact same `LibraryStatsViewModel` instead of drifting apart.
 */
/** A badge below its target never reads 100%, whatever the rounding. */
const progressTowards = (current: number, target: number): number =>
  current >= target ? 100 : Math.min(99, Math.floor(current / target * 100));

export function computeAchievementBadgeStats(stats: LibraryStatsViewModel): AchievementBadgeStat[] {
  const totalXp = stats.xpChartData.reduce((sum, item) => sum + item.XP, 0);
  const maxSingleDayXp = Math.max(0, ...stats.xpChartData.map(item => item.XP));
  const activeDays = stats.xpChartData.filter(item => item.XP > 0).length;
  return [
    { id: 'streak_3', unlocked: activeDays >= 3, progress: progressTowards(activeDays, 3), current: activeDays, target: 3 },
    { id: 'mastery_10', unlocked: stats.reviewed >= 10, progress: progressTowards(stats.reviewed, 10), current: stats.reviewed, target: 10 },
    { id: 'mastery_50', unlocked: stats.learned >= 50, progress: progressTowards(stats.learned, 50), current: stats.learned, target: 50 },
    { id: 'xp_100', unlocked: maxSingleDayXp >= 100, progress: progressTowards(maxSingleDayXp, 100), current: maxSingleDayXp, target: 100 },
    { id: 'xp_total_500', unlocked: totalXp >= 500, progress: progressTowards(totalXp, 500), current: totalXp, target: 500 },
    { id: 'night_owl', unlocked: activeDays >= 5, progress: progressTowards(activeDays, 5), current: activeDays, target: 5 },
  ];
}

/** What a badge's numbers count, for the "{n} to go" line. */
export type BoardBadgeUnit = 'days' | 'cards' | 'words' | 'xp' | 'reviews' | 'answers';

const legacyBadges: Record<AchievementBadgeId, { readonly tier: AchievementTier; readonly unit: BoardBadgeUnit }> = {
  streak_3: { tier: 'bud', unit: 'days' },
  mastery_10: { tier: 'bloom', unit: 'words' },
  mastery_50: { tier: 'star', unit: 'words' },
  xp_100: { tier: 'bloom', unit: 'xp' },
  xp_total_500: { tier: 'star', unit: 'xp' },
  night_owl: { tier: 'bud', unit: 'days' },
};

const metricUnits: Record<AchievementMetric, BoardBadgeUnit> = {
  reviewedCards: 'cards',
  activeDays: 'days',
  bestDayXp: 'xp',
  streak: 'days',
  lateReviews: 'reviews',
  spellingCorrect: 'answers',
  verifiedXp: 'xp',
  masteredWords: 'words',
};

/** One badge as the board draws it, whether the server recorded it or the library statistics stand in. */
export interface BoardBadge {
  readonly id: string;
  readonly tier: AchievementTier;
  readonly state: AchievementBadgeVisualState;
  /** Progress shown next to the target: the target itself once earned. */
  readonly value: number;
  readonly target: number;
  /** Share of the target, 0–100; 100 only once earned. */
  readonly percent: number;
  readonly unit: BoardBadgeUnit;
  /** The study day the server recorded; null before badges are recorded. */
  readonly earned: AchievementRecord | null;
}

export interface BoardTitle {
  readonly id: string;
  readonly level: number;
  /** Recorded, or granted by the rewards inventory before titles were recorded. */
  readonly held: boolean;
  readonly earned: AchievementRecord | null;
  /** The title the learner's card shows: the highest one held. */
  readonly shown: boolean;
}

export interface AchievementsBoardModel {
  /** The twelve verifiable badges with their recorded days; false while the library statistics stand in. */
  readonly recorded: boolean;
  readonly badges: readonly BoardBadge[];
  readonly earnedCount: number;
  /** The badge the meter, the Crystal featured card and Lumi point at. */
  readonly featured: BoardBadge;
  /** Null when the learner is signed out or the level is not usable. */
  readonly level: LevelProgressView | null;
  /** Empty without the verified state. */
  readonly titles: readonly BoardTitle[];
  readonly shownTitleId: string | null;
  /** Summary tiles from the verified state; null where it has no value yet. */
  readonly totalXp: number | null;
  readonly bestStreak: number | null;
  readonly paceMinutes: number | null;
}

const usableLearner = (learner: AchievementsLearnerLevel | null): learner is AchievementsLearnerLevel => Boolean(learner)
  && Number.isFinite(learner!.level) && learner!.level >= 1 && Number.isFinite(learner!.xp) && learner!.xp >= 0;

const fromLegacy = (stat: AchievementBadgeStat): BoardBadge => ({
  id: stat.id,
  tier: legacyBadges[stat.id].tier,
  state: resolveAchievementBadgeState(stat),
  value: stat.unlocked ? stat.target : Math.min(stat.current, stat.target),
  target: stat.target,
  percent: stat.progress,
  unit: legacyBadges[stat.id].unit,
  earned: null,
});

const fromRecorded = (badge: AchievementBadgeView): BoardBadge => {
  const earned = badge.earned;
  const value = earned ? badge.target : Math.min(badge.value, badge.target);
  return {
    id: badge.id,
    tier: badge.tier,
    state: badge.state === 'not-started' ? 'locked' : badge.state,
    value,
    target: badge.target,
    // An unrecorded badge never reads 100% before the server records it.
    percent: earned ? 100 : Math.min(99, Math.floor(badge.progress * 100)),
    unit: metricUnits[badge.metric],
    earned,
  };
};

/** The badge closest to being earned; the first not started when none is in progress. */
const pickFeatured = (badges: readonly BoardBadge[]): BoardBadge => {
  const inProgress = badges.filter(badge => badge.state === 'in-progress');
  if (inProgress.length > 0) return inProgress.reduce((best, badge) => badge.percent > best.percent ? badge : best);
  return badges.find(badge => badge.state === 'locked') ?? badges[badges.length - 1];
};

/**
 * Everything the achievements board draws. Signed out, it is the board the library statistics
 * give. Signed in, the verified state adds the level, the title, the summary tiles and, once the
 * server records them, the twelve badges with the day each was earned.
 */
export function buildAchievementsBoard(stats: LibraryStatsViewModel, learner: AchievementsLearnerLevel | null, now: Date): AchievementsBoardModel {
  const signedIn = usableLearner(learner) ? learner : null;
  const state = signedIn?.gamification;
  const streak = state ? buildStreakView(state, now) : null;
  const view = state && streak ? buildAchievementsView(state, streak.length) : null;
  const badges = view?.recorded ? view.badges.map(fromRecorded) : computeAchievementBadgeStats(stats).map(fromLegacy);
  const paceMs = state ? buildStudyTimeView(state, now)?.dailyAverageMs ?? null : null;
  return {
    recorded: Boolean(view?.recorded),
    badges,
    earnedCount: badges.filter(badge => badge.state === 'earned').length,
    featured: pickFeatured(badges),
    level: signedIn ? levelProgress(signedIn.xp) : null,
    titles: view && state ? view.titles.map(title => ({
      id: title.id,
      level: title.level,
      held: Boolean(title.earned) || state.rewards.ownedTitleIds.includes(title.id),
      earned: title.earned,
      shown: title.shown,
    })) : [],
    shownTitleId: view?.shownTitleId ?? null,
    totalXp: state && signedIn ? signedIn.xp : null,
    bestStreak: streak?.best && streak.best.length > 0 ? streak.best.length : null,
    paceMinutes: paceMs === null ? null : Math.max(1, Math.round(paceMs / 60_000)),
  };
}

const studyDayDate = (day: string): Date => new Date(`${day}T00:00:00Z`);

/**
 * A recorded study day as the badge footer shows it: day and short month in the learner's
 * locale, with the year only when it is not the current one. UTC keeps the day from shifting.
 */
export function formatEarnedDay(day: string, now: Date): string {
  const date = studyDayDate(day);
  const withYear = date.getUTCFullYear() !== now.getFullYear();
  const parts = getDateTimeFormat({ day: '2-digit', month: 'short', timeZone: 'UTC', ...(withYear ? { year: 'numeric' } : {}) }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(entry => entry.type === type)?.value;
  return [part('day'), part('month'), withYear ? part('year') : undefined].filter(Boolean).join(' ');
}

/** The full date for screen-reader text. */
export const formatEarnedDayLong = (day: string): string => getDateTimeFormat({ day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(studyDayDate(day));

/** The late-review window's edges, as clock times in the learner's locale. */
export const lateReviewWindow = (): { readonly start: string; readonly end: string } => {
  const clock = getDateTimeFormat({ hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
  const at = (hour: number) => clock.format(Date.UTC(2026, 0, 1, hour));
  return { start: at(LATE_REVIEW_START_HOUR), end: at(LATE_REVIEW_END_HOUR) };
};

/** Names and exact conditions of the twelve badges the server records, keyed by catalog id. */
export const recordedBadgeCopy: Readonly<Record<string, { readonly name: MessageDescriptor; readonly condition: MessageDescriptor }>> = {
  'first-review': {
    name: msg({ id: 'achievements.badge.first-review', message: 'First spark' }),
    condition: msg({ id: 'achievements.badge.first-review.condition', message: 'Finish your first review.' }),
  },
  'active-days-3': {
    name: msg({ id: 'achievements.badge.active-days-3', message: 'Bud routine' }),
    condition: msg({ id: 'achievements.badge.active-days-3.condition', message: 'Earn XP on {target} different days.' }),
  },
  'active-days-5': {
    name: msg({ id: 'achievements.badge.active-days-5', message: 'Steady return' }),
    condition: msg({ id: 'achievements.badge.active-days-5.condition', message: 'Earn XP on {target} different days.' }),
  },
  'reviewed-10': {
    name: msg({ id: 'achievements.badge.reviewed-10', message: 'Blooming recall' }),
    condition: msg({ id: 'achievements.badge.reviewed-10.condition', message: 'Review {target} different cards.' }),
  },
  'day-xp-100': {
    name: msg({ id: 'achievements.badge.day-xp-100', message: 'Bright study day' }),
    condition: msg({ id: 'achievements.badge.day-xp-100.condition', message: 'Earn {target} XP in one day.' }),
  },
  'streak-7': {
    name: msg({ id: 'achievements.badge.streak-7', message: 'Week of fire' }),
    condition: msg({ id: 'achievements.badge.streak-7.condition', message: '{target} days in a row.' }),
  },
  'late-reviews-10': {
    name: msg({ id: 'achievements.badge.late-reviews-10', message: 'Night owl' }),
    condition: msg({ id: 'achievements.badge.late-reviews-10.condition', message: '{target} reviews between {start} and {end}.' }),
  },
  'spelling-50': {
    name: msg({ id: 'achievements.badge.spelling-50', message: 'Sharp ear' }),
    condition: msg({ id: 'achievements.badge.spelling-50.condition', message: '{target} correct answers in Spelling.' }),
  },
  'xp-500': {
    name: msg({ id: 'achievements.badge.xp-500', message: 'Growing collection' }),
    condition: msg({ id: 'achievements.badge.xp-500.condition', message: 'Collect {target} XP.' }),
  },
  'mastered-50': {
    name: msg({ id: 'achievements.badge.mastered-50', message: 'Star keeper' }),
    condition: msg({ id: 'achievements.badge.mastered-50.condition', message: '{target} words rated Easy.' }),
  },
  'mastered-100': {
    name: msg({ id: 'achievements.badge.mastered-100', message: 'Century' }),
    condition: msg({ id: 'achievements.badge.mastered-100.condition', message: '{target} words rated Easy.' }),
  },
  'web-wanderer': {
    name: msg({ id: 'achievements.badge.web-wanderer', message: 'Web Wanderer' }),
    condition: msg({ id: 'achievements.badge.web-wanderer.condition', message: '{target} days in a row.' }),
  },
};

/** Title names, keyed by catalog id. */
export const titleCopy: Readonly<Record<string, MessageDescriptor>> = {
  'word-keeper': msg({ id: 'achievements.title.word-keeper', message: 'Word keeper' }),
  'word-collector': msg({ id: 'achievements.title.word-collector', message: 'Word collector' }),
};
