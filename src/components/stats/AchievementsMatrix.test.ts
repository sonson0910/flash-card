import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { describe, expect, it } from 'vitest';
import type { LibraryStatsViewModel } from '../../features/library/libraryViewModel';
import { achievementBadgeCopy, AchievementsMatrix, findNewlyUnlockedBadgeIds, resolveAchievementBadgeState } from './AchievementsMatrix';
import { AchievementsLearnerProvider, achievementsLevelFacts } from './AchievementsMatrixLearner';

i18n.load('en', {});
i18n.activate('en');

const stats = (): LibraryStatsViewModel => ({ total: 1, reviewed: 1, learned: 0, learning: 1, dueToday: 1, categoryChart: [], categoryChartIsPartial: false, difficultyChart: [], xpChartData: [{ date: '2026-09-28', XP: 100 }] });

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

describe('dedicated achievements presentation', () => {
  it('uses the six real computed badges and provides a route back to Progress', () => {
    const html = renderToStaticMarkup(createElement(I18nProvider, { i18n }, createElement(AchievementsMatrix, { stats: stats(), onBackToProgress: () => {} })));

    expect(html).toContain('Back to Progress');
    expect(html).toContain('Achievements · 1 of 6 earned');
    expect(html).not.toContain('of 12 earned');
    expect(html.match(/data-badge-state=/g)).toHaveLength(6);
    expect(html).toContain('data-badge-state="earned"');
    expect(html).toContain('data-badge-state="in-progress"');
    expect(html).toContain('data-badge-state="locked"');
    expect(html).toContain('data-badge-tier="bud"');
    expect(html).toContain('data-badge-tier="bloom"');
    expect(html).toContain('data-badge-tier="star"');
    expect(html).toContain('data-achievement-summary');
    expect(html).toContain('data-featured-achievement');
    expect(html).toContain('data-badge-id="streak_3"');
  });
});

describe('learner level on the achievements ring', () => {
  it('shows the verified level, its XP meter and the sessions estimate', () => {
    const history = [{ date: '2026-09-27', XP: 60 }, { date: '2026-09-28', XP: 100 }];
    const html = renderToStaticMarkup(createElement(I18nProvider, { i18n }, createElement(
      AchievementsLearnerProvider, { learner: { level: 3, xp: 640 } },
      createElement(AchievementsMatrix, { stats: { ...stats(), xpChartData: history }, onBackToProgress: () => {} }),
    )));

    expect(html).toContain('<span class="ach-ring-label">Level</span><span class="ach-ring-number">3</span>');
    expect(html).toContain('data-learner-level="3"');
    expect(html).toMatch(/<span class="ach-mono">640<\/span> \/ 900 XP to Level 4/);
    // 260 XP left at an average of 80 XP per study day.
    expect(html).toContain('≈ 4 sessions');
    expect(html).toContain('48%');
    expect(html).not.toContain('data-featured-achievement');
  });

  it('keeps badge progress when no learner level is provided or the level is not usable', () => {
    expect(achievementsLevelFacts(null)).toBeNull();
    expect(achievementsLevelFacts({ level: 0, xp: 10 })).toBeNull();
    expect(achievementsLevelFacts({ level: 2, xp: 150 })).toMatchObject({ start: 100, next: 400, remaining: 250, percent: 17 });
    const html = renderToStaticMarkup(createElement(I18nProvider, { i18n }, createElement(
      AchievementsLearnerProvider, { learner: null },
      createElement(AchievementsMatrix, { stats: stats() }),
    )));
    expect(html).toContain('data-featured-achievement');
    expect(html).not.toContain('data-learner-level');
  });
});
