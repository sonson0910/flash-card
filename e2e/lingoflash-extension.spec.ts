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
    const first = await context.newPage();
    await navigate(first, appUrl);
    const second = await context.newPage();
    await navigate(second, appUrl);
    const popup = await extensionPage();
    const scope = 'opaque_scope_e2e_123456';

    await postMetadata(first, 'LINGOFLASH_EXTENSION_DECK_METADATA', { scope, decks: ['Reading'] });
    await expect.poll(async () => ((await session(popup, metadataKey))[metadataKey] as { decks?: string[] } | undefined)?.decks).toEqual(['Reading']);
    await postMetadata(second, 'LINGOFLASH_EXTENSION_DECK_METADATA', { scope, decks: ['Writing'] });
    await expect.poll(async () => ((await session(popup, metadataKey))[metadataKey] as { decks?: string[] } | undefined)?.decks).toEqual(['Writing']);
    await postMetadata(first, 'LINGOFLASH_EXTENSION_DECK_METADATA_CLEAR', { scope });
    await expect.poll(async () => (await session(popup, metadataKey))[metadataKey]).toBeUndefined();

    await postMetadata(second, 'LINGOFLASH_EXTENSION_DECK_METADATA', { scope, decks: ['Stale'] });
    await expect.poll(async () => (await session(popup, metadataKey))[metadataKey]).toBeUndefined();
  });
});
