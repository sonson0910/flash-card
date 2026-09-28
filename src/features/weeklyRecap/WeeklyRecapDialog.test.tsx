import { renderToStaticMarkup } from 'react-dom/server';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { createRadixDialogPassthroughMock } from '../../testing/radix-dialog-passthrough';
import type { LibraryStatsViewModel } from '../library/libraryViewModel';
import WeeklyRecapDialog from './WeeklyRecapDialog';

vi.mock('@radix-ui/react-dialog', () => createRadixDialogPassthroughMock());

i18n.load('en', {});
i18n.activate('en');

const render = (node: ReactNode) => renderToStaticMarkup(<I18nProvider i18n={i18n}>{node}</I18nProvider>);

const stats = (overrides: Partial<LibraryStatsViewModel> = {}): LibraryStatsViewModel => ({
  total: 10, reviewed: 10, learned: 4, learning: 6, dueToday: 2,
  categoryChart: [], categoryChartIsPartial: false, difficultyChart: [], xpChartData: [],
  ...overrides,
});

const fixedNow = () => new Date('2026-09-27T09:00:00.000Z');

describe('WeeklyRecapDialog', () => {
  it('renders nothing while closed, matching the real Radix Dialog contract', () => {
    const html = render(<WeeklyRecapDialog open={false} onOpenChange={vi.fn()} stats={stats()} now={fixedNow} />);
    expect(html).toBe('');
  });

  it('computes the visible date range and totals from the real xp chart data when open', () => {
    const html = render(<WeeklyRecapDialog
      open onOpenChange={vi.fn()} now={fixedNow}
      stats={stats({
        reviewed: 60, learned: 50,
        xpChartData: [{ date: '2026-09-25', XP: 40 }, { date: '2026-09-26', XP: 60 }],
      })}
    />);

    expect(html).toContain('Sep 21');
    expect(html).toContain('Sep 27');
    expect(html).toContain('100'); // 40 + 60 XP inside the window.
    expect(html).toContain('weekly-recap-screen');
    expect(html).toContain('weekly-recap-card');
    expect(html).toContain('weekly-recap-controls');
  });

  it('surfaces how many of the real (all-time) milestone badges are unlocked', () => {
    const html = render(<WeeklyRecapDialog
      open onOpenChange={vi.fn()} now={fixedNow}
      stats={stats({ reviewed: 60, learned: 50 })} // clears mastery_10 and mastery_50 thresholds.
    />);

    expect(html).toContain('2 of 6 milestones unlocked');
  });
});
