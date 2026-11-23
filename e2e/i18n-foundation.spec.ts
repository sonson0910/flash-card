import { expect, test } from '@playwright/test';

test('preview locale override renders translated and expanded landing copy', async ({ page }) => {
  await page.goto('/?view=landing&locale=vi');
  await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
  await expect(page.getByRole('button', { name: 'Bắt đầu học' }).first()).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Điều hướng trang giới thiệu' })).toBeVisible();
  // The hero demo card is a decorative <aside aria-label="..."> (role
  // "complementary"), not an <img> with translated alt text — the redesigned
  // landing hero conveys the demo content as text/markup instead of an image.
  await expect(page.getByRole('complementary', { name: 'Thẻ từ vựng tiếng Anh mẫu' })).toHaveCount(1);

  await page.goto('/?view=landing&locale=pseudo');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-XA');
  // expandPseudoCatalog (src/i18n/pseudo.ts) only brackets and pads text for
  // layout-expansion checks; it does not transliterate characters, matching
  // the un-accented `/\[New/` pseudo expectation flashcard-locale.spec.ts
  // already asserts for the same catalog.
  await expect(page.getByRole('button', { name: /\[Start learning/ }).first()).toBeVisible();
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
