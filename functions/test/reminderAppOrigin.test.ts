import { describe, expect, it } from 'vitest';
import { reminderTodayUrl } from '../src/reminderAppOrigin.js';

describe('reminder destination', () => {
  it('keeps staging and production reminders in their own Firebase project', () => {
    expect(reminderTodayUrl('sonflash-staging-20260906', 'vi'))
      .toBe('https://sonflash-staging-20260906.web.app/vi/?view=today');
    expect(reminderTodayUrl('sonflash-staging-20260906', 'en'))
      .toBe('https://sonflash-staging-20260906.web.app/?view=today');
    expect(reminderTodayUrl('encoded-hangout-433912-h2', 'en'))
      .toBe('https://sonflash.app/?view=today');
    expect(reminderTodayUrl('demo-lingoflash', 'en'))
      .toBe('http://127.0.0.1:4173/?view=today');
  });

  it('refuses an unknown project instead of falling back to production', () => {
    expect(() => reminderTodayUrl('unexpected-project', 'en')).toThrow(/not configured/);
    expect(() => reminderTodayUrl('toString', 'en')).toThrow(/not configured/);
  });
});
