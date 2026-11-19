import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { messages as enToday } from '../../i18n/locales/en/today.po';
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

// 2026-11-19 is a Thursday.
const history = [{ date: '2026-11-16', XP: 12 }, { date: '2026-11-18', XP: 6 }, { date: '2026-11-19', XP: 4 }];
const run = { studiedToday: true, days: 2 };
const week = studyWeek(history, '2026-11-19', run);

describe('StreakChip', () => {
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
    expect(html).toContain('Keep it going');
    expect(html).not.toMatch(/freeze|repair|Pro\b/i);
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
