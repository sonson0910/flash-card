import { expect, test } from '@playwright/test';

test.skip(({ browserName }) => browserName !== 'chromium', 'Mobile navigation runs on Chromium.');

test('mobile production navigation exposes Paths and stays usable at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    localStorage.clear();
  });

  await page.goto('/?view=today');
  const navigation = page.getByRole('navigation', { name: 'Mobile navigation bar' });
  await expect(navigation).toBeVisible();

  const navButtons = navigation.getByRole('button');
  await expect(navButtons).toHaveCount(4);
  const touchTargets = await navButtons.evaluateAll(buttons => buttons.map(button => {
    const bounds = button.getBoundingClientRect();
    return { height: bounds.height, width: bounds.width };
  }));
  expect(touchTargets.every(target => target.height >= 44 && target.width >= 44)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  const paths = navigation.getByRole('button', { name: 'Learning paths' });
  await paths.click();
  await expect(page).toHaveURL(/\?view=catalog$/);
  await expect(page.getByRole('heading', { name: 'Language paths' })).toBeVisible();
  await expect(paths).toHaveAttribute('aria-current', 'page');
});
