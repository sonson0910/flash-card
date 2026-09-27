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

  it('celebrates reaching the recap once through the shared, already-gated sound/haptic helpers', () => {
    // No jsdom/testing-library in this repo's toolchain (see AppShellMotion.test.ts for the
    // same pattern); the sound-off/haptics-off/reduced-motion gating itself is covered where
    // those helpers live: haptics.test.ts, interactionSounds.test.ts and motion.test.ts.
    expect(source).toContain("import { triggerHaptic } from '../../lib/haptics'");
    expect(source).toContain("import { playRewardSound } from '../../lib/interactionSounds'");
    expect(source).toMatch(/useEffect\(\(\) => \{\s*if \(!open\) return;\s*playRewardSound\(\);\s*triggerHaptic\('success'\);/);
    expect(source).not.toContain('navigator.vibrate');
  });

  it('gives the recap dialog a GSAP entrance that collapses under reduced motion', () => {
    expect(source).toContain('<Dialog.Content asChild');
    expect(source).toContain('<GsapEntrance');
    expect(source).toContain('variant="result"');
  });
});
