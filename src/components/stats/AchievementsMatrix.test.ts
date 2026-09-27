import { describe, expect, it } from 'vitest';
import { achievementBadgeCopy, findNewlyUnlockedBadgeIds, resolveAchievementBadgeState } from './AchievementsMatrix';

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

describe('resolveAchievementBadgeState', () => {
  it('is earned once the badge is unlocked, regardless of current progress', () => {
    expect(resolveAchievementBadgeState({ unlocked: true, current: 3 })).toBe('earned');
  });

  it('is in-progress when unearned but the learner has made real progress', () => {
    expect(resolveAchievementBadgeState({ unlocked: false, current: 1 })).toBe('in-progress');
  });

  it('is locked only when there is no progress signal yet, never from an invented gate', () => {
    expect(resolveAchievementBadgeState({ unlocked: false, current: 0 })).toBe('locked');
  });
});

describe('achievement badge tier grouping', () => {
  it('assigns every badge a stable, locale-independent tier key used to group the grid', () => {
    const tierKeysById = Object.fromEntries(
      Object.entries(achievementBadgeCopy).map(([id, copy]) => [id, copy.tierKey]),
    );
    expect(tierKeysById).toEqual({
      streak_3: 'bud',
      mastery_10: 'bloom',
      mastery_50: 'star',
      xp_100: 'bloom',
      xp_total_500: 'star',
      night_owl: 'bud',
    });
  });
});
