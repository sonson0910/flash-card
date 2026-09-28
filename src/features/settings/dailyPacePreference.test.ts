import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DAILY_PACE,
  isDailyPace,
  readDailyPace,
  readDailyPaceForEta,
  writeDailyPace,
} from './dailyPacePreference';

class FakeStorage {
  private readonly store = new Map<string, string>();
  getItem(key: string) { return this.store.has(key) ? this.store.get(key)! : null; }
  setItem(key: string, value: string) { this.store.set(key, value); }
}

describe('daily pace preference', () => {
  it('falls back to the default pace when nothing was saved', () => {
    expect(readDailyPace(new FakeStorage())).toBe(DEFAULT_DAILY_PACE);
    expect(readDailyPaceForEta(new FakeStorage())).toBeNull();
    expect(readDailyPaceForEta(null)).toBeNull();
  });

  it('round-trips a saved pace', () => {
    const storage = new FakeStorage();
    writeDailyPace(20, storage);
    expect(readDailyPace(storage)).toBe(20);
    expect(readDailyPaceForEta(storage)).toBe(20);
  });

  it('falls back to the default when the stored value is not one of the allowed options', () => {
    const storage = new FakeStorage();
    storage.setItem('sonflash_daily_pace_v1', '7');
    expect(readDailyPace(storage)).toBe(DEFAULT_DAILY_PACE);
    expect(readDailyPaceForEta(storage)).toBeNull();
  });

  it('validates pace values', () => {
    expect(isDailyPace(10)).toBe(true);
    expect(isDailyPace(11)).toBe(false);
    expect(isDailyPace('10')).toBe(false);
  });
});
