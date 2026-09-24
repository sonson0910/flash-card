import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./loadThemeAssets.ts', import.meta.url), 'utf8');
const styles = resolve(import.meta.dirname, '../../styles/themes');
const fontDirectory = resolve(import.meta.dirname, '../../assets/fonts/noto-sans-cjk');

describe('loadThemeAssets', () => {
  it('keeps Crystal and CJK CSS behind dynamic imports', () => {
    expect(source).toContain("import('../../styles/themes/crystal-ornaments.css')");
    expect(source).toContain("import('../../styles/themes/crystal-fonts.css')");
    expect(source).toContain("import('../../styles/themes/cjk-fonts-ja.css')");
    expect(source).toContain("import('../../styles/themes/cjk-fonts-ko.css')");
    expect(source).toContain("import('../../styles/themes/cjk-fonts-zh-hans.css')");
  });

  it('does not import lazy theme assets at module evaluation time', () => {
    expect(source).not.toMatch(/^import ['\"]\.\.\/\.\.\/styles\/themes\//m);
  });

  it('uses bounded WOFF2 CJK subsets outside the initial stylesheet', () => {
    const cjkStyles = ['cjk-fonts-ja.css', 'cjk-fonts-ko.css', 'cjk-fonts-zh-hans.css'];
    for (const file of cjkStyles) {
      const css = readFileSync(resolve(styles, file), 'utf8');
      expect(css).toContain("format('woff2')");
      expect(css).toContain('unicode-range:');
      expect(css).not.toContain('.ttf');
    }

    expect(readFileSync(resolve(import.meta.dirname, '../../index.css'), 'utf8')).not.toContain('cjk-fonts-');
    const assets = readdirSync(fontDirectory);
    expect(assets).toHaveLength(3);
    for (const asset of assets) {
      expect(asset).toMatch(/\.woff2$/);
      expect(statSync(resolve(fontDirectory, asset)).size).toBeLessThanOrEqual(1_200_000);
    }
  });
});
