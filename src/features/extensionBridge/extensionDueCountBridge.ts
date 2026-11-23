// Wire contract for the due-count badge in extensions/lingoflash/popup.js.
// The background script (extensions/lingoflash/background-core.js, functions
// syncDueCount/clearDueCount) accepts exactly this envelope: a postMessage
// from the app's own origin carrying { source, type, payload }, where payload
// is either { scope, count } (sync) or { scope } (clear). The extension's
// shared.js normalizeDueCountMetadata enforces the same scope pattern and the
// same MAX_DUE_COUNT bound duplicated below, so a malformed or absurd count is
// clamped identically on both sides of the bridge.
export const EXTENSION_DUE_COUNT_MESSAGE = 'LINGOFLASH_EXTENSION_DUE_COUNT';
export const EXTENSION_DUE_COUNT_CLEAR_MESSAGE = 'LINGOFLASH_EXTENSION_DUE_COUNT_CLEAR';

const APP_SOURCE = 'lingoflash-web-app';
const MAX_DUE_COUNT = 9_999;

export interface ExtensionDueCountScope {
  readonly ownerId: string;
  readonly scope: string;
}

// A non-negative safe integer, clamped to the same ceiling the extension
// enforces. Returns null for anything else so the caller never posts a
// fabricated or out-of-range number.
export const normalizeExtensionDueCount = (value: number): number | null => (
  Number.isSafeInteger(value) && value >= 0 ? Math.min(value, MAX_DUE_COUNT) : null
);

// The badge number is only real when the loaded stats belong to the signed-in
// owner, to the active course and to the current local day. Anything else (the
// empty placeholder, the previous course's stats, a count from yesterday) must
// not reach the extension, so the caller treats null as "nothing to publish".
export const extensionDueCountFor = (
  cloud: { ownerId?: string | null; statsTargetLanguage?: string | null; stats: { due: number; dueAsOfDate?: string } },
  ownerId: string | null,
  targetLanguage: string | null,
  localDay: string,
): number | null => (
  ownerId && cloud.ownerId === ownerId && targetLanguage && cloud.statsTargetLanguage === targetLanguage
    && cloud.stats.dueAsOfDate === localDay
    ? cloud.stats.due
    : null
);

export const localDayKey = (now = new Date()): string => (
  [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-')
);

// Opaque, non-identifying scope token. It ties a due-count sync/clear pair
// together for the extension's own scope-retirement bookkeeping without ever
// exposing the real owner id to the extension runtime.
export const createOpaqueExtensionDueCountScope = (): string => {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  } catch { /* Fall through to the non-identity fallback. */ }
  return `scope_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 18)}`;
};

export const postExtensionDueCountMessage = (type: string, payload: unknown): void => {
  try {
    globalThis.postMessage?.({ source: APP_SOURCE, type, payload }, globalThis.location?.origin || '*');
  } catch { /* The optional bridge may race navigation. */ }
};
