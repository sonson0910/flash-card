import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { VerifiedGamificationOutcome } from '../features/gamification/verifiedGamificationClient';

/** Confirms a completed streak repair once; a replayed review arrives without its streak change. */
export function announceStreakRepair(outcome: VerifiedGamificationOutcome, notify: (message: string) => void): void {
  if (!outcome.streakChange?.repaired) return;
  notify(i18n._(msg({ id: 'shell.streak.repaired', message: "Streak repaired. You're on a {count}-day streak again." }).id, { count: outcome.streak }));
}
