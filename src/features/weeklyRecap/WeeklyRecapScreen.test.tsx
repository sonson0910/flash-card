import { renderToStaticMarkup } from 'react-dom/server';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { WeeklyRecapData } from './weeklyRecapModel';
import { defaultWeeklyRecapSelection, toggleWeeklyRecapSelection } from './weeklyRecapSelection';
import { WeeklyRecapScreen, type WeeklyRecapScreenProps } from './WeeklyRecapScreen';

i18n.load('en', {});
i18n.activate('en');

const render = (node: ReactNode) => renderToStaticMarkup(<I18nProvider i18n={i18n}>{node}</I18nProvider>);

const data = (overrides: Partial<WeeklyRecapData> = {}): WeeklyRecapData => ({
  rangeStart: '2026-09-21',
  rangeEnd: '2026-09-27',
  days: Array.from({ length: 7 }, (_, index) => ({ dateKey: `2026-09-2${index}`, xp: index === 3 ? 90 : 0 })),
  totalXp: 90,
  activeDays: 1,
  bestDay: { dateKey: '2026-09-23', xp: 90 },
  hasActivity: true,
  ...overrides,
});

const baseProps = (overrides: Partial<WeeklyRecapScreenProps> = {}): WeeklyRecapScreenProps => ({
  data: data(),
  dateRangeLabel: 'Sep 21 – Sep 27',
  selection: defaultWeeklyRecapSelection(),
  caption: 'Great week!',
  milestones: { unlocked: 2, total: 6 },
  isBusy: false,
  lastOutcome: null,
  exportError: false,
  actions: { toggleSelection: vi.fn(), setCaption: vi.fn(), share: vi.fn(), download: vi.fn() },
  ...overrides,
});

describe('WeeklyRecapScreen', () => {
  it('shows an honest empty state instead of inventing a best week', () => {
    const html = render(<WeeklyRecapScreen {...baseProps({ data: data({ hasActivity: false, totalXp: 0, activeDays: 0, bestDay: null }) })} />);
    expect(html).toContain('No study activity yet this week.');
    expect(html).not.toContain('best week');
  });

  it('renders only the metrics that are toggled on', () => {
    const selection = toggleWeeklyRecapSelection(defaultWeeklyRecapSelection(), 'bestDay');
    const html = render(<WeeklyRecapScreen {...baseProps({ selection })} />);
    expect(html).toContain('XP this week');
    // "Best day" still appears once, as the always-visible toggle checkbox label; the metric card itself is gone.
    expect(html.match(/Best day/g)).toHaveLength(1);
  });

  it('always discloses that word-of-week and recall are unavailable rather than guessed', () => {
    const html = render(<WeeklyRecapScreen {...baseProps()} />);
    expect(html).toContain("don&#x27;t have yet");
  });

  it('shows the caption character budget', () => {
    const html = render(<WeeklyRecapScreen {...baseProps({ caption: 'hi' })} />);
    expect(html).toContain('2 / 220');
  });

  it('disables both share actions while an export is in flight', () => {
    const html = render(<WeeklyRecapScreen {...baseProps({ isBusy: true })} />);
    expect(html.match(/disabled=""/g)?.length).toBe(2);
  });

  it('surfaces the last share outcome and a distinct export error', () => {
    const shared = render(<WeeklyRecapScreen {...baseProps({ lastOutcome: 'copied' })} />);
    expect(shared).toContain('Copied to your clipboard.');

    const failed = render(<WeeklyRecapScreen {...baseProps({ exportError: true })} />);
    expect(failed).toContain('Could not create the image.');
  });
});
