import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

// Base port for this spec's own Vite fixture server. `playwright.config.ts` has
// `fullyParallel: false`, so different spec files (not just tests within one
// file) can still run concurrently on separate workers; four unrelated
// -visual specs each ran their own strictPort Vite server on this exact port,
// so any two of them scheduled on different workers at once raced for the
// same socket and one hit EADDRINUSE ("Port 4175 is already in use"). Offset
// by Playwright's parallelIndex, which is guaranteed distinct across workers
// that are actually running at the same time, per
// https://playwright.dev/docs/api/class-testinfo#test-info-parallel-index.
const FIXTURE_PORT_BASE = 4175;
let fixturePort = FIXTURE_PORT_BASE;
let fixtureOrigin = `http://127.0.0.1:${fixturePort}`;
const fixturePath = '/e2e/fixtures/practice-visual.html';
const themes = [
  { family: 'classic', mode: 'light' }, { family: 'classic', mode: 'dark' },
  { family: 'crystal', mode: 'light' }, { family: 'crystal', mode: 'dark' },
] as const;
const viewports = [{ name: 'desktop', width: 1440, height: 900 }, { name: '390px', width: 390, height: 844 }] as const;
const practiceViews = ['quiz', 'quiz-answered', 'quiz-wrong', 'spelling', 'spelling-checked', 'spelling-wrong', 'story', 'story-word', 'story-error', 'match', 'match-progress', 'shadowing', 'shadowing-result'] as const;

let fixtureServer: ViteDevServer | undefined;

/** Screens taller than a phone: their controls must be reachable by scrolling rather than all on screen at once. */
const isScrollingView = (view: string | null) => view === 'match' || view === 'match-progress' || view === 'shadowing' || view === 'shadowing-result' || view === 'story' || view === 'story-word';

async function expectAccessibleAndContained(page: Page, label: string) {
  const root = page.locator('[data-practice-visual-view]');
  const view = await root.getAttribute('data-practice-visual-view');
  const surface = view === 'dialog' ? page.getByRole('dialog') : root;
  const scrollingView = isScrollingView(view);
  await expect(surface.getByRole('button').first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label} has horizontal overflow`).toBeLessThanOrEqual(1);
  const clipped = await surface.locator('button:visible, input:visible').evaluateAll((elements, scrollingView) => elements.map(element => {
    const box = element.getBoundingClientRect();
    return { label: element.getAttribute('aria-label') || element.textContent?.trim(), left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
  }).filter(control => control.width > 0 && control.height > 0 && (
    control.left < -1 || control.right > window.innerWidth + 1 || (!scrollingView && (control.top < -1 || control.bottom > window.innerHeight + 1))
  )), scrollingView);
  expect(clipped, `${label} has clipped controls`).toEqual([]);
  const results = await new AxeBuilder({ page }).include(view === 'dialog' ? '[role="dialog"]' : '[data-practice-visual-view]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const blocking = results.violations.filter(violation => violation.impact === 'serious' || violation.impact === 'critical');
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

async function expectReducedMotion(page: Page, label: string) {
  const animations = await page.evaluate(() => document.getAnimations().filter(animation => Number(animation.effect?.getComputedTiming().duration ?? 0) > 1).map(animation => animation.effect instanceof KeyframeEffect && animation.effect.target instanceof Element ? getComputedStyle(animation.effect.target).animationName : 'unnamed animation'));
  expect(animations, `${label} starts motion despite reduced-motion preference`).toEqual([]);
}

async function expectScreen(page: Page, testInfo: TestInfo, name: string) {
  await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true, animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01 });
  const screenshot = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach(name, { path: screenshot, contentType: 'image/png' });
}


async function expectScrollingControlsReachable(page: Page, testInfo: TestInfo, name: string) {
  const position = await page.evaluate(() => ({ left: scrollX, top: scrollY }));
  try {
    const controls = page.locator('.practice-board').getByRole('button');
    await expect(controls).not.toHaveCount(0);
    for (const control of await controls.all()) {
      await control.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
      await expect(control).toBeInViewport({ ratio: 1 });
      await control.hover({ trial: true });
    }
    await testInfo.attach(`${name}-controls-in-viewport`, { body: await page.screenshot({ animations: 'disabled', caret: 'hide' }), contentType: 'image/png' });
  } finally {
    await page.evaluate(position => window.scrollTo({ ...position, behavior: 'instant' }), position);
  }
}

test.beforeAll(async ({}, testInfo) => {
  fixturePort = FIXTURE_PORT_BASE + testInfo.parallelIndex;
  fixtureOrigin = `http://127.0.0.1:${fixturePort}`;
  fixtureServer = await createServer({ configFile: 'vite.config.ts', cacheDir: `node_modules/.vite-e2e/practice-visual-${testInfo.parallelIndex}`, appType: 'mpa', server: { host: '127.0.0.1', port: fixturePort, strictPort: true }, optimizeDeps: { entries: ['e2e/fixtures/practice-visual.html'] } });
  await fixtureServer.listen();
});
test.afterAll(async () => { await fixtureServer?.close(); });

test('spelling defers submit during IME composition', async ({ page }) => {
  await page.goto(`${fixtureOrigin}${fixturePath}?view=spelling&locale=en`);
  const input = page.getByRole('textbox');
  const checks = page.locator('[data-spelling-check-count]');
  await expect(input).toBeVisible({ timeout: 15_000 });
  await input.dispatchEvent('compositionstart');
  await input.press('Enter');
  await expect(checks).toHaveText('0');
  await input.evaluate(element => {
    element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  });
  await expect(checks).toHaveText('0');
  await page.waitForTimeout(20);
  await input.press('Enter');
  await expect(checks).toHaveText('1');
});

// One test per screen, so a changed screen does not hide the result of the ones after it.
for (const theme of themes) for (const viewport of viewports) for (const view of practiceViews) {
  test(`${theme.family} ${theme.mode} practice ${view} is visually accessible at ${viewport.name}`, async ({ page }, testInfo) => {
    test.setTimeout(60_000);
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
    const name = `practice-${view}-${theme.family}-${theme.mode}-${viewport.name}`;
    if (view.startsWith('match') || view.startsWith('story')) await page.clock.setFixedTime('2026-09-25T09:00:00Z');
    if (view === 'shadowing-result') {
      // A stand-in recogniser, so a take can be scored without a microphone or a speech service.
      await page.addInitScript(() => {
        (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = class {
          onstart?: () => void;
          start() { (window as unknown as { lastRecognition: unknown }).lastRecognition = this; this.onstart?.(); }
          stop() {}
          abort() {}
        };
      });
    }
    await page.goto(`${fixtureOrigin}${fixturePath}?view=${view}&locale=en`);
    await expect(page.locator(`[data-practice-visual-view="${view}"]`)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('html')).toHaveAttribute('data-theme-family', theme.family);
    if (theme.mode === 'dark') await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    else await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
    if (theme.family === 'crystal') await expect(page.locator('#sonflash-crystal-theme')).toHaveAttribute('href', '/theme-crystal.css');
    if (view.startsWith('quiz')) {
      const category = page.getByText('IELTS', { exact: true });
      await expect(category).toBeVisible();
      expect(await category.evaluate(element => element.getBoundingClientRect().height), 'Quiz category badge stays compact').toBeLessThanOrEqual(44);
      await expect.poll(() => category.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        const painted = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        return painted === element || element.contains(painted);
      }), { message: 'Quiz category text is not covered by an answer' }).toBe(true);
    }
    if (view === 'story-word') {
      const word = page.locator('.practice-story__text [data-story-word]', { hasText: 'context' });
      await word.click();
      await expect(word).toHaveAttribute('aria-expanded', 'true');
    }
    if (view === 'match-progress') {
      // One pair matched and the next word chosen, as the match board shows a run in progress.
      await page.getByRole('button', { name: 'adapt', exact: true }).click();
      await page.getByRole('button', { name: 'thích nghi', exact: true }).click();
      const chosen = page.getByRole('button', { name: 'benefit', exact: true });
      await chosen.click();
      await expect(chosen).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('[data-state="matched"]')).toHaveCount(2);
    }
    if (view === 'shadowing-result') {
      await page.getByRole('button', { name: 'Start reading' }).click();
      await page.evaluate(() => {
        const result = Object.assign([{ transcript: 'Good learners adopt their plan when the evidence changes', confidence: 0.9 }], { isFinal: true });
        (window as unknown as { lastRecognition: { onresult(event: unknown): void } }).lastRecognition.onresult({ results: [result] });
      });
      await expect(page.getByRole('meter', { name: 'Sentence match' })).toBeVisible();
      await expect(page.locator('[data-mic-status]')).toBeVisible();
    }
    await expectAccessibleAndContained(page, name);
    await expectReducedMotion(page, name);
    await expectScreen(page, testInfo, name);
    if (isScrollingView(view)) await expectScrollingControlsReachable(page, testInfo, name);
  });
}

for (const theme of themes) for (const viewport of viewports) {
  test(`${theme.family} ${theme.mode} practice dialog is visually accessible at ${viewport.name}`, async ({ page }, testInfo) => {
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
    const name = `practice-dialog-${theme.family}-${theme.mode}-${viewport.name}`;
    await page.goto(`${fixtureOrigin}${fixturePath}?view=dialog&locale=en`);
    await expect(page.locator('[data-practice-visual-view="dialog"]')).toBeVisible({ timeout: 15_000 });
    // The narrow bottom sheet shortens the dialog title to "Practice".
    await expect(page.getByRole('heading', { name: viewport.width < 640 ? 'Practice' : 'Choose a practice mode', exact: true })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme-family', theme.family);
    if (theme.mode === 'dark') await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    else await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
    if (theme.family === 'crystal') await expect(page.locator('#sonflash-crystal-theme')).toHaveAttribute('href', '/theme-crystal.css');
    await expectAccessibleAndContained(page, name);
    await expectReducedMotion(page, name);
    await expectScreen(page, testInfo, name);
  });
}

for (const theme of themes) for (const viewport of viewports) {
  test(`${theme.family} ${theme.mode} Korean review shows syllable breakdown at ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: theme.mode, reducedMotion: 'reduce' });
    await page.route(new RegExp(`^https?://(?!127\\.0\\.0\\.1:${fixturePort})`), route => route.abort());
    await page.addInitScript(({ family, mode }) => {
      localStorage.setItem('sonflash_theme_family', family);
      localStorage.setItem('lingoflash_theme', mode);
      localStorage.setItem('sonflash_theme_follow_system', 'false');
      localStorage.setItem('sonflash_reduced_motion', 'true');
    }, theme);
    await page.goto(`${fixtureOrigin}${fixturePath}?view=ko-review&locale=en`);
    const card = page.locator('.flashcard-shell');
    const breakdown = page.locator('[data-hangul-breakdown]');
    await expect(card).toHaveAttribute('data-card-side', 'front');
    await expect(breakdown).toBeVisible();
    await expect(breakdown.locator('.hangul-breakdown__row').first()).toContainText('결=ㄱgㅕyeoㄹl');
    await expect(breakdown.locator('.hangul-breakdown__row').nth(1)).toContainText('심=ㅅsㅣiㅁm');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const violations = (await new AxeBuilder({ page }).include('[data-practice-visual-view="ko-review"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()).violations
      .filter(violation => violation.impact === 'serious' || violation.impact === 'critical');
    expect(violations, JSON.stringify(violations, null, 2)).toEqual([]);
    const screenshot = testInfo.outputPath(`korean-review-${theme.family}-${theme.mode}-${viewport.name}.png`);
    await page.screenshot({ path: screenshot, fullPage: true, animations: 'disabled', caret: 'hide' });
    await testInfo.attach('Korean review breakdown', { path: screenshot, contentType: 'image/png' });
    await card.locator('[data-reveal-meaning]').click();
    await expect(card).toHaveAttribute('data-card-side', 'back');
    await expect(breakdown).toBeVisible();
  });
}
