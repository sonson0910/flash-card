import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    localStorage.setItem('sonflash_theme_family', 'classic');
    localStorage.setItem('lingoflash_theme', 'dark');
    localStorage.setItem('sonflash_theme_follow_system', 'false');
    localStorage.setItem('sonflash_reduced_motion', 'false');
  });
});

test('every atmosphere activates without moving the landing page', async ({ page }) => {
  await page.goto('/?view=landing');
  // The atmosphere picker sits below the fold; scroll it into view once up
  // front so Playwright's own auto-scroll-before-click (needed to reach an
  // off-screen control) isn't mistaken for page movement caused by
  // activating an atmosphere.
  await page.getByRole('button', { name: 'Golden Hour', exact: true }).scrollIntoViewIfNeeded();

  for (const [index, label] of ['Golden Hour', 'Still Water', 'Deep Woods', 'Quiet Dawn'].entries()) {
    const control = page.getByRole('button', { name: label, exact: true });
    const scrollY = await page.evaluate(() => window.scrollY);
    await control.click();

    const video = page.locator('video[data-hero-video]').nth(index);
    await expect(control).toHaveAttribute('aria-pressed', 'true');
    await expect(video).toHaveClass(/opacity-70/);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
  }
});

test('landing frame stays still and pointer clicks do not move focus', async ({ page }) => {
  await page.goto('/?view=landing');
  await page.mouse.move(0, 0);

  const trainFrame = page.locator('.train-bob');
  const framePositions: number[] = [];
  for (let sample = 0; sample < 8; sample += 1) {
    framePositions.push(await trainFrame.evaluate(element => element.getBoundingClientRect().top));
    await page.waitForTimeout(200);
  }
  expect(new Set(framePositions.map(position => position.toFixed(1))).size).toBe(1);

  const deepWoods = page.getByRole('button', { name: 'Deep Woods', exact: true });
  await deepWoods.click();
  expect(await deepWoods.evaluate(element => document.activeElement === element)).toBe(false);
});
