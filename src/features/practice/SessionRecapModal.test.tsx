import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./SessionRecapModal.tsx', import.meta.url), 'utf8');

describe('SessionRecapModal', () => {
  it('keeps its close and action controls at least 44px', () => {
    expect(source).toContain('flex size-11 shrink-0 items-center justify-center rounded-xl');
    expect(source.match(/flex min-h-11 flex-1 items-center justify-center gap-2/g)).toHaveLength(2);
  });

  it('uses localized plural copy and locale-aware animated summary formats', () => {
    expect(source).toContain('message="{count, plural, one {# word} other {# words}}"');
    expect(source).toContain('<CountUp to={totalCards} />');
    expect(source).toContain('<CountUp to={accuracy} suffix="%" />');
    expect(source).toContain('<CountUp to={xpEarned} />');
  });

  it('shows the proud Lumi pose only for Crystal Star when enabled', () => {
    expect(source).toContain("dataset.themeFamily === 'crystal'");
    expect(source).toContain('readLumiEnabled()');
    expect(source).toContain('<Lumi pose="proud"');
  });
});
