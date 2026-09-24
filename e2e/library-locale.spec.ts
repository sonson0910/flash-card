import { expect, test } from '@playwright/test';

test('first Vietnamese library visit and live English switch translate the create surface', async ({ page }) => {
  await page.goto('/?view=library&locale=vi');

  const overview = page.locator('[data-library-region="overview"]');
  const wordInput = page.locator('#new-word');
  await expect(overview.getByRole('heading', { name: 'Thư viện của bạn' })).toBeVisible();
  await expect(wordInput).toHaveAttribute('placeholder', /Nhập một từ tiếng Anh/);
  await expect(wordInput).toHaveAttribute('lang', 'en');

  await page.getByRole('button', { name: 'Chọn ngôn ngữ' }).click();
  await page.getByRole('menuitemradio', { name: 'English' }).click();

  await expect(overview.getByRole('heading', { name: 'Your library' })).toBeVisible();
  await expect(wordInput).toHaveAttribute('placeholder', 'Type an English word (e.g. serendipity)…');
  await expect(wordInput).toHaveAttribute('lang', 'en');
});
