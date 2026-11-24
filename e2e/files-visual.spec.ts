import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

// This spec's own Vite fixture server, offset per worker like the other -visual specs.
const FIXTURE_PORT_BASE = 5055;
let fixtureOrigin = `http://127.0.0.1:${FIXTURE_PORT_BASE}`;
let fixtureServer: ViteDevServer | undefined;

const themes = [
  { family: 'classic', mode: 'light' }, { family: 'classic', mode: 'dark' },
  { family: 'crystal', mode: 'light' }, { family: 'crystal', mode: 'dark' },
] as const;
const viewports = [{ name: 'desktop', width: 1440, height: 900 }, { name: '390px', width: 390, height: 844 }] as const;
type Theme = (typeof themes)[number];

/** Every state on the upload and My files boards, in board order. */
const boards = [
  'Select', 'SelectImage', 'SelectEpub', 'Validating', 'Uploading', 'Processing', 'Partial', 'Results', 'SavedEpub',
  'AttachImage', 'ResizeImage', 'Empty', 'Files', 'Delete', 'Canceled', 'Retry', 'FileError', 'Rejected', 'RejectSize',
  'RejectPlan', 'QuotaExceeded', 'UploadIncomplete', 'UploadRejected',
] as const;

test.beforeAll(async ({}, testInfo) => {
  const port = FIXTURE_PORT_BASE + testInfo.parallelIndex;
  fixtureOrigin = `http://127.0.0.1:${port}`;
  fixtureServer = await createServer({
    configFile: 'vite.config.ts',
    cacheDir: `node_modules/.vite-e2e/files-visual-${testInfo.parallelIndex}`,
    appType: 'mpa',
    server: { host: '127.0.0.1', port, strictPort: true },
    optimizeDeps: { entries: ['e2e/fixtures/files-workspace.html'] },
  });
  await fixtureServer.listen();
});
test.afterAll(async () => { await fixtureServer?.close(); });

async function useTheme(page: Page, theme: Theme) {
  await page.emulateMedia({ colorScheme: theme.mode, reducedMotion: 'reduce' });
  await page.addInitScript(({ family, mode }) => {
    localStorage.setItem('sonflash_theme_family', family);
    localStorage.setItem('lingoflash_theme', mode);
    localStorage.setItem('sonflash_theme_follow_system', 'false');
    localStorage.setItem('sonflash_reduced_motion', 'true');
  }, theme);
}

async function openBoard(page: Page, board: string) {
  await page.goto(`${fixtureOrigin}/e2e/fixtures/files-workspace.html?board=${board}`);
  await expect(page.locator('.sf-files')).toBeVisible({ timeout: 15_000 });
  if (board === 'Delete') {
    await page.getByRole('button', { name: 'Delete ielts-reading.pdf' }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
  }
  await page.evaluate(() => document.fonts.ready);
}

async function expectContained(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect.soft(overflow, `${label} has horizontal overflow`).toBeLessThanOrEqual(1);
}

for (const theme of themes) for (const viewport of viewports) {
  test(`${theme.family} ${theme.mode} upload boards at ${viewport.name}`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await useTheme(page, theme);
    for (const board of boards) {
      await openBoard(page, board);
      await expect(page.locator('html')).toHaveAttribute('data-theme-family', theme.family);
      await expectContained(page, `${board} ${theme.family} ${theme.mode} ${viewport.name}`);
      await expect.soft(page).toHaveScreenshot(`files-${board}-${theme.family}-${theme.mode}-${viewport.name}.png`, {
        fullPage: true, animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01,
      });
    }
  });
}

for (const theme of themes) {
  test(`${theme.family} ${theme.mode} upload boards pass the accessibility checks`, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1440, height: 900 });
    await useTheme(page, theme);
    for (const board of ['Select', 'Uploading', 'Retry', 'QuotaExceeded', 'Results', 'Partial', 'Delete', 'FileError', 'RejectSize'] as const) {
      await openBoard(page, board);
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      const blocking = results.violations.filter(violation => violation.impact === 'serious' || violation.impact === 'critical');
      expect.soft(blocking, `${board}: ${JSON.stringify(blocking.map(violation => [violation.id, violation.nodes.map(node => node.target)]))}`).toEqual([]);
      const small = await page.locator('.sf-files button:visible, .sf-files select:visible').evaluateAll(elements => elements
        .map(element => {
          // A control the board draws under 44 px keeps its size and carries an invisible ::after layer that
          // extends where it can be pressed; that layer is positioned against the control's padding box.
          const layer = getComputedStyle(element, '::after');
          const reach = (side: string) => layer.content !== 'none' && layer.position === 'absolute'
            ? Math.max(0, -Number.parseFloat(layer.getPropertyValue(side)) || 0)
            : 0;
          const box = element.getBoundingClientRect();
          return {
            label: element.getAttribute('aria-label') || element.textContent?.trim(),
            width: Math.max(box.width, element.clientWidth + reach('left') + reach('right')),
            height: Math.max(box.height, element.clientHeight + reach('top') + reach('bottom')),
          };
        })
        .filter(({ width, height }) => width < 44 || height < 44)
        .map(({ label, width, height }) => `${label} ${Math.round(width)}x${Math.round(height)}`));
      expect.soft(small, `${board} has controls under 44 px`).toEqual([]);
    }
  });
}

test('the storage settings section and the card photo slot match their screens', async ({ page }) => {
  for (const theme of [themes[0], themes[3]]) {
    await useTheme(page, theme);
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`${fixtureOrigin}/e2e/fixtures/files-workspace.html?surface=settings`);
      await expect(page.getByText('3 files · 3.7 MB of 8 MB used')).toBeVisible({ timeout: 15_000 });
      await expect.soft(page).toHaveScreenshot(`files-settings-${theme.family}-${theme.mode}-${viewport.name}.png`, { fullPage: true, animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01 });
      await page.goto(`${fixtureOrigin}/e2e/fixtures/files-workspace.html?surface=card-edit`);
      await expect(page.getByRole('button', { name: 'Upload a photo from this device' })).toBeVisible({ timeout: 15_000 });
      await expect.soft(page).toHaveScreenshot(`files-card-photo-${theme.family}-${theme.mode}-${viewport.name}.png`, { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01 });
    }
  }
});
