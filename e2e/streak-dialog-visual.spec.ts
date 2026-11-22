import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

// Renders the streak details from stored stats documents, so the frozen, repair and milestone
// states can be seen before an emulator journey reaches them.
const FIXTURE_PORT_BASE = 4875;
const fixturePath = '/e2e/fixtures/streak-dialog-visual.html';
const themes = [
  { family: 'classic', mode: 'light' }, { family: 'classic', mode: 'dark' },
  { family: 'crystal', mode: 'light' }, { family: 'crystal', mode: 'dark' },
] as const;
const viewports = [
  { name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844 },
] as const;
const states = [
  { state: 'active', chip: '1 streak freeze', dialog: 'active', title: 'Keep your streak going.', text: ['1 of 2 freezes left', 'Freezes are used automatically.'] },
  { state: 'frozen', chip: '11 study days', dialog: 'frozen', title: 'Your streak is safe.', text: ['You missed yesterday, so a streak freeze stepped in.', 'No freezes left'] },
  { state: 'repair', chip: 'Repair your streak', dialog: 'repair', title: 'Your 23-day streak ended.', text: ['Review 20 cards', '0 / 20', 'Repair window:', 'Start a session'] },
  { state: 'repair-progress', chip: 'Repair your streak', dialog: 'repair', title: 'Your 23-day streak ended.', text: ['8 / 20', 'Keep repairing'] },
  { state: 'milestone', chip: '2 streak freezes', dialog: 'milestone', title: '30 days in a row', text: ['Badge unlocked · Web Wanderer', 'Reviews', 'New words', 'Recall', '+100 XP added'] },
] as const;

let fixturePort = FIXTURE_PORT_BASE;
let fixtureOrigin = `http://127.0.0.1:${fixturePort}`;
let fixtureServer: ViteDevServer | undefined;

async function expectAccessibleAndContained(page: Page, label: string) {
  const dialog = page.locator('.streak-dialog');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${label} has horizontal overflow`).toBe(true);
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(Boolean(box && viewport && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height), `${label} stays inside the viewport`).toBe(true);
  const results = await new AxeBuilder({ page })
    .include('.streak-dialog')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const blocking = results.violations.filter(violation => violation.impact === 'serious' || violation.impact === 'critical');
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

async function attachScreen(page: Page, testInfo: TestInfo, name: string) {
  const screenshot = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach(name, { path: screenshot, contentType: 'image/png' });
}

async function openFixture(page: Page, family: string, mode: 'light' | 'dark', state: string, locale: string) {
  await page.emulateMedia({ colorScheme: mode, reducedMotion: 'reduce' });
  await page.route(new RegExp(`^https?://(?!127\\.0\\.0\\.1:${fixturePort})`), route => route.abort());
  await page.addInitScript(theme => {
    localStorage.setItem('sonflash_theme_family', theme.family);
    localStorage.setItem('lingoflash_theme', theme.mode);
    localStorage.setItem('sonflash_theme_follow_system', 'false');
    localStorage.setItem('sonflash_reduced_motion', 'true');
  }, { family, mode });
  await page.goto(`${fixtureOrigin}${fixturePath}?state=${state}&locale=${locale}`);
  await expect(page.locator(`[data-streak-dialog-visual-view="${state}"]`)).toHaveCount(1, { timeout: 15_000 });
  await expect(page.locator('html')).toHaveAttribute('data-theme-family', family);
  if (family === 'crystal') await expect(page.locator('#sonflash-crystal-theme')).toHaveAttribute('href', '/theme-crystal.css');
}

test.beforeAll(async ({}, testInfo) => {
  fixturePort = FIXTURE_PORT_BASE + testInfo.parallelIndex;
  fixtureOrigin = `http://127.0.0.1:${fixturePort}`;
  fixtureServer = await createServer({
    configFile: 'vite.config.ts', cacheDir: `node_modules/.vite-e2e/streak-dialog-visual-${testInfo.parallelIndex}`,
    appType: 'mpa', server: { host: '127.0.0.1', port: fixturePort, strictPort: true },
    optimizeDeps: { entries: ['e2e/fixtures/streak-dialog-visual.html'] },
  });
  await fixtureServer.listen();
});

test.afterAll(async () => { await fixtureServer?.close(); });

for (const theme of themes) for (const viewport of viewports) for (const entry of states) {
  test(`${theme.family} ${theme.mode} ${entry.state} streak details are visually accessible at ${viewport.name}`, async ({ page }, testInfo) => {
    page.on('pageerror', error => { throw error; });
    await page.setViewportSize(viewport);
    await openFixture(page, theme.family, theme.mode, entry.state, 'en');
    const name = `streak-dialog-${entry.state}-${theme.family}-${theme.mode}-${viewport.name}`;

    await page.getByRole('button', { name: entry.chip }).click();
    const dialog = page.locator('.streak-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('data-streak-state', entry.dialog);
    await expect(dialog).toHaveAttribute('data-family', theme.family);
    await expect(page.getByRole('dialog', { name: new RegExp(`^${entry.title}`) })).toBeVisible();
    for (const text of entry.text) await expect(dialog).toContainText(text);
    await expect(dialog).not.toContainText(/\bPro\b|refills|buy|gems?\b/i);
    await expect(dialog.getByRole('list', { name: 'This week' }).getByRole('listitem')).toHaveCount(7);
    await expectAccessibleAndContained(page, name);
    await attachScreen(page, testInfo, name);
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true, animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01 });
  });
}

test('vi streak repair details fit the crystal phone', async ({ page }, testInfo) => {
  page.on('pageerror', error => { throw error; });
  await page.setViewportSize(viewports[1]);
  await openFixture(page, 'crystal', 'dark', 'repair', 'vi');
  await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
  await page.getByRole('button', { name: 'Khôi phục chuỗi' }).click();
  const dialog = page.locator('.streak-dialog');
  await expect(dialog).toContainText('Chuỗi 23 ngày của bạn đã đứt.');
  await expect(dialog).toContainText('Ôn 20 thẻ');
  await expectAccessibleAndContained(page, 'vi repair');
  await attachScreen(page, testInfo, 'streak-dialog-repair-vi-crystal-dark-mobile');
  await expect(page).toHaveScreenshot('streak-dialog-repair-vi-crystal-dark-mobile.png', { fullPage: true, animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01 });
});
