/**
 * Small, pure derivations for the Today screen. Every value comes from data the
 * learner already has (plan counts, XP, streak, goals); nothing is invented.
 */

export type TodayStageId = 'review' | 'new' | 'match' | 'recap';

export interface TodayStageFact {
  readonly id: TodayStageId;
  readonly count: number;
  readonly skipped: boolean;
}

/** Review needs one recall; a new word needs an introduction plus a recall. */
const SECONDS_PER_REVIEW_CARD = 20;
const SECONDS_PER_NEW_CARD = 40;

/** Rounded-up minutes for one stage; Match is a one-minute round and Recap a one-minute summary. */
export const stageMinutes = (stage: TodayStageFact): number => {
  if (stage.skipped) return 0;
  if (stage.id === 'review') return Math.max(1, Math.ceil((stage.count * SECONDS_PER_REVIEW_CARD) / 60));
  if (stage.id === 'new') return Math.max(1, Math.ceil((stage.count * SECONDS_PER_NEW_CARD) / 60));
  return 1;
};

export const sessionMinutes = (stages: readonly TodayStageFact[]): number =>
  stages.reduce((total, stage) => total + stageMinutes(stage), 0);

export type DayPeriod = 'morning' | 'afternoon' | 'evening';

export const dayPeriod = (now: Date): DayPeriod => {
  const hour = now.getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  return 'evening';
};

/** ISO-8601 week number of the local calendar date. */
export const isoWeekNumber = (now: Date): number => {
  const date = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.ceil(((date.getTime() - yearStart) / 86_400_000 + 1) / 7);
};

/** Whole local days from today until an ISO `yyyy-mm-dd` date; null for an invalid or past date. */
export const daysUntil = (isoDate: string, now: Date): number | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return null;
  const target = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((target - today) / 86_400_000);
  return Number.isFinite(days) && days >= 0 ? days : null;
};

/** Matches the verified gamification curve: level = floor(sqrt(xp / 100)) + 1. */
export const levelProgress = (xp: number) => {
  const safeXp = Number.isFinite(xp) && xp > 0 ? Math.floor(xp) : 0;
  const level = Math.floor(Math.sqrt(safeXp / 100)) + 1;
  const start = 100 * (level - 1) ** 2;
  const next = 100 * level ** 2;
  return { level, xp: safeXp, start, next, remaining: next - safeXp, percent: Math.round(((safeXp - start) / (next - start)) * 100) };
};

/**
 * Sessions to the next level, from the average XP of recent study days. Null
 * without enough history to say anything honest.
 */
export const sessionsToNextLevel = (remainingXp: number, history: readonly { readonly XP: number }[]): number | null => {
  const studyDays = history.slice(-14).map(day => day.XP).filter(xp => Number.isFinite(xp) && xp > 0);
  if (studyDays.length < 2 || remainingXp <= 0) return null;
  const average = studyDays.reduce((total, xp) => total + xp, 0) / studyDays.length;
  return Math.max(1, Math.ceil(remainingXp / average));
};

/** Review XP per card on its first review of the study day, and the Word Match completion award (server rules). */
const REVIEW_CARD_XP = 2;
const MATCH_COMPLETION_XP = 20;

/** Most XP the planned session can award; a card already reviewed today earns nothing again. */
export const sessionXpCeiling = (stages: readonly TodayStageFact[]): number => stages.reduce((total, stage) => {
  if (stage.skipped) return total;
  if (stage.id === 'review' || stage.id === 'new') return total + stage.count * REVIEW_CARD_XP;
  if (stage.id === 'match') return total + MATCH_COMPLETION_XP;
  return total;
}, 0);

const previousIsoDay = (isoDay: string): string => {
  const [year, month, day] = isoDay.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
};

export interface StudyRun {
  readonly studiedToday: boolean;
  /** Consecutive study days ending today (when studied) or yesterday. */
  readonly days: number;
}

/**
 * Reads the current run of study days from the verified per-day XP history. `evidencedStreak`
 * is the server's streak once today is evidenced (0 otherwise); it wins over the history count
 * because the stored history may not reach back to the start of the run, and the streak chip
 * shows that same number.
 */
export const studyRun = (
  history: readonly { readonly date: string; readonly XP: number }[],
  todayIso: string,
  evidencedStreak = 0,
): StudyRun => {
  const studied = new Set(history.filter(entry => entry.XP > 0).map(entry => entry.date));
  const studiedToday = studied.has(todayIso);
  let cursor = studiedToday ? todayIso : previousIsoDay(todayIso);
  let days = 0;
  while (studied.has(cursor) && days < studied.size) {
    days += 1;
    cursor = previousIsoDay(cursor);
  }
  return { studiedToday, days: studiedToday ? Math.max(days, evidencedStreak) : days };
};

/** "Day N" of the run: today counts once the learner has studied, otherwise finishing today makes it the next day. */
export const runDayNumber = (run: StudyRun): number => run.studiedToday ? Math.max(1, run.days) : run.days + 1;

/** Longest display name the greeting and Lumi's bubble can hold without wrapping the heading. */
const GREETING_NAME_MAX = 24;

/**
 * The learner's display name for a greeting, or null when there is none or it is too long to
 * greet by. The whole name is kept: name order differs by culture, so no "first name" is guessed.
 */
export const greetingName = (name: string | undefined): string | null => {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  return [...trimmed].length <= GREETING_NAME_MAX ? trimmed : null;
};

/** Hostname without `www.` for a captured page, or null when the URL cannot be parsed. */
export const sourceSite = (url: string | undefined): string | null => {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
};
