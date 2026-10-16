import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { renderToStaticMarkup as renderReactToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityHeatmap, dayInTimeZone, firstDayOfWeek, formatHeatmapDate, weekdayLabels } from './ActivityHeatmap';

const renderToStaticMarkup = (node: React.ReactNode) => renderReactToStaticMarkup(<I18nProvider i18n={i18n}>{node}</I18nProvider>);

describe('ActivityHeatmap', () => {
  beforeEach(() => { i18n.load('en', {}); i18n.activate('en'); });
  afterEach(() => { vi.useRealTimers(); i18n.activate('en'); });

  it('plots the localized date keys written by completed learning activity', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26T12:00:00+07:00'));

    i18n.activate('en');
    const html = renderToStaticMarkup(
      <ActivityHeatmap entries={[{ date: 'Aug 26, 2026', XP: 12 }]} />,
    );

    expect(html).toContain('<strong class="font-bold text-[var(--sf-text)]">1</strong> active days');
    expect(html).toContain('Aug 26, 2026: 12 XP');
    expect(html).toContain('var(--sf-heat-1)');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-label="Study activity"');
  });

  it.each([['en-US', 0], ['vi', 1], ['ja', 0]])('uses the locale first weekday for %s', (locale, firstDay) => {
    expect(firstDayOfWeek(locale)).toBe(firstDay);
    expect(weekdayLabels(locale)).toHaveLength(7);
    expect(formatHeatmapDate('2026-08-26', locale)).not.toBe('2026-08-26');
  });

  it('renders exactly the selected rolling review range and marks pre-coverage dates unavailable', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-28T12:00:00+07:00'));
    const html = renderToStaticMarkup(<ActivityHeatmap entries={[]} rangeDays={30} reviewActivity={{
      coverageStartedOn: '2026-09-20',
      days: { '2026-09-28': { reviewed: 2, again: 1, hard: 0, good: 1, easy: 0 } },
    }} />);

    expect(html.match(/size-3.5/g)).toHaveLength(firstDayOfWeek('en') === 0 ? 35 : 42);
    expect(html).toContain('Activity unavailable before coverage began');
    expect(html).toContain('Sep 28, 2026: 2 reviews');
    expect(html).toContain('Outside selected range');
  });

  it('makes only covered days selectable for the inspected-day detail', () => {
    const html = renderToStaticMarkup(<ActivityHeatmap entries={[]} rangeDays={30} todayKey="2026-09-28" selectedDate="2026-09-28" onDaySelect={vi.fn()} reviewActivity={{ coverageStartedOn: '2026-09-20', days: { '2026-09-28': { reviewed: 2, again: 1, hard: 0, good: 1, easy: 0 } } }} />);

    expect(html).toContain('<button type="button" aria-pressed="true" aria-label="Sep 28, 2026: 2 reviews"');
    expect(html).toContain('<button type="button" disabled="" aria-label="Sep 19, 2026: Activity unavailable before coverage began"');
    expect(html).toContain('<button type="button" disabled="" aria-label="Sep 29, 2026: Outside selected range"');
    expect(html).toContain('class="flex size-6 shrink-0 items-center justify-center focus-visible:outline-2');
    expect(html).toContain('<span class="size-3.5 rounded-[4px] border border-[var(--sf-border)] transition-transform hover:scale-125"');
  });

  it('defaults review activity to 30 days and keeps XP totals account-wide', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-28T12:00:00+07:00'));
    const reviewHtml = renderToStaticMarkup(<ActivityHeatmap entries={[]} reviewActivity={{
      coverageStartedOn: '2026-09-28', days: { '2026-09-28': { reviewed: 1, again: 1, hard: 0, good: 0, easy: 0 } },
    }} />);
    const xpHtml = renderToStaticMarkup(<ActivityHeatmap entries={[
      { date: '2025-01-01', XP: 8 }, { date: '2026-09-28', XP: 12 },
    ]} />);

    expect(reviewHtml.match(/size-3.5/g)).toHaveLength(firstDayOfWeek('en') === 0 ? 35 : 42);
    expect(xpHtml).toContain('<strong class="font-bold text-[var(--sf-text)]">20</strong> total XP');
  });

  it('uses the account reward time zone for a rolling boundary', () => {
    expect(dayInTimeZone(new Date('2026-09-28T00:30:00.000Z'), 'America/Los_Angeles')).toBe('2026-09-27');
    expect(dayInTimeZone(new Date('2026-09-28T00:30:00.000Z'), 'Asia/Ho_Chi_Minh')).toBe('2026-09-28');
  });

  it('includes exactly 182 calendar days for the 26-week range', () => {
    const html = renderToStaticMarkup(<ActivityHeatmap entries={[]} rangeDays={182} todayKey="2026-09-28" reviewActivity={{
      coverageStartedOn: '2026-03-30',
      days: {
        '2026-03-30': { reviewed: 9, again: 9, hard: 0, good: 0, easy: 0 },
        '2026-03-31': { reviewed: 1, again: 0, hard: 0, good: 1, easy: 0 },
        '2026-09-28': { reviewed: 2, again: 1, hard: 0, good: 1, easy: 0 },
      },
    }} />);

    expect(html).toContain('<strong class="font-bold text-[var(--sf-text)]">3</strong> reviews');
    expect(html).toContain('Mar 31, 2026: 1 reviews');
    expect(html).toContain('Mar 30, 2026: Outside selected range');
  });

  it('does not overlap adjacent month labels at the start of a range', () => {
    const html = renderToStaticMarkup(<ActivityHeatmap entries={[]} rangeDays={182} todayKey="2026-09-24" reviewActivity={{ coverageStartedOn: '2026-03-27', days: {} }} />);
    expect(html).not.toContain('>Mar</span>');
    expect(html).toContain('>Apr</span>');
  });
});
