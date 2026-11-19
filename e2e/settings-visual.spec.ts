import { expect, test } from './fixtures/firebase-emulator';
import type { Page, TestInfo } from '@playwright/test';

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

async function expectSettingsScreen(page: Page, testInfo: TestInfo, name: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${name} has horizontal overflow`).toBeLessThanOrEqual(1);
  const smallTargets = await page.locator('[data-async-content="settings"]').locator('button:visible, select:visible, [role="switch"]:visible').evaluateAll(elements => elements
    .map(element => {
      const box = (element.getAttribute('role') === 'switch' ? element.closest('label, .ss-row') ?? element : element).getBoundingClientRect();
      return { label: element.getAttribute('aria-label') || element.textContent?.trim(), height: box.height };
    })
    .filter(control => control.height < 44));
  expect(smallTargets, `${name} keeps 44px targets`).toEqual([]);
  const screenshot = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: screenshot, fullPage: true, animations: 'disabled', caret: 'hide' });
  await testInfo.attach(name, { path: screenshot, contentType: 'image/png' });
  await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true, animations: 'disabled', caret: 'hide' });
}

for (const theme of themes) for (const viewport of viewports) {
  test(`${theme.family} ${theme.mode} reminder settings match the board at ${viewport.name}`, async ({ page, seedCourseProfile, signIn, blockExternalNetwork }, testInfo) => {
    await seedCourseProfile({ targetLanguage: 'ko' });
    await prepareTheme(page, theme, viewport);
    await blockExternalNetwork(page);
    await signIn(page, '/?view=settings&locale=en');
    const sections = page.getByRole('navigation', { name: 'Settings sections' });
    await sections.getByRole('button', { name: 'Reminders' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'A nudge, not a nag.' })).toBeVisible();
    const reminders = page.getByRole('region', { name: 'Study reminders' });
    await expect(reminders.getByLabel('Send at')).toBeVisible();
    await expect(reminders.getByRole('checkbox')).toHaveCount(7);
    await expect(reminders.getByRole('switch', { name: /Smart reminder/ })).toBeVisible();
    await expect(reminders.getByRole('switch', { name: /Browser push/ })).toBeVisible();
    await expect(reminders.getByRole('switch', { name: /Weekly digest/ })).toBeVisible();
    const preview = reminders.getByRole('complementary', { name: 'Live preview' });
    if (viewport.name === 'desktop') await expect(preview).toBeVisible();
    await expect(preview.getByText('Extension badge shows cards due, right in your toolbar.')).toBeAttached();
    await expect(page.getByRole('switch', { name: /Study sounds/ })).toBeVisible();
    await expectSettingsScreen(page, testInfo, `settings-reminders-${theme.family}-${theme.mode}-${viewport.name}`);
  });

  test(`${theme.family} ${theme.mode} language settings match the board at ${viewport.name}`, async ({ page, seedCourseProfile, signIn, blockExternalNetwork }, testInfo) => {
    await seedCourseProfile({ targetLanguage: 'ko' });
    await prepareTheme(page, theme, viewport);
    await blockExternalNetwork(page);
    await signIn(page, '/?view=settings&locale=en');
    await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Language & courses' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Language & courses' })).toBeVisible();
    const language = page.getByRole('region', { name: 'Language & courses' });
    await expect(language.getByLabel('App language').first()).toBeVisible();
    await expect(language.getByRole('radio', { name: /^Vietnamese/ })).toBeChecked();
    await expect(language.locator('[data-settings-active-course]')).toContainText('Korean ← Vietnamese');
    await expect(language.getByRole('button', { name: /Add a language/ })).toBeVisible();
    await expectSettingsScreen(page, testInfo, `settings-language-${theme.family}-${theme.mode}-${viewport.name}`);
  });
}
