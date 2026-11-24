import type { ThemeFamily } from './themePreference';

export type ScriptFont = 'ja' | 'ko' | 'zh-Hans';

let crystalAssets: Promise<void> | undefined;
const scriptFonts = new Map<ScriptFont, Promise<void>>();

const CRYSTAL_STYLESHEET_ID = 'sonflash-crystal-theme';
// A fetch the browser has already finished may still have its load or error event queued; give it this long to arrive.
const FINISHED_FETCH_GRACE_MS = 100;
// The token sheet is about 16 KB. A link the browser reports nothing about after this long is treated as failed.
const SILENT_STYLESHEET_WAIT_MS = 10_000;

// A failed link can still expose an empty sheet (Chromium does), so only a sheet with rules counts as loaded.
const hasRules = (stylesheet: HTMLLinkElement): boolean => {
  try {
    return (stylesheet.sheet?.cssRules.length ?? 0) > 0;
  } catch {
    return stylesheet.sheet !== null;
  }
};

const fetchFinished = (stylesheet: HTMLLinkElement): boolean =>
  typeof performance !== 'undefined' && (performance.getEntriesByName?.(stylesheet.href, 'resource').length ?? 0) > 0;

// index.html's boot script inserts the link while the page parses, well before this loader runs, so the link may
// still be downloading: wait for it rather than restart the download. It may also have settled already, and then
// neither event comes again; it is rechecked shortly after when the browser has finished fetching it, and after a
// bounded wait when the browser records nothing (WebKit keeps no timing entry for a failed fetch).
const settleBootStylesheet = (stylesheet: HTMLLinkElement): Promise<boolean> => new Promise(resolve => {
  let recheck: ReturnType<typeof setTimeout> | undefined;
  const settle = (loaded: boolean) => {
    clearTimeout(recheck);
    resolve(loaded);
  };
  stylesheet.addEventListener('load', () => settle(true), { once: true });
  stylesheet.addEventListener('error', () => settle(false), { once: true });
  recheck = setTimeout(() => settle(hasRules(stylesheet)), fetchFinished(stylesheet) ? FINISHED_FETCH_GRACE_MS : SILENT_STYLESHEET_WAIT_MS);
});

const appendCrystalStylesheet = (): Promise<void> => new Promise((resolve, reject) => {
  const stylesheet = document.createElement('link');
  stylesheet.id = CRYSTAL_STYLESHEET_ID;
  stylesheet.rel = 'stylesheet';
  stylesheet.href = '/theme-crystal.css';
  stylesheet.addEventListener('load', () => resolve(), { once: true });
  stylesheet.addEventListener('error', () => {
    stylesheet.remove();
    reject(new Error('Crystal theme stylesheet could not load.'));
  }, { once: true });
  document.head.append(stylesheet);
});

export const loadCrystalStylesheet = async (): Promise<void> => {
  if (typeof document === 'undefined') return;
  const existing = document.getElementById(CRYSTAL_STYLESHEET_ID) as HTMLLinkElement | null;
  if (existing) {
    if (hasRules(existing) || await settleBootStylesheet(existing)) return;
    // Only a link that has failed is replaced, by a fresh one that fetches the sheet again.
    existing.remove();
  }
  return appendCrystalStylesheet();
};

// crystal-motion.css is not here: main.tsx imports it into the render-blocking stylesheet, so the Crystal entrances
// are in place for the first paint instead of starting over when a late sheet arrives.
export const loadThemeAssets = (family: ThemeFamily): Promise<void> => {
  if (family !== 'crystal') return Promise.resolve();
  crystalAssets ??= Promise.all([
    loadCrystalStylesheet(),
    import('../../styles/themes/crystal-ornaments.css'),
    import('../../styles/themes/crystal-fonts.css'),
  ]).then(
    () => undefined,
    error => {
      crystalAssets = undefined;
      throw error;
    },
  );
  return crystalAssets;
};

const scriptFontLoaders: Record<ScriptFont, () => Promise<unknown>> = {
  ja: () => import('../../styles/themes/cjk-fonts-ja.css'),
  ko: () => import('../../styles/themes/cjk-fonts-ko.css'),
  'zh-Hans': () => import('../../styles/themes/cjk-fonts-zh-hans.css'),
};

export const loadScriptFont = (script: ScriptFont): Promise<void> => {
  const existing = scriptFonts.get(script);
  if (existing) return existing;
  const load = scriptFontLoaders[script]().then(() => undefined);
  scriptFonts.set(script, load);
  return load;
};
