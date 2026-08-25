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

const createBrowser = (url: string, storage = new MemoryStorage(), topFrame = true) => {
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
    isTopFrame: () => topFrame,
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

const nonce = 'nonce_123456789012345678';

const optionsFor = (
  generate: () => Promise<{ status: 'failed'; error: Error }>,
  overrides: { changeDraft?: (value: string) => void; openLibrary?: () => void } = {},
) => ({
  ownerId: 'user-1',
  identityLoading: false,
  isBusy: false,
  changeDraft: overrides.changeDraft ?? (() => undefined),
  generate,
  openLibrary: overrides.openLibrary ?? (() => undefined),
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
  it('does not process verified storage from a subframe', async () => {
    const now = Date.now();
    const storage = new MemoryStorage();
    storage.setItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY, JSON.stringify({
      v: 3,
      id: 'intent_subframe_123',
      nonce,
      text: 'resilient',
      createdAt: now,
      mode: 'silent',
    }));
    const { browser } = createBrowser('https://app.example.test/?view=library', storage, false);
    let generated = 0;
    const runtime = startBrowserExtensionImportRuntime(optionsFor(async () => {
      generated += 1;
      return { status: 'failed', error: new Error('should not run') };
    }), browser);
    await new Promise(resolve => setImmediate(resolve));
    runtime.dispose();
    expect(generated).toBe(0);
  });

  it('does not let a same-id stale nonce block the current pending intent', async () => {
    const now = Date.now();
    const storage = new MemoryStorage();
    const firstNonce = 'nonce_A_123456789012345678';
    const secondNonce = 'nonce_B_123456789012345678';
    storage.setItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY, JSON.stringify({
      v: 3,
      id: 'intent_same_id_123',
      nonce: firstNonce,
      text: 'first',
      createdAt: now,
      mode: 'silent',
    }));
    const { browser, storage: browserStorage } = createBrowser('https://app.example.test/?view=library', storage);
    let generated = 0;
    let draft = '';
    const initialOptions = optionsFor(async () => {
      generated += 1;
      return { status: 'failed', error: new Error('expected test failure') };
    }, { changeDraft: value => { draft = value; } });
    initialOptions.identityLoading = true;
    const runtime = startBrowserExtensionImportRuntime(initialOptions, browser);

    browserStorage.setItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY, JSON.stringify({
      v: 3,
      id: 'intent_same_id_123',
      nonce: secondNonce,
      text: 'second',
      createdAt: now,
      mode: 'silent',
    }));
    runtime.acceptVerifiedIntent({
      v: 3,
      id: 'intent_same_id_123',
      nonce: secondNonce,
      text: 'second',
      createdAt: now,
      mode: 'silent',
    });
    runtime.update({ ...initialOptions, identityLoading: false });
    await new Promise(resolve => setImmediate(resolve));
    runtime.dispose();

    expect(generated).toBe(1);
    expect(draft).toBe('second');
  });

  it('does not process a raw URL hash without a verified pending intent', async () => {
    const rawUrl = `https://app.example.test/?view=library#lf-import=${encodePayload({
      v: 3,
      id: 'intent_forged_123',
      nonce,
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
      v: 3,
      id: 'intent_verified_123',
      nonce,
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
      payload: { id: 'intent_verified_123', nonce },
    }));
  });

  it('ignores a ready message whose nonce is not backed by verified storage', async () => {
    const now = Date.now();
    const { browser, storage, dispatchMessage } = createBrowser('https://app.example.test/?view=library');
    storage.setItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY, JSON.stringify({
      v: 3,
      id: 'intent_nonce_123',
      nonce,
      text: 'resilient',
      createdAt: now,
      mode: 'silent',
    }));
    let generated = 0;
    const runtime = startBrowserExtensionImportRuntime(optionsFor(async () => {
      generated += 1;
      return { status: 'failed', error: new Error('should not run') };
    }), browser);
    dispatchMessage({
      source: 'lingoflash-extension-bridge',
      type: 'LINGOFLASH_EXTENSION_IMPORT_READY',
      payload: { v: 3, id: 'intent_nonce_123', nonce: 'nonce_wrong_123456789012345678', text: 'resilient', createdAt: now, mode: 'silent' },
    });
    await new Promise(resolve => setImmediate(resolve));
    runtime.dispose();
    expect(generated).toBe(1);
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
        v: 3,
        id: 'intent_forged_123',
        nonce,
        text: 'forged',
        createdAt: Date.now(),
        mode: 'silent',
      },
    });
    await new Promise(resolve => setImmediate(resolve));
    runtime.dispose();

    expect(generated).toBe(0);
  });

  it('only fills the draft for an unverified intent and never generates', async () => {
    const { browser } = createBrowser('https://app.example.test/?view=library');
    let generated = 0;
    let draft = '';
    let opened = 0;
    const runtime = startBrowserExtensionImportRuntime(optionsFor(async () => {
      generated += 1;
      return { status: 'failed', error: new Error('should not run') };
    }, {
      changeDraft: value => { draft = value; },
      openLibrary: () => { opened += 1; },
    }), browser);

    runtime.acceptUnverifiedIntent({
      v: 3,
      id: 'intent_manual_123',
      nonce,
      text: 'forged',
      createdAt: Date.now(),
      mode: 'silent',
    });
    await new Promise(resolve => setImmediate(resolve));
    runtime.dispose();

    expect(draft).toBe('forged');
    expect(opened).toBe(1);
    expect(generated).toBe(0);
  });

  it('does not generate the same verified operation again after an app reload', async () => {
    const now = Date.now();
    const { browser, storage } = createBrowser('https://app.example.test/?view=library');
    storage.setItem(BROWSER_EXTENSION_IMPORT_STORAGE_KEY, JSON.stringify({
      v: 3,
      id: 'intent_reload_123',
      nonce,
      text: 'resilient',
      createdAt: now,
      mode: 'silent',
    }));
    let generated = 0;
    const generate = async () => {
      generated += 1;
      return { status: 'failed' as const, error: new Error('expected test failure') };
    };

    const firstRuntime = startBrowserExtensionImportRuntime(optionsFor(generate), browser);
    await new Promise(resolve => setImmediate(resolve));
    firstRuntime.dispose();
    const reloadedRuntime = startBrowserExtensionImportRuntime(optionsFor(generate), browser);
    await new Promise(resolve => setImmediate(resolve));
    reloadedRuntime.dispose();

    expect(generated).toBe(1);
  });
});
