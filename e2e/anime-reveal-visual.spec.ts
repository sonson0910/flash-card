import AxeBuilder from '@axe-core/playwright';
import { writeFile } from 'node:fs/promises';
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
  // Close, then Later and Use frame on a level up, or Share and the main action on the others.
  await expect(reveal.locator('button:visible'), `${label} ${event} actions`).toHaveCount(3);
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
    await expect(page.locator(`[data-anime-reveal-visual-view="${event}"]`)).toHaveCount(1, { timeout: 15_000 });
    await expect(page.locator('.anime-reveal')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.anime-reveal')).toHaveAttribute('data-event', event);
    await expect(page.locator('.anime-reveal')).toHaveAttribute('data-motion', 'reduced');
    if (event === 'streak') {
      await expect(page.locator('.anime-reveal__title')).toHaveText('30-day streak');
      await expect(page.locator('.anime-reveal__description')).toHaveText('A full month of study. You earned 1 streak freeze, so one missed day will not break the chain. You now hold 2.');
      await expect(page.locator('.anime-reveal__rewards li')).toHaveText(['+1 streak freeze', '+100 XP', 'Badge · Web Wanderer']);
      await expect(page.locator('.anime-reveal')).not.toContainText(/\bPro\b|refills|daily plan now adds/i);
    } else {
      await expect(page.locator('.anime-reveal')).not.toContainText(/\+25 XP|\+100 XP|daily plan now adds|you now hold 2/i);
    }
    if (event === 'tierup') await expect(page.locator('.anime-reveal__tier-card')).toContainText('New → Mastered');
    if (event === 'levelup') {
      await expect(page.locator('.anime-reveal__level-art')).toHaveText('LV13');
      await expect(page.locator('.anime-reveal__title')).toContainText('LV 12 → 13');
    }
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
    await expect(page.locator('.anime-reveal')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('html')).toHaveAttribute('lang', locale === 'pseudo' ? 'en-XA' : 'vi');
    await expect(page.locator('.anime-reveal__title')).toContainText(locale === 'pseudo' ? '[' :
      event === 'tierup' ? 'Đã thành thạo' : event === 'streak' ? 'Chuỗi 30 ngày' : 'Đã lên cấp');
    await expectAccessibleAndContained(page, `${locale} ${event}`, event);
    await expect(page).toHaveScreenshot(`anime-reveal-${event}-${locale}-crystal-dark-mobile.png`, {
      fullPage: true, animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01,
    });
  });
}

interface SharedRevealImage { readonly title?: string; readonly text?: string; readonly name: string; readonly type: string; readonly base64: string }

for (const theme of themes) for (const viewport of viewports) for (const event of ['tierup', 'streak'] as const) {
  test(`${theme.family} ${theme.mode} ${event} reveal shares its card as an image made on the device at ${viewport.name}`, async ({ page }, testInfo) => {
    page.on('pageerror', error => { throw error; });
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: theme.mode, reducedMotion: 'reduce' });
    await page.route(new RegExp(`^https?://(?!127\\.0\\.0\\.1:${fixturePort})`), route => route.abort());
    await page.addInitScript(({ family, mode }) => {
      localStorage.setItem('sonflash_theme_family', family);
      localStorage.setItem('lingoflash_theme', mode);
      localStorage.setItem('sonflash_theme_follow_system', 'false');
      localStorage.setItem('sonflash_reduced_motion', 'true');
      // The device share sheet, recorded instead of opened.
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (data: { files: File[]; title?: string; text?: string }) => {
          const file = data.files[0];
          const bytes = new Uint8Array(await file.arrayBuffer());
          let binary = '';
          for (const byte of bytes) binary += String.fromCharCode(byte);
          (window as unknown as { sharedRevealImage: unknown }).sharedRevealImage = { title: data.title, text: data.text, name: file.name, type: file.type, base64: btoa(binary) };
        },
      });
    }, theme);
    const name = `anime-reveal-${event}-shared-${theme.family}-${theme.mode}-${viewport.name}`;
    await page.goto(`${fixtureOrigin}${fixturePath}?event=${event}&locale=en`);
    await expect(page.locator('.anime-reveal')).toBeVisible({ timeout: 15_000 });
    const offDevice: string[] = [];
    page.on('request', request => { if (!request.url().startsWith(fixtureOrigin)) offDevice.push(request.url()); });

    await page.getByRole('button', { name: event === 'tierup' ? 'Share card' : 'Share', exact: true }).click();
    await expect(page.locator('.anime-reveal__share-status')).toHaveText('Shared.');
    const shared = await page.evaluate(() => (window as unknown as { sharedRevealImage?: SharedRevealImage }).sharedRevealImage);
    expect(shared).toMatchObject({
      title: event === 'tierup' ? 'SonFlash · Tier up' : 'SonFlash · Streak milestone',
      text: event === 'tierup' ? 'Mastered' : '30-day streak',
      name: event === 'tierup' ? 'sonflash-tier-up.png' : 'sonflash-streak.png',
      type: 'image/png',
    });
    expect(offDevice).toEqual([]);
    await expectAccessibleAndContained(page, name, event);
    await attachScreen(page, testInfo, name);
    const image = testInfo.outputPath(`${name}-image.png`);
    await writeFile(image, Buffer.from(shared!.base64, 'base64'));
    await testInfo.attach(`${name}-image`, { path: image, contentType: 'image/png' });
  });
}
