import { expect, test } from '@playwright/test';

test('denied Web Storage does not crash guest startup, navigation, or Progress', async ({ page }) => {
  await page.addInitScript(() => {
    const denied = () => { throw new DOMException('Access denied', 'SecurityError'); };
    Object.defineProperties(Storage.prototype, {
      getItem: { configurable: true, value: denied },
      setItem: { configurable: true, value: denied },
      removeItem: { configurable: true, value: denied },
    });
  });

  await page.goto('/?view=library');
  await expect(page.getByRole('heading', { name: 'Your library' })).toBeVisible();
  await expect(page.getByText('SonFlash needs a reload')).toHaveCount(0);

  await page.getByRole('button', { name: 'Progress' }).first().click();
  await expect(page.getByRole('heading', { name: 'Progress' })).toBeVisible();
  await expect(page.getByText('Complete a review to begin your progress history.')).toBeVisible();
  await expect(page.getByText('SonFlash needs a reload')).toHaveCount(0);
});
