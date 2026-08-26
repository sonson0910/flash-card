import { expect, test } from '@playwright/test';

test('every atmosphere plays without moving the landing page', async ({ page }) => {
  await page.goto('/?view=landing');

  for (const [index, label] of ['Golden Hour', 'Still Water', 'Deep Woods', 'Quiet Dawn'].entries()) {
    const control = page.getByRole('button', { name: label, exact: true });
    await control.scrollIntoViewIfNeeded();
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
