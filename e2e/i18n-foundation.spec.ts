import { expect, test } from '@playwright/test';

test('preview locale override renders translated and expanded landing copy', async ({ page }) => {
  await page.goto('/?view=landing&locale=vi');
  await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
  await expect(page.getByRole('button', { name: 'Bắt đầu học' }).first()).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Điều hướng trang giới thiệu' })).toBeVisible();
  await expect(page.getByRole('img', { name: /Giao diện học SonFlash/ })).toHaveCount(1);

  await page.goto('/?view=landing&locale=pseudo');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-XA');
  await expect(page.getByRole('button', { name: /\[Śţàŕţ ĺēàŕńĩńĝ/ }).first()).toBeVisible();
});

test('stored locale change reaches another tab without a reload', async ({ context, page }) => {
  const other = await context.newPage();
  const qa = await context.newPage();
  await Promise.all([
    page.goto('/?view=landing&locale=en'),
    other.goto('/?view=landing'),
    qa.goto('/?view=landing&locale=pseudo'),
  ]);
  await expect(other.getByRole('button', { name: 'Start learning' }).first()).toBeVisible();
  await page.evaluate(() => localStorage.setItem('sonflash_ui_locale', 'vi'));
  await expect(other.locator('html')).toHaveAttribute('lang', 'vi');
  await expect(other.getByRole('button', { name: 'Bắt đầu học' }).first()).toBeVisible();
  await expect(qa.locator('html')).toHaveAttribute('lang', 'en-XA');
  await other.close();
  await qa.close();
});
