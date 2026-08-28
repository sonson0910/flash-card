import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const landingSource = readFileSync(new URL('./LandingPage.tsx', import.meta.url), 'utf8');
const cssSource = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');
const htmlSource = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');

describe('landing asset delivery contract', () => {
  it('serves local media with native AV1/H.264 fallback', () => {
    expect(landingSource).toContain("type='video/mp4; codecs=\"av01.0.08M.08\"'");
    expect(landingSource).toContain("type='video/mp4; codecs=\"avc1.640028\"'");
    expect(landingSource).toContain('data-hero-video');
    expect(landingSource).toContain('muted');
    expect(landingSource).toContain('playsInline');
    expect(landingSource).toContain('train-window.webp');
    expect(landingSource).not.toContain('cloudfront.net');
    expect(landingSource).not.toContain('figma.site');
  });

  it('keeps every selectable atmosphere small enough to start promptly', () => {
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

  it('self-hosts Instrument Serif and removes remote font/auth hints', () => {
    expect(cssSource).toContain('instrument-serif-latin-regular.woff2');
    expect(cssSource).not.toContain('instrument-serif-latin-italic.woff2');
    expect(cssSource).not.toContain('font-style: italic');
    expect(cssSource).toContain(".premium-kicker {\n    font-family: inherit;");
    expect(cssSource).not.toContain('fonts.googleapis.com');
    expect(htmlSource).not.toContain('fonts.googleapis.com');
    expect(htmlSource).not.toContain('fonts.gstatic.com');
    expect(htmlSource).not.toContain('apis.google.com');
    expect(htmlSource).not.toContain('firebaseapp.com');
  });
});
