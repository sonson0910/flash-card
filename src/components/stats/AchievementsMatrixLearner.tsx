import { createContext, useContext, type ReactNode } from 'react';
import type { VerifiedGamificationState } from '../../features/gamification/verifiedGamificationClient';
import type { SyncIdentityViewModel } from '../shell/shellTypes';

/** The signed-in learner's verified level and XP, as the shell header shows them. */
export interface AchievementsLearnerLevel {
  readonly level: number;
  readonly xp: number;
  /**
   * The verified state the app already listens to (stats, XP history and rewards): badge and
   * title records, the streak record and study time. Without it the board keeps the badges it
   * works out from the library statistics.
   */
  readonly gamification?: VerifiedGamificationState;
  /**
   * The account the header's account menu shows, so the profile card draws the same avatar.
   * Without it the profile card shows a person icon and no name.
   */
  readonly identity?: SyncIdentityViewModel;
}

const AchievementsLearnerContext = createContext<AchievementsLearnerLevel | null>(null);

/**
 * The app runtime owns the verified level; the achievements board sits a few screens down. The
 * context carries the level there without threading it through the Progress screen.
 */
export function AchievementsLearnerProvider({ learner, children }: { readonly learner: AchievementsLearnerLevel | null; readonly children?: ReactNode }) {
  return <AchievementsLearnerContext.Provider value={learner}>{children}</AchievementsLearnerContext.Provider>;
}

export const useAchievementsLearner = (): AchievementsLearnerLevel | null => useContext(AchievementsLearnerContext);
