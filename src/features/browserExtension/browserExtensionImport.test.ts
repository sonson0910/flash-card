import { describe, expect, it } from 'vitest';
import {
  BROWSER_EXTENSION_IMPORT_HASH_KEY,
  BROWSER_EXTENSION_IMPORT_PROTOCOL_V3,
  BROWSER_EXTENSION_IMPORT_STORAGE_KEY,
  BROWSER_EXTENSION_IMPORT_UNVERIFIED_STORAGE_KEY,
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
  it('normalizes selected text without silently truncating it', () => {
    expect(normalizeBrowserExtensionImportText('  machine\n   learning  ')).toBe('machine learning');
    expect(normalizeBrowserExtensionImportText(null)).toBe('');
  });

  it('decodes a fresh Unicode payload', () => {
    const now = Date.UTC(2026, 7, 19, 8, 0, 0);
    expect(parseBrowserExtensionImport(importUrl({
      v: 2,
      id: 'intent_12345678',
      text: 'café culture',
      createdAt: now,
    }), now)).toEqual({
      v: 2,
      id: 'intent_12345678',
      text: 'café culture',
      createdAt: now,
    });
  });

  it('preserves the validated silent-delivery mode', () => {
    const now = Date.UTC(2026, 7, 19, 8, 0, 0);
    expect(parseBrowserExtensionImport(importUrl({
      v: 2,
      id: 'intent_silent_123',
      text: 'resilient',
      createdAt: now,
      mode: 'silent',
    }), now)).toEqual({
      v: 2,
      id: 'intent_silent_123',
      text: 'resilient',
      createdAt: now,
      mode: 'silent',
    });
  });

  it('parses a v3 opaque ticket without treating it as a verified intent', () => {
    const parsed = parseBrowserExtensionImport(importUrl({
      v: BROWSER_EXTENSION_IMPORT_PROTOCOL_V3,
      ticket: 'ticket_123456789',
      mode: 'silent',
    }));
    expect(parsed).toEqual({ v: 3, ticket: 'ticket_123456789', mode: 'silent' });
  });

  it('keeps verified v3 sentence context bounded and normalized', () => {
    const parsed = parseBrowserExtensionImportValue({
      v: 3,
      id: 'intent_context_123',
      ticket: 'ticket_context_123',
      text: 'resilient',
      context: `  The resilient\n${'team '.repeat(200)}finished.  `,
      createdAt: Date.now(),
      mode: 'silent',
    });

    expect(parsed).toMatchObject({
      v: 3,
      id: 'intent_context_123',
      text: 'resilient',
      context: expect.stringContaining('The resilient team'),
    });
    expect((parsed as { context?: string } | null)?.context?.length).toBeLessThanOrEqual(500);
  });

  it('accepts requestedDeck only on a resolved v3 intent and ignores it on a raw ticket', () => {
    const verified = parseBrowserExtensionImportValue({
      v: 3,
      id: 'intent_deck_123456',
      ticket: 'ticket_deck_123456',
      text: 'resilient',
      requestedDeck: ' Reading ',
      createdAt: Date.now(),
      mode: 'silent',
    });
    expect(verified).toMatchObject({ requestedDeck: 'Reading' });
    expect(parseBrowserExtensionImport(importUrl({
      v: 3,
      ticket: 'ticket_deck_123456',
      requestedDeck: 'Forged',
      mode: 'silent',
    }))).toEqual({ v: 3, ticket: 'ticket_deck_123456', mode: 'silent' });
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
      v: 2,
      id: 'intent_12345678',
      text: 'word',
      createdAt: now - (25 * 60 * 60 * 1000),
    }), now)).toBeNull();
    expect(parseBrowserExtensionImport(importUrl({
      v: 2,
      id: 'intent_12345678',
      text: 'x'.repeat(81),
      createdAt: now,
    }), now)).toBeNull();
    expect(parseBrowserExtensionImport(importUrl({
      v: 2,
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
      v: 2,
      id: 'intent_12345678',
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
