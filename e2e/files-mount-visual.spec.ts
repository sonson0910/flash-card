import { expect, test } from './fixtures/firebase-emulator';
import type { Page, TestInfo } from '@playwright/test';

// My files and the storage settings section inside the signed-in app shell, compared with the
// UploadStates and AnimeUploadStates boards (Phase14 Classic/Crystal Files*).
const themes = [
  { family: 'classic', mode: 'light' }, { family: 'classic', mode: 'dark' },
  { family: 'crystal', mode: 'light' }, { family: 'crystal', mode: 'dark' },
] as const;
const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

async function prepareTheme(page: Page, theme: (typeof themes)[number], viewport: (typeof viewports)[number]) {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ colorScheme: theme.mode, reducedMotion: 'reduce' });
  await page.addInitScript(({ family, mode }) => {
    localStorage.setItem('sonflash_theme_family', family);
    localStorage.setItem('lingoflash_theme', mode);
    localStorage.setItem('sonflash_theme_follow_system', 'false');
    localStorage.setItem('sonflash_reduced_motion', 'true');
  }, theme);
}

async function expectScreen(page: Page, testInfo: TestInfo, name: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${name} has horizontal overflow`).toBeLessThanOrEqual(1);
  const screenshot = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: screenshot, fullPage: true, animations: 'disabled', caret: 'hide' });
  await testInfo.attach(name, { path: screenshot, contentType: 'image/png' });
  await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true, animations: 'disabled', caret: 'hide' });
}

for (const theme of themes) for (const viewport of viewports) {
  test(`${theme.family} ${theme.mode} My files fills the workspace like the upload boards at ${viewport.name}`, async ({ page, seedCourseProfile, signIn, blockExternalNetwork }, testInfo) => {
    await seedCourseProfile({ targetLanguage: 'ko' });
    await prepareTheme(page, theme, viewport);
    await blockExternalNetwork(page);
    await signIn(page, '/?view=files&locale=en');
    await expect(page.locator('html')).toHaveAttribute('data-theme-family', theme.family);
    const shelf = page.getByRole('complementary', { name: 'My files' });
    await expect(shelf.getByText('No files yet')).toBeVisible();
    await expect(page.getByRole('meter', { name: 'Storage usage' }).first()).toHaveAttribute('aria-valuetext', '0 B of 100 MB used');
    await expect(page.getByRole('heading', { name: 'Choose a file' })).toBeVisible();

    // The page reaches the bottom of the workspace (above the floating bar on phones) without a scroll.
    const fit = await page.evaluate(() => {
      const workspace = document.getElementById('learning-workspace')!;
      const files = document.querySelector('.sf-files')!.getBoundingClientRect();
      const bar = document.querySelector('.claude-mobile-nav');
      const barTop = bar && getComputedStyle(bar).display !== 'none' ? bar.getBoundingClientRect().top : workspace.getBoundingClientRect().bottom;
      return { scroll: workspace.scrollHeight - workspace.clientHeight, gap: Math.round(barTop - files.bottom) };
    });
    expect(fit.scroll, 'My files scrolls inside the workspace').toBeLessThanOrEqual(1);
    expect(fit.gap, 'My files leaves space under the page').toBeGreaterThanOrEqual(0);
    expect(fit.gap, 'My files leaves space under the page').toBeLessThanOrEqual(1);
    await expectScreen(page, testInfo, `files-page-${theme.family}-${theme.mode}-${viewport.name}`);
  });

  test(`${theme.family} ${theme.mode} storage settings section at ${viewport.name}`, async ({ page, seedCourseProfile, signIn, blockExternalNetwork }, testInfo) => {
    await seedCourseProfile({ targetLanguage: 'ko' });
    await prepareTheme(page, theme, viewport);
    await blockExternalNetwork(page);
    await signIn(page, '/?view=settings&section=files&locale=en');
    await expect(page.getByRole('heading', { level: 1, name: 'Storage & files' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Storage and files' }).getByText('0 files · 0 B of 100 MB used')).toBeVisible();
    await expectScreen(page, testInfo, `files-settings-section-${theme.family}-${theme.mode}-${viewport.name}`);
  });
}
