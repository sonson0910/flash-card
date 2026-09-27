import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

const FIXTURE_PORT_BASE = 4675;
const fixturePath = '/e2e/fixtures/language-practice-visual.html';
const themes = [
  { family: 'classic', mode: 'light' }, { family: 'classic', mode: 'dark' },
  { family: 'crystal', mode: 'light' }, { family: 'crystal', mode: 'dark' },
] as const;
const viewports = [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844 }] as const;
const languages = ['en', 'ko', 'ja', 'zh'] as const;
const readySelectors: Record<(typeof languages)[number], string> = {
  en: '.language-practice-drill__answer',
  ko: '.language-practice-drill__hangul-keys',
  ja: '.language-practice-drill__answer',
  zh: '.language-practice-drill__tone-grid',
};

let fixturePort = FIXTURE_PORT_BASE;
let fixtureOrigin = `http://127.0.0.1:${fixturePort}`;
let fixtureServer: ViteDevServer | undefined;

async function expectAccessibleAndContained(page: Page, label: string) {
  const surface = page.locator('.language-practice-drill');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${label} has horizontal overflow`).toBe(true);
  const violations = (await new AxeBuilder({ page }).include('.language-practice-drill')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()).violations
    .filter(violation => violation.impact === 'serious' || violation.impact === 'critical');
  expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
  const clipped = await surface.locator('button:visible, input:visible').evaluateAll(elements => elements.map(element => {
    const box = element.getBoundingClientRect();
    return { name: element.getAttribute('aria-label') || element.textContent?.trim(), left: box.left, right: box.right, width: box.width, height: box.height };
  }).filter(control => control.width > 0 && control.height > 0 && (control.left < -1 || control.right > window.innerWidth + 1)));
  expect(clipped, `${label} has horizontally clipped controls`).toEqual([]);
}

async function enterKoreanWrongFinal(surface: Locator) {
  // 결심 with the final consonant deliberately entered as ㅂ produces 결십.
  for (const jamo of ['ㄱ', 'ㅕ', 'ㄹ', 'ㅅ', 'ㅣ', 'ㅂ']) {
    await surface.getByRole('button', { name: new RegExp(`^${jamo}`) }).click();
  }
  await expect(surface.locator('.language-practice-drill__hangul-diagnostic').first()).toContainText('결십');
  await expect(surface.getByRole('status')).toContainText('Delete it and choose ㅁ');
  await expect(surface.locator('[data-hangul-mismatch="true"]')).toHaveCount(1);
}

test.beforeAll(async ({}, testInfo) => {
  fixturePort = FIXTURE_PORT_BASE + testInfo.parallelIndex;
  fixtureOrigin = `http://127.0.0.1:${fixturePort}`;
  fixtureServer = await createServer({
    configFile: 'vite.config.ts', cacheDir: `node_modules/.vite-e2e/language-practice-${testInfo.parallelIndex}`,
    appType: 'mpa', server: { host: '127.0.0.1', port: fixturePort, strictPort: true },
    optimizeDeps: { entries: ['e2e/fixtures/language-practice-visual.html'] },
  });
  await fixtureServer.listen();
});
test.afterAll(async () => { await fixtureServer?.close(); });

for (const theme of themes) for (const viewport of viewports) for (const language of languages) {
  test(`${theme.family} ${theme.mode} ${language} language drill is visually accessible at ${viewport.name}`, async ({ page }, testInfo) => {
    page.on('pageerror', error => { throw error; });
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: theme.mode, reducedMotion: 'reduce' });
    await page.route(new RegExp(`^https?://(?!127\\.0\\.0\\.1:${fixturePort})`), route => route.abort());
    await page.addInitScript(({ family, mode }) => {
      localStorage.setItem('sonflash_theme_family', family);
      localStorage.setItem('lingoflash_theme', mode);
      localStorage.setItem('sonflash_theme_follow_system', 'false');
      localStorage.setItem('sonflash_reduced_motion', 'true');
    }, theme);
    const name = `language-practice-${language}-${theme.family}-${theme.mode}-${viewport.name}`;
    await page.goto(`${fixtureOrigin}${fixturePath}?kind=${language}&locale=en`);
    const surface = page.locator('.language-practice-drill');
    await expect(surface).toBeVisible({ timeout: 15_000 });
    await expect(surface.locator(readySelectors[language])).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(`[data-language-practice-visual-view="${language}"]`)).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme-family', theme.family);
    if (theme.mode === 'dark') await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    else await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
    if (theme.family === 'crystal') await expect(page.locator('#sonflash-crystal-theme')).toHaveAttribute('href', '/theme-crystal.css');
    if (theme.family === 'crystal') await expect(surface).toHaveCSS('border-radius', '0px');
    if (language === 'ko') await enterKoreanWrongFinal(surface);
    if (language === 'ja') {
      await expect(surface.locator('.language-practice-drill__ruby')).toHaveCount(0);
      await expect(surface.locator('.japanese-pitch-contour')).toHaveCount(0);
      await surface.getByRole('button', { name: 'Hint' }).click();
      await expect(surface.locator('.language-practice-drill__ruby')).toBeVisible();
      await expect(surface.locator('.japanese-pitch-contour')).toBeVisible();
    }
    await expectAccessibleAndContained(page, name);
    await expect(surface).toHaveScreenshot(`${name}.png`, { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01 });
    const screenshot = testInfo.outputPath(`${name}.png`);
    await surface.screenshot({ path: screenshot });
    await testInfo.attach(name, { path: screenshot, contentType: 'image/png' });
  });
}

for (const theme of themes) for (const viewport of viewports) {
  test(`${theme.family} ${theme.mode} Japanese sentence completion at ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: theme.mode, reducedMotion: 'reduce' });
    await page.route(new RegExp(`^https?://(?!127\\.0\\.0\\.1:${fixturePort})`), route => route.abort());
    await page.addInitScript(({ family, mode }) => {
      localStorage.setItem('sonflash_theme_family', family);
      localStorage.setItem('lingoflash_theme', mode);
      localStorage.setItem('sonflash_theme_follow_system', 'false');
      localStorage.setItem('sonflash_reduced_motion', 'true');
    }, theme);
    await page.goto(`${fixtureOrigin}${fixturePath}?kind=ja-sentence&locale=en`);
    const surface = page.locator('.language-practice-drill');
    const answer = surface.locator('.language-practice-drill__answer');
    await expect(answer).toBeVisible();
    await answer.fill('まいあさ');
    await surface.getByRole('button', { name: 'Check' }).click();
    await expect(surface.getByRole('heading', { name: 'Complete the sentence' })).toBeVisible();
    await expect(answer).toBeFocused();
    await expect(surface.getByText('Sáng nào tôi cũng uống cà phê.')).toBeVisible();
    await expect(surface.locator('.language-practice-drill__sentence')).toContainText('私は');
    await expect(surface.locator('.language-practice-drill__segments button')).toHaveCount(4);
    await expectAccessibleAndContained(page, 'Japanese sentence completion');
    const name = `language-practice-ja-sentence-${theme.family}-${theme.mode}-${viewport.name}`;
    await expect(surface).toHaveScreenshot(`${name}.png`, { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01 });
    const screenshot = testInfo.outputPath(`${name}.png`);
    await surface.screenshot({ path: screenshot, animations: 'disabled', caret: 'hide' });
    await testInfo.attach('Japanese sentence completion', { path: screenshot, contentType: 'image/png' });
    await surface.locator('.language-practice-drill__segments').getByRole('button', { name: /毎朝/ }).click();
    await surface.getByRole('button', { name: 'Check' }).click();
    await expect(surface.getByRole('status')).toContainText('Correct');
  });
}

test('Korean drill accepts a correct two-set physical keyboard answer', async ({ page }) => {
  await page.goto(`${fixtureOrigin}${fixturePath}?kind=ko&locale=en`);
  const surface = page.locator('.language-practice-drill');
  await expect(surface.locator(readySelectors.ko)).toBeVisible({ timeout: 15_000 });
  await surface.focus();
  for (const key of ['r', 'u', 'f', 't', 'l', 'a']) await page.keyboard.press(key);
  await expect(surface.locator('.language-practice-drill__hangul-diagnostic').first()).toContainText('결심');
  await surface.getByRole('button', { name: 'Check' }).click();
  await expect(surface.getByRole('status')).toContainText('Correct');
});

test('Korean drill lets the learner repair a wrong final consonant before checking', async ({ page }) => {
  await page.goto(`${fixtureOrigin}${fixturePath}?kind=ko&locale=en`);
  const surface = page.locator('.language-practice-drill');
  await expect(surface.locator(readySelectors.ko)).toBeVisible({ timeout: 15_000 });
  await enterKoreanWrongFinal(surface);
  await surface.getByRole('button', { name: 'Delete' }).click();
  await surface.getByRole('button', { name: /^ㅁ/ }).click();
  await expect(surface.locator('.language-practice-drill__hangul-diagnostic')).toContainText('결심');
  await expect(surface.getByRole('status')).toHaveCount(0);
  await expect(surface.locator('[data-hangul-mismatch="true"]')).toHaveCount(0);
  await surface.getByRole('button', { name: 'Check' }).click();
  await expect(surface.getByRole('status')).toContainText('Correct');
});
