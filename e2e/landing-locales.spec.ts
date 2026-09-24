import { expect, test } from '@playwright/test';

const origin = 'https://sonflash.app';
const locales = [
  { path: '/', language: 'en', canonical: `${origin}/` },
  { path: '/vi/', language: 'vi', canonical: `${origin}/vi/` },
] as const;

for (const { path, language, canonical } of locales) {
  test(`serves the ${language} landing with static SEO metadata and no cloud startup`, async ({ page, request }) => {
    const response = await request.get(path);
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toContain('text/html');
    const html = await response.text();
    expect(html).toMatch(new RegExp(`<html\\s+lang="${language}"`));
    expect(html).toContain(`<link rel="canonical" href="${canonical}"`);

    const cloudRequests: string[] = [];
    page.on('request', request => {
      if (/firebase|googleapis|recaptcha|identitytoolkit|securetoken/i.test(request.url())) {
        cloudRequests.push(request.url());
      }
    });
    await page.goto(path);
    await expect(page.locator('html')).toHaveAttribute('lang', language);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', canonical);
    for (const alternate of [
      { language: 'en', href: `${origin}/` },
      { language: 'vi', href: `${origin}/vi/` },
      { language: 'x-default', href: `${origin}/` },
    ]) {
      await expect(page.locator(`link[rel="alternate"][hreflang="${alternate.language}"]`))
        .toHaveAttribute('href', alternate.href);
    }
    expect(cloudRequests).toEqual([]);
  });
}

test('visible language links reach both landing locales', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Tiếng Việt' }).first().click();
  await expect(page).toHaveURL(/\/vi\/$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
  await expect(page.getByRole('link', { name: 'English' }).first()).toHaveAttribute('href', '/');
});

test('language links replace a returning visitor’s saved choice', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('sonflash_ui_locale', 'en'));
  await page.reload();
  await page.getByRole('link', { name: 'Tiếng Việt' }).first().click();
  await expect(page).toHaveURL(/\/vi\/$/);
  await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
  expect(await page.evaluate(() => localStorage.getItem('sonflash_ui_locale'))).toBe('vi');
});
