import { readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const landingSource = readFileSync(new URL('./LandingPage.tsx', import.meta.url), 'utf8');
const cssSource = readFileSync(new URL('../../index.css', import.meta.url), 'utf8');
const htmlSource = readFileSync(new URL('../../../index.html', import.meta.url), 'utf8');
const landingPageCssSource = readFileSync(new URL('./landing-page.css', import.meta.url), 'utf8');

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

  it('makes the Classic hero demo card a real flip toggle instead of a static reveal', () => {
    expect(landingSource).toContain('function ClassicLandingHero(');
    expect(landingSource).toContain('const [flipped, setFlipped] = useState(false)');
    expect(landingSource).toContain('role="button"');
    expect(landingSource).toContain('aria-pressed={flipped}');
    expect(landingSource).toContain("transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)'");
    expect(landingSource).toContain('onKeyDown={handleFlipKeyDown}');
    expect(landingSource).toContain("id: 'landing.demo.reveal-prompt'");
    // Front and back faces must both hide their backside so the flip reveals real content, not a duplicate.
    expect(landingSource.match(/backfaceVisibility: 'hidden'/g)?.length).toBeGreaterThanOrEqual(2);
    // Reduced motion must skip the 3D transition rather than only disabling it visually.
    expect(landingSource).toContain("transition: reduceMotion ? 'none' :");
    expect(landingSource).toContain("perspective: reduceMotion ? 'none' : '1600px'");
  });

  it('keeps the Crystal mobile hero decor from covering the sign-in CTA', () => {
    // Regression for the audited 390px overlap where a negative margin-top pulled the card
    // stage/Lumi artwork up over the "Sign in to sync" button (evidence: current-landing-390.png).
    expect(landingPageCssSource).not.toContain('margin-top: -26px');
    expect(landingPageCssSource).toMatch(/\.crystal-card-stage \{ min-height: 330px; margin-top: 0;/);
    expect(landingPageCssSource).toMatch(/@media \(max-width: 900px\) \{ \.crystal-landing-hero \{[^}]*row-gap: 28px;/);
  });

  it('defers non-critical landing imagery instead of loading everything eagerly', () => {
    expect(landingSource).toContain('src={trainWindow}');
    expect(landingSource).toMatch(/src=\{trainWindow\}[\s\S]{0,120}loading="lazy"/);
    expect(landingSource).toMatch(/src=\{animeSpelling\}[\s\S]{0,40}loading="lazy"/);
    expect(landingSource).toMatch(/src=\{animeImmediate\}[\s\S]{0,40}loading="lazy"/);
    // The most prominent collage card and the header mark stay eager/high-priority for LCP.
    expect(landingSource).toMatch(/src=\{sonflashLogo\}[\s\S]{0,80}fetchPriority="high"/);
    expect(landingSource).toMatch(/src=\{animeInstant\}[\s\S]{0,40}fetchPriority="high"/);
  });

  it('makes footer and consent legal links keyboard-focus visible', () => {
    const legalLinkBlocks = landingSource.match(/<a[^>]*href="\/(privacy|terms)\.html"[^>]*>/g) ?? [];
    expect(legalLinkBlocks.length).toBeGreaterThan(0);
    for (const block of legalLinkBlocks) {
      expect(block).toContain('focus-visible:outline-2');
    }
  });
});
