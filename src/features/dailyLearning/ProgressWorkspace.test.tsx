import { renderToStaticMarkup } from 'react-dom/server';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { LibraryStatsViewModel } from '../library/libraryViewModel';
import ProgressWorkspace, { formatLocalMasteredDate, hasProgressActivity } from './ProgressWorkspace';

i18n.load('en', {});
i18n.activate('en');

const renderProgress = (node: ReactNode) => renderToStaticMarkup(<I18nProvider i18n={i18n}>{node}</I18nProvider>);

const stats = (overrides: Partial<LibraryStatsViewModel> = {}): LibraryStatsViewModel => ({
  total: 1,
  reviewed: 0,
  learned: 0,
  learning: 1,
  dueToday: 1,
  dueAsOfDate: [new Date().getFullYear(), String(new Date().getMonth() + 1).padStart(2, '0'), String(new Date().getDate()).padStart(2, '0')].join('-'),
  categoryChart: [{ name: 'Education', value: 1 }],
  categoryChartIsPartial: false,
  difficultyChart: [{ name: 'Not reviewed', value: 1 }],
  xpChartData: [],
  ...overrides,
});

describe('ProgressWorkspace learning activity gate', () => {
  it('formats recently mastered timestamps in the viewer local date', () => {
    const input = '2026-09-27T18:30:00.000Z';
    const date = new Date(input);
    const expected = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
    expect(formatLocalMasteredDate(input)).toBe(expected);
    expect(formatLocalMasteredDate('invalid')).toBe('invalid');
  });

  it('keeps Progress empty and does not request charts for a merely added card', () => {
    const value = stats();
    const html = renderProgress(<ProgressWorkspace
      darkMode={false} isOffline={false} stats={value} isStatsLoading={false} statsError={null}
      continueReview={vi.fn()} openVocabulary={vi.fn()}
    />);

    expect(hasProgressActivity(value)).toBe(false);
    expect(html).toContain('Complete a review to begin your progress history.');
    expect(html).toContain('Start your first review');
    expect(html).not.toContain('Loading progress charts');
  });

  it('shows scaled forecast bars and mastery cards for an added card before its first review', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 27, 10));
    const dueForecast = Array.from({ length: 13 }, (_, index) => ({
      date: new Date(Date.UTC(2026, 8, 28 + index)).toISOString().slice(0, 10),
      count: index === 0 ? 0 : index === 1 ? 1 : index === 2 ? 4 : 0,
    }));
    let html: string;
    try {
      html = renderProgress(<ProgressWorkspace
        darkMode={false} isOffline={false} stats={stats({
          dueAsOfDate: '2026-09-27',
          dueForecast,
          recentlyMastered: [{ id: 'mastered-1', word: 'benefit', translation: 'lợi ích', masteredAt: '2026-09-27T18:30:00.000Z' }],
        })} isStatsLoading={false} statsError={null}
        continueReview={vi.fn()} openVocabulary={vi.fn()}
      />);
    } finally {
      vi.useRealTimers();
    }

    expect(html).toContain('Complete a review to begin your progress history.');
    expect(html).toContain('Due today and over the next 13 days');
    expect(html).toMatch(/<time dateTime="2026-09-27"[^>]*>Today<\/time>/);
    expect(html).toContain('2026-09-28');
    expect(html.match(/class="grid min-w-0 gap-1"/g)).toHaveLength(14);
    expect(html).toContain('height:0%');
    expect(html).toContain('height:25%');
    expect(html).toContain('height:100%');
    expect(html).toContain('benefit');
    expect(html).toContain('lợi ích');
    expect(html).not.toContain('Loading progress charts');
  });

  it('does not label yesterday’s cached count Today after local midnight', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 28, 0, 1));
    let html: string;
    try {
      html = renderProgress(<ProgressWorkspace
        darkMode={false} isOffline={false} stats={stats({
          reviewed: 1,
          dueAsOfDate: '2026-09-27',
          dueForecast: [{ date: '2026-09-28', count: 4 }],
        })} isStatsLoading={false} statsError={null}
        continueReview={vi.fn()} openVocabulary={vi.fn()}
      />);
    } finally {
      vi.useRealTimers();
    }
    expect(html).toContain('Forecast is unavailable');
    expect(html).not.toContain('dateTime="2026-09-28"');
    expect(html).not.toContain('class="grid min-w-0 gap-1"');
    expect(html).toContain('Your saved progress');
    expect(html).not.toContain('Review 1 due word');
    expect(html).not.toContain('Your scheduled review is clear');
  });

  it('offers vocabulary intake instead of an inert review action when the Library is empty', () => {
    const html = renderProgress(<ProgressWorkspace
      darkMode={false} isOffline={false} stats={stats({ total: 0, learning: 0, dueToday: 0 })}
      isStatsLoading={false} statsError={null} continueReview={vi.fn()} openVocabulary={vi.fn()}
    />);

    expect(html).toContain('Add vocabulary');
    expect(html).not.toContain('Start your first review');
  });

  it('does not mistake a pre-rated legacy card for a review event', () => {
    const value = stats({
      difficultyChart: [{ name: 'Learning', value: 1 }],
    });

    expect(hasProgressActivity(value)).toBe(false);
  });

  it('opens Progress after the reviewed-card count records a real review', () => {
    const value = stats({ reviewed: 1 });

    expect(hasProgressActivity(value)).toBe(true);
  });

  it('offers the dedicated achievements view only after real activity exists', () => {
    const html = renderProgress(<ProgressWorkspace
      darkMode={false} isOffline={false} stats={stats({ reviewed: 1 })} isStatsLoading={false} statsError={null}
      continueReview={vi.fn()} openVocabulary={vi.fn()}
    />);

    expect(html).toContain('View achievements');
    expect(html).not.toContain('Your word garden');
  });

  it('opens Progress when completed practice has recorded XP without a card review', () => {
    const value = stats({ xpChartData: [{ date: 'Aug 26, 2026', XP: 5 }] });

    expect(hasProgressActivity(value)).toBe(true);
  });

  it('keeps saved totals visible while progress refreshes', () => {
    const html = renderProgress(<ProgressWorkspace
      darkMode={false} isOffline={false} stats={stats({ reviewed: 12, learned: 4, dueToday: 3 })} isStatsLoading statsError={null}
      continueReview={vi.fn()} openVocabulary={vi.fn()}
    />);

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Your saved progress');
    expect(html).toContain('<span class="sr-only">12</span>');
    expect(html).toContain('<span class="sr-only">4</span>');
    expect(html).toContain('<span class="sr-only">3</span>');
  });

  it('renders the three progress totals through accessible animated counters', () => {
    const html = renderProgress(<ProgressWorkspace
      darkMode={false} isOffline={false} stats={stats({ reviewed: 12, learned: 4, dueToday: 3 })}
      isStatsLoading={false} statsError={null} continueReview={vi.fn()} openVocabulary={vi.fn()}
    />);

    expect(html.match(/data-count-up="true"/g)).toHaveLength(3);
    expect(html).toContain('<span class="sr-only">12</span>');
    expect(html).toContain('<span class="sr-only">4</span>');
    expect(html).toContain('<span class="sr-only">3</span>');
  });
});
