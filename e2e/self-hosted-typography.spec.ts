import { expect, test } from './fixtures/firebase-emulator';

test('Classic landing, workspace and settings use the bundled body font', async ({
  page, seedCourseProfile, signIn, blockExternalNetwork,
}) => {
  await blockExternalNetwork(page);
  await page.addInitScript(() => {
    localStorage.setItem('sonflash_theme_family', 'classic');
    localStorage.setItem('sonflash_theme_follow_system', 'false');
  });
  await page.goto('/?locale=en');
  await expect(page.locator('.landing-copy h1')).toBeVisible();
  await expect.soft(page.locator('.landing-canvas')).toHaveCSS('font-family', /^"?Geist Variable"?,/);

  await seedCourseProfile();
  await signIn(page, '/?view=settings&locale=en');
  await expect(page.locator('.settings-screen')).toBeVisible();
  for (const selector of ['.claude-app-shell', '.settings-screen']) {
    await expect.soft(page.locator(selector)).toHaveCSS('font-family', /^"?Geist Variable"?,/);
  }
  const fonts = await page.evaluate(async () => {
    const faces = await document.fonts.load('500 14px "Geist Variable"', 'English tiếng Việt');
    return faces.map(face => ({ family: face.family.replaceAll('"', ''), status: face.status }));
  });
  expect(fonts.length).toBeGreaterThan(0);
  expect(fonts.every(face => face.family === 'Geist Variable' && face.status === 'loaded')).toBe(true);
});
