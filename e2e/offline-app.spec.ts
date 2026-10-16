import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type BrowserContext, type Request } from '@playwright/test';
import { expect, test } from './fixtures/firebase-emulator';
import { startBackendOutageProxy, startOfflineReleaseFixture, type OfflineReleaseFixture } from './offline-release-fixture';

const offlineCard = {
  id: 'word-resilient', schemaVersion: 2, revision: 1,
  word: 'resilient',
  normalizedWord: 'resilient',
  translation: 'kiên cường',
  explanation: 'Able to recover after difficulty.',
  phonetic: '',
  emoji: '🌱',
  category: 'Character',
  audioUrl: null,
  imageUrl: null,
  createdAt: '2026-07-20T03:00:00.000Z',
  bookmarked: false,
  difficulty: 'unrated',
  customDeck: null,
};

test.beforeEach(async ({ seedCards, seedCourseProfile }) => {
  await seedCourseProfile();
  await seedCards([offlineCard]);
});

const closeFixture = async (fixture: OfflineReleaseFixture | undefined) => {
  if (fixture) await fixture.close();
};

const protectedPaths = [
  '/api',
  '/api/',
  '/api.json',
  '/api/device-cards',
  '/auth',
  '/auth/',
  '/auth.json',
  '/auth/token',
  '/__/',
  '/__/session',
  '/__/auth/handler',
  '/catalog',
  '/catalog/',
  '/catalog.json',
  '/private',
  '/private/',
  '/private.json',
  '/private/profile.json',
  '/media',
  '/media/',
  '/media.json',
  '/catalog/english/release-manifest.json',
  '/media/lesson.mp4',
  '/audio-pack',
  '/audio-pack/',
  '/audio-pack.json',
  '/audio-pack/lesson.m4a',
  '/__sonflash_offline_media_pack__',
  '/__sonflash_offline_media_pack__/',
  '/__sonflash_offline_media_pack__.json',
  '/health',
  '/health/',
  '/health/private',
  '/manifest',
  '/manifest/',
  '/manifest/private',
  '/privacy',
  '/privacy/',
  '/privacy.json',
  '/privacy-private',
  '/privacy/private',
  '/browser-extension-privacy/private',
  '/browser-extension-privacy.json',
];

test('landing does not register or request the offline shell, and Hosting headers stay explicit', async ({ page, request }) => {
  const fixture = await startOfflineReleaseFixture();
  try {
    const requestedPaths: string[] = [];
    page.on('request', requestEvent => requestedPaths.push(new URL(requestEvent.url()).pathname));

    const sw = await request.get(`${fixture.origin}/sw.js`);
    expect(sw.status()).toBe(200);
    expect(sw.headers()['content-type']).toBe('application/javascript; charset=utf-8');
    expect(sw.headers()['cache-control']).toBe('no-cache,no-store,must-revalidate');

    const index = await request.get(`${fixture.origin}/index.html`);
    expect(index.headers()['cache-control']).toBe('no-cache,no-store,must-revalidate');
    const health = await request.get(`${fixture.origin}/health.json`);
    expect(health.headers()['content-type']).toBe('application/json; charset=utf-8');
    expect(health.headers()['cache-control']).toBe('no-cache,no-store,must-revalidate');
    const manifest = await request.get(`${fixture.origin}/manifest.webmanifest`);
    expect(manifest.status()).toBe(200);
    expect(manifest.headers()['content-type']).toBe('application/manifest+json; charset=utf-8');
    expect(manifest.headers()['cache-control']).toBe('public,max-age=300');
    const privacy = await request.get(`${fixture.origin}/browser-extension-privacy.html`);
    expect(privacy.status()).toBe(200);
    expect(privacy.headers()['content-type']).toBe('text/html; charset=utf-8');
    expect(privacy.headers()['cache-control']).toBe('public,max-age=300');

    await page.goto(`${fixture.origin}/?view=landing`);
    await expect(page.getByRole('button', { name: /Prepare offline/i })).toHaveCount(0);
    expect(requestedPaths).not.toContain('/sw.js');
  } finally {
    await closeFixture(fixture);
  }
});

test('a prepared shell recovers the cached learner workspace during an app-server outage', async ({ page: initialPage, browser, browserName, signIn, blockExternalNetwork }) => {
  const fixture = await startOfflineReleaseFixture();
  let proxy: Awaited<ReturnType<typeof startBackendOutageProxy>> | undefined;
  let proxyContext: BrowserContext | undefined;
  let page = initialPage;
  try {
    if (browserName === 'webkit') {
      proxy = await startBackendOutageProxy(fixture.origin);
      proxyContext = await browser.newContext({ proxy: { server: proxy.origin } });
      page = await proxyContext.newPage();
    }
    await blockExternalNetwork(page, [Number(new URL(fixture.origin).port)]);
    await signIn(page, `${fixture.origin}/?view=library&locale=en`);
    await expect(page.getByRole('heading', { name: 'Your library' })).toBeVisible();
    await expect(page.getByText('resilient', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('app files, up to 4 MiB', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Prepare offline', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Available offline', exact: true })).toBeDisabled();
    await expect(page.getByText('Available offline.', { exact: true })).toBeVisible();

    await page.reload();
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

    const onlineApi = await page.evaluate(async () => {
      const response = await fetch('/api/device-cards');
      return { status: response.status, contentType: response.headers.get('content-type') };
    });
    expect(onlineApi.status).toBe(503);
    expect(onlineApi.contentType).toContain('application/json');

    const outageRequests = new Set<Request>();
    const successfulBackendResponses: number[] = [];
    let outageStarted = false;
    page.on('request', request => {
      if (outageStarted && new URL(request.url()).origin !== fixture.origin) outageRequests.add(request);
    });
    page.on('response', response => {
      if (outageRequests.has(response.request()) && response.ok()) {
        successfulBackendResponses.push(response.status());
      }
    });
    await page.route(url => url.origin !== fixture.origin, route => route.abort());
    outageStarted = true;
    proxy?.cutBackends();
    await fixture.close();
    // Firefox's native offline mode prevents SW navigations; WebKit does not
    // expose a reliable native offline signal. Both still exercise server loss.
    test.info().annotations.push({
      type: 'outage-mode',
      description: browserName === 'chromium' ? 'native offline and stopped server' : 'stopped server and blocked backends; native offline reload not verified',
    });
    if (browserName === 'chromium') await page.context().setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Your library' })).toBeVisible();
    await expect(page.getByText('resilient', { exact: true }).first()).toBeVisible();
    if (browserName === 'chromium' && await page.evaluate(() => navigator.onLine)) {
      // Chromium can reset its native online signal on a cached navigation.
      // Reapply actual network emulation; backend routes remain blocked.
      await page.context().setOffline(false);
      await page.context().setOffline(true);
    }

    const offlineApi = await page.evaluate(async () => {
      try {
        const response = await fetch('/api/device-cards');
        return { status: response.status, contentType: response.headers.get('content-type') };
      } catch (error) {
        return { error: String(error) };
      }
    });
    expect(offlineApi.error || offlineApi.status !== 200 || !offlineApi.contentType?.includes('text/html')).toBeTruthy();

    const backendUnavailable = await page.evaluate(async host => {
      try { await fetch(`http://${host}/`); return false; }
      catch { return true; }
    }, process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080');
    expect(backendUnavailable).toBe(true);
    if (proxy) expect(proxy.blockedRequests()).toBeGreaterThan(0);
    expect(successfulBackendResponses).toEqual([]);

    await page.getByRole('button', { name: 'Today', exact: true }).first().click();
    await expect(page.locator('#daily-today-heading')).toBeVisible();
    if (browserName !== 'webkit') {
      await page.context().setOffline(true);
      expect(await page.evaluate(() => navigator.onLine)).toBe(false);
      await expect(page.getByText("You're offline. Reconnect to start today's session.", { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: "Start today's session", exact: true }).and(page.locator(':enabled'))).toHaveCount(0);
      if (browserName === 'chromium') await expect(page.getByRole('button', { name: "Start today's session", exact: true })).toBeDisabled();
    }
    expect(successfulBackendResponses).toEqual([]);

  } finally {
    const cleanup = await Promise.allSettled([
      browserName !== 'webkit' ? page.context().setOffline(false) : Promise.resolve(),
      proxyContext?.close(), proxy?.close(), closeFixture(fixture),
    ]);
    const failures = cleanup.filter(result => result.status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Offline fixture cleanup failed.');
  }
});

test('protected and mutable paths stay outside the shell online and offline', async ({ page, browserName, signIn, blockExternalNetwork }) => {
  const fixture = await startOfflineReleaseFixture();
  try {
    await blockExternalNetwork(page, [Number(new URL(fixture.origin).port)]);
    await signIn(page, `${fixture.origin}/?view=library&locale=en`);
    await page.getByRole('button', { name: 'Prepare offline', exact: true }).click();
    await expect(page.getByText('Available offline.', { exact: true })).toBeVisible();
    await page.reload();
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

    const onlineResponses = await page.evaluate(async paths => Promise.all(paths.map(async pathname => {
      const response = await fetch(pathname);
      return {
        pathname,
        status: response.status,
        contentType: response.headers.get('content-type'),
      };
    })), protectedPaths);
    for (const response of onlineResponses) {
      expect(response.status !== 200 || !response.contentType?.includes('text/html')).toBeTruthy();
    }

    await page.route(url => url.origin !== fixture.origin, route => route.abort());
    if (browserName === 'webkit') await fixture.close();
    else await page.context().setOffline(true);
    const offlineResponses = await page.evaluate(async paths => Promise.all(paths.map(async pathname => {
      const cached = await caches.match(pathname);
      try {
        const response = await fetch(pathname);
        return { pathname, cached: Boolean(cached), status: response.status, contentType: response.headers.get('content-type') };
      } catch (error) {
        return { pathname, cached: Boolean(cached), error: String(error) };
      }
    })), protectedPaths);
    for (const response of offlineResponses) {
      expect(response.cached).toBe(false);
      expect('error' in response || response.status !== 200 || !response.contentType?.includes('text/html')).toBeTruthy();
    }
  } finally {
    if (browserName !== 'webkit') await page.context().setOffline(false);
    await closeFixture(fixture);
  }
});

test('a persistent Chromium profile reopens the cached workspace after all clients close', async ({ browserName, signIn, blockExternalNetwork }) => {
  test.skip(browserName !== 'chromium', 'Persistent-profile cold reopen is covered on Chromium.');
  const fixture = await startOfflineReleaseFixture();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sonflash-offline-reopen-'));
  let context: BrowserContext | undefined;
  try {
    context = await chromium.launchPersistentContext(userDataDir, { headless: true });
    const first = await context.newPage();
    await blockExternalNetwork(first, [Number(new URL(fixture.origin).port)]);
    await signIn(first, `${fixture.origin}/?view=library&locale=en`);
    await expect(first.getByRole('heading', { name: 'Your library' })).toBeVisible();
    await expect(first.getByText('resilient', { exact: true }).first()).toBeVisible();
    await first.getByRole('button', { name: 'Prepare offline', exact: true }).click();
    await expect(first.getByText('Available offline.', { exact: true })).toBeVisible();
    await first.reload();
    await expect.poll(() => first.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
    await expect.poll(() => first.evaluate(() => (
      globalThis as typeof globalThis & { __SONFLASH_RELEASE_MARKER__?: string }
    ).__SONFLASH_RELEASE_MARKER__)).toBe('A');

    await context.close();
    context = undefined;
    await fixture.close();

    context = await chromium.launchPersistentContext(userDataDir, { headless: true });
    await context.route(url => url.origin !== fixture.origin, route => route.abort());
    await context.setOffline(true);
    const reopened = await context.newPage();
    await blockExternalNetwork(reopened, [Number(new URL(fixture.origin).port)]);
    await reopened.route(url => url.origin !== fixture.origin, route => route.abort());
    await reopened.goto(`${fixture.origin}/?view=library`);
    await expect(reopened.getByRole('heading', { name: 'Your library' })).toBeVisible();
    await expect(reopened.getByText('resilient', { exact: true }).first()).toBeVisible();
    await reopened.goto(`${fixture.origin}/?view=today`);
    await expect(reopened.getByRole('heading', { level: 1, name: /^Today:/ })).toBeVisible();
    await expect(reopened.getByRole('button', { name: /Learn:/ }).first()).toBeVisible();
  } finally {
    await context?.close();
    await closeFixture(fixture);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
