import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { LibraryStatsViewModel } from '../library/libraryViewModel';
import ProgressWorkspace, { hasProgressActivity } from './ProgressWorkspace';

const stats = (overrides: Partial<LibraryStatsViewModel> = {}): LibraryStatsViewModel => ({
  total: 1,
  reviewed: 0,
  learned: 0,
  learning: 1,
  dueToday: 1,
  categoryChart: [{ name: 'Education', value: 1 }],
  categoryChartIsPartial: false,
  difficultyChart: [{ name: 'Not reviewed', value: 1, color: '#94a3b8' }],
  xpChartData: [{ date: 'Aug 4, 2026', XP: 10 }],
  ...overrides,
});

describe('ProgressWorkspace learning activity gate', () => {
  it('keeps Progress empty and does not request charts for a merely added card', () => {
    const value = stats();
    const html = renderToStaticMarkup(<ProgressWorkspace
      darkMode={false} isOffline={false} stats={value} isStatsLoading={false} statsError={null}
      continueReview={vi.fn()} openVocabulary={vi.fn()}
    />);

    expect(hasProgressActivity(value)).toBe(false);
    expect(html).toContain('Complete a review to begin your progress history.');
    expect(html).toContain('Start your first review');
    expect(html).not.toContain('Loading progress charts');
  });

  it('offers vocabulary intake instead of an inert review action when the Library is empty', () => {
    const html = renderToStaticMarkup(<ProgressWorkspace
      darkMode={false} isOffline={false} stats={stats({ total: 0, learning: 0, dueToday: 0 })}
      isStatsLoading={false} statsError={null} continueReview={vi.fn()} openVocabulary={vi.fn()}
    />);

    expect(html).toContain('Add vocabulary');
    expect(html).not.toContain('Start your first review');
  });

  it('does not mistake a pre-rated legacy card for a review event', () => {
    const value = stats({
      difficultyChart: [{ name: 'Learning', value: 1, color: '#f59e0b' }],
    });

    expect(hasProgressActivity(value)).toBe(false);
  });

  it('opens Progress after the reviewed-card count records a real review', () => {
    const value = stats({ reviewed: 1 });

    expect(hasProgressActivity(value)).toBe(true);
  });
});
