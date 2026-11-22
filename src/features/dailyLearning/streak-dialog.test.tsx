import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { messages as enToday } from '../../i18n/locales/en/today.po';
import { buildStreakView } from '../gamification/streakView';
import { stateFromFixture, streakFixtures, type VerifiedStatsFixture } from '../gamification/testing/verifiedStatsFixtures';
import { StreakChip } from './StreakDialog';
import { studyWeek } from './todayScreenFacts';

// The real Portal renders nothing without a DOM; render the dialog parts in place and always open.
vi.mock('@radix-ui/react-dialog', () => {
  const part = ({ children, asChild: _asChild, ...rest }: { children?: ReactNode; asChild?: boolean } & Record<string, unknown>) => <div {...rest}>{children}</div>;
  return { Root: ({ children }: { children?: ReactNode }) => <>{children}</>, Trigger: ({ children }: { children?: ReactNode }) => <>{children}</>, Portal: part, Overlay: part, Content: part, Close: part, Title: part, Description: part };
});

const theme = vi.hoisted(() => ({ family: 'classic' as 'classic' | 'crystal' }));
vi.mock('../theme/ThemeProvider', () => ({ useTheme: () => ({ family: theme.family, mode: 'dark', setMode: () => undefined, setFamily: () => undefined }) }));

i18n.load('en', enToday);
i18n.activate('en');

const render = (node: ReactNode) => renderToStaticMarkup(<I18nProvider i18n={i18n}>{node}</I18nProvider>);
const viewOf = (fixture: VerifiedStatsFixture) => buildStreakView(stateFromFixture(fixture), fixture.now);
const renderFixture = (fixture: VerifiedStatsFixture, extra: { readonly onStartSession?: () => void } = {}) =>
  render(<StreakChip view={viewOf(fixture)} now={fixture.now} streak={0} className="chip" {...extra} />);
const forbiddenCopy = /Pro\b|refills|bonus|buy|gem/i;

// 2026-11-19 is a Thursday.
const history = [{ date: '2026-11-16', XP: 12 }, { date: '2026-11-18', XP: 6 }, { date: '2026-11-19', XP: 4 }];
const run = { studiedToday: true, days: 2 };
const week = studyWeek(history, '2026-11-19', run);

describe('StreakChip from XP history', () => {
  it('opens details built from the verified streak and this week of XP history', () => {
    const html = render(<StreakChip streak={2} run={run} week={week} className="chip" />);
    expect(html).toContain('2 study days');
    expect(html).toContain('2-day streak');
    expect(html).toContain('Your streak <em>is safe.</em>');
    expect(html).toContain('You studied today, so your 2-day streak keeps going. Come back tomorrow to make it 3.');
    expect(html).toContain('aria-label="This week"');
    expect(html.match(/<li /g)).toHaveLength(7);
    expect(html).toContain('aria-label="Monday: studied"');
    expect(html).toContain('aria-label="Tuesday: no study"');
    expect(html).toContain('aria-label="Friday: still ahead"');
    expect(html).toMatch(/data-state="done" data-today="true" aria-current="date" aria-label="Thursday: studied"/);
    expect(html).toContain('Study days this week</dt><dd>3</dd>');
    expect(html).toContain('XP this week</dt><dd>22</dd>');
    expect(html).toContain('aria-label="Close streak details"');
    expect(html).toContain('A day counts once you review a card.');
    expect(html).toContain('Keep it going');
    expect(html).not.toMatch(/freeze|repair|Best streak/i);
    expect(html).not.toMatch(forbiddenCopy);
  });

  it('asks for today when the run has not been extended yet', () => {
    const open = { studiedToday: false, days: 2 };
    const html = render(<StreakChip streak={2} run={open} week={studyWeek(history.slice(0, 2), '2026-11-19', open)} className="chip" />);
    expect(html).toContain('Keep your streak <em>going.</em>');
    expect(html).toContain('Study today to keep your 2-day streak going.');
    expect(html).toContain('aria-label="Thursday: today, not studied yet"');
  });

  it('shows nothing without a streak and leaves out the week when it is unknown', () => {
    expect(render(<StreakChip streak={0} className="chip" />)).toBe('');
    expect(render(<StreakChip streak={undefined} className="chip" />)).toBe('');
    const html = render(<StreakChip streak={4} className="chip" />);
    expect(html).toContain('4-day streak');
    expect(html).not.toContain('This week');
  });
});

describe('StreakChip from the server streak record', () => {
  it('shows the held freezes on the chip and in the details before the record exists', () => {
    theme.family = 'classic';
    const html = renderFixture(streakFixtures.legacyOpen);
    expect(html).toContain('data-streak-chip="active"');
    expect(html).toContain('1 streak freeze');
    expect(html).toContain('Keep your streak <em>going.</em>');
    expect(html).toContain('Study today to keep your 6-day streak going.');
    expect(html).toContain('1 of 2 freezes left');
    expect(html).toContain('Earn one every 7-day run · next in 1 day');
    expect(html).toContain('Freezes are used automatically.');
    expect(html).toContain('aria-label="Thursday: today, not studied yet"');
    expect(html).not.toContain('Best streak');
    expect(html).not.toMatch(forbiddenCopy);
  });

  it('marks the frozen day and says a freeze stepped in', () => {
    theme.family = 'classic';
    const html = renderFixture(streakFixtures.frozenOneDay, { onStartSession: () => undefined });
    expect(html).toContain('data-streak-state="frozen"');
    expect(html).toContain('11 study days');
    expect(html).toContain('11-day streak');
    expect(html).toContain('Your streak <em>is safe.</em>');
    expect(html).toContain('You missed yesterday, so a streak freeze stepped in. Study today and the run keeps going.');
    expect(html).toContain('aria-label="Wednesday: streak freeze used"');
    expect(html).toContain('aria-label="Tuesday: studied"');
    expect(html).toContain('No freezes left');
    expect(html).toContain('Earn one every 7-day run · next in 3 days');
    expect(html).toContain('streak-dialog-badge');
    expect(html).toContain('Freezes are used automatically.');
    expect(html).toContain('Keep it going');
    expect(html).not.toMatch(forbiddenCopy);
  });

  it('uses the Crystal wording for the freeze copy', () => {
    theme.family = 'crystal';
    const html = renderFixture(streakFixtures.frozenOneDay);
    expect(html).toContain('Study today and the streak keeps going.');
    expect(html).toContain('Earn one every 7-day streak · next in 3 days');
    theme.family = 'classic';
  });

  it('offers the repair with its rule, progress and window, and no paid option', () => {
    theme.family = 'classic';
    const html = renderFixture(streakFixtures.repairAvailable, { onStartSession: () => undefined });
    expect(html).toContain('data-streak-state="repair"');
    expect(html).toContain('Repair your streak');
    expect(html).toContain('23 → 0');
    expect(html).toContain('Your 23-day streak <em>ended.</em>');
    expect(html).toContain('repair it before the window closes, or simply start a new run today.');
    expect(html).toContain('Review 20 cards');
    expect(html).toContain('aria-valuenow="0"');
    expect(html).toContain('0 / 20 · ≈ 7 min');
    expect(html).toContain('Repair window: <span class="streak-dialog-window-time">36 h 0 min</span>');
    expect(html).toContain('Your XP and words are safe either way.');
    expect(html).toContain('No penalty if you let it go.');
    expect(html).toContain('Start fresh');
    expect(html).toContain('Start a session');
    expect(html).toContain('aria-label="Tuesday: no study"');
    expect(html).not.toMatch(/freezes left|Study days this week/);
    expect(html).not.toMatch(forbiddenCopy);
  });

  it('keeps counting a repair in progress and only closes without a session to start', () => {
    const html = renderFixture(streakFixtures.repairInProgress, { onStartSession: () => undefined });
    expect(html).toContain('8 / 20 · ≈ 4 min');
    expect(html).toContain('aria-valuenow="8"');
    expect(html).toContain('Keep repairing');
    const closeOnly = renderFixture(streakFixtures.repairInProgress);
    expect(closeOnly).toContain('Start fresh');
    expect(closeOnly).not.toContain('Keep repairing');
  });

  it('hides the chip once the run has ended without a repair', () => {
    expect(renderFixture(streakFixtures.endedNoRepair)).toBe('');
  });

  it('celebrates the 30-day milestone with the real XP and the best streak', () => {
    theme.family = 'classic';
    const html = renderFixture(streakFixtures.safeAtMilestone);
    expect(html).toContain('data-streak-state="milestone"');
    expect(html).toContain('2 streak freezes');
    expect(html).toContain('Badge unlocked · Web Wanderer');
    expect(html).toContain('30 days <em>in a row.</em>');
    expect(html).toContain('A whole month of showing up. That is how words stick for good.');
    expect(html).toContain('streak-dialog-gold-chip">30</span>');
    expect(html).toContain('+100 XP added');
    expect(html).toContain('Best streak</dt><dd>30 days</dd>');
    expect(html.match(/streak-dialog-confetti/g)).toHaveLength(1);
    expect(html).toContain('Continue');
    expect(html).not.toMatch(forbiddenCopy);
  });

  it('shows the run totals on a milestone when the review counters cover the run', () => {
    const fixture = streakFixtures.safeAtMilestone;
    const html = render(<StreakChip view={viewOf(fixture)} runStats={{ reviews: 1_284, newWords: 312, recallPercent: 91 }} now={fixture.now} streak={0} className="chip" />);
    expect(html).toContain('<div data-stat="reviews"><dt>Reviews</dt><dd>1,284</dd></div><div data-stat="new-words"><dt>New words</dt><dd>312</dd></div><div data-stat="recall"><dt>Recall</dt><dd>91%</dd></div>');
    const partial = render(<StreakChip view={viewOf(fixture)} runStats={{ reviews: null, newWords: 40, recallPercent: null }} now={fixture.now} streak={0} className="chip" />);
    expect(partial).toContain('data-count="1"');
    expect(partial).not.toMatch(/Reviews|Recall/);
    expect(html).not.toContain('Best streak');
    theme.family = 'crystal';
    expect(render(<StreakChip view={viewOf(fixture)} now={fixture.now} streak={0} className="chip" />)).toContain('30 days <em>in a row!</em>');
    theme.family = 'classic';
  });
});
