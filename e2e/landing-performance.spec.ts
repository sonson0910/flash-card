import { expect, test } from '@playwright/test';

const cloudRequest = /firebase|googleapis|recaptcha|identitytoolkit|securetoken|\/api\/device-cards/i;
const runtimeCloudScript = /\/assets\/(?:AppRuntime|firebase|firebase-functions)[^/]*\.js$/i;
const landingCards = Array.from({ length: 6 }, (_, index) => ({
  id: `landing-${index}`,
  word: `landing-word-${index}`,
  normalizedWord: `landing-word-${index}`,
  translation: `nghĩa ${index}`,
  explanation: `A useful explanation ${index}.`,
  phonetic: '',
  emoji: '📚',
  category: 'Landing test',
  partOfSpeech: 'noun',
  audioUrl: null,
  imageUrl: null,
  createdAt: new Date(2026, 7, index + 1).toISOString(),
  bookmarked: false,
  difficulty: 'unrated',
  customDeck: null,
}));

test('cold landing is cloud-free and warm runtime stays mounted across navigation', async ({ page }) => {
  await page.addInitScript(initialCards => {
    localStorage.setItem('lingoflash_cards', JSON.stringify(initialCards));
    localStorage.removeItem('lingoflash_cards_owner');
  }, landingCards);
  const requests: string[] = [];
  let documentRequests = 0;
  page.on('request', request => {
    requests.push(request.url());
    if (request.resourceType() === 'document' && request.frame() === page.mainFrame()) documentRequests += 1;
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

  expect(requests.filter(url => cloudRequest.test(url))).toEqual([]);
  await page.getByRole('button', { name: 'Start learning', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  await page.getByRole('button', { name: 'More practice' }).click();
  await expect(page.getByRole('dialog', { name: 'Choose a practice mode' })).toBeVisible();
  await page.evaluate(() => {
    history.pushState({}, '', '/?view=landing');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await expect(page.locator('video[data-hero-video]')).toHaveCount(4);
  await page.getByRole('button', { name: 'Start learning', exact: true }).first().click();
  await expect(page.getByRole('dialog', { name: 'Choose a practice mode' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Choose a practice mode' })).toBeHidden();

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

test('atmosphere controls activate every video without moving the page', async ({ page }) => {
  await page.goto('/?view=landing');

  for (const label of ['Still Water', 'Deep Woods', 'Quiet Dawn', 'Golden Hour']) {
    const control = page.getByRole('button', { name: label, exact: true });
    await control.scrollIntoViewIfNeeded();
    const scrollY = await page.evaluate(() => window.scrollY);
    await control.click();

    const activeVideo = page.locator('video[data-hero-video]').filter({
      has: page.locator(`source[src*="${label.toLowerCase().replace(' ', '-')}"]`),
    });
    await expect(control).toHaveAttribute('aria-pressed', 'true');
    await expect(activeVideo).toHaveClass(/opacity-70/);
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollY);
  }
});

test('data saver keeps the landing page static without requesting hero video', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: { saveData: true },
    });
  });
  const mediaRequests: string[] = [];
  page.on('request', request => {
    if (/\.mp4(?:\?|$)/i.test(request.url())) mediaRequests.push(request.url());
  });

  await page.goto('/?view=landing');

  await expect(page.getByRole('status')).toBeVisible();
  await expect(page.locator('fieldset')).toHaveCount(0);
  expect(mediaRequests).toEqual([]);
});

test('failed runtime import restores landing and retries with a fresh runtime entry', async ({ page }) => {
  await page.addInitScript(initialCards => {
    localStorage.setItem('lingoflash_cards', JSON.stringify(initialCards));
    localStorage.removeItem('lingoflash_cards_owner');
  }, landingCards);
  const requests: string[] = [];
  let documentRequests = 0;
  let blockRuntime = true;
  await page.route(/\/assets\/AppRuntimeInitial\.virtual-[^/]+\.js$/i, route => (blockRuntime ? route.abort() : route.continue()));
  page.on('request', request => {
    requests.push(request.url());
    if (request.resourceType() === 'document' && request.frame() === page.mainFrame()) documentRequests += 1;
  });

  await page.goto('/?view=landing');
  expect(requests.filter(url => cloudRequest.test(url))).toEqual([]);

  await page.getByRole('button', { name: 'Start learning', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: /Remember words\. Use them when it matters\./ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry workspace', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/view=landing/);

  blockRuntime = false;
  await page.getByRole('button', { name: 'Retry workspace', exact: true }).click();
  await expect(page).toHaveURL(/runtime-retry=\d+/);
  await expect(page.getByRole('button', { name: 'Start learning', exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Start learning', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  expect(documentRequests).toBe(2);
  const runtimeRequests = requests.filter(url => /\/assets\/AppRuntime(?:Initial|Retry)\.virtual-[^/]+\.js$/i.test(url));
  expect(runtimeRequests).toHaveLength(2);
  expect(runtimeRequests[0]).toContain('AppRuntimeInitial.virtual-');
  expect(runtimeRequests[1]).toContain('AppRuntimeRetry.virtual-');
});
