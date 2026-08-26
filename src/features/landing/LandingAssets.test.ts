import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const landingSource = readFileSync(new URL('./LandingPage.tsx', import.meta.url), 'utf8');

describe('landing atmosphere contract', () => {
  it('serves every atmosphere locally within its startup budget', () => {
    expect(landingSource).not.toContain('cloudfront.net');
    for (const atmosphere of ['golden-hour', 'still-water', 'deep-woods', 'quiet-dawn']) {
      expect(statSync(new URL(`../../assets/landing/${atmosphere}.av1.mp4`, import.meta.url)).size).toBeLessThan(2_000_000);
      expect(statSync(new URL(`../../assets/landing/${atmosphere}.h264.mp4`, import.meta.url)).size).toBeLessThan(3_000_000);
    }
  });

  it('keeps the mobile hero stable while browser chrome changes', () => {
    expect(landingSource).not.toContain('100dvh');
    expect(landingSource).toContain('100svh');
    expect(landingSource).not.toContain('focus({ preventScroll: true })');
  });
});
