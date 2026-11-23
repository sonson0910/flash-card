import { describe, expect, it } from 'vitest';
import { buildAchievementsView, levelProgress } from './achievementsView';
import { achievementsFixture, stateFromFixture } from './testing/verifiedStatsFixtures';
import { verifiedGamificationFromDocuments } from './verifiedGamificationClient';

describe('buildAchievementsView', () => {
  it('shows badges already met when recording began as earned by that day, and progress for the rest', () => {
    const view = buildAchievementsView(stateFromFixture(achievementsFixture));
    expect(view).toMatchObject({ recorded: true, recordingStartedOn: '2026-11-27', earnedCount: 6, total: 12, shownTitleId: null });
    const badge = (id: string) => view.badges.find(item => item.id === id);
    expect(view.badges.map(item => item.id)).toEqual([
      'first-review', 'active-days-3', 'active-days-5', 'reviewed-10', 'day-xp-100', 'streak-7',
      'late-reviews-10', 'spelling-50', 'xp-500', 'mastered-50', 'mastered-100', 'web-wanderer',
    ]);
    expect(badge('first-review')).toMatchObject({ state: 'earned', progress: 1, earned: { on: '2026-11-27', exact: false } });
    expect(badge('xp-500')).toMatchObject({ state: 'earned', value: 622 });
    expect(badge('mastered-50')).toMatchObject({ state: 'in-progress', value: 13, target: 50, progress: 0.26, earned: null });
    expect(badge('late-reviews-10')).toMatchObject({ state: 'in-progress', value: 1 });
    expect(badge('spelling-50')).toMatchObject({ state: 'not-started', value: 0, progress: 0 });
    expect(badge('streak-7')).toMatchObject({ state: 'in-progress', value: 4, tier: 'bloom' });
    expect(badge('web-wanderer')).toMatchObject({ value: 4, target: 30, tier: 'star' });
  });

  it('moves the streak badges with the streak the screen shows', () => {
    const view = buildAchievementsView(stateFromFixture(achievementsFixture), 0);
    expect(view.badges.find(item => item.id === 'streak-7')).toMatchObject({ value: 0, state: 'not-started' });
  });

  it('shows the highest recorded title, with its date', () => {
    const stats = achievementsFixture.stats as Record<string, unknown>;
    const record = stats.achievementsV1 as Record<string, unknown>;
    const state = verifiedGamificationFromDocuments({
      ...stats,
      verifiedXp: 14_820,
      achievementsV1: {
        ...record,
        titles: { 'word-keeper': { on: '2026-11-27', exact: false }, 'word-collector': { on: '2026-12-03', exact: true } },
      },
    }, {}, {});
    const view = buildAchievementsView(state);
    expect(view.shownTitleId).toBe('word-collector');
    expect(view.titles).toEqual([
      { id: 'word-keeper', level: 5, earned: { on: '2026-11-27', exact: false }, shown: false },
      { id: 'word-collector', level: 13, earned: { on: '2026-12-03', exact: true }, shown: true },
    ]);
    expect(view.level).toEqual({ level: 13, xpIntoLevel: 420, levelSpan: 2_500, progress: 0.168 });
  });

  it('falls back to the earlier badge screen and the rewards title until the server records achievements', () => {
    const state = verifiedGamificationFromDocuments({ verifiedXp: 14_401 }, {}, { ownedTitleIds: ['word-collector'] });
    const view = buildAchievementsView(state);
    expect(view).toMatchObject({ recorded: false, badges: [], earnedCount: 0, shownTitleId: 'word-collector' });
    expect(view.titles.find(title => title.id === 'word-collector')).toMatchObject({ earned: null, shown: true });
  });

  it('computes level progress with the server curve', () => {
    expect(levelProgress(0)).toEqual({ level: 1, xpIntoLevel: 0, levelSpan: 100, progress: 0 });
    expect(levelProgress(1_600)).toEqual({ level: 5, xpIntoLevel: 0, levelSpan: 900, progress: 0 });
    expect(levelProgress(1_599)).toMatchObject({ level: 4, xpIntoLevel: 699, levelSpan: 700 });
  });
});
