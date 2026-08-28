import { describe, expect, it } from 'vitest';
import {
  BROWSER_EXTENSION_IMPORT_HASH_KEY,
  BROWSER_EXTENSION_IMPORT_STORAGE_KEY,
  BROWSER_EXTENSION_IMPORT_UNVERIFIED_STORAGE_KEY,
  BROWSER_EXTENSION_IMPORT_PROTOCOL_VERSION,
  BROWSER_EXTENSION_IMPORT_MAX_ENCODED_LENGTH,
  captureBrowserExtensionImport,
  clearPendingBrowserExtensionImport,
  createBrowserExtensionImportCleanLocation,
  normalizeBrowserExtensionImportText,
  parseBrowserExtensionImport,
  parseBrowserExtensionImportValue,
  readPendingBrowserExtensionImport,
  type BrowserExtensionImportBrowser,
  type BrowserExtensionImportStorage,
} from './browserExtensionImport';

const encodePayload = (value: unknown): string => {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

class MemoryStorage implements BrowserExtensionImportStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const importUrl = (payload: unknown): string =>
  `https://app.example.test/?view=library#${BROWSER_EXTENSION_IMPORT_HASH_KEY}=${encodePayload(payload)}`;

describe('browser extension import protocol', () => {
  const nonce = 'nonce_123456789012345678';
  it('normalizes selected text without silently truncating it', () => {
    expect(normalizeBrowserExtensionImportText('  machine\n   learning  ')).toBe('machine learning');
    expect(normalizeBrowserExtensionImportText(null)).toBe('');
  });

  it('decodes a fresh Unicode payload', () => {
    const now = Date.UTC(2026, 7, 19, 8, 0, 0);
    expect(parseBrowserExtensionImport(importUrl({
      v: BROWSER_EXTENSION_IMPORT_PROTOCOL_VERSION,
      id: 'intent_12345678',
      text: 'café culture',
      createdAt: now,
    }), now)).toEqual({
      v: BROWSER_EXTENSION_IMPORT_PROTOCOL_VERSION,
      id: 'intent_12345678',
      text: 'café culture',
      createdAt: now,
    });
  });

  it('preserves the validated silent-delivery mode', () => {
    const now = Date.UTC(2026, 7, 19, 8, 0, 0);
    expect(parseBrowserExtensionImport(importUrl({
      v: BROWSER_EXTENSION_IMPORT_PROTOCOL_VERSION,
      id: 'intent_silent_123',
      nonce,
      text: 'resilient',
      createdAt: now,
      mode: 'silent',
    }), now)).toEqual({
      v: BROWSER_EXTENSION_IMPORT_PROTOCOL_VERSION,
      id: 'intent_silent_123',
      nonce,
      text: 'resilient',
      createdAt: now,
      mode: 'silent',
    });
  });

  it('preserves bounded page context and requested deck for a verified v3 import', () => {
    const now = Date.UTC(2026, 7, 19, 8, 0, 0);
    expect(parseBrowserExtensionImportValue({
      v: BROWSER_EXTENSION_IMPORT_PROTOCOL_VERSION,
      id: 'intent_context_123',
      nonce,
      text: 'lead',
      context: ` The lead\n${'actor '.repeat(100)}arrived. `,
      requestedDeck: ' Reading ',
      createdAt: now,
      mode: 'silent',
    }, now)).toEqual({
      v: BROWSER_EXTENSION_IMPORT_PROTOCOL_VERSION,
      id: 'intent_context_123',
      nonce,
      text: 'lead',
      context: expect.stringContaining('The lead actor'),
      requestedDeck: 'Reading',
      createdAt: now,
      mode: 'silent',
    });
  });

  it('rejects malformed context and deck fields at the bridge boundary', () => {
    const now = Date.UTC(2026, 7, 19, 8, 0, 0);
    const valid = {
      v: BROWSER_EXTENSION_IMPORT_PROTOCOL_VERSION,
      id: 'intent_context_123',
      nonce,
      text: 'lead',
      createdAt: now,
      mode: 'silent' as const,
    };
    expect(parseBrowserExtensionImportValue({ ...valid, context: 42 }, now)).toBeNull();
    expect(parseBrowserExtensionImportValue({ ...valid, requestedDeck: ['Reading'] }, now)).toBeNull();
  });

  it('rejects silent intents with a missing or malformed nonce', () => {
    const now = Date.UTC(2026, 7, 19, 8, 0, 0);
    const valid = { v: BROWSER_EXTENSION_IMPORT_PROTOCOL_VERSION, id: 'intent_silent_123', text: 'resilient', createdAt: now, mode: 'silent' as const };
    expect(parseBrowserExtensionImport(importUrl(valid), now)).toBeNull();
    expect(parseBrowserExtensionImport(importUrl({ ...valid, nonce: 'short' }), now)).toBeNull();
  });

  it('keeps legacy v2 non-silent drafts but rejects legacy silent imports', () => {
    const now = Date.UTC(2026, 7, 19, 8, 0, 0);
    expect(parseBrowserExtensionImport(importUrl({
      v: 2,
      id: 'legacy_draft_123',
      text: 'legacy',
      createdAt: now,
    }), now)).toEqual({
      v: 2,
      id: 'legacy_draft_123',
      text: 'legacy',
      createdAt: now,
    });
    expect(parseBrowserExtensionImport(importUrl({
      v: 2,
      id: 'legacy_silent_123',
      nonce,
      text: 'legacy',
      createdAt: now,
      mode: 'silent',
    }), now)).toBeNull();
  });

  it('rejects malformed, stale, oversized and unsupported-mode payloads', () => {
    const now = Date.UTC(2026, 7, 19, 8, 0, 0);
    expect(parseBrowserExtensionImport('https://app.example.test/#lf-import=***', now)).toBeNull();
    expect(parseBrowserExtensionImport(importUrl({
      v: 1,
      id: 'legacy_v1_123',
      text: 'legacy',
      createdAt: now,
      mode: 'silent',
    }), now)).toBeNull();
    expect(parseBrowserExtensionImport(importUrl({
      v: BROWSER_EXTENSION_IMPORT_PROTOCOL_VERSION,
      id: 'intent_12345678',
      text: 'word',
      createdAt: now - (25 * 60 * 60 * 1000),
    }), now)).toBeNull();
    expect(parseBrowserExtensionImport(importUrl({
      v: BROWSER_EXTENSION_IMPORT_PROTOCOL_VERSION,
      id: 'intent_12345678',
      text: 'x'.repeat(81),
      createdAt: now,
    }), now)).toBeNull();
    expect(parseBrowserExtensionImport(importUrl({
      v: BROWSER_EXTENSION_IMPORT_PROTOCOL_VERSION,
      id: 'intent_12345678',
      text: 'word',
      createdAt: now,
      mode: 'background',
    }), now)).toBeNull();
  });

  it('captures the intent, stores it per tab and removes only its hash parameter', () => {
    const now = Date.UTC(2026, 7, 19, 8, 0, 0);
    const storage = new MemoryStorage();
    let currentUrl = `${importUrl({
      v: BROWSER_EXTENSION_IMPORT_PROTOCOL_VERSION,
      id: 'intent_12345678',
      nonce,
      text: 'resilient',
      createdAt: now,
      mode: 'silent',
    })}&keep=1`;
    const browser: BrowserExtensionImportBrowser = {
      getCurrentUrl: () => currentUrl,
      replaceLocation: location => { currentUrl = location; },
      getSessionStorage: () => storage,
      listenHashChange: () => () => undefined,
      listenMessage: () => () => undefined,
      postMessage: () => undefined,
      isTopFrame: () => true,
    };

    expect(captureBrowserExtensionImport(browser, now)).toMatchObject({
      text: 'resilient',
      mode: 'silent',
    });
    expect(currentUrl).toBe('/?view=library#keep=1');
    expect(storage.getItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY)).toBeNull();
    expect(parseBrowserExtensionImportValue(JSON.parse(
      storage.getItem(BROWSER_EXTENSION_IMPORT_UNVERIFIED_STORAGE_KEY) ?? '{}',
    ), now)).toMatchObject({
      id: 'intent_12345678',
      mode: 'silent',
    });
  });

  it('rejects oversized encoded imports before invoking atob', () => {
    const originalAtob = globalThis.atob;
    let calls = 0;
    globalThis.atob = value => { calls += 1; return originalAtob(value); };
    try {
      expect(parseBrowserExtensionImport(
        `https://app.example.test/?view=library#lf-import=${'a'.repeat(BROWSER_EXTENSION_IMPORT_MAX_ENCODED_LENGTH + 1)}`,
      )).toBeNull();
      expect(calls).toBe(0);
    } finally {
      globalThis.atob = originalAtob;
    }
  });

  it('does not capture imports from a subframe', () => {
    const storage = new MemoryStorage();
    const browser: BrowserExtensionImportBrowser = {
      getCurrentUrl: () => importUrl({
        v: BROWSER_EXTENSION_IMPORT_PROTOCOL_VERSION,
        id: 'intent_subframe_123',
        nonce,
        text: 'resilient',
        createdAt: Date.now(),
        mode: 'silent',
      }),
      replaceLocation: () => { throw new Error('must not clean subframe URL'); },
      getSessionStorage: () => storage,
      listenHashChange: () => () => undefined,
      listenMessage: () => () => undefined,
      postMessage: () => undefined,
      isTopFrame: () => false,
    };
    expect(captureBrowserExtensionImport(browser)).toBeNull();
    expect(storage.getItem(BROWSER_EXTENSION_IMPORT_UNVERIFIED_STORAGE_KEY)).toBeNull();
  });

  it('does not clear a newer pending intent when an older operation finishes', () => {
    const now = Date.UTC(2026, 7, 19, 8, 0, 0);
    const storage = new MemoryStorage();
    storage.setItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY, JSON.stringify({
      v: 2,
      id: 'intent_newer_123',
      text: 'newer',
      createdAt: now,
    }));
    clearPendingBrowserExtensionImport(storage, 'intent_older_123');
    expect(readPendingBrowserExtensionImport(storage, now)?.text).toBe('newer');
  });

  it('does not clear a same-id pending intent with a different nonce', () => {
    const now = Date.now();
    const storage = new MemoryStorage();
    storage.setItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY, JSON.stringify({
      v: BROWSER_EXTENSION_IMPORT_PROTOCOL_VERSION,
      id: 'intent_same_id_123',
      nonce: 'nonce_B_123456789012345678',
      text: 'newer',
      createdAt: now,
      mode: 'silent',
    }));

    clearPendingBrowserExtensionImport(
      storage,
      'intent_same_id_123',
      'nonce_A_123456789012345678',
    );

    expect(readPendingBrowserExtensionImport(storage, now)?.nonce)
      .toBe('nonce_B_123456789012345678');
  });

  it('does not clear the matching intent merely because its timestamp is stale', () => {
    const now = Date.UTC(2026, 7, 20, 8, 0, 0);
    const storage = new MemoryStorage();
    storage.setItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY, JSON.stringify({
      v: 2,
      id: 'intent_stale_newer_123',
      text: 'still pending',
      createdAt: now - (25 * 60 * 60 * 1000),
    }));

    clearPendingBrowserExtensionImport(storage, 'intent_completed_older_123');

    expect(storage.getItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY)).not.toBeNull();
  });

  it('cleans malformed imports so they cannot loop on every render', () => {
    expect(createBrowserExtensionImportCleanLocation(
      'https://app.example.test/?view=library#lf-import=broken&lesson=one',
    )).toBe('/?view=library#lesson=one');
  });
});
