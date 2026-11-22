import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { weeklyRecapHasActivity, type WeeklyRecapData, type WeeklyRecapStats } from './weeklyRecapModel';

/**
 * What can be toggled on or off the shareable recap card. The word of the week is the only
 * card content, so it is the only field that starts hidden: the screen promises that private
 * words are never added to the image automatically.
 */
export type WeeklyRecapSelectionKey = 'words' | 'streak' | 'recall' | 'wordOfWeek' | 'heatmap';

export type WeeklyRecapSelection = Readonly<Record<WeeklyRecapSelectionKey, boolean>>;

export const WEEKLY_RECAP_SELECTION_KEYS: readonly WeeklyRecapSelectionKey[] = [
  'words', 'streak', 'recall', 'wordOfWeek', 'heatmap',
];

/** Whether the word of the week starts on the share image. */
export const WORD_OF_WEEK_SHOWN_BY_DEFAULT = false;

export const defaultWeeklyRecapSelection = (): WeeklyRecapSelection => ({
  words: true, streak: true, recall: true, wordOfWeek: WORD_OF_WEEK_SHOWN_BY_DEFAULT, heatmap: true,
});

export function toggleWeeklyRecapSelection(
  selection: WeeklyRecapSelection,
  key: WeeklyRecapSelectionKey,
): WeeklyRecapSelection {
  return { ...selection, [key]: !selection[key] };
}

export const WEEKLY_RECAP_CAPTION_MAX_LENGTH = 220;

export function clampWeeklyRecapCaption(value: string): string {
  return value.slice(0, WEEKLY_RECAP_CAPTION_MAX_LENGTH);
}

const captionCopy = {
  words: msg({ id: 'weeklyRecap.caption.suggested-words', message: '{words, plural, one {# new word} other {# new words}} this week on SonFlash.' }),
  streak: msg({ id: 'weeklyRecap.caption.suggested-streak', message: '{days, plural, one {# day} other {# days}} in a row.' }),
  xp: msg({ id: 'weeklyRecap.caption.suggested-xp', message: '{xp, number} XP this week.' }),
  quiet: msg({ id: 'weeklyRecap.caption.suggested-quiet', message: 'A quiet week — back to it tomorrow.' }),
};

const say = (descriptor: { id?: string; message?: string }, values: Record<string, unknown>) =>
  i18n._(descriptor.id ?? '', values, { message: descriptor.message });

/** A safe, editable starting caption built only from real numbers already on the card. */
export function buildSuggestedWeeklyRecapCaption(
  data: WeeklyRecapData,
  stats: WeeklyRecapStats | null = null,
  selection: WeeklyRecapSelection = defaultWeeklyRecapSelection(),
): string {
  if (!weeklyRecapHasActivity(data, stats)) return say(captionCopy.quiet, {});
  const streak = selection.streak && stats?.streakDays ? say(captionCopy.streak, { days: stats.streakDays }) : '';
  let lead = '';
  if (stats?.words) {
    if (selection.words && stats.words.started > 0) lead = say(captionCopy.words, { words: stats.words.started });
  } else if (selection.words && data.totalXp > 0) {
    lead = say(captionCopy.xp, { xp: data.totalXp });
  }
  return [lead, streak].filter(Boolean).join(' ');
}

export function captionAfterWeeklyRecapSelectionChange(
  data: WeeklyRecapData,
  stats: WeeklyRecapStats | null,
  selection: WeeklyRecapSelection,
  caption: string,
  captionCustomized: boolean,
): string {
  return captionCustomized ? caption : buildSuggestedWeeklyRecapCaption(data, stats, selection);
}
