import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const extensionRoot = join(process.cwd(), 'extensions/lingoflash');
const themes = [
  { family: 'classic', scheme: 'light' }, { family: 'classic', scheme: 'dark' },
  { family: 'crystal', scheme: 'light' }, { family: 'crystal', scheme: 'dark' },
] as const;
const popupStates = ['idle', 'loading', 'created', 'existing', 'auth-required', 'quota', 'error'] as const;
const mimeTypes: Record<string, string> = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.woff2': 'font/woff2' };

let server: Server;
let origin = '';

async function startExtensionServer() {
  server = createServer(async (request, response) => {
    const pathname = normalize(new URL(request.url || '/', 'http://localhost').pathname).replace(/^[/\\]+/, '');
    const file = join(extensionRoot, pathname || 'popup.html');
    if (!file.startsWith(extensionRoot)) return response.writeHead(403).end();
    try {
      response.writeHead(200, { 'content-type': mimeTypes[extname(file)] || 'application/octet-stream' });
      response.end(await readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Extension visual server did not bind a TCP port.');
  origin = `http://127.0.0.1:${address.port}`;
}

test.beforeAll(startExtensionServer);
test.afterAll(() => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())));

async function mockChrome(page: Page, theme: typeof themes[number]) {
  await page.addInitScript(({ family, scheme }) => {
    const settings = {
      autoSpeak: false, bubbleDurationMs: 0, recentLookupsEnabled: true,
      quickTranslateSource: 'auto', quickTranslateTarget: 'vi', selectionIconSites: [],
      themeFamily: family, colorScheme: scheme,
    };
    const respond = (message: { type?: string }) => {
      if (message.type === 'GET_SELECTION') return { ok: true, text: '' };
      if (message.type === 'GET_DECKS') return { ok: true, decks: [] };
      if (message.type === 'GET_ACTIVE_SITE') return { ok: true, pattern: 'https://example.test/*', enabled: false };
      if (message.type === 'GET_SHORTCUTS') return { ok: true, saveShortcut: 'Ctrl+Shift+L', translateShortcut: 'Alt+Shift+L' };
      if (message.type === 'GET_RECENT_LOOKUPS') return {
        ok: true,
        items: [{ text: 'resilient', translation: 'kiên cường', sourceLanguage: 'en', targetLanguage: 'vi', kind: 'create', status: 'created', timestamp: 0 }],
      };
      if (message.type === 'GET_DUE_COUNT') return { ok: false };
      if (message.type === 'ADD_SELECTION') return { ok: true, id: 'visual-capture' };
      return { ok: true };
    };
    const storage = {
      get: (_key: unknown, callback: (value: unknown) => void) => callback({ lingoflash_extension_settings: settings }),
      set: (_value: unknown, callback: () => void) => callback(),
    };
    (window as any).__extensionListeners = [];
    (window as any).chrome = {
      i18n: { getMessage: () => '' },
      runtime: {
        lastError: null,
        onMessage: { addListener: (listener: unknown) => (window as any).__extensionListeners.push(listener) },
        sendMessage: (message: { type?: string }, callback: (value: unknown) => void) => callback(respond(message)),
      },
      storage: { sync: storage, local: storage, session: storage },
      permissions: { request: (_value: unknown, callback: (value: boolean) => void) => callback(true), remove: (_value: unknown, callback: (value: boolean) => void) => callback(true) },
    };
  }, theme);
}

async function emitPopupState(page: Page, state: typeof popupStates[number]) {
  if (state === 'idle') return;
  await expect(page.locator('#requested-deck')).toBeEnabled();
  await page.locator('#selection').fill('resilient');
  await page.locator('#selection-form').evaluate((form: HTMLFormElement) => form.requestSubmit());
  await expect(page.locator('#status')).toContainText('Đã bắt đầu tạo');
  await page.evaluate(({ state }) => {
    const payloads: Record<string, Record<string, unknown>> = {
      loading: { status: 'loading-save' },
      created: { status: 'created', text: 'resilient', translation: 'kiên cường', phonetic: '/rɪˈzɪl.jənt/', explanation: 'Có khả năng phục hồi.', exampleSentence: 'A resilient community rebuilt.', exampleTranslation: 'Một cộng đồng kiên cường đã xây dựng lại.', sourceLanguage: 'en', inlineShown: false },
      existing: { status: 'existing', text: 'resilient', translation: 'kiên cường', sourceLanguage: 'en', inlineShown: false },
      'auth-required': { status: 'auth-required' },
      quota: { status: 'error', message: 'Bạn đã hết hạn mức AI hôm nay.' },
      error: { status: 'error', message: 'Không thể tạo flashcard. Hãy thử lại.', retryId: 'visual-capture' },
    };
    for (const listener of (window as any).__extensionListeners) listener({ type: 'QUICK_ADD_STATUS', payload: { id: 'visual-capture', ...payloads[state] } });
  }, { state });
}

async function attach(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, animations: 'disabled', caret: 'hide' });
  await testInfo.attach(name, { path, contentType: 'image/png' });
  await expect(page).toHaveScreenshot(`${name}.png`, { animations: 'disabled', caret: 'hide' });
}

for (const theme of themes) {
  test(`extension popup captures ${theme.family} ${theme.scheme} states`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 380, height: 640 });
    await page.emulateMedia({ colorScheme: theme.scheme, reducedMotion: 'reduce' });
    await mockChrome(page, theme);
    for (const state of popupStates) {
      await page.goto(`${origin}/popup.html`);
      await expect(page.locator('html')).toHaveAttribute('data-theme-family', theme.family);
      await emitPopupState(page, state);
      if (state === 'loading') await expect(page.locator('#status')).toContainText('Đang tạo flashcard');
      if (state === 'created' || state === 'existing') await expect(page.locator('#result-card')).toBeVisible();
      if (state === 'auth-required' || state === 'quota' || state === 'error') await expect(page.locator('#state-card')).toBeVisible();
      if (state === 'quota') await expect(page.locator('#state-card')).toHaveAttribute('data-state', 'quota');
      await attach(page, testInfo, `extension-popup-${theme.family}-${theme.scheme}-${state}`);
    }
  });

  test(`extension options captures ${theme.family} ${theme.scheme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 960, height: 900 });
    await page.emulateMedia({ colorScheme: theme.scheme, reducedMotion: 'reduce' });
    await mockChrome(page, theme);
    await page.goto(`${origin}/options.html`);
    await expect(page.locator('html')).toHaveAttribute('data-theme-family', theme.family);
    await expect(page.locator('#settings-form')).toBeVisible();
    await attach(page, testInfo, `extension-options-${theme.family}-${theme.scheme}`);
  });
}

test('extension in-page renderer captures result and quota states', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.setContent('<main><h1>Article title</h1><p>A resilient community rebuilt the bridge.</p></main>');
  await page.addScriptTag({ path: join(extensionRoot, 'background-ui.js') });
  for (const [name, payload] of Object.entries({
    created: { status: 'created', text: 'resilient', translation: 'kiên cường', phonetic: '/rɪˈzɪl.jənt/', explanation: 'Có khả năng phục hồi.', exampleSentence: 'A resilient community rebuilt the bridge.', exampleTranslation: 'Một cộng đồng kiên cường đã xây dựng lại.', aiGenerated: true, anchor: { left: 180, bottom: 180 }, bubbleDurationMs: 0 },
    quota: { status: 'error', text: 'resilient', message: 'Bạn đã hết hạn mức AI hôm nay.', anchor: { left: 180, bottom: 180 }, bubbleDurationMs: 0 },
  })) {
    await page.evaluate(value => (window as any).LingoFlashExtensionUi.renderInlineBubble(value), payload);
    const host = page.locator('#lingoflash-inline-translation-host');
    await expect(host).toBeVisible();
    await attach(page, testInfo, `extension-in-page-${name}`);
  }
});

test('extension in-page renderer captures a Korean selection with Vietnamese quick translation', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.setContent('<main lang="ko"><h1>경제 뉴스</h1><p>한국은행은 기준금리를 동결하기로 <mark id="selected-word">결정</mark>했다.</p></main>');
  await page.addScriptTag({ path: join(extensionRoot, 'background-ui.js') });
  const selection = await page.evaluate(() => {
    const selectedWord = document.getElementById('selected-word');
    if (!selectedWord?.firstChild) throw new Error('Korean selection fixture is unavailable.');
    const range = document.createRange();
    range.selectNodeContents(selectedWord);
    const browserSelection = window.getSelection();
    browserSelection?.removeAllRanges();
    browserSelection?.addRange(range);
    return (window as any).LingoFlashExtensionUi.captureSelectionFromPage();
  });
  expect(selection.text).toBe('결정');
  expect(selection.context).toContain('기준금리를 동결하기로 결정했다.');

  await page.evaluate(payload => (window as any).LingoFlashExtensionUi.renderInlineBubble(payload), {
    status: 'translated', text: selection.text, translation: 'quyết định', sourceLanguage: 'ko', targetLanguage: 'vi', speechLocale: 'ko-KR',
    anchor: { left: 180, bottom: 180 }, bubbleDurationMs: 0,
  });
  const host = page.locator('#lingoflash-inline-translation-host');
  const result = host.getByRole('status').filter({ hasText: 'quyết định' });
  await expect(host).toBeVisible();
  await expect(result).toHaveAttribute('aria-live', 'polite');
  await expect(result).toContainText('Chỉ dịch • không lưu • không dùng quota AI');
  await expect(host.getByRole('button', { name: 'Nghe phát âm 결정' })).toBeVisible();
  await expect(host.getByRole('button', { name: 'Đóng kết quả SonFlash' })).toBeVisible();
  await attach(page, testInfo, 'extension-in-page-korean-vietnamese-translation');
});
