import { expect, test } from '@playwright/test';

test.skip(({ browserName }) => browserName !== 'chromium', 'Landing interaction coverage runs on Chromium.');

test('desktop Landing CTAs click through to their implemented destinations', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.clear());

  const cases = [
    { name: 'Curriculum', view: 'catalog' },
    { name: 'Vocabulary Library', view: 'library' },
    { name: 'Start Learning', view: 'today' },
    { name: 'Experience FSRS Now', view: 'today' },
    { name: 'Start Learning Free', view: 'today' },
  ] as const;

  for (const { name, view } of cases) {
    await page.goto('/?view=landing');
    await expect(page.getByRole('heading', { name: /Master Vocabulary/ })).toBeVisible();
    await page.getByRole('button', { name, exact: true }).click();
    if (view === 'today') {
      await expect(page).toHaveURL(/\/$/);
    } else {
      await expect(page).toHaveURL(new RegExp(`\\?view=${view}$`));
    }
  }
});

test('mobile Landing menu CTAs support keyboard activation', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => localStorage.clear());

  const cases = [
    { name: 'Curriculum', view: 'catalog' },
    { name: 'Vocabulary Library', view: 'library' },
    { name: 'Start Learning', view: 'today' },
  ] as const;

  await page.goto('/?view=landing');
  for (const [index, { name, view }] of cases.entries()) {
    const menuToggle = page.locator('header button[aria-label]');
    await expect(menuToggle).toHaveAttribute('aria-label', 'Open menu');
    await menuToggle.focus();
    await page.keyboard.press('Enter');
    await expect(menuToggle).toHaveAttribute('aria-expanded', 'true');

    const cta = page.getByRole('button', { name, exact: true });
    await expect(cta).toHaveCount(1);
    await cta.focus();
    await page.keyboard.press('Enter');
    if (view === 'today') {
      await expect(page).toHaveURL(/\/$/);
    } else {
      await expect(page).toHaveURL(new RegExp(`\\?view=${view}$`));
    }
    if (index < cases.length - 1) {
      await page.goBack();
      await expect(page.getByRole('heading', { name: /Master Vocabulary/ })).toBeVisible();
    }
  }
});
