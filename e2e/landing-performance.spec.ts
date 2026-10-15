import { expect, test } from './fixtures/firebase-emulator';
import type { Page } from '@playwright/test';

const cloudRequest = /firebase|googleapis|recaptcha|identitytoolkit|securetoken|\/api\/device-cards/i;
const runtimeCloudScript = /\/assets\/(?:AppRuntime|firebase|firebase-functions)[^/]*\.js$/i;
const heroMedia = /\/assets\/(?:still-water|deep-woods|quiet-dawn|golden-hour)[^/]*\.(?:mp4|webm)(?:\?|$)/i;

async function setAtmospherePreference(page: Page, mode: 'light' | 'dark', reduced: boolean) {
  await page.emulateMedia({ colorScheme: mode, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await page.addInitScript(({ mode, reduced }) => {
    localStorage.setItem('sonflash_theme_family', 'classic');
    localStorage.setItem('lingoflash_theme', mode);
    localStorage.setItem('sonflash_theme_follow_system', 'false');
    localStorage.setItem('sonflash_reduced_motion', String(reduced));
  }, { mode, reduced });
}
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

test('cold landing is cloud-free and warm runtime stays mounted across navigation', async ({ page, seedCards, signInInPlace }) => {
  await setAtmospherePreference(page, 'dark', false);
  await seedCards(landingCards);
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
  // Sign-in happens in place (no navigation) so documentRequests below still
  // reflects exactly one document load; Today now requires an authenticated
  // owner since guest/local-only mode was removed. window.__SONFLASH_TEST__
  // is only installed once AppRuntime's lazy chunk evaluates, which only
  // happens once the view leaves 'landing' — so this priming click (Start
  // learning -> enterApp -> setViewMode('today')) mounts that chunk first.
  // AppRuntime's signed-out effect immediately bounces viewMode back to
  // 'landing', capturing the pre-bounce /?view=today URL in
  // preSignInLocationRef; once signInInPlace resolves and `user` becomes
  // truthy, AppRuntime's own restore effect pushes that captured URL back and
  // dispatches a synthetic popstate, landing on Today automatically — no
  // second "Start learning" click, since the button (and the landing page
  // under it) is already gone by then.
  await page.getByRole('button', { name: 'Start learning', exact: true }).first().click();
  await signInInPlace(page);
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

  await page.getByRole('button', { name: 'SonFlash', exact: true }).click();
  await expect(page.locator('video[data-hero-video]')).toHaveCount(4);
  await page.getByRole('button', { name: 'Start learning', exact: true }).first().click();
  await page.getByRole('button', { name: 'Vocabulary', exact: true }).first().click();
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
  await setAtmospherePreference(page, 'dark', false);
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

for (const condition of ['light', 'reduced-motion', 'compact'] as const) {
  test(`cold ${condition} landing stays cloud-free without loading hero media`, async ({ page }) => {
    await setAtmospherePreference(page, condition === 'light' ? 'light' : 'dark', condition === 'reduced-motion');
    if (condition === 'compact') await page.setViewportSize({ width: 390, height: 844 });
    const requests: string[] = [];
    page.on('request', request => requests.push(request.url()));
    await page.goto('/?view=landing');
    await expect(page.getByRole('status').filter({ hasText: 'Static atmosphere is enabled' })).toHaveCount(1);
    await expect(page.locator('video[data-hero-video]')).toHaveCount(0);
    expect(requests.filter(url => cloudRequest.test(url) || heroMedia.test(url))).toEqual([]);
  });
}

test('failed runtime import restores landing and retries with a fresh runtime entry', async ({ page, seedCards, signInInPlace }) => {
  await seedCards(landingCards);
  const initialRuntimeScript = /\/assets\/AppRuntimeInitial\.virtual-[^/]+\.js$/i;
  const retryRuntimeScript = /\/assets\/AppRuntimeRetry\.virtual-[^/]+\.js$/i;
  const requests: string[] = [];
  const failedRuntimeRequests: string[] = [];
  const finishedRuntimeRequests: string[] = [];
  let documentRequests = 0;
  let blockRuntime = true;
  await page.route(initialRuntimeScript, route => (blockRuntime ? route.abort() : route.continue()));
  page.on('request', request => {
    requests.push(request.url());
    if (request.resourceType() === 'document' && request.frame() === page.mainFrame()) documentRequests += 1;
  });
  page.on('requestfailed', request => {
    if (initialRuntimeScript.test(request.url()) || retryRuntimeScript.test(request.url())) failedRuntimeRequests.push(request.url());
  });
  page.on('requestfinished', request => {
    if (initialRuntimeScript.test(request.url()) || retryRuntimeScript.test(request.url())) finishedRuntimeRequests.push(request.url());
  });

  await page.goto('/?view=landing');
  expect(requests.filter(url => cloudRequest.test(url))).toEqual([]);

  await page.getByRole('button', { name: 'Start learning', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Workspace could not load.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Remember words\. Use them when it matters\./ })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Retry workspace', exact: true })).toBeVisible();
  await expect(page).toHaveURL('http://127.0.0.1:4173/');
  const initialRequestsBeforeRetry = requests.filter(url => initialRuntimeScript.test(url));
  expect(initialRequestsBeforeRetry.length).toBeGreaterThan(0);
  expect(failedRuntimeRequests).toEqual(initialRequestsBeforeRetry);

  await page.getByRole('button', { name: 'Retry workspace', exact: true }).click();
  await expect(page).toHaveURL(/runtime-retry=\d+/);
  await expect(page.getByRole('button', { name: 'Start learning', exact: true }).first()).toBeVisible();
  // Same priming click as the top test: this retry reload landed back on
  // the (view-less) landing URL, so AppRuntimeRetry's chunk and its hook
  // have not loaded yet either. As in the top test, AppRuntime's own
  // sign-in return-flow effect (bounce to landing, then restore the
  // captured URL via pushState + a synthetic popstate once `user` resolves)
  // lands on Today by itself once signInInPlace resolves, so no second click
  // is needed or possible (the button is already gone).
  await page.getByRole('button', { name: 'Start learning', exact: true }).first().click();
  await signInInPlace(page);
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
  expect(documentRequests).toBe(2);
  const runtimeRequests = requests.filter(url => initialRuntimeScript.test(url) || retryRuntimeScript.test(url));
  const retryRequestIndex = runtimeRequests.findIndex(url => retryRuntimeScript.test(url));
  expect(retryRequestIndex).toBe(initialRequestsBeforeRetry.length);
  expect(runtimeRequests.slice(retryRequestIndex + 1).filter(url => initialRuntimeScript.test(url))).toEqual([]);
  expect(runtimeRequests.filter(url => retryRuntimeScript.test(url))).toHaveLength(1);
  expect(failedRuntimeRequests.filter(url => retryRuntimeScript.test(url))).toEqual([]);
  expect(finishedRuntimeRequests.filter(url => retryRuntimeScript.test(url))).toHaveLength(1);
});
