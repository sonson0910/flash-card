import { i18n } from '@lingui/core';
import { beforeAll, describe, expect, it } from 'vitest';
import type { WeeklyRecapData } from './weeklyRecapModel';
import {
  buildSuggestedWeeklyRecapCaption,
  captionAfterWeeklyRecapSelectionChange,
  clampWeeklyRecapCaption,
  defaultWeeklyRecapSelection,
  toggleWeeklyRecapSelection,
  WEEKLY_RECAP_CAPTION_MAX_LENGTH,
} from './weeklyRecapSelection';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

const recap = (overrides: Partial<WeeklyRecapData> = {}): WeeklyRecapData => ({
  rangeStart: '2026-09-21',
  rangeEnd: '2026-09-27',
  days: [],
  totalXp: 0,
  activeDays: 0,
  bestDay: null,
  hasActivity: false,
  ...overrides,
});

describe('weekly recap selection toggles', () => {
  it('defaults every field to shown', () => {
    const selection = defaultWeeklyRecapSelection();
    expect(Object.values(selection).every(Boolean)).toBe(true);
  });

  it('flips exactly the toggled key', () => {
    const selection = toggleWeeklyRecapSelection(defaultWeeklyRecapSelection(), 'reviewed');
    expect(selection.reviewed).toBe(false);
    expect(selection.totalXp).toBe(true);
  });
});

describe('weekly recap caption', () => {
  it('clamps to the shared-card character budget', () => {
    const long = 'x'.repeat(WEEKLY_RECAP_CAPTION_MAX_LENGTH + 50);
    expect(clampWeeklyRecapCaption(long)).toHaveLength(WEEKLY_RECAP_CAPTION_MAX_LENGTH);
  });

  it('suggests an honest quiet-week caption when there is no activity', () => {
    expect(buildSuggestedWeeklyRecapCaption(recap())).toBe('A quiet week — back to it tomorrow.');
  });

  it('suggests a caption built only from the real totals on screen', () => {
    const caption = buildSuggestedWeeklyRecapCaption(recap({ totalXp: 90, activeDays: 3, hasActivity: true }));
    expect(caption).toBe('90 XP and 3 active days this week.');
  });

  it('uses singular day wording for exactly one active day', () => {
    const caption = buildSuggestedWeeklyRecapCaption(recap({ totalXp: 20, activeDays: 1, hasActivity: true }));
    expect(caption).toBe('20 XP and 1 active day this week.');
  });

  it('uses the real review count when XP activity is unavailable', () => {
    const caption = buildSuggestedWeeklyRecapCaption(recap({ reviewedCount: 9, hasActivity: true }));
    expect(caption).toBe('9 reviews this week.');
  });

  it('removes unchecked metrics from automatic captions and preserves edited captions', () => {
    const reviewOnly = recap({ reviewedCount: 9, hasActivity: true });
    const withoutReviews = toggleWeeklyRecapSelection(defaultWeeklyRecapSelection(), 'reviewed');
    expect(captionAfterWeeklyRecapSelectionChange(reviewOnly, withoutReviews, '9 reviews this week.', false)).toBe('');
    expect(captionAfterWeeklyRecapSelectionChange(reviewOnly, withoutReviews, 'My own caption', true)).toBe('My own caption');

    const xpWeek = recap({ totalXp: 90, activeDays: 3, hasActivity: true });
    const withoutXp = toggleWeeklyRecapSelection(defaultWeeklyRecapSelection(), 'totalXp');
    expect(buildSuggestedWeeklyRecapCaption(xpWeek, withoutXp)).toBe('3 active days this week.');
    const withoutXpOrDays = toggleWeeklyRecapSelection(withoutXp, 'activeDays');
    expect(buildSuggestedWeeklyRecapCaption(xpWeek, withoutXpOrDays)).toBe('');
  });
});
