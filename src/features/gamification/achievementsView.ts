import {
  ACHIEVEMENT_BADGES,
  ACHIEVEMENT_TITLES,
  levelForVerifiedXp,
  type AchievementBadge,
  type AchievementCounters,
  type AchievementMetric,
  type AchievementRecord,
} from '../../../functions/src/achievement-rules';
import type { VerifiedGamificationState } from './verifiedGamificationClient';

export interface AchievementBadgeView extends AchievementBadge {
  /** The metric's current value; it can pass `target`. */
  readonly value: number;
  /** Share of the target reached, 0 to 1. */
  readonly progress: number;
  /** When the server recorded it; null until then. */
  readonly earned: AchievementRecord | null;
  readonly state: 'earned' | 'in-progress' | 'not-started';
}

export interface AchievementTitleView {
  readonly id: string;
  readonly level: number;
  readonly earned: AchievementRecord | null;
  /** This is the title shown on the learner's card. */
  readonly shown: boolean;
}

export interface LevelProgressView {
  readonly level: number;
  /** Verified XP earned inside the current level. */
  readonly xpIntoLevel: number;
  /** Verified XP the current level spans. */
  readonly levelSpan: number;
  /** Share of the level done, 0 to 1. */
  readonly progress: number;
}

export interface AchievementsView {
  /** False until the server has recorded badges; screens then keep their earlier badge display. */
  readonly recorded: boolean;
  readonly recordingStartedOn: string | null;
  /** The twelve verifiable badges in catalog order; empty until recorded. */
  readonly badges: readonly AchievementBadgeView[];
  readonly earnedCount: number;
  readonly total: number;
  readonly titles: readonly AchievementTitleView[];
  /** The highest title held, or null when none is. */
  readonly shownTitleId: string | null;
  readonly level: LevelProgressView;
}

/** XP inside the current level, using the level curve the server uses (level L starts at 100(L−1)² XP). */
export const levelProgress = (xp: number): LevelProgressView => {
  const level = levelForVerifiedXp(xp);
  const levelStart = 100 * (level - 1) ** 2;
  const levelSpan = 100 * (2 * level - 1);
  const xpIntoLevel = Math.max(0, xp - levelStart);
  return { level, xpIntoLevel, levelSpan, progress: Math.min(1, xpIntoLevel / levelSpan) };
};

const metricValue = (metric: AchievementMetric, counters: AchievementCounters, xp: number, streak: number): number => {
  switch (metric) {
    case 'streak': return streak;
    case 'verifiedXp': return xp;
    default: return counters[metric];
  }
};

/**
 * Badge progress and earned dates, titles and level progress. `displayedStreak` is the streak
 * the screen's header shows, so the streak badges move with it.
 */
export function buildAchievementsView(state: VerifiedGamificationState, displayedStreak = state.streak): AchievementsView {
  const record = state.achievements;
  const badges = record ? ACHIEVEMENT_BADGES.map((badge): AchievementBadgeView => {
    const value = metricValue(badge.metric, record.counters, state.xp, displayedStreak);
    const earned = record.badges[badge.id] ?? null;
    return {
      ...badge,
      value,
      progress: earned ? 1 : Math.min(1, value / badge.target),
      earned,
      state: earned ? 'earned' : value > 0 ? 'in-progress' : 'not-started',
    };
  }) : [];
  // Without a record, the titles the rewards inventory already grants still show.
  const heldTitle = (id: string) => Boolean(record?.titles[id]) || state.rewards.ownedTitleIds.includes(id);
  const shownTitleId = [...ACHIEVEMENT_TITLES].reverse().find(title => heldTitle(title.id))?.id ?? null;
  return {
    recorded: Boolean(record),
    recordingStartedOn: record?.recordingStartedOn ?? null,
    badges,
    earnedCount: badges.filter(badge => badge.earned).length,
    total: ACHIEVEMENT_BADGES.length,
    titles: ACHIEVEMENT_TITLES.map(title => ({
      ...title,
      earned: record?.titles[title.id] ?? null,
      shown: title.id === shownTitleId,
    })),
    shownTitleId,
    level: levelProgress(state.xp),
  };
}
