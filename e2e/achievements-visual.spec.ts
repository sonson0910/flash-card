import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

const fixturePath = '/e2e/fixtures/achievements-visual.html';
// Base port for this spec's own Vite fixture server, offset per worker: see practice-visual.spec.ts.
const FIXTURE_PORT_BASE = 5475;
let fixtureOrigin = `http://127.0.0.1:${FIXTURE_PORT_BASE}`;
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
// What each account's board must say: the counts come from the stored records the fixture builds.
const accounts = [
  { id: 'earned', earned: 10, earnedBy: 3, exact: 7 },
  { id: 'new', earned: 6, earnedBy: 6, exact: 0 },
  { id: 'empty', earned: 0, earnedBy: 0, exact: 0 },
] as const;

let fixtureServer: ViteDevServer | undefined;

async function expectAccessibleAndContained(page: Page, label: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${label} has horizontal overflow`).toBe(true);
  const smallTargets = await page.locator('.achievements-board button:visible').evaluateAll(elements => elements
    .map(element => ({ name: element.textContent?.trim(), height: element.getBoundingClientRect().height }))
    .filter(control => control.height < 44));
  expect(smallTargets, `${label} has controls under 44px`).toEqual([]);
  const results = await new AxeBuilder({ page })
    .include('.achievements-board')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const blocking = results.violations.filter(violation => violation.impact === 'serious' || violation.impact === 'critical');
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

test.beforeAll(async ({}, testInfo) => {
  const port = FIXTURE_PORT_BASE + testInfo.parallelIndex;
  fixtureOrigin = `http://127.0.0.1:${port}`;
  fixtureServer = await createServer({
    configFile: 'vite.config.ts', cacheDir: `node_modules/.vite-e2e/achievements-visual-${testInfo.parallelIndex}`,
    appType: 'mpa',
    server: { host: '127.0.0.1', port, strictPort: true },
    optimizeDeps: { entries: ['e2e/fixtures/achievements-visual.html'] },
  });
  await fixtureServer.listen();
});

test.afterAll(async () => {
  await fixtureServer?.close();
});

for (const theme of themes) for (const viewport of viewports) for (const account of accounts) {
  test(`${theme.family} ${theme.mode} achievements for the ${account.id} account at ${viewport.name}`, async ({ page }, testInfo) => {
    page.on('pageerror', error => { throw error; });
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: theme.mode, reducedMotion: 'reduce' });
    await page.addInitScript(({ family, mode }) => {
      localStorage.setItem('sonflash_theme_family', family);
      localStorage.setItem('lingoflash_theme', mode);
      localStorage.setItem('sonflash_theme_follow_system', 'false');
      localStorage.setItem('sonflash_reduced_motion', 'true');
    }, theme);
    await page.goto(`${fixtureOrigin}${fixturePath}?locale=en&account=${account.id}`);
    const board = page.locator('.achievements-board');
    await expect(board).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('html')).toHaveAttribute('data-theme-family', theme.family);
    if (theme.family === 'crystal') await expect(page.locator('#sonflash-crystal-theme')).toHaveAttribute('href', '/theme-crystal.css');

    const badges = board.locator('[data-achievement-grid] [data-badge-state]');
    await expect(badges).toHaveCount(12);
    await expect(board.locator('[data-achievement-grid] [data-badge-state="earned"]')).toHaveCount(account.earned);
    // Badges earned before recording started carry "earned by" that day; no badge shows an invented day.
    await expect(board.locator('[data-achievement-grid] [data-earned-by]')).toHaveCount(account.earnedBy);
    await expect(board.locator('[data-achievement-grid] [data-earned-on]:not([data-earned-by])')).toHaveCount(account.exact);
    await expect(board.locator('[data-badge-id="active-days-5"]').getByText('Earn XP on 5 different days.')).toBeVisible();

    if (theme.family === 'crystal') {
      await expect(board.getByRole('heading', { level: 1, name: 'Collection' })).toBeVisible();
      await expect(board.getByText(`${account.earned} / 12 unlocked`)).toBeVisible();
      await expect(board.locator('[data-achievement-profile]')).toContainText('Khánh Bùi');
      await expect(board.getByRole('tab', { name: 'Badges' })).toHaveAttribute('aria-selected', 'true');
    } else {
      await expect(board.getByText(`Achievements · ${account.earned} of 12 earned`)).toBeVisible();
      await expect(board.getByRole('heading', { level: 1 })).toHaveText(account.id === 'earned' ? 'Word keeper, still climbing.' : 'Your word garden');
    }
    await expectAccessibleAndContained(page, `${theme.family} ${theme.mode} ${viewport.name} ${account.id}`);

    const name = `achievements-${account.id}-${theme.family}-${theme.mode}-${viewport.name}`;
    const screenshot = testInfo.outputPath(`${name}.png`);
    await page.screenshot({ path: screenshot, fullPage: true, animations: 'disabled', caret: 'hide' });
    await testInfo.attach(name, { path: screenshot, contentType: 'image/png' });

    if (theme.family === 'crystal') {
      // The titles tab: both titles with the level each needs, the one held with its recorded day.
      const titlesTab = board.getByRole('tab', { name: 'Titles' });
      await titlesTab.focus();
      await page.keyboard.press('ArrowRight');
      await expect(titlesTab).toHaveAttribute('aria-selected', 'true');
      await expect(titlesTab).toBeFocused();
      const titles = board.locator('#ach-panel-titles');
      await expect(titles).toBeVisible();
      await expect(titles.locator('[data-title-id]')).toHaveCount(2);
      await expect(titles.getByText('Reach level 13')).toBeVisible();
      if (account.id === 'earned') await expect(titles.locator('[data-title-shown]')).toContainText('Shown on your card');
      else await expect(titles.locator('[data-title-shown]')).toHaveCount(0);
      await expectAccessibleAndContained(page, `${theme.family} ${theme.mode} ${viewport.name} ${account.id} titles`);
      const titlesShot = testInfo.outputPath(`${name}-titles.png`);
      await page.screenshot({ path: titlesShot, fullPage: true, animations: 'disabled', caret: 'hide' });
      await testInfo.attach(`${name}-titles`, { path: titlesShot, contentType: 'image/png' });
      await page.keyboard.press('ArrowLeft');
      await expect(board.getByRole('tab', { name: 'Badges' })).toHaveAttribute('aria-selected', 'true');
    }

    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true, animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01 });
  });
}
