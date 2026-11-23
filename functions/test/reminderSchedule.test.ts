import { describe, expect, it } from 'vitest';
import { nextReminderAfterScheduledDay, nextReminderOccurrence, quietHoursEndAfter, studiedOnLocalDay } from '../src/reminderSchedule.js';

describe('quietHoursEndAfter', () => {
  it('defers a delayed reminder across midnight in the learner timezone', () => {
    const schedule = { days: [0], sendAtLocal: '21:30', timezone: 'UTC',
      quietHours: { startLocal: '22:00', endLocal: '06:00' } };
    expect(quietHoursEndAfter(schedule, new Date('2026-10-04T21:59:00Z'))).toBeNull();
    expect(quietHoursEndAfter(schedule, new Date('2026-10-04T22:15:00Z'))).toEqual(new Date('2026-10-05T06:00:00Z'));
    expect(quietHoursEndAfter(schedule, new Date('2026-10-05T05:59:00Z'))).toEqual(new Date('2026-10-05T06:00:00Z'));
    expect(quietHoursEndAfter(schedule, new Date('2026-10-05T06:00:00Z'))).toBeNull();
  });

  it('uses the actual timezone clock through a DST jump', () => {
    const schedule = { days: [0], sendAtLocal: '00:30', timezone: 'America/New_York',
      quietHours: { startLocal: '01:00', endLocal: '03:00' } };
    expect(quietHoursEndAfter(schedule, new Date('2026-03-08T06:30:00Z'))).toEqual(new Date('2026-03-08T07:00:00Z'));
    expect(() => quietHoursEndAfter({ ...schedule, timezone: '' }, new Date('2026-03-08T06:30:00Z'))).toThrow();
  });
});

describe('nextReminderOccurrence', () => {
  it('shifts a nonexistent spring DST time forward by the gap', () => {
    const next = nextReminderOccurrence({ days: [0], sendAtLocal: '02:30', timezone: 'America/New_York' }, new Date('2026-03-08T04:00:00Z'));
    expect(next).toEqual({ at: new Date('2026-03-08T07:30:00Z'), scheduledDay: '2026-03-08' });
  });

  it('preserves the requested minutes through a half-hour DST gap', () => {
    const next = nextReminderOccurrence({ days: [0], sendAtLocal: '02:15', timezone: 'Australia/Lord_Howe' }, new Date('2026-10-03T12:00:00Z'));
    expect(next).toEqual({ at: new Date('2026-10-03T15:45:00Z'), scheduledDay: '2026-10-04' });
  });

  it('uses the remaining occurrence in a repeated fall DST hour', () => {
    const schedule = { days: [0], sendAtLocal: '01:30', timezone: 'America/New_York' };
    expect(nextReminderOccurrence(schedule, new Date('2026-11-01T04:00:00Z')).at).toEqual(new Date('2026-11-01T05:30:00Z'));
    expect(nextReminderOccurrence(schedule, new Date('2026-11-01T05:45:00Z')).at).toEqual(new Date('2026-11-01T06:30:00Z'));
    expect(nextReminderOccurrence(schedule, new Date('2026-11-01T06:45:00Z')).at).toEqual(new Date('2026-11-08T06:30:00Z'));
  });

  it('keeps the selected day when quiet hours move delivery past midnight', () => {
    const schedule = { days: [0], sendAtLocal: '23:00', timezone: 'UTC', quietHours: { startLocal: '22:00', endLocal: '07:00' } };
    expect(nextReminderOccurrence(schedule, new Date('2026-09-28T06:00:00Z'))).toEqual({
      at: new Date('2026-09-28T07:00:00Z'), scheduledDay: '2026-09-27',
    });
  });

  it('moves a daytime quiet-hour send to its end on the same day', () => {
    expect(nextReminderOccurrence({
      days: [2], sendAtLocal: '12:30', timezone: 'UTC', quietHours: { startLocal: '12:00', endLocal: '13:00' },
    }, new Date('2026-09-29T10:00:00Z'))).toEqual({ at: new Date('2026-09-29T13:00:00Z'), scheduledDay: '2026-09-29' });
  });

  it('selects weekdays in the learner timezone rather than the server timezone', () => {
    expect(nextReminderOccurrence({ days: [1], sendAtLocal: '08:00', timezone: 'Asia/Ho_Chi_Minh' }, new Date('2026-09-27T23:00:00Z'))).toEqual({
      at: new Date('2026-09-28T01:00:00Z'), scheduledDay: '2026-09-28',
    });
  });

  it('rejects invalid schedule inputs', () => {
    const base = { days: [1], sendAtLocal: '09:00', timezone: 'UTC' };
    expect(() => nextReminderOccurrence({ ...base, days: [] }, new Date())).toThrow();
    expect(() => nextReminderOccurrence({ ...base, days: [1, 1] }, new Date())).toThrow();
    expect(() => nextReminderOccurrence({ ...base, sendAtLocal: '25:00' }, new Date())).toThrow();
    expect(() => nextReminderOccurrence({ ...base, timezone: 'Not/A_Zone' }, new Date())).toThrow();
    expect(() => nextReminderOccurrence({ ...base, quietHours: { startLocal: '10:00', endLocal: '10:00' } }, new Date())).toThrow();
  });
});

describe('studiedOnLocalDay', () => {
  it('compares the learner day across UTC midnight', () => {
    const now = new Date('2026-09-30T01:00:00Z');
    expect(studiedOnLocalDay(new Date('2026-09-29T18:00:00Z'), now, 'Asia/Ho_Chi_Minh')).toBe(true);
    expect(studiedOnLocalDay(new Date('2026-09-29T16:00:00Z'), now, 'Asia/Ho_Chi_Minh')).toBe(false);
  });

  it('compares calendar days through a repeated DST hour', () => {
    const now = new Date('2026-11-01T06:45:00Z');
    expect(studiedOnLocalDay(new Date('2026-11-01T05:30:00Z'), now, 'America/New_York')).toBe(true);
    expect(studiedOnLocalDay(new Date('2026-11-01T03:30:00Z'), now, 'America/New_York')).toBe(false);
  });

  it('rejects invalid instants and time zones', () => {
    expect(() => studiedOnLocalDay(new Date('invalid'), new Date(), 'UTC')).toThrow();
    expect(() => studiedOnLocalDay(new Date(), new Date(), 'Not/A_Zone')).toThrow();
  });
});

describe('nextReminderAfterScheduledDay', () => {
  it('does not schedule the second DST occurrence for a day already processed', () => {
    const schedule = { days: [0], sendAtLocal: '01:30', timezone: 'America/New_York' };
    expect(nextReminderAfterScheduledDay(schedule, new Date('2026-11-01T05:30:00Z'), '2026-11-01'))
      .toEqual({ at: new Date('2026-11-08T06:30:00Z'), scheduledDay: '2026-11-08' });
  });
});
