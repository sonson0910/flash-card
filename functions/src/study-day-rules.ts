// Calendar arithmetic on study days: 'YYYY-MM-DD' strings in the account's pinned reward time
// zone. The Functions and the web client share this file, so it imports nothing that only one of
// them can load. Day arithmetic runs on the date string through Date.UTC, so the length of a
// local day (23 or 25 hours at a daylight-saving change) never matters.

const DAY_MS = 24 * 60 * 60 * 1000;

export const isStudyDay = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

const utcMidnight = (day: string): number => {
  const [year, month, date] = day.split('-').map(Number);
  return Date.UTC(year, month - 1, date);
};

/** The study day `offset` days after `day` (before it when negative). */
export const shiftStudyDay = (day: string, offset: number): string =>
  new Date(utcMidnight(day) + offset * DAY_MS).toISOString().slice(0, 10);

/** Whole days from `from` to `to`: 1 when `to` is the next day, negative when it is earlier. */
export const studyDaysBetween = (from: string, to: string): number =>
  Math.round((utcMidnight(to) - utcMidnight(from)) / DAY_MS);

/** The Monday that starts the week of `day`; a study week runs Monday to Sunday. */
export const weekStartOf = (day: string): string =>
  shiftStudyDay(day, -((new Date(utcMidnight(day)).getUTCDay() + 6) % 7));

export const isPlainRecord = (value: unknown): value is Record<string, unknown> => Boolean(value)
  && typeof value === 'object' && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

export const isCount = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;

/** Adds without passing the largest safe integer, so a stored counter stays a valid count. */
export const addCount = (left: number, right: number): number => Math.min(left + right, Number.MAX_SAFE_INTEGER);

/** The newest key of a day map, or `fallback` when every key is older. */
export const latestStudyDay = (days: Record<string, unknown>, fallback: string): string =>
  Object.keys(days).reduce((latest, day) => day > latest ? day : latest, fallback);
