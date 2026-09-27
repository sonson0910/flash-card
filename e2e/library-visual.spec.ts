import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

// Base port for this spec's own Vite fixture server, offset per-worker below.
// See practice-visual.spec.ts for why: `fullyParallel: false` still lets
// different spec files run concurrently on separate workers, and four
// unrelated -visual specs each bound a strictPort Vite server to this exact
// literal port, so two running on different workers at once raced for the
// same socket.
const FIXTURE_PORT_BASE = 4275;
let fixturePort = FIXTURE_PORT_BASE;
let fixtureOrigin = `http://127.0.0.1:${fixturePort}`;
const fixturePath = '/e2e/fixtures/library-visual.html';
const themes = [
  { family: 'classic', mode: 'light' }, { family: 'classic', mode: 'dark' },
  { family: 'crystal', mode: 'light' }, { family: 'crystal', mode: 'dark' },
] as const;

async function gotoFixture(page: Page, query = 'locale=en') {
  const url = `${fixtureOrigin}${fixturePath}?${query}`;
  await page.goto(url);
  const root = page.locator('[data-library-visual-view]');
  if (await root.isVisible({ timeout: 5_000 }).catch(() => false)) return;

  // Vite can serve the first dependency-optimization request before its module graph is ready.
  await page.reload();
  await expect(root).toBeVisible({ timeout: 15_000 });
}
const viewports = [{ name: 'desktop', width: 1440, height: 900 }, { name: '390px', width: 390, height: 844 }] as const;

let fixtureServer: ViteDevServer | undefined;

async function expectAccessibleAndContained(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label} has horizontal overflow`).toBeLessThanOrEqual(1);
  const clipped = await page.locator('button:visible, input:visible, select:visible, textarea:visible').evaluateAll(elements => elements.map(element => {
    const box = element.getBoundingClientRect();
    return { label: element.getAttribute('aria-label') || element.textContent?.trim(), left: box.left, right: box.right, width: box.width, height: box.height };
  }).filter(control => control.width > 0 && control.height > 0 && (control.left < -1 || control.right > window.innerWidth + 1)));
  expect(clipped, `${label} has horizontally clipped controls`).toEqual([]);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const blocking = results.violations.filter(violation => violation.impact === 'serious' || violation.impact === 'critical');
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

async function expectReducedMotion(page: Page, label: string) {
  const animations = await page.evaluate(() => document.getAnimations().filter(animation => Number(animation.effect?.getComputedTiming().duration ?? 0) > 1).map(animation => animation.effect instanceof KeyframeEffect && animation.effect.target instanceof Element ? getComputedStyle(animation.effect.target).animationName : 'unnamed animation'));
  expect(animations, `${label} starts motion despite reduced-motion preference`).toEqual([]);
}

async function expectScreen(page: Page, testInfo: TestInfo, name: string) {
  await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true, animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01 });
  const screenshot = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach(name, { path: screenshot, contentType: 'image/png' });
}

async function expectDialogScreen(page: Page, testInfo: TestInfo, name: string) {
  const dialog = page.locator('[role="dialog"], [role="alertdialog"]').last();
  await expect(dialog).toHaveScreenshot(`${name}.png`, { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01 });
  const screenshot = testInfo.outputPath(`${name}.png`);
  await dialog.screenshot({ path: screenshot });
  await testInfo.attach(name, { path: screenshot, contentType: 'image/png' });
}

test.beforeAll(async ({}, testInfo) => {
  fixturePort = FIXTURE_PORT_BASE + testInfo.parallelIndex;
  fixtureOrigin = `http://127.0.0.1:${fixturePort}`;
  fixtureServer = await createServer({ configFile: 'vite.config.ts', cacheDir: `node_modules/.vite-e2e/library-visual-${testInfo.parallelIndex}`, appType: 'mpa', server: { host: '127.0.0.1', port: fixturePort, strictPort: true }, optimizeDeps: { entries: ['e2e/fixtures/library-visual.html'] } });
  await fixtureServer.listen();
});
test.afterAll(async () => { await fixtureServer?.close(); });

test('Library create input defers submit during IME composition', async ({ page }) => {
  await gotoFixture(page);
  // LibraryScreen.tsx now tucks LibraryTools (and its #new-word input) inside
  // a closed-by-default <details data-library-region="tools"> disclosure —
  // the primary create-card path is the dialog opened from LibraryOverview's
  // "Create card" button. Expand it before the input becomes visible.
  await page.locator('[data-library-region="tools"] summary').click();
  const input = page.locator('#new-word');
  const count = page.locator('[data-library-generate-count]');
  await expect(input).toBeVisible({ timeout: 15_000 });
  await input.dispatchEvent('compositionstart');
  await input.press('Enter');
  await expect(count).toHaveText('0');
  await input.dispatchEvent('compositionend');
  await input.press('Enter');
  await expect(count).toHaveText('1');
});

for (const theme of themes) for (const viewport of viewports) {
  test(`${theme.family} ${theme.mode} Library and dialogs are visually accessible at ${viewport.name}`, async ({ page }, testInfo) => {
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
    const name = `library-${theme.family}-${theme.mode}-${viewport.name}`;
    await gotoFixture(page);
    await expect(page.locator('[data-library-visual-view]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#new-word')).toHaveAttribute('lang', 'en');
    await expect(page.locator('#new-word')).toHaveAttribute('inputmode', 'text');
    await expect(page.locator('html')).toHaveAttribute('data-theme-family', theme.family);
    if (theme.mode === 'dark') await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    else await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
    if (theme.family === 'crystal') await expect(page.locator('#sonflash-crystal-theme')).toHaveAttribute('href', '/theme-crystal.css');
    if (theme.family === 'crystal') await expect(page.locator('.library-word-grade').first()).toBeVisible();
    else await expect(page.locator('.library-word-grade').first()).toBeHidden();
    await expectAccessibleAndContained(page, name);
    await expectReducedMotion(page, name);
    await expectScreen(page, testInfo, name);

    // LibraryScreen.tsx now tucks LibraryTools (and its "AI Dialogue"/"Scan
    // Text" buttons) inside a closed-by-default <details data-library-region="tools">
    // disclosure — see the IME test above for the same pattern.
    await page.locator('[data-library-region="tools"] summary').click();
    await page.getByRole('button', { name: 'AI Dialogue' }).click();
    await expect(page.getByRole('heading', { name: 'Practice in context' })).toBeVisible();
    await expectAccessibleAndContained(page, `${name}-dialogue`);
    await expectReducedMotion(page, `${name}-dialogue`);
    await expectScreen(page, testInfo, `${name}-dialogue`);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();

    await page.getByRole('button', { name: 'Scan Text' }).click();
    await expect(page.getByRole('heading', { name: 'Scan text' })).toBeVisible();
    await expectAccessibleAndContained(page, `${name}-extractor`);
    await expectReducedMotion(page, `${name}-extractor`);
    await expectScreen(page, testInfo, `${name}-extractor`);
  });
}

const dialogViews = [
  ['edit', 'Edit card'], ['deck-delete', /Delete “IELTS” deck/],
  // AppOverlays.tsx's share dialog title is now dynamic: outgoing shows
  // `Share "{category}"` (shell.share.outgoing-title), incoming shows the
  // category name alone as the heading (with a "Shared with you" kicker
  // above it) instead of a generic "Review shared deck"/"ready to share"
  // phrase. The fixture (library-visual.tsx) always uses category "IELTS".
  ['share', 'Share “IELTS”'], ['share-in', 'IELTS'],
  ['clear', 'Clear the entire library?'], ['insights', 'Learning insights'],
] as const;
const inlineViews = [['import', 'Import cards']] as const;

for (const theme of themes) for (const viewport of viewports) {
  test(`${theme.family} ${theme.mode} Library dialog surfaces are visually accessible at ${viewport.name}`, async ({ page }, testInfo) => {
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
    for (const [dialog, title] of dialogViews) {
      const name = `library-${dialog}-${theme.family}-${theme.mode}-${viewport.name}`;
      await gotoFixture(page, `locale=en&dialog=${dialog}`);
      await expect(page.getByRole(dialog === 'clear' || dialog === 'deck-delete' ? 'alertdialog' : 'dialog')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('heading', { name: title })).toBeVisible();
      await expectAccessibleAndContained(page, name);
      await expectReducedMotion(page, name);
      if (dialog === 'edit') {
        const backdropPreview = page.locator('[data-edit-preview-backdrop]');
        const sheetPreview = page.locator('[data-edit-preview]');
        if (viewport.name === 'desktop') {
          await expect(backdropPreview).toBeVisible();
          await expect(sheetPreview).toBeHidden();
          const previewLayer = await backdropPreview.evaluate(element => Number(getComputedStyle(element).zIndex));
          const overlayLayer = await page.locator('[data-edit-overlay]').evaluate(element => Number(getComputedStyle(element).zIndex));
          expect(previewLayer).toBeGreaterThan(overlayLayer);
        } else {
          await expect(backdropPreview).toBeHidden();
          await expect(sheetPreview).toBeVisible();
        }
        const screenshot = testInfo.outputPath(`${name}-page.png`);
        await page.screenshot({ path: screenshot, fullPage: true, animations: 'disabled', caret: 'hide' });
        await testInfo.attach(`${name}-page`, { path: screenshot, contentType: 'image/png' });
      }
      await expectDialogScreen(page, testInfo, name);
    }
  });
}

for (const theme of themes) for (const viewport of viewports) {
  test(`${theme.family} ${theme.mode} Library inline tools are visually accessible at ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: theme.mode, reducedMotion: 'reduce' });
    await page.route(new RegExp(`^https?://(?!127\\.0\\.0\\.1:${fixturePort})`), route => route.abort());
    await page.addInitScript(({ family, mode }) => {
      localStorage.setItem('sonflash_theme_family', family);
      localStorage.setItem('lingoflash_theme', mode);
      localStorage.setItem('sonflash_theme_follow_system', 'false');
      localStorage.setItem('sonflash_reduced_motion', 'true');
    }, theme);
    for (const [dialog, title] of inlineViews) {
      const name = `library-${dialog}-${theme.family}-${theme.mode}-${viewport.name}`;
      await gotoFixture(page, `locale=en&dialog=${dialog}`);
      const surface = page.locator('[data-library-inline-visual]');
      await expect(surface).toBeVisible({ timeout: 15_000 });
      await expect(surface.getByRole('heading', { name: title })).toBeVisible();
      await expectAccessibleAndContained(page, name);
      await expectReducedMotion(page, name);
      await expect(surface).toHaveScreenshot(`${name}.png`, { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01 });
      const screenshot = testInfo.outputPath(`${name}.png`);
      await surface.screenshot({ path: screenshot });
      await testInfo.attach(name, { path: screenshot, contentType: 'image/png' });
    }
  });
}
