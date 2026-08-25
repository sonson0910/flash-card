import { expect, test } from '@playwright/test';

const cloudRequest = /firebase|googleapis|recaptcha|identitytoolkit|securetoken|\/api\/device-cards/i;
const runtimeCloudScript = /\/assets\/(?:AppRuntime|firebase|firebase-functions)[^/]*\.js$/i;

test('cold landing is cloud-free and warm runtime stays mounted across navigation', async ({ page }) => {
  const requests: string[] = [];
  let documentRequests = 0;
  page.on('request', request => {
    requests.push(request.url());
    if (request.resourceType() === 'document') documentRequests += 1;
  });

  await page.goto('/?view=landing');

  expect(requests.filter(url => cloudRequest.test(url))).toEqual([]);
  const videos = page.locator('video[data-hero-video]');
  await expect(videos).toHaveCount(4);
  for (let index = 0; index < 4; index += 1) {
    const sources = videos.nth(index).locator('source');
    await expect(sources).toHaveCount(2);
    await expect(sources.nth(0)).toHaveAttribute('type', 'video/mp4; codecs="av01.0.08M.08"');
    await expect(sources.nth(1)).toHaveAttribute('type', 'video/mp4; codecs="avc1.640028"');
  }

  await page.getByRole('button', { name: 'Start Learning', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();

  await page.getByRole('button', { name: 'Home', exact: true }).click();
  await expect(page.locator('video[data-hero-video]')).toHaveCount(4);
  await page.getByRole('button', { name: 'Vocabulary Library', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Vocabulary library' })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('view')).toBe('library');
  const runtimeScriptRequests = requests.filter(url => runtimeCloudScript.test(url));
  const requestCounts = new Map<string, number>();
  runtimeScriptRequests.forEach(url => requestCounts.set(url, (requestCounts.get(url) ?? 0) + 1));
  expect([...requestCounts.entries()].filter(([, count]) => count > 1)).toEqual([]);
  // Hook/controller identity is intentionally not instrumented in production;
  // one document request plus one load of each runtime cloud script is the
  // strongest observable no-reload/no-duplicate-init contract here.
  expect(documentRequests).toBe(1);
});
