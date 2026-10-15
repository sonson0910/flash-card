import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadCrystalStylesheet } from './loadThemeAssets';

const source = readFileSync(new URL('./loadThemeAssets.ts', import.meta.url), 'utf8');
const styles = resolve(import.meta.dirname, '../../styles/themes');
const fontDirectory = resolve(import.meta.dirname, '../../assets/fonts/noto-sans-cjk');

class FakeStylesheet {
  id = '';
  rel = '';
  href = '';
  sheet: unknown = null;
  isConnected = false;
  private readonly listeners = new Map<string, (() => void)[]>();

  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  remove() { this.isConnected = false; }
  emit(type: string) { this.listeners.get(type)?.forEach(listener => listener()); }
}

const installStylesheetDocument = () => {
  const stylesheets: FakeStylesheet[] = [];
  const documentLike = {
    getElementById: (id: string) => stylesheets.find(stylesheet => stylesheet.id === id && stylesheet.isConnected) ?? null,
    createElement: () => new FakeStylesheet(),
    head: { append: (stylesheet: FakeStylesheet) => { stylesheet.isConnected = true; stylesheets.push(stylesheet); } },
  };
  vi.stubGlobal('document', documentLike);
  return stylesheets;
};

afterEach(() => vi.unstubAllGlobals());

describe('loadThemeAssets', () => {
  it('keeps Crystal and CJK CSS behind dynamic imports', () => {
    expect(source).toContain("import('../../styles/themes/crystal-ornaments.css')");
    expect(source).toContain("import('../../styles/themes/crystal-fonts.css')");
    expect(source).toContain("import('../../styles/themes/cjk-fonts-ja.css')");
    expect(source).toContain("import('../../styles/themes/cjk-fonts-ko.css')");
    expect(source).toContain("import('../../styles/themes/cjk-fonts-zh-hans.css')");
  });

  it('removes a failed stylesheet and retries with a new link', async () => {
    const stylesheets = installStylesheetDocument();
    const firstLoad = loadCrystalStylesheet();
    const first = stylesheets[0];
    first.emit('error');
    await expect(firstLoad).rejects.toThrow('Crystal theme stylesheet could not load.');
    expect(first.isConnected).toBe(false);

    const retry = loadCrystalStylesheet();
    const second = stylesheets[1];
    expect(second).not.toBe(first);
    second.emit('load');
    await expect(retry).resolves.toBeUndefined();
  });

  it('does not add a link when an existing Crystal stylesheet is already ready', async () => {
    const stylesheets = installStylesheetDocument();
    const existing = new FakeStylesheet();
    existing.id = 'sonflash-crystal-theme';
    existing.isConnected = true;
    existing.sheet = {};
    stylesheets.push(existing);

    await expect(loadCrystalStylesheet()).resolves.toBeUndefined();
    expect(stylesheets).toEqual([existing]);
  });

  it('replaces an unresolved existing Crystal stylesheet so a retry can complete', async () => {
    const stylesheets = installStylesheetDocument();
    const existing = new FakeStylesheet();
    existing.id = 'sonflash-crystal-theme';
    existing.isConnected = true;
    stylesheets.push(existing);

    const retry = loadCrystalStylesheet();
    const replacement = stylesheets[1];
    expect(existing.isConnected).toBe(false);
    expect(replacement).not.toBe(existing);
    replacement.emit('load');
    await expect(retry).resolves.toBeUndefined();
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
