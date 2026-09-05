import { expect, test, type Page } from '@playwright/test';
import { startOfflineReleaseFixture, type OfflineReleaseFixture } from './offline-release-fixture';

const offlineCard = {
  id: 'offline-journey',
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

const seedGuestWorkspace = async (page: Page) => {
  await page.addInitScript(card => {
    localStorage.setItem('lingoflash_cards', JSON.stringify([card]));
    localStorage.removeItem('lingoflash_cards_owner');
    localStorage.removeItem('lingoflash_cards_scoped_v1');
  }, offlineCard);
};

const closeFixture = async (fixture: OfflineReleaseFixture | undefined) => {
  if (fixture) await fixture.close();
};

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

    await page.goto(fixture.origin);
    await expect(page.getByRole('button', { name: /Prepare offline/i })).toHaveCount(0);
    expect(requestedPaths).not.toContain('/sw.js');
  } finally {
    await closeFixture(fixture);
  }
});

test('a prepared shell serves the cached learner workspace after a real network loss and cold reopen', async ({ page, browserName }) => {
  const fixture = await startOfflineReleaseFixture();
  try {
    await seedGuestWorkspace(page);
    await page.goto(`${fixture.origin}/?view=library`);
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

    await page.context().setOffline(true);
    try {
      await page.reload();
    } catch (error) {
      if (browserName === 'webkit' && String(error).includes('WebKit encountered an internal error')) {
        test.skip(true, 'This WebKit Playwright build cannot navigate with context.setOffline(true); Chromium covers the real offline journey.');
        return;
      }
      throw error;
    }
    await expect(page.getByRole('heading', { name: 'Your library' })).toBeVisible();
    await expect(page.getByText('resilient', { exact: true }).first()).toBeVisible();

    const offlineApi = await page.evaluate(async () => {
      try {
        const response = await fetch('/api/device-cards');
        return { status: response.status, contentType: response.headers.get('content-type') };
      } catch (error) {
        return { error: String(error) };
      }
    });
    expect(offlineApi.error || offlineApi.status !== 200 || !offlineApi.contentType?.includes('text/html')).toBeTruthy();

    await page.getByRole('button', { name: 'Today', exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'Your daily plan' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Learn:/ }).first()).toBeVisible();

    const reopened = await page.context().newPage();
    try {
      await reopened.goto(`${fixture.origin}/?view=library`);
      await expect(reopened.getByRole('heading', { name: 'Your library' })).toBeVisible();
      await expect(reopened.getByText('resilient', { exact: true }).first()).toBeVisible();
      await reopened.goto(`${fixture.origin}/?view=today`);
      await expect(reopened.getByRole('heading', { name: 'Your daily plan' })).toBeVisible();
      await expect(reopened.getByRole('button', { name: /Learn:/ }).first()).toBeVisible();
    } finally {
      await reopened.close();
    }
  } finally {
    await page.context().setOffline(false);
    await closeFixture(fixture);
  }
});
