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

const installBootStylesheet = (stylesheets: FakeStylesheet[], sheet: unknown = null) => {
  const boot = new FakeStylesheet();
  boot.id = 'sonflash-crystal-theme';
  boot.href = 'http://localhost/theme-crystal.css';
  boot.isConnected = true;
  boot.sheet = sheet;
  stylesheets.push(boot);
  return boot;
};

const stubFinishedFetches = (urls: string[]) => vi.stubGlobal('performance', {
  getEntriesByName: (name: string) => (urls.includes(name) ? [{ name }] : []),
});

describe('loadThemeAssets', () => {
  it('keeps Crystal and CJK CSS behind dynamic imports', () => {
    expect(source).toContain("import('../../styles/themes/crystal-ornaments.css')");
    expect(source).toContain("import('../../styles/themes/crystal-fonts.css')");
    expect(source).toContain("import('../../styles/themes/cjk-fonts-ja.css')");
    expect(source).toContain("import('../../styles/themes/cjk-fonts-ko.css')");
    expect(source).toContain("import('../../styles/themes/cjk-fonts-zh-hans.css')");
  });

  it('puts the Crystal motion sheet in the render-blocking stylesheet, so entrances never wait for a late sheet', () => {
    const main = readFileSync(resolve(import.meta.dirname, '../../main.tsx'), 'utf8');
    expect(main).toContain("import './styles/themes/crystal-motion.css';");
    expect(source).not.toContain("import('../../styles/themes/crystal-motion.css')");
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
    const existing = installBootStylesheet(stylesheets, { cssRules: [{}] });

    await expect(loadCrystalStylesheet()).resolves.toBeUndefined();
    expect(stylesheets).toEqual([existing]);
  });

  describe('with the boot link from index.html', () => {
    afterEach(() => vi.useRealTimers());

    it('waits for it to finish downloading instead of starting the download again', async () => {
      const stylesheets = installStylesheetDocument();
      stubFinishedFetches([]);
      const boot = installBootStylesheet(stylesheets);

      const load = loadCrystalStylesheet();
      await Promise.resolve();
      expect(stylesheets).toEqual([boot]);
      expect(boot.isConnected).toBe(true);
      boot.emit('load');
      await expect(load).resolves.toBeUndefined();
      expect(stylesheets).toEqual([boot]);
    });

    it('replaces it only once it fails', async () => {
      const stylesheets = installStylesheetDocument();
      stubFinishedFetches([]);
      const boot = installBootStylesheet(stylesheets);

      const load = loadCrystalStylesheet();
      await Promise.resolve();
      boot.emit('error');
      await vi.waitFor(() => expect(stylesheets).toHaveLength(2));
      expect(boot.isConnected).toBe(false);
      stylesheets[1].emit('load');
      await expect(load).resolves.toBeUndefined();
    });

    it('replaces it when it failed before the loader could listen, leaving an empty sheet', async () => {
      vi.useFakeTimers();
      const stylesheets = installStylesheetDocument();
      const boot = installBootStylesheet(stylesheets, { cssRules: [] });
      stubFinishedFetches([boot.href]);

      const load = loadCrystalStylesheet();
      await vi.advanceTimersByTimeAsync(99);
      expect(stylesheets).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(boot.isConnected).toBe(false);
      expect(stylesheets).toHaveLength(2);
      stylesheets[1].emit('load');
      await expect(load).resolves.toBeUndefined();
    });

    it('gives up on it after a bounded wait when the browser reports nothing about it', async () => {
      vi.useFakeTimers();
      const stylesheets = installStylesheetDocument();
      stubFinishedFetches([]);
      const boot = installBootStylesheet(stylesheets);

      const load = loadCrystalStylesheet();
      await vi.advanceTimersByTimeAsync(9_999);
      expect(stylesheets).toEqual([boot]);
      await vi.advanceTimersByTimeAsync(1);
      expect(boot.isConnected).toBe(false);
      stylesheets[1].emit('load');
      await expect(load).resolves.toBeUndefined();
    });
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

describe('Crystal motion sheet', () => {
  const motion = readFileSync(resolve(styles, 'crystal-motion.css'), 'utf8');

  it('keeps the landing headline, its largest paint, at full opacity from the first frame', () => {
    const name = motion.match(/\.crystal-copy > h1 \{ animation: ([\w-]+)/)?.[1];
    expect(name).toBe('nk-rise-transform-k');
    const frames = motion.match(new RegExp(`@keyframes ${name}\\{([^\\n]*)\\}`))?.[1] ?? '';
    expect(frames).toContain('transform');
    expect(frames).not.toContain('opacity');
  });

  it('never fills an animation forwards, so no entered element keeps a transform', () => {
    expect([...motion.matchAll(/animation:[^;]*\b(?:both|forwards)\b/g)].map(match => match[0])).toEqual([]);
  });
});
