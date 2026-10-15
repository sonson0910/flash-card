import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

const fixturePath = '/e2e/fixtures/daily-recap.html';
// Base port for this spec's own Vite fixture server, offset per-worker below.
// See practice-visual.spec.ts for why: `fullyParallel: false` still lets
// different spec files run concurrently on separate workers, and four
// unrelated -visual specs each bound a strictPort Vite server to this exact
// literal port, so two running on different workers at once raced for the
// same socket.
const FIXTURE_PORT_BASE = 4375;
let fixturePort = FIXTURE_PORT_BASE;
let fixtureOrigin = `http://127.0.0.1:${fixturePort}`;
const themes = [
  { family: 'classic', mode: 'light' },
  { family: 'classic', mode: 'dark' },
  { family: 'crystal', mode: 'light' },
  { family: 'crystal', mode: 'dark' },
] as const;
const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: '390px', width: 390, height: 844 },
] as const;
const locales = [
  { code: 'en', title: 'Session complete' },
  { code: 'vi', title: 'Hoàn thành phiên học' },
] as const;

let fixtureServer: ViteDevServer | undefined;

async function expectAccessibleAndContained(page: Page, label: string) {
  const recap = page.locator('[data-session-recap]');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${label} has horizontal overflow`).toBe(true);

  const clippedControls = await recap.locator('button:visible').evaluateAll(elements => elements
    .map(element => {
      const box = element.getBoundingClientRect();
      return { name: element.getAttribute('aria-label') || element.textContent?.trim(), left: box.left, right: box.right, width: box.width, height: box.height };
    })
    .filter(control => control.width > 0 && control.height > 0 && (control.left < -1 || control.right > window.innerWidth + 1)));
  expect(clippedControls, `${label} has clipped controls`).toEqual([]);

  const results = await new AxeBuilder({ page })
    .include('[data-session-recap]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const blocking = results.violations.filter(violation => violation.impact === 'serious' || violation.impact === 'critical');
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

async function attachRecap(page: Page, testInfo: TestInfo, name: string) {
  const screenshot = testInfo.outputPath(`${name}.png`);
  await page.locator('[data-session-recap]').screenshot({ path: screenshot });
  await testInfo.attach(name, { path: screenshot, contentType: 'image/png' });
}

test.beforeAll(async ({}, testInfo) => {
  fixturePort = FIXTURE_PORT_BASE + testInfo.parallelIndex;
  fixtureOrigin = `http://127.0.0.1:${fixturePort}`;
  fixtureServer = await createServer({
    configFile: 'vite.config.ts', cacheDir: `node_modules/.vite-e2e/daily-recap-visual-${testInfo.parallelIndex}`,
    appType: 'mpa',
    server: { host: '127.0.0.1', port: fixturePort, strictPort: true },
    optimizeDeps: { entries: ['e2e/fixtures/daily-recap.html'] },
  });
  await fixtureServer.listen();
});

test.afterAll(async () => {
  await fixtureServer?.close();
});

test('Crystal recap retains its enabled mascot when theme assets load after the dialog', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    localStorage.setItem('sonflash_theme_family', 'crystal');
    localStorage.setItem('lingoflash_theme', 'light');
    localStorage.setItem('sonflash_theme_follow_system', 'false');
    localStorage.setItem('sonflash_reduced_motion', 'true');
  });
  await page.route('**/theme-crystal.css', async route => {
    await new Promise(resolve => setTimeout(resolve, 1_000));
    await route.continue();
  });
  await page.goto(`${fixtureOrigin}${fixturePath}?locale=en`);
  const recap = page.locator('[data-session-recap]');
  await expect(recap).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme-family', 'crystal');
  const mascot = recap.locator('img[data-lumi-pose="proud"]');
  await expect(mascot).toBeVisible();
  await expect.poll(() => mascot.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
});

for (const theme of themes) {
  for (const viewport of viewports) {
    test(`${theme.family} ${theme.mode} recap is visually accessible at ${viewport.name}`, async ({ page }, testInfo) => {
      page.on('pageerror', error => { throw error; });
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: theme.mode, reducedMotion: 'reduce' });
      await page.addInitScript(({ family, mode }) => {
        localStorage.setItem('sonflash_theme_family', family);
        localStorage.setItem('lingoflash_theme', mode);
        localStorage.setItem('sonflash_theme_follow_system', 'false');
        localStorage.setItem('sonflash_reduced_motion', 'true');
      }, theme);

      for (const locale of locales) {
        await page.goto(`${fixtureOrigin}${fixturePath}?locale=${locale.code}`);
        const root = page.locator('html');
        const recap = page.locator('[data-session-recap]');
        await expect(recap).toBeVisible({ timeout: 15_000 });
        await expect(root).toHaveAttribute('data-theme-family', theme.family);
        if (theme.mode === 'dark') await expect(root).toHaveClass(/\bdark\b/);
        else await expect(root).not.toHaveClass(/\bdark\b/);
        if (theme.family === 'crystal') await expect(page.locator('#sonflash-crystal-theme')).toHaveAttribute('href', '/theme-crystal.css');
        await expect(recap.getByRole('heading', { name: locale.title })).toBeVisible();
        await expect(recap.locator('[data-count-up]')).toHaveText(['12', '83', '175']);
        await expectAccessibleAndContained(page, `${theme.family} ${theme.mode} ${viewport.name} ${locale.code}`);
        await attachRecap(page, testInfo, `${theme.family}-${theme.mode}-${viewport.name}-${locale.code}-recap`);
        if (locale.code === 'en') await expect(recap).toHaveScreenshot(`daily-recap-${theme.family}-${theme.mode}-${viewport.name}.png`);
      }
    });
  }
}
