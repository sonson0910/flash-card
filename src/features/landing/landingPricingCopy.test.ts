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
});
