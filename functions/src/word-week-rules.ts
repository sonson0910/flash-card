// Weekly word statistics per course language in `stats.wordWeeksV1`: words started and mastered
// per study day, the best complete week and the most reviewed card of the week. Only the
// verified review transaction writes it; the map is display-only, so a malformed stored value
// starts over instead of failing a review. No word text is stored, only card ids.
// Shared by the Functions and the web client: import nothing that only one of them can load.
import { addCount, isCount, isPlainRecord, isStudyDay, shiftStudyDay, weekStartOf } from './study-day-rules.js';

/** Course languages tracked at most; a review in a further language is not counted. */
export const WORD_WEEKS_MAX_LANGUAGES = 16;
/** The word of the week is shown only once it has at least this many reviews in the week. */
export const WORD_OF_WEEK_MIN_REVIEWS = 2;
/** Recall for a week is shown only once the week has at least this many graded reviews. */
export const WEEK_RECALL_MIN_REVIEWS = 5;

export interface WordWeekDay {
  /** Cards reviewed for the first time. */
  readonly started: number;
  /** Cards that became mastered. */
  readonly mastered: number;
}

export interface BestWordWeek {
  readonly weekStart: string;
  readonly started: number;
}

export interface WordOfWeek {
  readonly cardId: string;
  /** Reviews of that card inside the week. */
  readonly reviews: number;
}

export interface WordWeeksV1 {
  /** Study day this map was first written. */
  readonly coverageStartedOn: string;
  /** Coverage began with the account's first verified action. */
  readonly fromFirstAction: boolean;
  /** Days from the Monday of the previous week onward. */
  readonly daysByLanguage: Readonly<Record<string, Readonly<Record<string, WordWeekDay>>>>;
  readonly bestWeekByLanguage: Readonly<Record<string, BestWordWeek>>;
  /** The two most recent weeks, keyed by their Monday. */
  readonly wordOfWeekByLanguage: Readonly<Record<string, Readonly<Record<string, WordOfWeek>>>>;
}

export const isCourseLanguage = (value: unknown): value is string => typeof value === 'string'
  && value.length <= 16
  && /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/.test(value);

const isCardId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
const isMonday = (value: unknown): value is string => isStudyDay(value) && weekStartOf(value) === value;

const perLanguage = <T>(value: unknown, parse: (entry: unknown) => T | undefined): Record<string, T> | undefined => {
  if (!isPlainRecord(value) || Object.keys(value).length > WORD_WEEKS_MAX_LANGUAGES) return undefined;
  const parsed: Record<string, T> = {};
  for (const [language, entry] of Object.entries(value)) {
    const result = parse(entry);
    if (!isCourseLanguage(language) || result === undefined) return undefined;
    parsed[language] = result;
  }
  return parsed;
};

const perDay = <T>(value: unknown, isKey: (key: unknown) => boolean, parse: (entry: unknown) => T | undefined) => {
  if (!isPlainRecord(value)) return undefined;
  const parsed: Record<string, T> = {};
  for (const [day, entry] of Object.entries(value)) {
    const result = parse(entry);
    if (!isKey(day) || result === undefined) return undefined;
    parsed[day] = result;
  }
  return parsed;
};

const wordWeekDay = (value: unknown): WordWeekDay | undefined => (
  isPlainRecord(value) && isCount(value.started) && isCount(value.mastered)
    ? { started: value.started, mastered: value.mastered } : undefined
);

const bestWeek = (value: unknown): BestWordWeek | undefined => (
  isPlainRecord(value) && isMonday(value.weekStart) && isCount(value.started)
    ? { weekStart: value.weekStart, started: value.started } : undefined
);

const wordOfWeek = (value: unknown): WordOfWeek | undefined => (
  isPlainRecord(value) && isCardId(value.cardId) && isCount(value.reviews) && value.reviews > 0
    ? { cardId: value.cardId, reviews: value.reviews } : undefined
);

/** The stored map, or undefined when it is missing or any part of it is malformed. */
export const parseWordWeeks = (value: unknown): WordWeeksV1 | undefined => {
  if (!isPlainRecord(value) || !isStudyDay(value.coverageStartedOn) || typeof value.fromFirstAction !== 'boolean') {
    return undefined;
  }
  const daysByLanguage = perLanguage(value.daysByLanguage, entry => perDay(entry, isStudyDay, wordWeekDay));
  const bestWeekByLanguage = perLanguage(value.bestWeekByLanguage, bestWeek);
  const wordOfWeekByLanguage = perLanguage(value.wordOfWeekByLanguage, entry => perDay(entry, isMonday, wordOfWeek));
  if (!daysByLanguage || !bestWeekByLanguage || !wordOfWeekByLanguage) return undefined;
  return {
    coverageStartedOn: value.coverageStartedOn,
    fromFirstAction: value.fromFirstAction,
    daysByLanguage,
    bestWeekByLanguage,
    wordOfWeekByLanguage,
  };
};

/**
 * The record an account starts when its first verified action is not a counted review (a card
 * create, a practice completion, or a review in a language that is not a course language).
 * Coverage begins with the account, so its first partial week counts toward the best week.
 */
export const firstActionWordWeeks = (studyDay: string): WordWeeksV1 => ({
  coverageStartedOn: studyDay,
  fromFirstAction: true,
  daysByLanguage: {},
  bestWeekByLanguage: {},
  wordOfWeekByLanguage: {},
});

/** One verified review as the weekly word record sees it. */
export interface WordWeekReview {
  readonly studyDay: string;
  readonly language: string;
  readonly cardId: string;
  /** The card had no review evidence before, so this review starts it. */
  readonly started: boolean;
  /** This review made the card mastered. */
  readonly mastered: boolean;
  /** Reviews of the card in the week of `studyDay`, this one included. */
  readonly reviewsThisWeek: number;
}

type MutableDays = Record<string, Record<string, WordWeekDay>>;

/**
 * Applies one review. Complete weeks that count toward the best week (those that began on or after
 * the coverage day, or every week when coverage began with the account's first action) are folded
 * into it before days older than the previous week's Monday are dropped. The word of the week is
 * replaced only by a strictly higher count, so the card that reached the top count first keeps it.
 * Undefined when the review is in a language beyond the cap: it is not counted.
 */
export const nextWordWeeks = (input: {
  readonly stored: WordWeeksV1 | undefined;
  readonly fromFirstAction: boolean;
  readonly review: WordWeekReview;
}): WordWeeksV1 | undefined => {
  const { stored, review } = input;
  const languages = new Set([
    ...Object.keys(stored?.daysByLanguage ?? {}),
    ...Object.keys(stored?.bestWeekByLanguage ?? {}),
    ...Object.keys(stored?.wordOfWeekByLanguage ?? {}),
  ]);
  if (!languages.has(review.language) && languages.size >= WORD_WEEKS_MAX_LANGUAGES) return undefined;
  const coverageStartedOn = stored?.coverageStartedOn ?? review.studyDay;
  const fromFirstAction = stored?.fromFirstAction ?? input.fromFirstAction;
  const daysByLanguage: MutableDays = Object.fromEntries(Object.entries(stored?.daysByLanguage ?? {})
    .map(([language, days]) => [language, { ...days }]));
  const picksByLanguage: Record<string, Record<string, WordOfWeek>> = Object.fromEntries(
    Object.entries(stored?.wordOfWeekByLanguage ?? {}).map(([language, picks]) => [language, { ...picks }]),
  );
  const bestWeekByLanguage: Record<string, BestWordWeek> = { ...(stored?.bestWeekByLanguage ?? {}) };

  if (review.started || review.mastered) {
    const days = daysByLanguage[review.language] ?? {};
    const day = days[review.studyDay] ?? { started: 0, mastered: 0 };
    days[review.studyDay] = {
      started: addCount(day.started, review.started ? 1 : 0),
      mastered: addCount(day.mastered, review.mastered ? 1 : 0),
    };
    daysByLanguage[review.language] = days;
  }
  const reviewWeek = weekStartOf(review.studyDay);
  const current = picksByLanguage[review.language]?.[reviewWeek];
  if (isCount(review.reviewsThisWeek) && review.reviewsThisWeek > (current?.reviews ?? 0)) {
    picksByLanguage[review.language] = {
      ...(picksByLanguage[review.language] ?? {}),
      [reviewWeek]: { cardId: review.cardId, reviews: review.reviewsThisWeek },
    };
  }

  const newestDay = Object.values(daysByLanguage).flatMap(days => Object.keys(days))
    .reduce((latest, day) => (day > latest ? day : latest), review.studyDay);
  const currentWeek = weekStartOf(newestDay);
  const keepFrom = shiftStudyDay(currentWeek, -7);
  const counts = (week: string) => fromFirstAction || coverageStartedOn <= week;
  for (const [language, days] of Object.entries(daysByLanguage)) {
    const startedByWeek = new Map<string, number>();
    for (const [day, entry] of Object.entries(days)) {
      const week = weekStartOf(day);
      if (week < currentWeek && counts(week)) startedByWeek.set(week, addCount(startedByWeek.get(week) ?? 0, entry.started));
    }
    for (const [week, started] of [...startedByWeek].sort(([left], [right]) => left.localeCompare(right))) {
      if (started > (bestWeekByLanguage[language]?.started ?? 0)) bestWeekByLanguage[language] = { weekStart: week, started };
    }
    const kept = Object.fromEntries(Object.entries(days).filter(([day]) => day >= keepFrom));
    if (Object.keys(kept).length > 0) daysByLanguage[language] = kept;
    else delete daysByLanguage[language];
  }
  for (const [language, picks] of Object.entries(picksByLanguage)) {
    const kept = Object.fromEntries(Object.entries(picks).filter(([week]) => week >= keepFrom));
    if (Object.keys(kept).length > 0) picksByLanguage[language] = kept;
    else delete picksByLanguage[language];
  }
  return { coverageStartedOn, fromFirstAction, daysByLanguage, bestWeekByLanguage, wordOfWeekByLanguage: picksByLanguage };
};
