import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { reminderTodayUrl } from '../src/reminderAppOrigin.js';

describe('reminder destination', () => {
  it('keeps staging and production reminders in their own Firebase project', () => {
    expect(reminderTodayUrl('sonflash-staging-20260906', 'vi'))
      .toBe('https://sonflash-staging-20260906.web.app/vi/?view=today');
    expect(reminderTodayUrl('sonflash-staging-20260906', 'en'))
      .toBe('https://sonflash-staging-20260906.web.app/?view=today');
    expect(reminderTodayUrl('encoded-hangout-433912-h2', 'en'))
      .toBe('https://encoded-hangout-433912-h2.web.app/?view=today');
    expect(reminderTodayUrl('demo-lingoflash', 'en'))
      .toBe('http://127.0.0.1:4173/?view=today');
  });

  it('links each deployed target to a host its app accepts', () => {
    const config = JSON.parse(readFileSync(new URL('../../firebase-applet-config.json', import.meta.url), 'utf8')) as {
      targets: Record<string, { projectId: string; allowedHosts: string[] }>;
    };
    for (const target of Object.values(config.targets)) {
      expect(target.allowedHosts).toContain(new URL(reminderTodayUrl(target.projectId, 'en')).host);
    }
  });

  it('refuses an unknown project instead of falling back to production', () => {
    expect(() => reminderTodayUrl('unexpected-project', 'en')).toThrow(/not configured/);
    expect(() => reminderTodayUrl('toString', 'en')).toThrow(/not configured/);
  });
});
