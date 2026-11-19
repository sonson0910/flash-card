/**
 * Study-day arithmetic in the learner's reward time zone. The server decides the study day with
 * the same calendar rule (`dayInTimeZone` in functions/src/verifiedGamification.ts), so the
 * countdown ends when the server starts counting a new day.
 */

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MINUTE_MS = 60_000;

const isValidTimeZone = (timeZone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
};

const deviceTimeZone = (): string => {
  try {
    const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && isValidTimeZone(zone) ? zone : 'UTC';
  } catch {
    return 'UTC';
  }
};

/** The stored reward time zone when it is valid; otherwise the device zone until the server pins one. */
export const resolveStudyTimeZone = (rewardTimeZone?: string | null): string => (
  rewardTimeZone && isValidTimeZone(rewardTimeZone) ? rewardTimeZone : deviceTimeZone()
);

/** The calendar day ("2026-11-19") of an instant in a time zone. */
export const studyDayInZone = (date: Date, timeZone: string): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
};

/** The calendar day before or after `day`, independent of any time zone. */
export const shiftStudyDay = (day: string, offset: number): string => {
  if (!DAY_PATTERN.test(day)) throw new RangeError('A study day must look like 2026-11-19.');
  const [year, month, date] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, date + offset)).toISOString().slice(0, 10);
};

/** Milliseconds by which the zone's wall clock runs ahead of UTC at an instant. */
const zoneOffsetMs = (instant: number, timeZone: string): number => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instant));
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(item => item.type === type)?.value);
  const wallClock = Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'), value('second'));
  return wallClock - (instant - (((instant % 1000) + 1000) % 1000));
};

/**
 * The first instant of the next study day. The offset is checked at the guessed instant as well,
 * so a daylight-saving change between now and midnight moves the answer by the right hour.
 */
export const nextStudyDayStart = (now: Date, timeZone: string): Date => {
  const nextDay = shiftStudyDay(studyDayInZone(now, timeZone), 1);
  const [year, month, date] = nextDay.split('-').map(Number);
  const midnightAsUtc = Date.UTC(year, month - 1, date);
  const first = midnightAsUtc - zoneOffsetMs(now.getTime(), timeZone);
  const second = midnightAsUtc - zoneOffsetMs(first, timeZone);
  const candidates = [first, second]
    .filter(candidate => candidate > now.getTime() && studyDayInZone(new Date(candidate), timeZone) === nextDay)
    .sort((left, right) => left - right);
  // A zone that skips midnight starts the day at the first existing minute; fall back to the
  // later guess, which then lies inside the next day.
  return new Date(candidates[0] ?? Math.max(first, second));
};

export interface StudyDayCountdown {
  readonly hours: number;
  readonly minutes: number;
}

/** Whole hours and minutes left in the study day, rounded up to the next minute. */
export const studyDayCountdown = (now: Date, timeZone: string): StudyDayCountdown => {
  const remaining = Math.max(0, nextStudyDayStart(now, timeZone).getTime() - now.getTime());
  const totalMinutes = Math.ceil(remaining / MINUTE_MS);
  return { hours: Math.floor(totalMinutes / 60), minutes: totalMinutes % 60 };
};
