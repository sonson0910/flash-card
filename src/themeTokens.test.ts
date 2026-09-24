import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(new URL('./index.css', import.meta.url), 'utf8');
const flashcardStylesheet = readFileSync(new URL('./styles/flashcard-effects.css', import.meta.url), 'utf8');
const classicStylesheet = readFileSync(new URL('./styles/themes/classic.css', import.meta.url), 'utf8');
const crystalStylesheet = readFileSync(new URL('../public/theme-crystal.css', import.meta.url), 'utf8');

const themeDeclarations = (selector: ':root[data-theme-family="classic"]' | ':root[data-theme-family="classic"].dark') => {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = classicStylesheet.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`Missing ${selector} theme declarations.`);
  return match[1];
};

const tokenHex = (declarations: string, token: string) => {
  const match = declarations.match(new RegExp(`${token}\\s*:\\s*(#[0-9a-f]{6})`, 'i'));
  if (!match) throw new Error(`Missing hex value for ${token}.`);
  return match[1];
};

const luminance = (hex: string) => [1, 3, 5]
  .map(index => Number.parseInt(hex.slice(index, index + 2), 16) / 255)
  .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0);

const contrast = (foreground: string, background: string) => {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
};

describe('surface theme tokens', () => {
  it('defines the muted surface token for light and dark themes', () => {
    expect(themeDeclarations(':root[data-theme-family="classic"]')).toMatch(/--sf-surface-muted\s*:/);
    expect(themeDeclarations(':root[data-theme-family="classic"].dark')).toMatch(/--sf-surface-muted\s*:/);
  });

  it('keeps normal text on the light brand color above WCAG AA contrast', () => {
    const light = themeDeclarations(':root[data-theme-family="classic"]');
    expect(contrast(tokenHex(light, '--sf-on-brand'), tokenHex(light, '--sf-brand')))
      .toBeGreaterThanOrEqual(4.5);
  });

  it('keeps Crystal button text above WCAG AA contrast in both modes', () => {
    for (const selector of [':root[data-theme-family="crystal"]', ':root[data-theme-family="crystal"].dark']) {
      const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const declarations = crystalStylesheet.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`))?.[1] ?? '';
      expect(contrast(tokenHex(declarations, '--sf-on-brand'), tokenHex(declarations, '--sf-brand')))
        .toBeGreaterThanOrEqual(4.5);
    }
  });

  it('stops the pronunciation waveform when reduced motion is requested', () => {
    const reducedMotionStyles = stylesheet.slice(stylesheet.indexOf('@media (prefers-reduced-motion: reduce)'));
    const waveformRule = reducedMotionStyles.match(/\.wave-bar-1,[^{]*\{([^}]*)\}/)?.[1] ?? '';
    for (const bar of [1, 2, 3, 4]) expect(reducedMotionStyles).toContain(`.wave-bar-${bar}`);
    expect(waveformRule).toMatch(/animation:\s*none/);
  });

  it('keeps Zen Glass dark in both themes and disables card blur on constrained devices', () => {
    const zenGlass = flashcardStylesheet.match(/\.zen-glass-slab\s*\{([^}]*)\}/)?.[1] ?? '';
    const constrainedStart = flashcardStylesheet.indexOf('@media (max-width: 1180px), (hover: none), (pointer: coarse)');
    const constrained = flashcardStylesheet.slice(
      constrainedStart,
      flashcardStylesheet.indexOf('html[data-save-data="true"]', constrainedStart),
    );

    expect(zenGlass).toContain('rgba(8, 20, 26, 0.92)');
    expect(zenGlass).not.toContain('rgba(255, 255, 255, 0.9)');
    expect(constrained).toContain('.flashcard-panel');
    expect(constrained).toContain('.zen-glass-slab');
    expect(constrained).toContain('backdrop-filter: none');
    expect(constrained).toContain('background: #081418');
  });
});
