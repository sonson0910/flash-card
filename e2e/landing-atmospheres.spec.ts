import { expect, test } from '@playwright/test';

test('every atmosphere plays without moving the landing page', async ({ page }) => {
  await page.goto('/?view=landing');

  for (const [index, label] of ['Golden Hour', 'Still Water', 'Deep Woods', 'Quiet Dawn'].entries()) {
    const control = page.getByRole('button', { name: label, exact: true });
    const scrollY = await page.evaluate(() => window.scrollY);
    await control.click();

    const video = page.locator('video[data-hero-video]').nth(index);
    await expect.poll(() => video.evaluate(element => ({
      paused: (element as HTMLVideoElement).paused,
      readyState: (element as HTMLVideoElement).readyState,
    }))).toMatchObject({ paused: false, readyState: 4 });
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

test('landing reveals the learning story as sections enter the viewport', async ({ page }) => {
  await page.goto('/?view=landing');

  for (const reveal of [
    page.locator('[data-landing-reveal="feature-row"]').first(),
    page.locator('[data-landing-reveal="method-preview"]'),
    page.locator('[data-landing-reveal="closing"]'),
  ]) {
    await reveal.scrollIntoViewIfNeeded();
    await expect(reveal).toHaveAttribute('data-landing-reveal-state', 'ready');
  }
});

test('landing keeps reveal content visible when the observer is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(globalThis, 'IntersectionObserver', { configurable: true, value: undefined });
  });
  await page.goto('/?view=landing');

  const reveals = page.locator('[data-landing-reveal]');
  await expect(reveals).toHaveCount(6);
  await expect.poll(() => reveals.evaluateAll(elements => elements.every(element => (
    element.getAttribute('data-landing-reveal-state') === 'ready'
    && getComputedStyle(element).opacity === '1'
  )))).toBe(true);
});
