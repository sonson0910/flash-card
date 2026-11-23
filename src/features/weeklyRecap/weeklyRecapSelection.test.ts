import { i18n } from '@lingui/core';
import { beforeAll, describe, expect, it } from 'vitest';
import type { WeeklyRecapData, WeeklyRecapStats } from './weeklyRecapModel';
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

const words = (started: number, streakDays: number | null = 12): WeeklyRecapStats => ({
  weekStart: '2026-11-16',
  words: { started, mastered: 0, since: null },
  bestWeek: null,
  aheadOfLastWeek: null,
  streakDays,
  recall: null,
  studied: null,
  wordOfWeek: null,
});

describe('weekly recap selection toggles', () => {
  it('shows every field except the word of the week, which never starts on the image', () => {
    expect(defaultWeeklyRecapSelection()).toEqual({ words: true, streak: true, recall: true, wordOfWeek: false, heatmap: true });
  });

  it('flips exactly the toggled key', () => {
    const selection = toggleWeeklyRecapSelection(defaultWeeklyRecapSelection(), 'recall');
    expect(selection.recall).toBe(false);
    expect(selection.words).toBe(true);
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

  it('suggests the words and the open streak, with no invite link', () => {
    expect(buildSuggestedWeeklyRecapCaption(recap({ totalXp: 90, hasActivity: true }), words(146))).toBe('146 new words this week on SonFlash. 12 days in a row.');
    expect(buildSuggestedWeeklyRecapCaption(recap({ totalXp: 90, hasActivity: true }), words(1, null))).toBe('1 new word this week on SonFlash.');
  });

  it('keeps the XP caption until words are counted', () => {
    expect(buildSuggestedWeeklyRecapCaption(recap({ totalXp: 90, activeDays: 3, hasActivity: true }))).toBe('90 XP this week.');
  });

  it('removes unchecked fields from automatic captions and preserves edited captions', () => {
    const week = recap({ totalXp: 90, hasActivity: true });
    const withoutStreak = toggleWeeklyRecapSelection(defaultWeeklyRecapSelection(), 'streak');
    expect(captionAfterWeeklyRecapSelectionChange(week, words(146), withoutStreak, '', false)).toBe('146 new words this week on SonFlash.');
    const withoutWords = toggleWeeklyRecapSelection(defaultWeeklyRecapSelection(), 'words');
    expect(captionAfterWeeklyRecapSelectionChange(week, words(146), withoutWords, '', false)).toBe('12 days in a row.');
    expect(captionAfterWeeklyRecapSelectionChange(week, words(146), withoutWords, 'My own caption', true)).toBe('My own caption');
  });
});
