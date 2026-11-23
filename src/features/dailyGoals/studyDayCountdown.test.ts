import { describe, expect, it } from 'vitest';
import {
  nextStudyDayStart,
  resolveStudyTimeZone,
  shiftStudyDay,
  studyDayCountdown,
  studyDayInZone,
} from './studyDayCountdown';

describe('study day countdown', () => {
  it('counts to midnight in Asia/Ho_Chi_Minh, which has a fixed offset', () => {
    const now = new Date('2026-11-19T15:15:00.000Z'); // 22:15 in Ho Chi Minh City
    expect(studyDayInZone(now, 'Asia/Ho_Chi_Minh')).toBe('2026-11-19');
    expect(nextStudyDayStart(now, 'Asia/Ho_Chi_Minh').toISOString()).toBe('2026-11-19T17:00:00.000Z');
    expect(studyDayCountdown(now, 'Asia/Ho_Chi_Minh')).toEqual({ hours: 1, minutes: 45 });
  });

  it('counts a 23-hour day when the clocks spring forward before midnight', () => {
    const now = new Date('2026-03-08T06:00:00.000Z'); // 01:00 EST, an hour before the change
    expect(nextStudyDayStart(now, 'America/New_York').toISOString()).toBe('2026-03-09T04:00:00.000Z');
    expect(studyDayCountdown(now, 'America/New_York')).toEqual({ hours: 22, minutes: 0 });
  });

  it('counts a 25-hour day when the clocks fall back before midnight', () => {
    const now = new Date('2026-11-01T04:30:00.000Z'); // 00:30 EDT, before the change at 02:00
    expect(nextStudyDayStart(now, 'America/New_York').toISOString()).toBe('2026-11-02T05:00:00.000Z');
    expect(studyDayCountdown(now, 'America/New_York')).toEqual({ hours: 24, minutes: 30 });
  });

  it('rounds the last seconds up to a whole minute and restarts at midnight', () => {
    expect(studyDayCountdown(new Date('2026-11-19T16:59:30.000Z'), 'Asia/Ho_Chi_Minh')).toEqual({ hours: 0, minutes: 1 });
    expect(studyDayCountdown(new Date('2026-11-19T17:00:00.000Z'), 'Asia/Ho_Chi_Minh')).toEqual({ hours: 24, minutes: 0 });
  });

  it('uses the stored reward zone when valid and the device zone otherwise', () => {
    expect(resolveStudyTimeZone('Asia/Ho_Chi_Minh')).toBe('Asia/Ho_Chi_Minh');
    const device = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(resolveStudyTimeZone('Mars/Olympus_Mons')).toBe(device);
    expect(resolveStudyTimeZone(undefined)).toBe(device);
  });

  it('shifts calendar days across month and year ends', () => {
    expect(shiftStudyDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftStudyDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(() => shiftStudyDay('19/11/2026', 1)).toThrow(RangeError);
  });
});
