import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

const themes = [
  { family: 'classic', mode: 'light' },
  { family: 'classic', mode: 'dark' },
  { family: 'crystal', mode: 'light' },
  { family: 'crystal', mode: 'dark' },
] as const;
const locales = [{ name: 'en', path: '/' }, { name: 'vi', path: '/vi/' }] as const;
const viewports = [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844 }] as const;

async function expectAccessibleAndContained(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label} has horizontal overflow`).toBeLessThanOrEqual(1);
  const clipped = await page.locator('a:visible, button:visible, summary:visible').evaluateAll(elements => elements.map(element => {
    const box = element.getBoundingClientRect();
    return { label: element.getAttribute('aria-label') || element.textContent?.trim(), left: box.left, right: box.right };
  }).filter(control => control.left < -1 || control.right > window.innerWidth + 1));
  expect(clipped, `${label} has horizontally clipped controls`).toEqual([]);

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const blocking = results.violations.filter(violation => violation.impact === 'serious' || violation.impact === 'critical');
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

async function expectReducedMotion(page: Page, label: string) {
  const animatedNames = await page.evaluate(() => document.getAnimations()
    .filter(animation => Number(animation.effect?.getComputedTiming().duration ?? 0) > 1)
    .map(animation => animation.effect instanceof KeyframeEffect && animation.effect.target instanceof Element
      ? getComputedStyle(animation.effect.target).animationName
      : 'unnamed'));
  expect(animatedNames, `${label} starts motion despite reduced-motion preference`).toEqual([]);
}

for (const theme of themes) for (const locale of locales) for (const viewport of viewports) {
  test(`${theme.family} ${theme.mode} ${locale.name} landing is visually accessible at ${viewport.name}`, async ({ page }) => {
    const name = `landing-${locale.name}-${theme.family}-${theme.mode}-${viewport.name}`;
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: theme.mode, reducedMotion: 'reduce' });
    await page.addInitScript(({ family, mode }) => {
      localStorage.setItem('sonflash_theme_family', family);
      localStorage.setItem('lingoflash_theme', mode);
      localStorage.setItem('sonflash_theme_follow_system', 'false');
      localStorage.setItem('sonflash_reduced_motion', 'true');
      localStorage.setItem('sonflash_lumi_enabled', 'true');
    }, theme);
    await page.goto(locale.path);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme-family', theme.family);
    if (theme.mode === 'dark') await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    else await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
    if (theme.family === 'crystal') await expect(page.locator('#sonflash-crystal-theme')).toHaveAttribute('href', '/theme-crystal.css');

    await expect(page.getByRole('link', { name: 'English' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Tiếng Việt' }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /privacy|quyền riêng tư/i }).last()).toBeVisible();
    await expect(page.getByRole('link', { name: /terms|điều khoản/i }).last()).toBeVisible();
    await expect(page.getByText(/18\+|18 tuổi trở lên|aged 18 and over/i)).toBeVisible();
    await expect(page.locator('main')).not.toContainText(/249[.,]?000|949[.,]?000|student.*50%|7-day.*trial|reverse.*trial/i);
    await expectAccessibleAndContained(page, name);
    await expectReducedMotion(page, name);
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true, animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01 });
  });
}

test('light landing first paint remains text-first without CJK fonts or video', async ({ page }) => {
  const requested: string[] = [];
  await page.addInitScript(() => {
    const entries: PerformanceEntry[] = [];
    new PerformanceObserver(list => entries.push(...list.getEntries())).observe({ type: 'largest-contentful-paint', buffered: true });
    (window as Window & { __landingLcpEntries?: PerformanceEntry[] }).__landingLcpEntries = entries;
    localStorage.setItem('sonflash_theme_family', 'classic');
    localStorage.setItem('lingoflash_theme', 'light');
    localStorage.setItem('sonflash_theme_follow_system', 'false');
  });
  page.on('request', request => requested.push(request.url()));
  await page.bringToFront();
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await page.waitForFunction(() => (window as Window & { __landingLcpEntries?: PerformanceEntry[] }).__landingLcpEntries?.length, undefined, { timeout: 5_000 });
  const lcp = await page.evaluate(() => {
    const entry = (window as Window & { __landingLcpEntries?: PerformanceEntry[] }).__landingLcpEntries?.at(-1) as (PerformanceEntry & { loadTime?: number; size?: number; url?: string }) | undefined;
    return { loadTime: entry?.loadTime, size: entry?.size, url: entry?.url };
  });
  expect(lcp.size, 'largest paint must have visible area').toBeGreaterThan(0);
  expect(lcp.url, 'largest paint must be a text candidate').toBe('');
  expect(lcp.loadTime, 'text LCP must not wait for a resource load').toBe(0);
  expect(requested.filter(url => /noto-sans-cjk|cjk-font|\.(?:av1|mp4)(?:\?|$)/i.test(url))).toEqual([]);
});

test('Crystal light keeps text as the final LCP after Lumi loads', async ({ page }, testInfo: TestInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    const entries: PerformanceEntry[] = [];
    new PerformanceObserver(list => entries.push(...list.getEntries())).observe({ type: 'largest-contentful-paint', buffered: true });
    (window as Window & { __crystalLcpEntries?: PerformanceEntry[] }).__crystalLcpEntries = entries;
    localStorage.setItem('sonflash_theme_family', 'crystal');
    localStorage.setItem('lingoflash_theme', 'light');
    localStorage.setItem('sonflash_theme_follow_system', 'false');
    localStorage.setItem('sonflash_lumi_enabled', 'true');
  });
  await page.bringToFront();
  await page.goto('/');
  const lumi = page.locator('[data-lumi-pose="hero"]');
  await expect(lumi).toBeVisible();
  await page.waitForFunction(() => {
    const image = document.querySelector<HTMLImageElement>('[data-lumi-pose="hero"]');
    return image?.complete && image.naturalWidth > 0;
  });
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.waitForFunction(() => (window as Window & { __crystalLcpEntries?: PerformanceEntry[] }).__crystalLcpEntries?.length, undefined, { timeout: 5_000 });
  const entries = await page.evaluate(() => (window as Window & { __crystalLcpEntries?: PerformanceEntry[] }).__crystalLcpEntries?.map(entry => {
    const lcp = entry as PerformanceEntry & { element?: Element; loadTime?: number; size?: number; url?: string };
    return { loadTime: lcp.loadTime, size: lcp.size, tag: lcp.element?.tagName, url: lcp.url };
  }) ?? []);
  const lumiGeometry = await lumi.evaluate(element => {
    const image = element as HTMLImageElement;
    const rect = image.getBoundingClientRect();
    const style = getComputedStyle(image);
    return { computedHeight: style.height, computedWidth: style.width, height: rect.height, naturalHeight: image.naturalHeight, naturalWidth: image.naturalWidth, width: rect.width };
  });
  await testInfo.attach('crystal-light-lcp', { body: JSON.stringify({ entries, lumiGeometry }), contentType: 'application/json' });
  const finalEntry = entries.at(-1);
  expect(finalEntry?.size, 'final Crystal LCP must have visible area').toBeGreaterThan(0);
  expect(finalEntry?.url, `final Crystal LCP must remain a text candidate after Lumi loads: ${JSON.stringify({ entries, lumiGeometry })}`).toBe('');
  expect(finalEntry?.loadTime, 'final text LCP must not wait for a resource load').toBe(0);
});

test('saved Crystal Lumi preference hides the landing companion', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    localStorage.setItem('sonflash_theme_family', 'crystal');
    localStorage.setItem('lingoflash_theme', 'dark');
    localStorage.setItem('sonflash_theme_follow_system', 'false');
    localStorage.setItem('sonflash_lumi_enabled', 'false');
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('[data-lumi-pose="hero"]')).not.toBeVisible();
});

test('Crystal Lumi only enters the hero where it preserves the headline and card', async ({ page }, testInfo: TestInfo) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.addInitScript(() => {
    localStorage.setItem('sonflash_theme_family', 'crystal');
    localStorage.setItem('lingoflash_theme', 'dark');
    localStorage.setItem('sonflash_theme_follow_system', 'false');
    localStorage.setItem('sonflash_lumi_enabled', 'true');
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.locator('[data-lumi-pose="hero"]')).not.toBeVisible();

  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.locator('[data-lumi-pose="hero"]')).not.toBeVisible();

  await page.setViewportSize({ width: 1440, height: 900 });
  const headline = page.getByRole('heading', { level: 1 });
  const card = page.getByLabel('Sample English vocabulary card');
  const cardMeaning = card.getByText('a happy discovery by chance');
  const cardExample = card.getByText('Finding that little bookshop was pure serendipity.');
  const lumi = page.locator('[data-lumi-pose="hero"]');
  await expect(headline).toBeVisible();
  await expect(card).toBeVisible();
  await expect(cardMeaning).toBeVisible();
  await expect(cardExample).toBeVisible();
  await expect(lumi).toBeVisible();
  const [headlineTextBox, cardMeaningBox, cardExampleBox, lumiBox] = await Promise.all([
    headline.evaluate(element => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const rect = range.getBoundingClientRect();
      return { right: rect.right };
    }),
    cardMeaning.boundingBox(),
    cardExample.boundingBox(),
    lumi.boundingBox(),
  ]);
  expect(lumiBox).not.toBeNull();
  const lumiRight = lumiBox!.x + lumiBox!.width;
  expect(lumiBox!.x, 'Lumi must not cover the hero headline at 1440px').toBeGreaterThanOrEqual(headlineTextBox.right);
  expect(cardMeaningBox).not.toBeNull();
  expect(cardExampleBox).not.toBeNull();
  expect(lumiRight, 'Lumi must not cover the card meaning at 1440px').toBeLessThanOrEqual(cardMeaningBox!.x);
  expect(lumiRight, 'Lumi must not cover the card example at 1440px').toBeLessThanOrEqual(cardExampleBox!.x);
  const screenshot = testInfo.outputPath('landing-crystal-dark-1440.png');
  await page.screenshot({ path: screenshot });
  await testInfo.attach('landing-crystal-dark-1440', { path: screenshot, contentType: 'image/png' });
});
