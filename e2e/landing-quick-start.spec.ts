import { expect, test } from '@playwright/test';

test.skip(({ browserName }) => browserName !== 'chromium', 'Landing integration runs on Chromium.');

test('landing does not preload or request the authenticated Firebase runtime', async ({ page }) => {
  const requestedUrls: string[] = [];
  page.on('request', request => requestedUrls.push(request.url()));

  await page.goto('/?view=landing');
  await expect(page.getByRole('heading', { name: /Master Vocabulary/ })).toBeVisible();

  const preloadedFirebase = await page.locator('link[rel="modulepreload"]').evaluateAll(links =>
    links.some(link => /firebase/i.test(link.getAttribute('href') ?? '')),
  );
  const eagerProviderPreconnects = await page.locator('link[rel="preconnect"]').evaluateAll(links =>
    links.map(link => link.getAttribute('href') ?? '')
      .filter(href => /(?:apis\.google\.com|firebaseapp\.com)/i.test(href)),
  );
  expect(preloadedFirebase).toBe(false);
  expect(requestedUrls.some(url => /firebase/i.test(url))).toBe(false);
  expect(eagerProviderPreconnects).toEqual([]);
});

test('Landing Quick Start carries the mounted draft into the real Library form', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const generationRequests: string[] = [];
  page.on('request', request => {
    if (request.url().includes('generateVocabulary')) generationRequests.push(request.url());
  });
  await page.addInitScript(() => {
    localStorage.clear();
  });

  await page.goto('/?view=landing');
  const landingInput = page.getByRole('textbox', { name: 'Enter word' });
  await expect(landingInput).toBeVisible();
  await landingInput.fill('  你好 · Serendipity  ');
  await page.getByRole('button', { name: 'Start Now' }).click();

  await expect(page).toHaveURL(/\?view=library$/);
  await expect(page.getByRole('heading', { name: 'Your library' })).toBeVisible();
  await expect(page.locator('#new-word')).toHaveValue('你好 · Serendipity');
  expect(generationRequests).toEqual([]);
});
