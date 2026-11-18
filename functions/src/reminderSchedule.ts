import { InputValidationError } from './inputValidation.js';

export interface ReminderSchedule {
  readonly days: readonly number[]; // Sunday = 0.
  readonly sendAtLocal: string; // HH:mm in timezone.
  readonly timezone: string;
  readonly quietHours?: { readonly startLocal: string; readonly endLocal: string };
}

export interface ReminderOccurrence {
  readonly at: Date;
  /** The selected schedule day, which can differ from the delivery day after quiet hours. */
  readonly scheduledDay: string;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MINUTE_MS = 60 * 1000;

const minuteOfDay = (value: string): number => {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new InputValidationError('Reminder time is invalid.');
  return Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
};

const localParts = (formatter: Intl.DateTimeFormat, instant: Date) => {
  const values = Object.fromEntries(formatter.formatToParts(instant).map(part => [part.type, Number(part.value)]));
  return { year: values.year, month: values.month, day: values.day, hour: values.hour, minute: values.minute };
};

const localKey = ({ year, month, day, hour, minute }: ReturnType<typeof localParts>): string =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

const dayKey = (day: Date): string => day.toISOString().slice(0, 10);

/** Defers a delayed delivery that reaches quiet hours without changing its selected day. */
export function quietHoursEndAfter(schedule: ReminderSchedule, now: Date): Date | null {
  if (!schedule.quietHours) return null;
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new InputValidationError('Reminder time is invalid.');
  }
  const start = minuteOfDay(schedule.quietHours.startLocal);
  const end = minuteOfDay(schedule.quietHours.endLocal);
  if (start === end) throw new InputValidationError('Reminder quiet hours are invalid.');
  if (typeof schedule.timezone !== 'string' || !schedule.timezone || schedule.timezone.length > 128) {
    throw new InputValidationError('Reminder time zone is invalid.');
  }
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
      timeZone: schedule.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
  } catch {
    throw new InputValidationError('Reminder time zone is invalid.');
  }
  const local = localParts(formatter, now);
  const minute = local.hour * 60 + local.minute;
  const inside = start < end ? minute >= start && minute < end : minute >= start || minute < end;
  if (!inside) return null;
  const localDay = Date.UTC(local.year, local.month - 1, local.day);
  const endDay = new Date(localDay + (start > end && minute >= start ? DAY_MS : 0));
  const endAt = instantForLocal(formatter, endDay, end, now);
  if (!endAt) throw new InputValidationError('Reminder quiet hours could not advance.');
  return endAt;
}

/** Compare server review time with the delivery day in the learner's time zone. */
export function studiedOnLocalDay(lastReviewAt: Date, now: Date, timezone: string): boolean {
  if (![lastReviewAt, now].every(date => date instanceof Date && Number.isFinite(date.getTime()))
    || typeof timezone !== 'string' || !timezone || timezone.length > 128) {
    throw new InputValidationError('Reminder study day is invalid.');
  }
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    });
  } catch {
    throw new InputValidationError('Reminder time zone is invalid.');
  }
  const localDay = (instant: Date) => {
    const { year, month, day } = localParts(formatter, instant);
    return `${year}-${month}-${day}`;
  };
  return localDay(lastReviewAt) === localDay(now);
}

/** Exact matches choose the next occurrence in a repeated DST hour; missing times shift forward by the gap. */
const instantForLocal = (formatter: Intl.DateTimeFormat, day: Date, minute: number, after: Date): Date | null => {
  const naive = day.getTime() + minute * MINUTE_MS;
  const requested = `${dayKey(day)}T${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
  const offsets = new Set<number>();
  for (let hour = -36; hour <= 36; hour += 3) {
    const probe = new Date(naive + hour * HOUR_MS);
    const local = localParts(formatter, probe);
    offsets.add(Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute) - probe.getTime());
  }
  const candidates = [...offsets].map(offset => new Date(naive - offset))
    .map(candidate => ({ candidate, key: localKey(localParts(formatter, candidate)) }));
  const exact = candidates.filter(entry => entry.key === requested);
  if (exact.length) return exact.filter(entry => entry.candidate > after)
    .sort((left, right) => left.candidate.getTime() - right.candidate.getTime())[0]?.candidate ?? null;
  // A spring-forward gap has no exact local instant. Keep the requested minutes after the jump.
  const shifted = candidates.filter(entry => entry.candidate > after && entry.key > requested)
    .sort((left, right) => left.key.localeCompare(right.key) || left.candidate.getTime() - right.candidate.getTime());
  return shifted[0]?.candidate ?? null;
};

/** Returns the next selected occurrence strictly after now, with its original local schedule day. */
export function nextReminderOccurrence(schedule: ReminderSchedule, now: Date): ReminderOccurrence {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())
    || !Array.isArray(schedule.days) || !schedule.days.length || schedule.days.length > 7
    || new Set(schedule.days).size !== schedule.days.length
    || schedule.days.some(day => !Number.isInteger(day) || day < 0 || day > 6)) {
    throw new InputValidationError('Reminder schedule is invalid.');
  }
  const sendMinute = minuteOfDay(schedule.sendAtLocal);
  const quietStart = schedule.quietHours ? minuteOfDay(schedule.quietHours.startLocal) : null;
  const quietEnd = schedule.quietHours ? minuteOfDay(schedule.quietHours.endLocal) : null;
  if (quietStart !== null && quietStart === quietEnd) throw new InputValidationError('Reminder quiet hours are invalid.');
  if (typeof schedule.timezone !== 'string' || !schedule.timezone || schedule.timezone.length > 128) {
    throw new InputValidationError('Reminder time zone is invalid.');
  }
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
      timeZone: schedule.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    });
  } catch {
    throw new InputValidationError('Reminder time zone is invalid.');
  }

  const localNow = localParts(formatter, now);
  const localToday = Date.UTC(localNow.year, localNow.month - 1, localNow.day);
  const selectedDays = new Set(schedule.days);
  const inQuietHours = quietStart !== null && quietEnd !== null && (quietStart < quietEnd
    ? sendMinute >= quietStart && sendMinute < quietEnd
    : sendMinute >= quietStart || sendMinute < quietEnd);
  const deliveryMinute = inQuietHours ? quietEnd : sendMinute;
  const deliveryDayOffset = inQuietHours && quietStart > quietEnd && sendMinute >= quietStart ? 1 : 0;
  let next: ReminderOccurrence | null = null;
  // Yesterday may still be pending when quiet hours moved its send time past midnight.
  for (let offset = -1; offset <= 7; offset++) {
    const scheduled = new Date(localToday + offset * DAY_MS);
    if (!selectedDays.has(scheduled.getUTCDay())) continue;
    const deliveryDay = new Date(scheduled.getTime() + deliveryDayOffset * DAY_MS);
    const at = instantForLocal(formatter, deliveryDay, deliveryMinute, now);
    if (at && (!next || at < next.at)) next = { at, scheduledDay: dayKey(scheduled) };
  }
  if (!next) throw new InputValidationError('Reminder occurrence could not be calculated.');
  return next;
}

/** Advance a processed schedule day, including both instants of a repeated DST hour. */
export function nextReminderAfterScheduledDay(
  schedule: ReminderSchedule,
  now: Date,
  processedDay: string,
): ReminderOccurrence {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(processedDay)) {
    throw new InputValidationError('Reminder scheduled day is invalid.');
  }
  let cursor = now;
  for (let attempt = 0; attempt < 3; attempt++) {
    const next = nextReminderOccurrence(schedule, cursor);
    if (next.scheduledDay > processedDay) return next;
    cursor = new Date(next.at.getTime() + 1);
  }
  throw new InputValidationError('Reminder occurrence could not advance.');
}
