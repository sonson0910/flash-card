import { describe, expect, it } from 'vitest';
import {
  BROWSER_EXTENSION_IMPORT_STORAGE_KEY,
  type BrowserExtensionImportBrowser,
  type BrowserExtensionImportStorage,
} from './browserExtensionImport';
import { startBrowserExtensionImportRuntime } from './browserExtensionImportRuntime';

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

const createBrowser = (url: string, storage = new MemoryStorage()) => {
  const messages: unknown[] = [];
  const listeners = new Set<(event: { source: unknown; origin: string; data: unknown }) => void>();
  const browser: BrowserExtensionImportBrowser = {
    getCurrentUrl: () => url,
    replaceLocation: () => undefined,
    getSessionStorage: () => storage,
    listenHashChange: () => () => undefined,
    listenMessage: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    postMessage: message => messages.push(message),
  };
  return {
    browser,
    messages,
    storage,
    dispatchMessage: (data: unknown) => {
      for (const listener of listeners) {
        listener({
          source: globalThis,
          origin: 'https://app.example.test',
          data,
        });
      }
    },
  };
};

const optionsFor = (generate: () => Promise<{ status: 'failed'; error: Error }>) => ({
  ownerId: 'user-1',
  identityLoading: false,
  isBusy: false,
  changeDraft: () => undefined,
  generate,
  openLibrary: () => undefined,
  notify: () => undefined,
  reportError: () => undefined,
});

const encodePayload = (value: unknown): string => {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = '';
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

describe('browser extension import runtime', () => {
  it('does not process a raw URL hash without a verified pending intent', async () => {
    const rawUrl = `https://app.example.test/?view=library#lf-import=${encodePayload({
      v: 1,
      id: 'intent_forged_123',
      text: 'forged',
      createdAt: Date.now(),
      mode: 'silent',
    })}`;
    const { browser } = createBrowser(rawUrl);
    let generated = 0;

    const runtime = startBrowserExtensionImportRuntime(optionsFor(async () => {
      generated += 1;
      return { status: 'failed', error: new Error('should not run') };
    }), browser);
    await new Promise(resolve => setImmediate(resolve));
    runtime.dispose();

    expect(generated).toBe(0);
  });

  it('processes only a verified silent intent from session storage', async () => {
    const now = Date.now();
    const { browser, storage, messages } = createBrowser('https://app.example.test/?view=library');
    storage.setItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY, JSON.stringify({
      v: 1,
      id: 'intent_verified_123',
      text: 'resilient',
      createdAt: now,
      mode: 'silent',
    }));
    let generated = 0;

    const runtime = startBrowserExtensionImportRuntime(optionsFor(async () => {
      generated += 1;
      return { status: 'failed', error: new Error('expected test failure') };
    }), browser);
    await new Promise(resolve => setImmediate(resolve));
    runtime.dispose();

    expect(generated).toBe(1);
    expect(messages).toContainEqual(expect.objectContaining({
      type: 'LINGOFLASH_EXTENSION_IMPORT_CLAIMED',
    }));
  });

  it('ignores a same-origin ready message that is not backed by verified storage', async () => {
    const { browser, dispatchMessage } = createBrowser('https://app.example.test/?view=library');
    let generated = 0;
    const runtime = startBrowserExtensionImportRuntime(optionsFor(async () => {
      generated += 1;
      return { status: 'failed', error: new Error('should not run') };
    }), browser);

    dispatchMessage({
      source: 'lingoflash-extension-bridge',
      type: 'LINGOFLASH_EXTENSION_IMPORT_READY',
      payload: {
        v: 1,
        id: 'intent_forged_123',
        text: 'forged',
        createdAt: Date.now(),
        mode: 'silent',
      },
    });
    await new Promise(resolve => setImmediate(resolve));
    runtime.dispose();

    expect(generated).toBe(0);
  });
});
