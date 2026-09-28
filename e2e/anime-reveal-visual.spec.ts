import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

const FIXTURE_PORT_BASE = 4575;
const fixturePath = '/e2e/fixtures/anime-reveal-visual.html';
const themes = [
  { family: 'classic', mode: 'light' }, { family: 'classic', mode: 'dark' },
  { family: 'crystal', mode: 'light' }, { family: 'crystal', mode: 'dark' },
] as const;
const viewports = [
  { name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844 },
] as const;
const events = ['tierup', 'streak', 'levelup'] as const;

let fixturePort = FIXTURE_PORT_BASE;
let fixtureOrigin = `http://127.0.0.1:${fixturePort}`;
let fixtureServer: ViteDevServer | undefined;

async function expectAccessibleAndContained(page: Page, label: string, event: (typeof events)[number]) {
  const reveal = page.locator('.anime-reveal');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${label} has horizontal overflow`).toBe(true);
  const results = await new AxeBuilder({ page })
    .include('.anime-reveal')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const blocking = results.violations.filter(violation => violation.impact === 'serious' || violation.impact === 'critical');
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  await expect(reveal.locator('button:visible')).toHaveCount(event === 'levelup' ? 3 : 2);
}

async function attachScreen(page: Page, testInfo: TestInfo, name: string) {
  const screenshot = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach(name, { path: screenshot, contentType: 'image/png' });
}

test.beforeAll(async ({}, testInfo) => {
  fixturePort = FIXTURE_PORT_BASE + testInfo.parallelIndex;
  fixtureOrigin = `http://127.0.0.1:${fixturePort}`;
  fixtureServer = await createServer({
    configFile: 'vite.config.ts', cacheDir: `node_modules/.vite-e2e/anime-reveal-visual-${testInfo.parallelIndex}`,
    appType: 'mpa', server: { host: '127.0.0.1', port: fixturePort, strictPort: true },
    optimizeDeps: { entries: ['e2e/fixtures/anime-reveal-visual.html'] },
  });
  await fixtureServer.listen();
});

test.afterAll(async () => { await fixtureServer?.close(); });

for (const theme of themes) for (const viewport of viewports) for (const event of events) {
  test(`${theme.family} ${theme.mode} ${event} reveal is visually accessible at ${viewport.name}`, async ({ page }, testInfo) => {
    page.on('pageerror', error => { throw error; });
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: theme.mode, reducedMotion: 'reduce' });
    await page.route(new RegExp(`^https?://(?!127\\.0\\.0\\.1:${fixturePort})`), route => route.abort());
    await page.addInitScript(({ family, mode }) => {
      localStorage.setItem('sonflash_theme_family', family);
      localStorage.setItem('lingoflash_theme', mode);
      localStorage.setItem('sonflash_theme_follow_system', 'false');
      localStorage.setItem('sonflash_reduced_motion', 'true');
    }, theme);
    const name = `anime-reveal-${event}-${theme.family}-${theme.mode}-${viewport.name}`;
    await page.goto(`${fixtureOrigin}${fixturePath}?event=${event}&locale=en`);
    await expect(page.locator(`[data-anime-reveal-visual-view="${event}"]`)).toHaveCount(1);
    await expect(page.locator('.anime-reveal')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.anime-reveal')).toHaveAttribute('data-event', event);
    await expect(page.locator('.anime-reveal')).toHaveAttribute('data-motion', 'reduced');
    await expect(page.locator('.anime-reveal')).not.toContainText(/\+25 XP|\+100 XP|daily plan now adds|you now hold 2/i);
    if (event === 'tierup') await expect(page.locator('.anime-reveal__tier-card')).toContainText('New → Mastered');
    if (event === 'levelup') await expect(page.locator('.anime-reveal__level-art')).toContainText('12 → 13');
    await expect(page.locator('html')).toHaveAttribute('data-theme-family', theme.family);
    if (theme.mode === 'dark') await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    else await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
    if (theme.family === 'crystal') await expect(page.locator('#sonflash-crystal-theme')).toHaveAttribute('href', '/theme-crystal.css');
    await expectAccessibleAndContained(page, name, event);
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true, animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01 });
    await attachScreen(page, testInfo, name);
  });
}

for (const locale of ['vi', 'pseudo'] as const) for (const event of events) {
  test(`${locale} ${event} reveal fits the crystal mobile ceremony`, async ({ page }) => {
    await page.setViewportSize(viewports[1]);
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.route(new RegExp(`^https?://(?!127\\.0\\.0\\.1:${fixturePort})`), route => route.abort());
    await page.addInitScript(() => {
      localStorage.setItem('sonflash_theme_family', 'crystal');
      localStorage.setItem('lingoflash_theme', 'dark');
      localStorage.setItem('sonflash_theme_follow_system', 'false');
      localStorage.setItem('sonflash_reduced_motion', 'true');
    });
    await page.goto(`${fixtureOrigin}${fixturePath}?event=${event}&locale=${locale}`);
    await expect(page.locator('.anime-reveal')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', locale === 'pseudo' ? 'en-XA' : 'vi');
    await expect(page.locator('.anime-reveal__title')).toContainText(locale === 'pseudo' ? '[' :
      event === 'tierup' ? 'Đã thành thạo' : event === 'streak' ? 'Đạt mốc chuỗi ngày' : 'Đã lên cấp');
    await expectAccessibleAndContained(page, `${locale} ${event}`, event);
    await expect(page).toHaveScreenshot(`anime-reveal-${event}-${locale}-crystal-dark-mobile.png`, {
      fullPage: true, animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01,
    });
  });
}
