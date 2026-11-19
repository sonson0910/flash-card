import { createContext, useContext, type ReactNode } from 'react';

/** The signed-in learner's verified level and XP, as the shell header shows them. */
export interface AchievementsLearnerLevel {
  readonly level: number;
  readonly xp: number;
}

const AchievementsLearnerContext = createContext<AchievementsLearnerLevel | null>(null);

/**
 * The app runtime knows the verified level; the achievements board sits a few
 * screens down inside the progress workspace. The context carries the level
 * there without threading it through every screen in between. Without a
 * provider the board shows badge progress instead of the level.
 */
export function AchievementsLearnerProvider({ learner, children }: { readonly learner: AchievementsLearnerLevel | null; readonly children?: ReactNode }) {
  return <AchievementsLearnerContext.Provider value={learner}>{children}</AchievementsLearnerContext.Provider>;
}

export const useAchievementsLearner = (): AchievementsLearnerLevel | null => useContext(AchievementsLearnerContext);

export interface AchievementsLevelFacts {
  readonly level: number;
  readonly xp: number;
  readonly start: number;
  readonly next: number;
  readonly remaining: number;
  /** Progress through the current level, 0–100. */
  readonly percent: number;
}

/** Level thresholds follow the server curve the header uses: level n starts at 100·(n−1)² XP. */
export const achievementsLevelFacts = (learner: AchievementsLearnerLevel | null): AchievementsLevelFacts | null => {
  if (!learner || !Number.isFinite(learner.level) || learner.level < 1 || !Number.isFinite(learner.xp) || learner.xp < 0) return null;
  const level = Math.floor(learner.level);
  const xp = Math.floor(learner.xp);
  const start = 100 * (level - 1) ** 2;
  const next = 100 * level ** 2;
  const percent = Math.max(0, Math.min(100, Math.round(((xp - start) / (next - start)) * 100)));
  return { level, xp, start, next, remaining: Math.max(0, next - xp), percent };
};
