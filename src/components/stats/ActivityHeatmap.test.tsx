import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { renderToStaticMarkup as renderReactToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityHeatmap, firstDayOfWeek, formatHeatmapDate, weekdayLabels } from './ActivityHeatmap';

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
});
