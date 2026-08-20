export const BROWSER_EXTENSION_IMPORT_HASH_KEY = 'lf-import';
export const BROWSER_EXTENSION_IMPORT_STORAGE_KEY = 'lingoflash_browser_extension_import';
export const BROWSER_EXTENSION_IMPORT_MAX_TEXT_LENGTH = 80;
export const BROWSER_EXTENSION_IMPORT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const BROWSER_EXTENSION_IMPORT_FUTURE_SKEW_MS = 5 * 60 * 1000;

export interface BrowserExtensionImportIntent {
  v: 1;
  id: string;
  text: string;
  createdAt: number;
  mode?: 'silent';
}

export interface BrowserExtensionImportStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface BrowserExtensionImportBrowser {
  getCurrentUrl(): string;
  replaceLocation(location: string): void;
  getSessionStorage(): BrowserExtensionImportStorage | null;
  listenHashChange(listener: () => void): () => void;
}

const browserImportPort: BrowserExtensionImportBrowser = {
  getCurrentUrl: () => globalThis.location?.href ?? '/',
  replaceLocation: location => globalThis.history?.replaceState(globalThis.history.state, '', location),
  getSessionStorage: () => {
    try {
      return globalThis.sessionStorage ?? null;
    } catch {
      return null;
    }
  },
  listenHashChange: listener => {
    globalThis.addEventListener?.('hashchange', listener);
    return () => globalThis.removeEventListener?.('hashchange', listener);
  },
};

export const normalizeBrowserExtensionImportText = (value: unknown): string =>
  (typeof value === 'string' ? value : '')
    .replace(/\s+/g, ' ')
    .trim();

const decodeBase64UrlUtf8 = (encoded: string): string => {
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error('Invalid base64url payload.');
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const binary = globalThis.atob(padded);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

const isFreshCreatedAt = (createdAt: number, now: number): boolean =>
  Number.isSafeInteger(createdAt)
  && createdAt > 0
  && createdAt <= now + BROWSER_EXTENSION_IMPORT_FUTURE_SKEW_MS
  && now - createdAt <= BROWSER_EXTENSION_IMPORT_MAX_AGE_MS;

const parseIntentValue = (value: unknown, now: number): BrowserExtensionImportIntent | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Partial<BrowserExtensionImportIntent>;
  const text = normalizeBrowserExtensionImportText(candidate.text);
  if (candidate.v !== 1) return null;
  if (typeof candidate.id !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(candidate.id)) return null;
  if (!text || text.length > BROWSER_EXTENSION_IMPORT_MAX_TEXT_LENGTH) return null;
  if (typeof candidate.createdAt !== 'number' || !isFreshCreatedAt(candidate.createdAt, now)) return null;
  if (candidate.mode !== undefined && candidate.mode !== 'silent') return null;
  return {
    v: 1,
    id: candidate.id,
    text,
    createdAt: candidate.createdAt,
    ...(candidate.mode === 'silent' ? { mode: 'silent' as const } : {}),
  };
};

const hashParameters = (url: URL): URLSearchParams =>
  new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash);

export const parseBrowserExtensionImport = (
  location: string,
  now = Date.now(),
): BrowserExtensionImportIntent | null => {
  try {
    const url = new URL(location, 'https://lingoflash.invalid');
    const encoded = hashParameters(url).get(BROWSER_EXTENSION_IMPORT_HASH_KEY);
    if (!encoded) return null;
    return parseIntentValue(JSON.parse(decodeBase64UrlUtf8(encoded)), now);
  } catch {
    return null;
  }
};

export const createBrowserExtensionImportCleanLocation = (location: string): string => {
  const url = new URL(location, 'https://lingoflash.invalid');
  const parameters = hashParameters(url);
  parameters.delete(BROWSER_EXTENSION_IMPORT_HASH_KEY);
  const remainingHash = parameters.toString();
  return `${url.pathname}${url.search}${remainingHash ? `#${remainingHash}` : ''}`;
};

const writePendingImport = (
  storage: BrowserExtensionImportStorage | null,
  intent: BrowserExtensionImportIntent,
): void => {
  try {
    storage?.setItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY, JSON.stringify(intent));
  } catch {
    // The current tab can still process the in-memory intent when storage is unavailable.
  }
};

export const readPendingBrowserExtensionImport = (
  storage: BrowserExtensionImportStorage | null,
  now = Date.now(),
): BrowserExtensionImportIntent | null => {
  try {
    const value = storage?.getItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY);
    if (!value) return null;
    const parsed = parseIntentValue(JSON.parse(value), now);
    if (!parsed) storage?.removeItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY);
    return parsed;
  } catch {
    try {
      storage?.removeItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY);
    } catch {
      // Storage is optional.
    }
    return null;
  }
};

export const clearPendingBrowserExtensionImport = (
  storage: BrowserExtensionImportStorage | null,
  expectedId?: string,
): void => {
  try {
    if (expectedId) {
      const rawValue = storage?.getItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY);
      if (!rawValue) return;
      let currentId: unknown;
      try {
        const parsed: unknown = JSON.parse(rawValue);
        currentId = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>).id
          : undefined;
      } catch {
        currentId = undefined;
      }
      if (currentId !== expectedId) return;
    }
    storage?.removeItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY);
  } catch {
    // Storage is optional.
  }
};

export const captureBrowserExtensionImport = (
  browser: BrowserExtensionImportBrowser = browserImportPort,
  now = Date.now(),
): BrowserExtensionImportIntent | null => {
  const location = browser.getCurrentUrl();
  let hasImportParameter = false;
  try {
    hasImportParameter = hashParameters(new URL(location, 'https://lingoflash.invalid'))
      .has(BROWSER_EXTENSION_IMPORT_HASH_KEY);
  } catch {
    return null;
  }
  if (!hasImportParameter) return null;

  const intent = parseBrowserExtensionImport(location, now);
  browser.replaceLocation(createBrowserExtensionImportCleanLocation(location));
  if (intent) writePendingImport(browser.getSessionStorage(), intent);
  return intent;
};

export const getBrowserExtensionImportBrowser = (): BrowserExtensionImportBrowser => browserImportPort;
