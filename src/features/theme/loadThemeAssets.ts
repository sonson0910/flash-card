import type { ThemeFamily } from './themePreference';

export type ScriptFont = 'ja' | 'ko' | 'zh-Hans';

let crystalAssets: Promise<void> | undefined;
const scriptFonts = new Map<ScriptFont, Promise<void>>();

export const loadCrystalStylesheet = (): Promise<void> => {
  if (typeof document === 'undefined') return Promise.resolve();
  let stylesheet = document.getElementById('sonflash-crystal-theme') as HTMLLinkElement | null;
  if (stylesheet?.sheet) return Promise.resolve();
  if (stylesheet?.isConnected) {
    stylesheet.remove();
    stylesheet = null;
  }
  const promise = new Promise<void>((resolve, reject) => {
    if (!stylesheet) {
      stylesheet = document.createElement('link');
      stylesheet.id = 'sonflash-crystal-theme';
      stylesheet.rel = 'stylesheet';
      stylesheet.href = '/theme-crystal.css';
    }
    stylesheet.addEventListener('load', () => resolve(), { once: true });
    stylesheet.addEventListener('error', () => {
      stylesheet?.remove();
      reject(new Error('Crystal theme stylesheet could not load.'));
    }, { once: true });
    if (!stylesheet.isConnected) document.head.append(stylesheet);
  });
  return promise;
};

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
