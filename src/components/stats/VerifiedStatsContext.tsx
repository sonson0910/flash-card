import { createContext, useContext, type ReactNode } from 'react';
import type { VerifiedGamificationState } from '../../features/gamification/verifiedGamificationClient';

/** The card fields the weekly recap shows for its word of the week. */
export interface VerifiedStatsCard {
  readonly id: string;
  readonly word: string;
}

/**
 * The verified stats the Progress, Stats and weekly recap surfaces read: the state the app already
 * hydrated from `profile/stats` and `profile/xp_history`, the course language those screens show,
 * and an optional single-card loader for the word of the week.
 */
export interface VerifiedStatsSource {
  readonly state: VerifiedGamificationState | null;
  readonly language: string;
  /** Reads one card document. Called only when the learner shows the word of the week. */
  readonly loadCard?: (cardId: string) => Promise<VerifiedStatsCard | null>;
}

const VerifiedStatsContext = createContext<VerifiedStatsSource | null>(null);

/**
 * The app runtime holds the verified state; Progress, its charts and the weekly recap sit a few
 * screens down. The context carries the state there without threading it through each screen.
 * Without a provider every element that needs it is left out, as before the data existed.
 */
export function VerifiedStatsProvider({ source, children }: { readonly source: VerifiedStatsSource | null; readonly children?: ReactNode }) {
  return <VerifiedStatsContext.Provider value={source}>{children}</VerifiedStatsContext.Provider>;
}

export const useVerifiedStats = (): VerifiedStatsSource | null => useContext(VerifiedStatsContext);
