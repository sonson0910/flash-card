import { describe, expect, it } from 'vitest';
import { findNewlyUnlockedBadgeIds } from './AchievementsMatrix';

describe('achievement unlock feedback', () => {
  it('celebrates only badges that changed from locked to unlocked', () => {
    expect(findNewlyUnlockedBadgeIds(
      new Set(['streak_3']),
      new Set(['streak_3', 'mastery_10']),
    )).toEqual(['mastery_10']);
  });

  it('does not celebrate badges that were already unlocked', () => {
    expect(findNewlyUnlockedBadgeIds(
      new Set(['streak_3']),
      new Set(['streak_3']),
    )).toEqual([]);
  });
});
