import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LibraryStatsViewModel } from '../../features/library/libraryViewModel';
import { achievementsFixture, stateFromFixture } from '../../features/gamification/testing/verifiedStatsFixtures';
import { ThemeProvider } from '../../features/theme/ThemeProvider';
import { achievementBadgeCopy, AchievementsMatrix, findNewlyUnlockedBadgeIds, resolveAchievementBadgeState } from './AchievementsMatrix';
import { AchievementsLearnerProvider, type AchievementsLearnerLevel } from './AchievementsMatrixLearner';

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
    // 640 XP is 240 into level 3, which spans 500 XP.
    expect(html).toMatch(/<span class="ach-mono">240<\/span> \/ 500 XP to Level 4/);
    // 260 XP left at an average of 80 XP per study day.
    expect(html).toContain('XP to Level 4</span><span class="tabular-nums">≈ 4 sessions</span>');
    expect(html).toContain('class="ach-meter-fill" style="width:48%"');
    expect(html).not.toContain('data-featured-achievement');
  });

  it('keeps badge progress when no learner level is provided or the level is not usable', () => {
    const html = renderToStaticMarkup(createElement(I18nProvider, { i18n }, createElement(
      AchievementsLearnerProvider, { learner: null },
      createElement(AchievementsMatrix, { stats: stats() }),
    )));
    expect(html).toContain('data-featured-achievement');
    expect(html).not.toContain('data-learner-level');
  });

  it('shows the share of the level when recent study days cannot support an estimate', () => {
    const html = renderToStaticMarkup(createElement(I18nProvider, { i18n }, createElement(
      AchievementsLearnerProvider, { learner: { level: 2, xp: 150 } },
      createElement(AchievementsMatrix, { stats: stats() }),
    )));
    expect(html).toContain('XP to Level 3</span><span class="tabular-nums">17%</span>');
    expect(html).not.toContain('≈');
  });
});

describe('recorded achievements', () => {
  afterEach(() => vi.unstubAllGlobals());

  const identity = { status: 'authenticated', displayName: 'Khánh Bùi', email: 'khanh@example.com', photoUrl: null } as const;
  const learnerFrom = (fixture = achievementsFixture): AchievementsLearnerLevel => {
    const gamification = stateFromFixture(fixture);
    return { level: 3, xp: gamification.xp, gamification, identity };
  };
  const render = (learner: AchievementsLearnerLevel | null, family: 'classic' | 'crystal' = 'classic') => {
    vi.stubGlobal('localStorage', { getItem: (key: string) => key === 'sonflash_theme_family' ? family : null, setItem: () => {}, removeItem: () => {} });
    return renderToStaticMarkup(createElement(I18nProvider, { i18n }, createElement(ThemeProvider, null, createElement(
      AchievementsLearnerProvider, { learner },
      createElement(AchievementsMatrix, { stats: stats(), onBackToProgress: () => {}, now: achievementsFixture.now }),
    ))));
  };
  const badgeHtml = (html: string, id: string) => html.match(new RegExp(`<article data-badge-id="${id}"[\\s\\S]*?</article>`))?.[0] ?? '';

  it('draws the twelve badges on the classic board with the recorded days and real conditions', () => {
    const html = render(learnerFrom());
    expect(html).toContain('Achievements · 6 of 12 earned');
    expect(html.match(/data-badge-state=/g)).toHaveLength(12);
    // Badges earned before recording started show "earned by" that day, never an exact date.
    expect(html.match(/data-earned-on="2026-11-27" data-earned-by=""/g)).toHaveLength(6);
    const reviewed = badgeHtml(html, 'reviewed-10');
    expect(reviewed).toContain('Review 10 different cards.');
    expect(reviewed).toContain('<span aria-hidden="true">Earned by 27 Nov</span>');
    expect(reviewed).toContain('Earned on or before November 27, 2026. The exact day was not recorded.');
    expect(badgeHtml(html, 'late-reviews-10')).toContain('10 reviews between 10:00 PM and 4:00 AM.');
    expect(badgeHtml(html, 'mastered-50')).toMatch(/13 \/ 50<\/span><span class="tabular-nums">26%/);
    expect(badgeHtml(html, 'spelling-50')).toContain('Not started yet');
    expect(html).toContain('<dt>Total XP</dt><dd class="tabular-nums">622</dd>');
    expect(html).toContain('Your word <em class="ach-title-accent">garden</em>');
  });

  it('names the title shown in the classic heading', () => {
    const titled = { ...achievementsFixture, stats: { ...achievementsFixture.stats, verifiedXp: 1_700, achievementsV1: { ...(achievementsFixture.stats.achievementsV1 as object), titles: { 'word-keeper': { on: '2026-12-02', exact: true } } } } };
    const html = render(learnerFrom(titled));
    expect(html).toContain('Word keeper, <em class="ach-title-accent">still climbing.</em>');
  });

  it('shows an empty account every badge with its condition and no earned day', () => {
    const empty = { ...achievementsFixture, stats: { ...achievementsFixture.stats, verifiedXp: 0, verifiedStreak: 0, lastVerifiedStudyDay: null, achievementsV1: { ...(achievementsFixture.stats.achievementsV1 as object), counters: { activeDays: 0, lastXpDay: null, lastXpDayXp: 0, bestDayXp: 0, reviewedCards: 0, masteredWords: 0, lateReviews: 0, spellingCorrect: 0 }, badges: {} } } };
    const html = render(learnerFrom(empty));
    expect(html).toContain('Achievements · 0 of 12 earned');
    expect(html).not.toContain('data-earned-on');
    expect(html.match(/Not started yet<\/p>/g)).toHaveLength(12);
    expect(html).toContain('Finish your first review.');
  });

  it('draws the Crystal profile card, the collection tabs and the titles list', () => {
    const html = render(learnerFrom(), 'crystal');
    expect(html).toContain('data-achievement-profile');
    expect(html).toContain('<p class="ach-emblem-name ach-profile-name">Khánh Bùi</p>');
    expect(html).toContain('<span aria-hidden="true">KB</span>');
    expect(html).toContain('Lv 3 <span class="ach-profile-xp">· 222 / 500 XP</span>');
    expect(html).toMatch(/<h1 id="achievements-heading"[^>]*>Collection<\/h1>/);
    expect(html).toContain('role="tablist"');
    expect(html).toMatch(/id="ach-tab-badges"[^>]*aria-selected="true"[^>]*tabindex="0"/);
    expect(html).toMatch(/id="ach-tab-titles"[^>]*aria-selected="false"[^>]*tabindex="-1"/);
    expect(html).toContain('6 / 12 unlocked');
    expect(html).toMatch(/id="ach-panel-titles"[^>]*hidden=""/);
    expect(html).toContain('Reach level 5');
    expect(html).toContain('Lv 3 / 5');
    expect(html).toContain('class="ach-glyph-filled"');
    expect(badgeHtml(html, 'spelling-50')).toContain('ach-badge-veil');
    expect(html).not.toContain('data-shown-title');
  });

  it('keeps the Crystal emblem card while only the level is known', () => {
    const html = render({ level: 3, xp: 640 }, 'crystal');
    expect(html).not.toContain('data-achievement-profile');
    expect(html).not.toContain('role="tablist"');
    expect(html).toContain('Your word <em class="ach-title-accent">garden</em>');
    expect(html).toContain('data-learner-level="3"');
    expect(html).toContain('Lv 3 · 240 / 500 XP');
  });
});
