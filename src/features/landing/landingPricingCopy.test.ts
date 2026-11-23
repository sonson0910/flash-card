import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('landing pricing copy against server limits', () => {
  it('states the per-account card cap instead of promising unlimited manual cards', () => {
    const cap = Number(/MAX_CARD_ALLOCATION\s*=\s*([\d_]+)/.exec(read('../../../functions/src/cardPersistence.ts'))?.[1].replaceAll('_', ''));
    expect(cap).toBeGreaterThan(0);
    const landing = read('./LandingPage.tsx');
    const row = /id: "manual-cards",([\s\S]*?)\n  \},/.exec(landing)?.[1] ?? '';
    expect(row).not.toBe('');
    expect(row).not.toContain('Unlimited');
    expect(row.match(/Up to ([\d,]+)/g)).toEqual([`Up to ${cap.toLocaleString('en-US')}`, `Up to ${cap.toLocaleString('en-US')}`]);
  });

  it('states the server AI limits and does not offer an unavailable Pro top-up', () => {
    const defaults = /PILOT_CONFIG_DEFAULTS[^{]*\{([\s\S]*?)\n\};/.exec(read('../../../functions/src/pilotConfig.ts'))?.[1] ?? '';
    const monthly = Number(/freeMonthlyAiCards:\s*(\d+)/.exec(defaults)?.[1]);
    const daily = Number(/freeDailyAiActions:\s*(\d+)/.exec(defaults)?.[1]);
    expect(monthly).toBeGreaterThan(0);
    expect(daily).toBeGreaterThan(0);
    const landing = read('./LandingPage.tsx');
    const message = (context: string) =>
      new RegExp(`context: '${context.replaceAll('.', '\\.')}', message: '([^']*)'`).exec(landing)?.[1] ?? '';
    expect(message('landing.pricing.value.ai-free')).toBe(`${monthly} / month`);
    const free = message('landing.pricing.faq.free.answer');
    expect(free).toContain(`${monthly} AI-generated cards each month`);
    expect(free).toContain(`${daily} AI actions a day`);
    expect(message('landing.pricing.faq.exhausted.question')).toContain(`all ${monthly} AI cards`);
    expect(message('landing.pricing.faq.exhausted.answer')).not.toMatch(/right away with Pro/);
  });
});
