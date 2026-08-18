import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('Paths is lazy, URL-addressable, useful without a shared release and accessible', async ({ page, browserName }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const requestedScripts: string[] = [];
  const requestedCatalogAssets: string[] = [];
  page.on('request', request => {
    if (request.resourceType() === 'script') requestedScripts.push(request.url());
    if (/\/catalog\/.*\.(?:json|ndjson)(?:\?|$)/i.test(request.url())) {
      requestedCatalogAssets.push(request.url());
    }
  });

  await page.goto('/?view=library&utm_source=phase4#catalog-test');
  await expect(page.getByRole('heading', { name: 'Your library' })).toBeVisible();
  expect(requestedScripts.some(url => /CatalogWorkspace/i.test(url))).toBe(false);

  await page.getByRole('button', { name: 'Paths' }).first().click();
  await expect(page).toHaveURL(/view=catalog.*utm_source=phase4.*#catalog-test/);
  await expect(page.getByRole('heading', { name: 'Language paths' })).toBeFocused();
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');
  await expect(page.getByRole('button', { name: 'Open vocabulary' })).toBeFocused();
  expect(requestedScripts.some(url => /CatalogWorkspace/i.test(url))).toBe(true);

  await expect(page.getByRole('heading', { name: 'Personal learning mode' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your personal paths' })).toBeVisible();
  await expect(page.getByText('No draft catalog vocabulary is mixed into these paths.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Catalog unavailable' })).toHaveCount(0);
  await expect(page.locator('#catalog-language')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /install|reviewed catalog/i })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Vocabulary explorer' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add to library' })).toHaveCount(0);
  expect(requestedCatalogAssets).toEqual([]);

  await page.context().setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  await expect(page.getByRole('button', { name: /install|reviewed catalog/i })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Your personal paths' })).toBeVisible();
  await page.context().setOffline(false);

  await page.setViewportSize({ width: 320, height: 800 });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  if (browserName === 'chromium') {
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations.filter(item => item.impact === 'serious' || item.impact === 'critical'))
      .toEqual([]);
  }
});

test('a direct Catalog URL never invents reviewed vocabulary or an installable release', async ({ page }) => {
  await page.goto('/?view=catalog&lang=ja');

  await expect(page).toHaveURL(/view=catalog/);
  await expect(page.getByRole('heading', { name: 'Language paths' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Catalog unavailable' })).toBeVisible();
  await expect(page.getByText('Draft vocabulary is never shown here.')).toBeVisible();
  await expect(page.getByRole('button', { name: /install|reviewed catalog/i })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'IELTS, TOEIC or everyday English' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Vocabulary explorer' })).toHaveCount(0);
});
