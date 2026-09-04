import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const stylesheet = readFileSync(new URL('./index.css', import.meta.url), 'utf8');

const themeDeclarations = (selector: ':root' | ':root.dark') => {
  const escapedSelector = selector.replace('.', '\\.');
  const match = stylesheet.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));
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

const cssBlock = (marker: string) => {
  const start = stylesheet.indexOf(marker);
  if (start < 0) throw new Error(`Missing ${marker} CSS block.`);
  const open = stylesheet.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < stylesheet.length; index += 1) {
    if (stylesheet[index] === '{') depth += 1;
    if (stylesheet[index] === '}' && --depth === 0) return stylesheet.slice(start, index + 1);
  }
  throw new Error(`Unclosed ${marker} CSS block.`);
};

const cssRule = (block: string, selector: string) => {
  const start = block.indexOf(selector);
  if (start < 0) throw new Error(`Missing ${selector} CSS rule.`);
  const open = block.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < block.length; index += 1) {
    if (block[index] === '{') depth += 1;
    if (block[index] === '}' && --depth === 0) return block.slice(start, index + 1);
  }
  throw new Error(`Unclosed ${selector} CSS rule.`);
};

describe('surface theme tokens', () => {
  it('defines the muted surface token for light and dark themes', () => {
    expect(themeDeclarations(':root')).toMatch(/--sf-surface-muted\s*:/);
    expect(themeDeclarations(':root.dark')).toMatch(/--sf-surface-muted\s*:/);
  });

  it('keeps normal text on the light brand color above WCAG AA contrast', () => {
    const light = themeDeclarations(':root');
    expect(contrast(tokenHex(light, '--sf-on-brand'), tokenHex(light, '--sf-brand')))
      .toBeGreaterThanOrEqual(4.5);
  });

  it('stops the pronunciation waveform when reduced motion is requested', () => {
    const reducedMotionStyles = stylesheet.slice(stylesheet.indexOf('@media (prefers-reduced-motion: reduce)'));

    expect(reducedMotionStyles).toContain(
      '.wave-bar-1, .wave-bar-2, .wave-bar-3, .wave-bar-4 { animation: none; }',
    );
  });

  it('includes flashcard glass surfaces in every compositing mitigation path', () => {
    const mitigationPaths = [
      {
        marker: '@media (max-width: 1180px), (hover: none), (pointer: coarse)',
        disablesBackdrop: true,
        hasDarkRule: true,
      },
      { marker: 'html[data-save-data="true"] :is(', disablesBackdrop: true, hasDarkRule: false },
      {
        marker: '@supports not ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px)))',
        disablesBackdrop: false,
        hasDarkRule: true,
      },
      { marker: '@media (prefers-reduced-transparency: reduce)', disablesBackdrop: true, hasDarkRule: true },
    ];

    for (const { marker, disablesBackdrop, hasDarkRule } of mitigationPaths) {
      const mitigation = cssBlock(marker);
      for (const surface of ['.flashcard-panel', '.zen-glass-slab']) {
        const lightRule = cssRule(mitigation, surface);
        expect(lightRule).toContain('background: var(--sf-surface)');
        if (disablesBackdrop) {
          expect(lightRule).toContain('-webkit-backdrop-filter: none');
          expect(lightRule).toMatch(/(?:^|[;\n])\s*backdrop-filter:\s*none(?:\s*;|\s*$)/m);
        }
        if (hasDarkRule) {
          expect(cssRule(mitigation, `.dark ${surface}`)).toContain('background: var(--sf-surface)');
        }
      }
    }
  });

  it('retains normal and dark flashcard glass theme selectors', () => {
    expect(stylesheet).toMatch(/\.flashcard-panel\s*\{/);
    expect(stylesheet).toMatch(/\.dark \.flashcard-panel\s*\{/);
    expect(stylesheet).toMatch(/\.zen-glass-slab\s*\{/);
    expect(stylesheet).toMatch(/\.dark \.zen-glass-slab\s*\{/);
  });
});
