import { expect, test } from '@playwright/test';

test('landing uses the local memory object and a complete product story', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?view=landing');

  await expect(page.getByRole('main')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Words stay with you.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start learning' }).first()).toBeInViewport();
  await expect(page.locator('[data-hero-image]')).toHaveAttribute('src', /sonflash-memory-object-v2\.webp/);
  await expect(page.locator('video')).toHaveCount(0);
  await expect(page.locator('[data-journey-card]')).toHaveCount(4);
  await expect(page.locator('[data-system-bento] > article')).toHaveCount(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('landing preserves the mobile navigation contract and desktop target sizes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?view=landing');

  const mobileMenu = page.locator('summary[aria-label="Open navigation menu"]');
  await mobileMenu.click();
  const mobileNavigation = page.getByRole('navigation', { name: 'Mobile navigation' });
  await expect(mobileNavigation.getByRole('link', { name: 'AI Features' })).toBeVisible();
  await expect(mobileNavigation.getByRole('link', { name: 'FSRS Method' })).toBeVisible();
  await expect(mobileNavigation.getByRole('button', { name: 'Curriculum' })).toBeVisible();
  await expect(mobileNavigation.getByRole('button', { name: 'Vocabulary Library' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(mobileMenu).toBeFocused();

  await page.setViewportSize({ width: 1024, height: 900 });
  const desktopTargets = page.getByRole('navigation', { name: 'Landing navigation' }).locator('a, button');
  const targetHeights = await desktopTargets.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height));
  expect(targetHeights.every(height => height >= 44)).toBe(true);
});

test('landing keeps every journey stage in document flow with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto('/?view=landing');

  const cards = page.locator('[data-journey-card]');
  const documentTops = await cards.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().top + window.scrollY));
  expect(new Set(documentTops.map(top => Math.round(top))).size).toBe(4);
  await expect(cards.getByRole('heading', { name: 'Reach for it naturally.' })).toBeVisible();
});

test('landing uses the static journey below the large-screen breakpoint', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto('/?view=landing');

  const cards = page.locator('[data-journey-card]');
  const documentTops = await cards.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().top + window.scrollY));
  expect(new Set(documentTops.map(top => Math.round(top))).size).toBe(4);
  await expect(page.locator('.pin-spacer')).toHaveCount(0);
  await cards.first().scrollIntoViewIfNeeded();
  await expect(cards.first().getByRole('heading', { name: 'Save the moment you met it.' })).toBeVisible();
});
