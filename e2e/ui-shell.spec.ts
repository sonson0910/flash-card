import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures/firebase-emulator';

test('the first-use create action focuses the visible word field', async ({ page, seedCourseProfile, signIn, blockExternalNetwork }) => {
  // The empty library panel is under test, not the onboarding overlay that covers it without a course profile.
  await seedCourseProfile();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await blockExternalNetwork(page);
  // A fresh emulator test user already starts with zero cards; no seeding needed.
  await signIn(page, '/?view=library&locale=en');
  await expect(page.locator('[data-empty-library-panel]')).toBeVisible();
  // The overview's "Create card" action opens the Card Creator dialog
  // (cardIntakeController.openCardCreator) rather than focusing the inline
  // empty-library word input directly; the dialog's own word field takes
  // focus via its onOpenAutoFocus handler (CreateCardDialog.tsx).
  await page.locator('[data-library-create-action]').click();
  await expect(page.getByRole('textbox', { name: 'Word or phrase' })).toBeFocused();
});

test('mobile shell switches language and theme without reloading', async ({ page, seedCourseProfile, signIn }) => {
  await seedCourseProfile();
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, '/?view=library');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  const shell = page.locator('[data-shell-layer="primary"]');
  await expect(shell).toBeVisible();
  // MobileToday keeps only the brand, streak and avatar in the header: theme and language live in the account menu.
  const accountTrigger = shell.getByRole('button', { name: 'Manage library' });
  await expect(shell.getByRole('button', { name: 'Choose language' })).toBeHidden();
  await accountTrigger.click();
  const preferences = shell.getByRole('group', { name: 'Theme and language' });
  await expect(preferences).toBeVisible();

  // Escape closes a popover opened inside the account menu before the menu itself.
  await preferences.getByRole('button', { name: 'Choose language' }).click();
  const english = page.getByRole('menuitemradio', { name: 'English' });
  await expect(english).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(english).toBeHidden();
  await expect(preferences).toBeVisible();

  await preferences.getByRole('button', { name: 'Choose language' }).click();
  await page.getByRole('menuitemradio', { name: 'Tiếng Việt' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
  await expect(page.getByRole('heading', { name: 'Thư viện từ vựng' })).toBeAttached();

  const viPreferences = shell.getByRole('group', { name: 'Giao diện và ngôn ngữ' });
  if (!await viPreferences.isVisible()) await shell.getByRole('button', { name: 'Quản lý thư viện' }).click();
  const themeTrigger = viPreferences.getByRole('button', { name: 'Chọn giao diện' });
  await themeTrigger.click();
  await expect(page.getByRole('menuitemradio', { name: 'Midnight Aurora' })).toBeFocused();
  await page.getByRole('menuitemradio', { name: 'Crystal Star: Ban ngày' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-family', 'crystal');
  await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
  if (!await viPreferences.isVisible()) await shell.getByRole('button', { name: 'Quản lý thư viện' }).click();
  await viPreferences.getByRole('button', { name: 'Chuyển giữa chế độ sáng và tối' }).click();
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  await page.keyboard.press('Escape');
  await expect(viPreferences).toBeHidden();
  await expect(shell.getByRole('button', { name: 'Quản lý thư viện' })).toBeFocused();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
  await expect(page.locator('html')).toHaveAttribute('data-theme-family', 'crystal');
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
});

test('pseudo locale keeps 360px shell controls inside the viewport', async ({ page, signIn }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signIn(page, '/?view=today&locale=pseudo');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-XA');
  const shell = page.locator('[data-shell-layer="primary"]');
  await expect(shell).toBeVisible();
  const bounds = await shell.locator('button:visible').evaluateAll(buttons => buttons.map(button => {
    const rect = button.getBoundingClientRect();
    return { left: rect.left, right: rect.right, width: rect.width, height: rect.height };
  }));
  expect(bounds.length).toBeGreaterThan(0);
  expect(bounds.every(rect => rect.left >= 0 && rect.right <= 360 && rect.width >= 44 && rect.height >= 44)).toBe(true);
  expect(await shell.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});

for (const family of ['classic', 'crystal'] as const) {
  for (const mode of ['dark', 'light'] as const) {
    for (const width of [1440, 390]) {
      test(`${family} ${mode} shell fits at ${width}px`, async ({ page, signIn }) => {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.addInitScript(({ family, mode }) => {
          localStorage.setItem('sonflash_theme_family', family);
          localStorage.setItem('lingoflash_theme', mode);
        }, { family, mode });
        await signIn(page, '/?view=today&locale=en');
        const shell = page.locator('[data-shell-layer="primary"]');
        await expect(shell).toBeVisible();
        expect(await shell.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
        await page.screenshot({ path: test.info().outputPath(`shell-${family}-${mode}-${width}.png`) });
        const result = await new AxeBuilder({ page }).withRules(['color-contrast', 'aria-required-attr', 'button-name']).analyze();
        expect(result.violations.map(({ id }) => id)).toEqual([]);
      });
    }
  }
}
