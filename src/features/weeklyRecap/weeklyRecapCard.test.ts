import { i18n } from '@lingui/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { availableWeeklyRecapSelectionKeys, buildWeeklyRecapCardContent, emphasisParts, studiedChipValue } from './weeklyRecapCard';
import type { WeeklyRecapData, WeeklyRecapStats } from './weeklyRecapModel';
import { defaultWeeklyRecapSelection } from './weeklyRecapSelection';

beforeAll(() => {
  i18n.load('en', {});
  i18n.activate('en');
});

const week = (totalXp = 60): WeeklyRecapData => ({
  rangeStart: '2026-11-23',
  rangeEnd: '2026-11-29',
  days: Array.from({ length: 7 }, (_, index) => ({ dateKey: `2026-11-${23 + index}`, xp: index === 3 ? totalXp : 0, ...(index > 3 ? { future: true } : {}) })),
  totalXp,
  activeDays: totalXp > 0 ? 1 : 0,
  bestDay: null,
  reviewedCount: null,
  hasActivity: totalXp > 0,
});

const stats = (overrides: Partial<WeeklyRecapStats> = {}): WeeklyRecapStats => ({
  weekStart: '2026-11-23',
  words: { started: 40, mastered: 3, since: null },
  bestWeek: null,
  aheadOfLastWeek: null,
  streakDays: 4,
  recall: { percent: 88, since: null },
  studied: { activeMs: 1_500_000, since: null },
  wordOfWeek: null,
  ...overrides,
});

const content = (recapStats: WeeklyRecapStats | null, data = week()) =>
  buildWeeklyRecapCardContent({ data, stats: recapStats, selection: defaultWeeklyRecapSelection(), wordOfWeek: null, locale: 'en' });

describe('weekly recap card content', () => {
  it('writes the ship week from the day counting began, without a best week or a zero', () => {
    // Counting began on Thursday 26 Nov for an account that studied before.
    const shipWeek = content(stats({
      words: { started: 12, mastered: 1, since: '2026-11-26' },
      recall: { percent: 90, since: '2026-11-26' },
      studied: { activeMs: 30_000, since: '2026-11-26' },
    }));

    expect(shipWeek.hero).toEqual({ value: '12', label: { before: 'words ', em: 'since Thursday', after: '' } });
    expect(shipWeek.chips).toEqual([
      { key: 'streak', value: '4 d', label: 'streak' },
      { key: 'recall', value: '90%', label: 'recall since Thursday' },
      { key: 'studied', value: '< 1 min', label: 'studied since Thursday' },
    ]);
    expect(shipWeek.garden?.label).toBe('Bloom garden since Thursday');
  });

  it('says no new words yet instead of drawing a zero', () => {
    const quiet = content(stats({ words: { started: 0, mastered: 0, since: null } }));
    expect(quiet.hero).toEqual({ value: null, label: { before: 'No new words yet this week', em: '', after: '' } });
    expect(quiet.garden?.cells.map(cell => cell.count)).toEqual(['0', '0']);
  });

  it('shows a dash for recall below five graded reviews and for study time before it is counted', () => {
    const early = content(stats({ recall: { percent: null, since: null }, studied: null, streakDays: null }));
    expect(early.chips).toEqual([
      { key: 'recall', value: '—', label: 'recall' },
      { key: 'studied', value: '—', label: 'studied' },
    ]);
  });

  it('omits recall without review activity for the course, and every chip without verified stats', () => {
    expect(content(stats({ recall: null })).chips.map(chip => chip.key)).toEqual(['streak', 'studied']);
    const legacy = content(null);
    expect(legacy.chips).toEqual([]);
    expect(legacy.hero?.label).toEqual({ before: 'XP ', em: 'this week', after: '' });
    expect(legacy.garden).toBeNull();
  });

  it('formats studied time as the board does', () => {
    expect(studiedChipValue(59_000)).toBe('< 1 min');
    expect(studiedChipValue(34 * 60_000 + 59_000)).toBe('34 min');
    expect(studiedChipValue(2 * 3_600_000 + 5 * 60_000)).toBe('2 h 05');
  });

  it('offers the word of the week toggle only when a pick exists and its card can be read', () => {
    const pick = stats({ wordOfWeek: { cardId: 'card-1', reviews: 3 } });
    expect(availableWeeklyRecapSelectionKeys(week(), pick, true)).toEqual(['words', 'streak', 'recall', 'wordOfWeek', 'heatmap']);
    expect(availableWeeklyRecapSelectionKeys(week(), pick, false)).not.toContain('wordOfWeek');
    expect(availableWeeklyRecapSelectionKeys(week(0), null, true)).toEqual([]);
    expect(availableWeeklyRecapSelectionKeys(week(0), stats({ words: { started: 0, mastered: 0, since: null } }), true)).toEqual([]);
  });

  it('splits an emphasised run out of a translated label', () => {
    expect(emphasisParts('từ <0>tuần này</0>')).toEqual({ before: 'từ ', em: 'tuần này', after: '' });
    expect(emphasisParts('plain')).toEqual({ before: 'plain', em: '', after: '' });
  });
});
