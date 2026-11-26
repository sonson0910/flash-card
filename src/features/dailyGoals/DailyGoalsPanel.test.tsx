import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MATCH_WIN_XP, REVIEW_CARD_XP } from '../../../functions/src/xp-rules';
import type { useVerifiedGamificationState } from '../gamification/verifiedGamificationClient';

const theme = vi.hoisted(() => ({ family: 'classic' as 'classic' | 'crystal' }));
vi.mock('../theme/ThemeProvider', () => ({ useTheme: () => ({ family: theme.family, mode: 'light' }) }));

import { DailyGoalsPanel, type DailyGoalsPanelProps } from './DailyGoalsPanel';

i18n.load('en', {});
i18n.activate('en');

const render = (node: ReactNode) => renderToStaticMarkup(<I18nProvider i18n={i18n}>{node}</I18nProvider>);
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').trim();

const props = (overrides: Partial<DailyGoalsPanelProps> = {}): DailyGoalsPanelProps => ({
  gamification: {
    rewardTimeZone: 'Asia/Ho_Chi_Minh',
    xpHistory: { '2026-11-19': 26 },
    streak: 12,
    lastStudyDay: '2026-11-18',
    dailyGoals: { coverageStartedOn: '2026-11-10', days: { '2026-11-19': { studiedCards: 3, matchWins: 1 } } },
  },
  planHasMatch: true,
  dailyPace: 10,
  now: new Date('2026-11-19T15:15:00.000Z'),
  ...overrides,
});

describe('daily goals panel', () => {
  beforeEach(() => { theme.family = 'classic'; });

  it.each(['classic', 'crystal'] as const)('renders server progress, granted XP and the reset countdown in %s', family => {
    theme.family = family;
    const html = render(<DailyGoalsPanel {...props()} />);
    const visible = text(html);
    // Crystal sets the count as the board does ("3 / 10"); classic keeps the compact form.
    const count = (done: number, target: number) => (family === 'crystal' ? `${done} / ${target}` : `${done}/${target}`);
    expect(html).toContain(`daily-goals-panel--${family}`);
    expect(visible).toContain('Daily goals');
    expect(visible).toContain('Resets in 1 h 45 min');
    expect(visible).toContain('Study 10 cards');
    expect(visible).toContain(`+${10 * REVIEW_CARD_XP} XP`);
    expect(visible).toContain(count(3, 10));
    expect(visible).toContain('Win a word match');
    expect(visible).toContain(`+${MATCH_WIN_XP} XP`);
    expect(visible).toContain(count(1, 1));
    expect(visible).toContain('Keep your 12-day streak');
    expect(visible).toContain(count(0, 1));
    expect(html).toContain('aria-valuetext="3 of 10"');
    expect(html).toContain('style="width:30%"');
    expect(visible).not.toMatch(/claim|combo|bonus|lesson/i);
    expect(visible.match(/\+\d+ XP/g)).toEqual([`+${10 * REVIEW_CARD_XP} XP`, `+${MATCH_WIN_XP} XP`]);
  });

  it('keeps each countdown number with its unit in crystal so the label only wraps between words', () => {
    theme.family = 'crystal';
    expect(render(<DailyGoalsPanel {...props()} />)).toContain('Resets in 1\u00a0h 45\u00a0min');
    theme.family = 'classic';
    expect(render(<DailyGoalsPanel {...props()} />)).toContain('Resets in 1 h 45 min');
  });

  it('shows a dash with a text alternative when today began before the counters', () => {
    const html = render(<DailyGoalsPanel {...props({
      gamification: {
        rewardTimeZone: 'Asia/Ho_Chi_Minh',
        xpHistory: { '2026-11-19': 50 },
        streak: 0,
        dailyGoals: { coverageStartedOn: '2026-11-20', days: { '2026-11-19': { studiedCards: 1, matchWins: 0 } } },
      },
    })} />);
    expect(html).toContain('—');
    expect(text(html)).toContain('Not counted yet today');
    expect(text(html)).toContain('Start a streak');
    expect(html).not.toContain('aria-valuetext="1 of 10"');
  });

  it('takes the verified gamification state the app already holds', () => {
    // A type error here means the panel can no longer be mounted with `practiceWorkspace.model.gamification`.
    const accepts = (state: ReturnType<typeof useVerifiedGamificationState>): DailyGoalsPanelProps['gamification'] => state;
    expect(typeof accepts).toBe('function');
  });

  it('leaves the match goal out when the plan has no match', () => {
    const html = render(<DailyGoalsPanel {...props({
      planHasMatch: false,
      gamification: { ...props().gamification, dailyGoals: { coverageStartedOn: '2026-11-10', days: {} } },
    })} />);
    expect(text(html)).not.toContain('Win a word match');
  });
});
