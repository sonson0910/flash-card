import { i18n } from '@lingui/core';
import { beforeAll, describe, expect, it } from 'vitest';
import type { WeeklyRecapData } from './weeklyRecapModel';
import {
  buildSuggestedWeeklyRecapCaption,
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
    const selection = toggleWeeklyRecapSelection(defaultWeeklyRecapSelection(), 'heatmap');
    expect(selection.heatmap).toBe(false);
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
});
