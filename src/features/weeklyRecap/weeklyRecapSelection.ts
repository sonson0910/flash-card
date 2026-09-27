import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { WeeklyRecapData } from './weeklyRecapModel';

/**
 * What can be toggled on or off the shareable recap card. There is no word
 * or sentence field here on purpose: the bounded XP-history source this
 * feature reads from never carries word-level or private content, so there
 * is nothing that needs an opt-in privacy toggle beyond what is listed.
 */
export type WeeklyRecapSelectionKey = 'totalXp' | 'activeDays' | 'bestDay' | 'heatmap' | 'milestones';

export type WeeklyRecapSelection = Readonly<Record<WeeklyRecapSelectionKey, boolean>>;

export const WEEKLY_RECAP_SELECTION_KEYS: readonly WeeklyRecapSelectionKey[] = [
  'totalXp', 'activeDays', 'bestDay', 'heatmap', 'milestones',
];

export const defaultWeeklyRecapSelection = (): WeeklyRecapSelection => ({
  totalXp: true, activeDays: true, bestDay: true, heatmap: true, milestones: true,
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
  active: msg({
    id: 'weeklyRecap.caption.suggested-active',
    message: '{xp, number} XP and {days, plural, one {# active day} other {# active days}} this week.',
  }),
  quiet: msg({ id: 'weeklyRecap.caption.suggested-quiet', message: 'A quiet week — back to it tomorrow.' }),
};

/** A safe, editable starting caption built only from real numbers already on screen. */
export function buildSuggestedWeeklyRecapCaption(data: WeeklyRecapData): string {
  if (!data.hasActivity) return i18n._(captionCopy.quiet);
  return i18n._(captionCopy.active.id, { xp: data.totalXp, days: data.activeDays }, { message: captionCopy.active.message });
}
