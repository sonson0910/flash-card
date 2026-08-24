export const BROWSER_EXTENSION_IMPORT_HASH_KEY = 'lf-import';
export const BROWSER_EXTENSION_IMPORT_STORAGE_KEY = 'lingoflash_browser_extension_import';
export const BROWSER_EXTENSION_IMPORT_UNVERIFIED_STORAGE_KEY = 'lingoflash_browser_extension_draft_import';
export const BROWSER_EXTENSION_IMPORT_PROTOCOL_VERSION = 3;
export const BROWSER_EXTENSION_IMPORT_LEGACY_DRAFT_PROTOCOL_VERSION = 2;
export const BROWSER_EXTENSION_IMPORT_BRIDGE_SOURCE = 'lingoflash-extension-bridge';
export const BROWSER_EXTENSION_IMPORT_APP_SOURCE = 'lingoflash-web-app';
export const BROWSER_EXTENSION_IMPORT_READY_MESSAGE = 'LINGOFLASH_EXTENSION_IMPORT_READY';
export const BROWSER_EXTENSION_IMPORT_UNVERIFIED_MESSAGE = 'LINGOFLASH_EXTENSION_IMPORT_UNVERIFIED';
export const BROWSER_EXTENSION_IMPORT_CLAIMED_MESSAGE = 'LINGOFLASH_EXTENSION_IMPORT_CLAIMED';
export const BROWSER_EXTENSION_IMPORT_MAX_TEXT_LENGTH = 80;
export const BROWSER_EXTENSION_IMPORT_MAX_ENCODED_LENGTH = 2048;
export const BROWSER_EXTENSION_IMPORT_NONCE_PATTERN = /^[A-Za-z0-9_-]{22,64}$/;
export const BROWSER_EXTENSION_IMPORT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const BROWSER_EXTENSION_IMPORT_FUTURE_SKEW_MS = 5 * 60 * 1000;

export interface BrowserExtensionImportIntent {
  v: 2 | 3;
  id: string;
  nonce?: string;
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
  listenMessage(listener: (event: BrowserExtensionImportMessageEvent) => void): () => void;
  postMessage(message: unknown): void;
  isTopFrame(): boolean;
}

export interface BrowserExtensionImportMessageEvent {
  source: unknown;
  origin: string;
  data: unknown;
}

export const isBrowserExtensionImportTopFrame = (): boolean => {
  try {
    return globalThis.top != null && globalThis.top === globalThis.self;
  } catch {
    return false;
  }
};

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
  listenMessage: listener => {
    if (!isBrowserExtensionImportTopFrame()) return () => undefined;
    const handler = (event: MessageEvent) => {
      if (event.source !== (globalThis as unknown as MessageEventSource)
        || event.origin !== globalThis.location?.origin) return;
      listener(event);
    };
    globalThis.addEventListener?.('message', handler);
    return () => globalThis.removeEventListener?.('message', handler);
  },
  postMessage: message => {
    try { globalThis.postMessage?.(message, globalThis.location?.origin || '*'); } catch { /* Navigation may race the result. */ }
  },
  isTopFrame: () => {
    return isBrowserExtensionImportTopFrame();
  },
};

export const normalizeBrowserExtensionImportText = (value: unknown): string =>
  (typeof value === 'string' ? value : '')
    .replace(/\s+/g, ' ')
    .trim();

const decodeBase64UrlUtf8 = (encoded: string): string => {
  if (encoded.length > BROWSER_EXTENSION_IMPORT_MAX_ENCODED_LENGTH) {
    throw new Error('Encoded import payload is too large.');
  }
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
  const isCurrentVersion = candidate.v === BROWSER_EXTENSION_IMPORT_PROTOCOL_VERSION;
  const isLegacyDraft = candidate.v === BROWSER_EXTENSION_IMPORT_LEGACY_DRAFT_PROTOCOL_VERSION
    && candidate.mode === undefined;
  if (!isCurrentVersion && !isLegacyDraft) return null;
  if (typeof candidate.id !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(candidate.id)) return null;
  if (!text || text.length > BROWSER_EXTENSION_IMPORT_MAX_TEXT_LENGTH) return null;
  if (typeof candidate.createdAt !== 'number' || !isFreshCreatedAt(candidate.createdAt, now)) return null;
  if (candidate.mode !== undefined && candidate.mode !== 'silent') return null;
  if (candidate.mode === 'silent'
    && (typeof candidate.nonce !== 'string' || !BROWSER_EXTENSION_IMPORT_NONCE_PATTERN.test(candidate.nonce))) return null;
  return {
    v: candidate.v === BROWSER_EXTENSION_IMPORT_PROTOCOL_VERSION
      ? BROWSER_EXTENSION_IMPORT_PROTOCOL_VERSION
      : BROWSER_EXTENSION_IMPORT_LEGACY_DRAFT_PROTOCOL_VERSION,
    id: candidate.id,
    ...(candidate.mode === 'silent' ? { nonce: candidate.nonce } : {}),
    text,
    createdAt: candidate.createdAt,
    ...(candidate.mode === 'silent' ? { mode: 'silent' as const } : {}),
  };
};

export const parseBrowserExtensionImportValue = (
  value: unknown,
  now = Date.now(),
): BrowserExtensionImportIntent | null => parseIntentValue(value, now);

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

const writePendingDraftImport = (
  storage: BrowserExtensionImportStorage | null,
  intent: BrowserExtensionImportIntent,
): void => {
  try {
    // URL capture is unverified client input. Keep it draft-only; the verified
    // key is written exclusively by the extension bridge after worker checks.
    storage?.setItem(BROWSER_EXTENSION_IMPORT_UNVERIFIED_STORAGE_KEY, JSON.stringify(intent));
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
  expectedNonce?: string,
): void => {
  try {
    if (expectedId) {
      const rawValue = storage?.getItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY);
      if (!rawValue) return;
      let currentId: unknown;
      let currentNonce: unknown;
      try {
        const parsed: unknown = JSON.parse(rawValue);
        currentId = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>).id
          : undefined;
        currentNonce = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>).nonce
          : undefined;
      } catch {
        currentId = undefined;
      }
      if (currentId !== expectedId || (expectedNonce !== undefined && currentNonce !== expectedNonce)) return;
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
  try {
    if (!browser.isTopFrame()) return null;
  } catch {
    return null;
  }
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
  if (intent) writePendingDraftImport(browser.getSessionStorage(), intent);
  return intent;
};

export const getBrowserExtensionImportBrowser = (): BrowserExtensionImportBrowser => browserImportPort;
