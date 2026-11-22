import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { heatmapLevelForXp } from '../../components/stats/ActivityHeatmap';
import { boardDateLocale, formatBoardDate, formatStudyWeekday } from '../../components/stats/studyFacts';
import { formatNumber } from '../../lib/format';
import { weeklyRecapHasActivity, type WeeklyRecapData, type WeeklyRecapStats } from './weeklyRecapModel';
import type { WeeklyRecapSelection, WeeklyRecapSelectionKey } from './weeklyRecapSelection';

/** The word of the week once its card was read. */
export interface WeeklyRecapWordOfWeek {
  readonly word: string;
  readonly reviews: number;
}

/** A label with one emphasised run, as the boards set "words *this week*". */
export interface WeeklyRecapEmphasis {
  readonly before: string;
  readonly em: string;
  readonly after: string;
}

export interface WeeklyRecapChip {
  readonly key: 'streak' | 'recall' | 'studied';
  readonly value: string;
  readonly label: string;
}

export interface WeeklyRecapHeatDay {
  readonly dateKey: string;
  readonly level: 0 | 1 | 2 | 3 | 4;
  readonly future: boolean;
  readonly initial: string;
  readonly label: string;
}

/** Everything the card draws, in the UI language: the screen and the PNG render the same content. */
export interface WeeklyRecapCardContent {
  readonly kicker: string;
  /** The empty-week sentence, shown instead of the hero and the stats. */
  readonly empty: string | null;
  /** `value` is null for a state written as a sentence ("No new words yet this week"). */
  readonly hero: { readonly value: string | null; readonly label: WeeklyRecapEmphasis } | null;
  readonly chips: readonly WeeklyRecapChip[];
  readonly wordOfWeek: { readonly label: string; readonly word: string; readonly detail: string } | null;
  readonly heatmap: readonly WeeklyRecapHeatDay[] | null;
  /** Crystal only: the week's two tier movements. */
  readonly garden: {
    readonly label: string;
    readonly cells: readonly { readonly key: 'bloom' | 'star'; readonly from: string; readonly to: string; readonly count: string }[];
  } | null;
}

export const weeklyRecapCardCopy = {
  kicker: msg({ id: 'weeklyRecap.card.kicker', message: 'My week' }),
  empty: msg({ id: 'weeklyRecap.empty', message: 'No study activity yet this week. Come back after a review to see your recap.' }),
  words: msg({ id: 'weeklyRecap.hero.words', message: 'words <0>this week</0>' }),
  wordsSince: msg({ id: 'weeklyRecap.hero.words-since', message: 'words <0>since {weekday}</0>' }),
  noWords: msg({ id: 'weeklyRecap.hero.no-words', message: 'No new words yet this week' }),
  xp: msg({ id: 'weeklyRecap.hero.total-xp', message: 'XP <0>this week</0>' }),
  streakValue: msg({ id: 'weeklyRecap.chip.streak-value', message: '{days} d' }),
  streak: msg({ id: 'weeklyRecap.chip.streak', message: 'streak' }),
  recall: msg({ id: 'weeklyRecap.chip.recall', message: 'recall' }),
  recallSince: msg({ id: 'weeklyRecap.chip.recall-since', message: 'recall since {weekday}' }),
  studied: msg({ id: 'weeklyRecap.chip.studied', message: 'studied' }),
  studiedSince: msg({ id: 'weeklyRecap.chip.studied-since', message: 'studied since {weekday}' }),
  hoursMinutes: msg({ id: 'weeklyRecap.chip.hours-minutes', message: '{hours} h {minutes}' }),
  minutes: msg({ id: 'weeklyRecap.chip.minutes', message: '{minutes} min' }),
  underMinute: msg({ id: 'weeklyRecap.chip.under-minute', message: '< 1 min' }),
  wordOfWeek: msg({ id: 'weeklyRecap.word-of-week.label', message: 'Word of the week' }),
  wordOfWeekDetail: msg({ id: 'weeklyRecap.word-of-week.detail', message: 'Reviewed {reviews, plural, one {# time} other {# times}} this week' }),
  garden: msg({ id: 'weeklyRecap.garden.label', message: 'Bloom garden' }),
  gardenSince: msg({ id: 'weeklyRecap.garden.label-since', message: 'Bloom garden since {weekday}' }),
  bud: msg({ id: 'weeklyRecap.garden.bud', message: 'Bud' }),
  bloom: msg({ id: 'weeklyRecap.garden.bloom', message: 'Bloom' }),
  star: msg({ id: 'weeklyRecap.garden.star', message: 'Star' }),
  heatDay: msg({ id: 'weeklyRecap.heatmap.day', message: '{weekday}: {xp, number} XP' }),
  heatFuture: msg({ id: 'weeklyRecap.heatmap.future', message: '{weekday}: still to come' }),
};

const say = (descriptor: { id?: string; message?: string }, values: Record<string, unknown> = {}) =>
  i18n._(descriptor.id ?? '', values, { message: descriptor.message });

/** Splits "words <0>this week</0>" into its plain and emphasised runs. */
export function emphasisParts(text: string): WeeklyRecapEmphasis {
  const match = /^(.*?)<0>(.*?)<\/0>(.*)$/s.exec(text);
  return match ? { before: match[1], em: match[2], after: match[3] } : { before: text, em: '', after: '' };
}

const MINUTE_MS = 60_000;

/** "2 h 05", "34 min", "< 1 min": the board's studied chip. */
export function studiedChipValue(activeMs: number): string {
  const minutes = Math.floor(Math.max(0, activeMs) / MINUTE_MS);
  if (minutes < 1) return say(weeklyRecapCardCopy.underMinute);
  if (minutes < 60) return say(weeklyRecapCardCopy.minutes, { minutes });
  return say(weeklyRecapCardCopy.hoursMinutes, { hours: Math.floor(minutes / 60), minutes: String(minutes % 60).padStart(2, '0') });
}

/** "16 – 22 Nov" in the UI language, day first as on the boards. */
export function weeklyRecapRangeLabel(rangeStart: string, rangeEnd: string, locale: string): string {
  const formatter = new Intl.DateTimeFormat(boardDateLocale(locale), { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const start = new Date(`${rangeStart}T12:00:00Z`);
  const end = new Date(`${rangeEnd}T12:00:00Z`);
  return typeof formatter.formatRange === 'function' ? formatter.formatRange(start, end) : `${formatter.format(start)} – ${formatter.format(end)}`;
}

/** "26 Nov": the day the weekly word counts started. */
export const weeklyRecapShortDate = (day: string, locale: string): string =>
  formatBoardDate(day, locale, { day: 'numeric', month: 'short' });

/**
 * Which toggles have something to show; the word of the week also needs its card to exist.
 * An empty week shows its sentence alone, so it offers none.
 */
export function availableWeeklyRecapSelectionKeys(
  data: WeeklyRecapData,
  stats: WeeklyRecapStats | null,
  wordOfWeekAvailable: boolean,
): WeeklyRecapSelectionKey[] {
  const keys: WeeklyRecapSelectionKey[] = [];
  if (!weeklyRecapHasActivity(data, stats)) return keys;
  if (stats?.words || data.totalXp > 0) keys.push('words');
  if (stats?.streakDays) keys.push('streak');
  if (stats?.recall) keys.push('recall');
  if (stats?.wordOfWeek && wordOfWeekAvailable) keys.push('wordOfWeek');
  if (data.totalXp > 0) keys.push('heatmap');
  return keys;
}

export function buildWeeklyRecapCardContent(input: {
  readonly data: WeeklyRecapData;
  readonly stats: WeeklyRecapStats | null;
  readonly selection: WeeklyRecapSelection;
  readonly wordOfWeek: WeeklyRecapWordOfWeek | null;
  readonly locale: string;
}): WeeklyRecapCardContent {
  const { data, stats, selection, wordOfWeek, locale } = input;
  const kicker = say(weeklyRecapCardCopy.kicker);
  if (!weeklyRecapHasActivity(data, stats)) {
    return { kicker, empty: say(weeklyRecapCardCopy.empty), hero: null, chips: [], wordOfWeek: null, heatmap: null, garden: null };
  }
  const weekday = (day: string) => formatStudyWeekday(day, locale);
  const words = stats?.words ?? null;

  let hero: WeeklyRecapCardContent['hero'] = null;
  if (selection.words && words) {
    if (words.since) hero = { value: formatNumber(words.started), label: emphasisParts(say(weeklyRecapCardCopy.wordsSince, { weekday: weekday(words.since) })) };
    else if (words.started > 0) hero = { value: formatNumber(words.started), label: emphasisParts(say(weeklyRecapCardCopy.words)) };
    else hero = { value: null, label: emphasisParts(say(weeklyRecapCardCopy.noWords)) };
  } else if (selection.words && data.totalXp > 0) {
    hero = { value: formatNumber(data.totalXp), label: emphasisParts(say(weeklyRecapCardCopy.xp)) };
  }

  const chips: WeeklyRecapChip[] = [];
  if (stats) {
    if (selection.streak && stats.streakDays) {
      chips.push({ key: 'streak', value: say(weeklyRecapCardCopy.streakValue, { days: stats.streakDays }), label: say(weeklyRecapCardCopy.streak) });
    }
    if (selection.recall && stats.recall) {
      chips.push({
        key: 'recall',
        value: stats.recall.percent === null ? '—' : `${formatNumber(stats.recall.percent)}%`,
        label: stats.recall.since ? say(weeklyRecapCardCopy.recallSince, { weekday: weekday(stats.recall.since) }) : say(weeklyRecapCardCopy.recall),
      });
    }
    chips.push({
      key: 'studied',
      value: stats.studied ? studiedChipValue(stats.studied.activeMs) : '—',
      label: stats.studied?.since ? say(weeklyRecapCardCopy.studiedSince, { weekday: weekday(stats.studied.since) }) : say(weeklyRecapCardCopy.studied),
    });
  }

  const initials = new Intl.DateTimeFormat(boardDateLocale(locale), { weekday: 'narrow', timeZone: 'UTC' });
  const heatmap = selection.heatmap && data.totalXp > 0
    ? data.days.map(day => {
      const name = weekday(day.dateKey);
      return {
        dateKey: day.dateKey,
        level: day.future ? 0 as const : heatmapLevelForXp(day.xp),
        future: day.future === true,
        initial: initials.format(new Date(`${day.dateKey}T12:00:00Z`)),
        label: day.future ? say(weeklyRecapCardCopy.heatFuture, { weekday: name }) : say(weeklyRecapCardCopy.heatDay, { weekday: name, xp: day.xp }),
      };
    })
    : null;

  return {
    kicker,
    empty: null,
    hero,
    chips,
    wordOfWeek: selection.wordOfWeek && stats?.wordOfWeek && wordOfWeek
      ? { label: say(weeklyRecapCardCopy.wordOfWeek), word: wordOfWeek.word, detail: say(weeklyRecapCardCopy.wordOfWeekDetail, { reviews: wordOfWeek.reviews }) }
      : null,
    heatmap,
    garden: words
      ? {
        label: words.since ? say(weeklyRecapCardCopy.gardenSince, { weekday: weekday(words.since) }) : say(weeklyRecapCardCopy.garden),
        cells: [
          { key: 'bloom', from: say(weeklyRecapCardCopy.bud), to: say(weeklyRecapCardCopy.bloom), count: formatNumber(words.started) },
          { key: 'star', from: say(weeklyRecapCardCopy.bloom), to: say(weeklyRecapCardCopy.star), count: formatNumber(words.mastered) },
        ],
      }
      : null,
  };
}
