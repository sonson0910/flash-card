import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const extensionRoot = resolve('extensions/lingoflash');
const appUrl = 'https://encoded-hangout-433912-h2.web.app/?view=library';
const metadataKey = 'lingoflash_extension_deck_metadata';
const jobKeyPrefix = 'lingoflash_quick_add_job_';

test.describe('LingoFlash MV3 extension', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'The unpacked MV3 extension test requires Chromium.');

  let context: BrowserContext;
  let profile: string;
  let extensionOrigin: string;

  test.beforeEach(async () => {
    profile = await mkdtemp(join(tmpdir(), 'lingoflash-extension-e2e-'));
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${extensionRoot}`, `--load-extension=${extensionRoot}`],
    });
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    extensionOrigin = worker.url().replace(/\/background\.js$/, '');
  });

  test.afterEach(async () => {
    await context?.close();
    await rm(profile, { recursive: true, force: true });
  });

  const extensionPage = async () => {
    const page = await context.newPage();
    await page.goto(`${extensionOrigin}/popup.html`);
    return page;
  };

  const session = (page: Page, key: string | null) => page.evaluate(async storageKey => {
    const browser = globalThis as typeof globalThis & {
      chrome: { storage: { session: { get(key: string | null): Promise<Record<string, unknown>> } } };
    };
    return browser.chrome.storage.session.get(storageKey);
  }, key);

  const postMetadata = (page: Page, type: string, payload: object) => page.evaluate(({ messageType, messagePayload }) => {
    window.postMessage({
      source: 'lingoflash-web-app',
      type: messageType,
      payload: messagePayload,
    }, location.origin);
  }, { messageType: type, messagePayload: payload });

  const navigate = async (page: Page, url: string) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
        return;
      } catch (error) {
        if (attempt === 2) throw error;
        await page.waitForTimeout(250);
      }
    }
  };

  test('cleans a terminal quick-add worker tab through the service worker', async () => {
    const source = await context.newPage();
    await source.goto('http://127.0.0.1:4173', { waitUntil: 'domcontentloaded' });
    const popup = await extensionPage();
    await source.bringToFront();

    const workerTabPromise = context.waitForEvent('page');
    const started = await popup.evaluate(() => {
      const browser = globalThis as typeof globalThis & {
        chrome: { runtime: { sendMessage(message: object): Promise<{ ok: boolean }> } };
      };
      return browser.chrome.runtime.sendMessage({ type: 'ADD_SELECTION', text: 'resilient' });
    });
    expect(started.ok).toBe(true);
    const workerTab = await workerTabPromise;
    await workerTab.waitForURL(/encoded-hangout-433912-h2\.web\.app/, { timeout: 20_000 });

    await expect.poll(async () => Object.keys(await session(popup, null))
      .some(key => key.startsWith(jobKeyPrefix))).toBe(true);
    await workerTab.close();

    await expect.poll(async () => Object.keys(await session(popup, null))
      .some(key => key.startsWith(jobKeyPrefix))).toBe(false);
  });

  test('rejects stale app-bridge metadata after a generation is cleared', async () => {
    // Keep the approved app origin and real extension content script, without
    // loading a deployed app that can publish its own account metadata.
    await context.route('https://encoded-hangout-433912-h2.web.app/**', route => route.fulfill({
      contentType: 'text/html', body: '<!doctype html><title>App bridge document</title>',
    }));
    await context.addInitScript(() => {
      window.addEventListener('message', event => {
        if (event.source === window && event.origin === location.origin
          && event.data?.source === 'lingoflash-extension-bridge'
          && event.data?.type === 'LINGOFLASH_EXTENSION_PROVIDER_READY') {
          (window as Window & { __bridgeReady?: boolean }).__bridgeReady = true;
        }
      });
    });
    const first = await context.newPage();
    await navigate(first, appUrl);
    await first.waitForFunction(() => (window as Window & { __bridgeReady?: boolean }).__bridgeReady);
    const popup = await extensionPage();
    const scope = 'opaque_scope_e2e_123456';
    await popup.evaluate(key => {
      const state = window as Window & { __deckWrites?: string[][] };
      state.__deckWrites = [];
      const browser = globalThis as typeof globalThis & {
        chrome: { storage: { onChanged: { addListener(callback: (changes: Record<string, { newValue?: { decks?: string[] } }>, area: string) => void): void } } };
      };
      browser.chrome.storage.onChanged.addListener((changes, area) => {
        const decks = changes[key]?.newValue?.decks;
        if (area === 'session' && decks) state.__deckWrites!.push(decks);
      });
    }, metadataKey);

    await postMetadata(first, 'LINGOFLASH_EXTENSION_DECK_METADATA', { scope, decks: ['Reading'] });
    await expect.poll(async () => ((await session(popup, metadataKey))[metadataKey] as { decks?: string[] } | undefined)?.decks).toEqual(['Reading']);
    const second = await context.newPage();
    await navigate(second, appUrl);
    await second.waitForFunction(() => (window as Window & { __bridgeReady?: boolean }).__bridgeReady);
    await postMetadata(second, 'LINGOFLASH_EXTENSION_DECK_METADATA', { scope, decks: ['Writing'] });
    await expect.poll(async () => ((await session(popup, metadataKey))[metadataKey] as { decks?: string[] } | undefined)?.decks).toEqual(['Writing']);
    await postMetadata(second, 'LINGOFLASH_EXTENSION_DECK_METADATA_CLEAR', { scope });
    await expect.poll(async () => (await session(popup, metadataKey))[metadataKey]).toBeUndefined();

    await postMetadata(second, 'LINGOFLASH_EXTENSION_DECK_METADATA', { scope, decks: ['Stale'] });
    // The same document's relay processes these in order. A successful fresh
    // scope witnesses completion, so absence cannot pass before Stale is handled.
    await postMetadata(second, 'LINGOFLASH_EXTENSION_DECK_METADATA', { scope: `${scope}_fresh`, decks: ['Fresh'] });
    await expect.poll(async () => ((await session(popup, metadataKey))[metadataKey] as { decks?: string[] } | undefined)?.decks).toEqual(['Fresh']);
    await expect.poll(() => popup.evaluate(() => (window as Window & { __deckWrites?: string[][] }).__deckWrites)).toContainEqual(['Fresh']);
    expect(await popup.evaluate(() => (window as Window & { __deckWrites?: string[][] }).__deckWrites)).not.toContainEqual(['Stale']);
  });
});
