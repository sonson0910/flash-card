import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActivityHeatmap } from './ActivityHeatmap';

describe('ActivityHeatmap', () => {
  afterEach(() => vi.useRealTimers());

  it('plots the localized date keys written by completed learning activity', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-26T12:00:00+07:00'));

    const html = renderToStaticMarkup(
      <ActivityHeatmap entries={[{ date: 'Aug 26, 2026', XP: 12 }]} />,
    );

    expect(html).toContain('<strong class="font-bold text-[var(--sf-text)]">1</strong> active days');
    expect(html).toContain('aria-label="2026-08-26: 12 XP"');
  });
});
