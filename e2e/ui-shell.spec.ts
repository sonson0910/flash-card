import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('mobile shell switches language and theme without reloading', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?view=library');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  const shell = page.locator('[data-shell-layer="primary"]');
  await expect(shell).toBeVisible();

  await shell.getByRole('button', { name: 'Choose language' }).click();
  const english = page.getByRole('menuitemradio', { name: 'English' });
  await expect(english).toBeFocused();
  await page.getByRole('menuitemradio', { name: 'Tiếng Việt' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
  await expect(page.getByRole('heading', { name: 'Thư viện từ vựng' })).toBeAttached();

  const themeTrigger = shell.getByRole('button', { name: 'Chọn giao diện' });
  await themeTrigger.click();
  await expect(page.getByRole('menuitemradio', { name: 'Midnight Aurora' })).toBeFocused();
  await page.getByRole('menuitemradio', { name: 'Crystal Star: Ban ngày' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-family', 'crystal');
  await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
  await shell.getByRole('button', { name: 'Chuyển giữa chế độ sáng và tối' }).click();
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
  await expect(page.locator('html')).toHaveAttribute('data-theme-family', 'crystal');
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
});

test('pseudo locale keeps 360px shell controls inside the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?view=today&locale=pseudo');
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
      test(`${family} ${mode} shell fits at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.addInitScript(({ family, mode }) => {
          localStorage.setItem('sonflash_theme_family', family);
          localStorage.setItem('lingoflash_theme', mode);
        }, { family, mode });
        await page.goto('/?view=today&locale=en');
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
