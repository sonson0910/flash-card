import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures/firebase-emulator';
import type { Page, TestInfo } from '@playwright/test';

const fixedTime = new Date('2026-09-27T12:00:00.000Z');
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

async function expectAccessibleAndContained(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label} has horizontal overflow`).toBeLessThanOrEqual(1);
  const clipped = await page.locator('button:visible, input:visible, a:visible').evaluateAll(elements => elements
    .map(element => {
      const box = element.getBoundingClientRect();
      return { label: element.getAttribute('aria-label') || element.textContent?.trim(), left: box.left, right: box.right, width: box.width, height: box.height };
    })
    .filter(control => control.width > 0 && control.height > 0 && (control.left < -1 || control.right > window.innerWidth + 1)));
  expect(clipped, `${label} has horizontally clipped controls`).toEqual([]);

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const blocking = results.violations.filter(violation => violation.impact === 'serious' || violation.impact === 'critical');
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

async function attachDialog(page: Page, testInfo: TestInfo, name: string) {
  const dialog = page.getByRole('dialog');
  const screenshot = testInfo.outputPath(`${name}.png`);
  await dialog.screenshot({ path: screenshot, animations: 'disabled', caret: 'hide' });
  await testInfo.attach(name, { path: screenshot, contentType: 'image/png' });
}

async function openManagementMenu(page: Page) {
  await page.getByRole('button', { name: 'Manage library' }).click();
  await expect(page.getByRole('menu', { name: 'Library management' })).toBeVisible();
}

for (const theme of themes) for (const viewport of viewports) {
  test(`${theme.family} ${theme.mode} account and plan dialogs match the signed-in shell at ${viewport.name}`, async ({ page, seedCourseProfile, signIn, blockExternalNetwork }, testInfo) => {
    await page.clock.install({ time: fixedTime });
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: theme.mode, reducedMotion: 'reduce' });
    await blockExternalNetwork(page);
    await page.addInitScript(({ family, mode }) => {
      localStorage.setItem('sonflash_theme_family', family);
      localStorage.setItem('lingoflash_theme', mode);
      localStorage.setItem('sonflash_theme_follow_system', 'false');
      localStorage.setItem('sonflash_reduced_motion', 'true');
    }, theme);
    await seedCourseProfile();
    await signIn(page, '/?view=library&locale=en');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await openManagementMenu(page);
    await page.getByRole('menuitem', { name: 'See Pro plan' }).click();
    await expect(page.getByRole('heading', { name: 'Add momentum to your learning' })).toBeVisible();
    await expect(page.getByText('Loading plan details…')).toBeHidden();
    await expectAccessibleAndContained(page, `${theme.family}-${theme.mode}-${viewport.name}-plan-dialog`);
    await attachDialog(page, testInfo, `landing-plan-${theme.family}-${theme.mode}-${viewport.name}`);
    await page.getByRole('button', { name: 'Close' }).first().click();
    await expect(page.getByRole('dialog')).toBeHidden();

    await openManagementMenu(page);
    await page.getByRole('menuitem', { name: 'Account data' }).click();
    await expect(page.getByRole('heading', { name: 'Account data' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download account data (JSON)' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Delete my account' })).toBeEnabled();
    await expectAccessibleAndContained(page, `${theme.family}-${theme.mode}-${viewport.name}-account-dialog`);
    await attachDialog(page, testInfo, `landing-account-${theme.family}-${theme.mode}-${viewport.name}`);
  });
}
