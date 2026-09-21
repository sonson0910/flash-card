import { expect, test, type Locator, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

const layouts = [
  { name: 'normal', width: 1280, height: 900, zoom: '100%' },
  { name: '320px/200%', width: 320, height: 700, zoom: '200%' },
] as const;

let fixtureServer: ViteDevServer | undefined;
let fixtureOrigin = '';

const cards = Array.from({ length: 4 }, (_, index) => ({
  id: `phase6-target-${index}`,
  word: ['focus', 'practice', 'repeat', 'remember'][index],
  normalizedWord: ['focus', 'practice', 'repeat', 'remember'][index],
  translation: ['tập trung', 'luyện tập', 'lặp lại', 'ghi nhớ'][index],
  explanation: 'A compact card used to measure interactive controls.',
  phonetic: '/test/',
  emoji: '📘',
  category: 'Accessibility',
  audioUrl: null,
  imageUrl: null,
  exampleSentence: 'Practice helps you remember.',
  createdAt: `2026-07-26T00:0${index}:00.000Z`,
  bookmarked: false,
  difficulty: 'unrated',
  customDeck: null,
}));

async function expectTargets(locator: Locator, label: string) {
  const count = await locator.count();
  expect(count, `${label} should expose at least one reachable control`).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    const control = locator.nth(index);
    const name = await control.evaluate(element => element.getAttribute('aria-label') || element.textContent?.trim() || element.className);
    await expect.poll(
      async () => (await control.boundingBox())?.width ?? 0,
      { message: `${label} control ${index} (${name}) width` },
    ).toBeGreaterThanOrEqual(44);
    await expect.poll(
      async () => (await control.boundingBox())?.height ?? 0,
      { message: `${label} control ${index} (${name}) height` },
    ).toBeGreaterThanOrEqual(44);
  }
}

async function openLibrary(page: Page) {
  await page.goto('/?view=library');
  await expect(page.getByRole('heading', { name: 'Your library' })).toBeVisible();
}

async function applyLayout(page: Page, layout: typeof layouts[number]) {
  await page.setViewportSize({ width: layout.width, height: layout.height });
  await page.locator('html').evaluate((element, zoom) => { element.style.fontSize = zoom; }, layout.zoom);
}

test.beforeAll(async ({}, testInfo) => {
  const port = 4174 + ['chromium', 'firefox', 'webkit'].indexOf(testInfo.project.name);
  fixtureOrigin = `http://127.0.0.1:${port}`;
  fixtureServer = await createServer({
    configFile: 'vite.config.ts',
    appType: 'mpa',
    server: { host: '127.0.0.1', port, strictPort: true },
    optimizeDeps: { entries: ['e2e/fixtures/phase6-touch-targets.html'] },
  });
  await fixtureServer.listen();
});

test.afterAll(async () => {
  await fixtureServer?.close();
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(seedCards => {
    localStorage.setItem('lingoflash_cards', JSON.stringify(seedCards));
    localStorage.removeItem('lingoflash_cards_owner');
    localStorage.setItem('lingoflash_theme', 'light');
  }, cards);
});

test('LibraryTools, Flashcard, and CardMnemonicSection measure at least 44px in both layouts', async ({ page }) => {
  for (const layout of layouts) {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await openLibrary(page);
    await applyLayout(page, layout);

    const tools = page.locator('#library-tools');
    await tools.getByRole('button', { name: /More/ }).click();
    await expectTargets(tools.locator('button:visible, input:not([type="file"]):visible, select:visible'), `LibraryTools ${layout.name}`);

    const card = page.getByRole('group', { name: /focus flashcard/i });
    await card.getByRole('button', { name: /Reveal the Vietnamese meaning/ }).click();
    await expect(card.locator('[data-mnemonic-generate]')).toBeVisible();
    const revealedContent = card.locator('[data-card-content="revealed"]');
    await expectTargets(revealedContent.locator('button[data-card-control]:visible, button[data-mnemonic-generate]:visible'), `Flashcard and CardMnemonicSection ${layout.name}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
});

test('undo pauses on hover and focus, then dismisses once after the remaining time', async ({ page }) => {
  await page.clock.install();
  for (const layout of layouts) {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await page.goto(`${fixtureOrigin}/e2e/fixtures/phase6-touch-targets.html?view=undo`);
    await applyLayout(page, layout);
    const toast = page.getByRole('alert');
    await expect(toast).toBeVisible();
    await expectTargets(toast.getByRole('button'), `UndoToast ${layout.name}`);

    await toast.hover();
    await expect(toast.locator('.undo-toast-progress')).toHaveCSS('animation-play-state', 'paused');
    await page.clock.runFor(5_100);
    await expect(toast).toBeVisible();

    await page.getByRole('button', { name: 'Replace dismiss callback' }).click();
    await toast.getByRole('button', { name: 'Undo' }).focus();
    await page.mouse.move(0, 0);
    await page.clock.runFor(5_100);
    await expect(toast).toBeVisible();

    await page.getByRole('button', { name: 'Replace dismiss callback' }).focus();
    await expect(toast.locator('.undo-toast-progress')).toHaveCSS('animation-play-state', 'running');
    await page.clock.runFor(5_000);
    await expect(toast).toBeHidden();
    await expect.poll(() => page.evaluate(() => (window as Window & { undoDismissVersion?: number }).undoDismissVersion)).toBe(1);
  }
});

test('Shadowing and SessionRecapModal controls measure at least 44px in both layouts', async ({ page }) => {
  for (const layout of layouts) {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await page.goto('/');
    await applyLayout(page, layout);
    await page.getByRole('button', { name: 'More practice' }).click();
    await page.getByRole('button', { name: 'Shadowing Arena' }).click();
    await expect(page.getByText(/Shadowing Arena/)).toBeVisible();
    await expectTargets(page.locator('main button:visible'), `Shadowing ${layout.name}`);

    await page.goto(`${fixtureOrigin}/e2e/fixtures/phase6-touch-targets.html?view=recap`);
    await applyLayout(page, layout);
    const recap = page.getByRole('dialog').filter({ has: page.getByText('Session Complete!') });
    await expect(recap).toBeVisible();
    await expectTargets(recap.getByRole('button'), `SessionRecapModal ${layout.name}`);
  }
});
