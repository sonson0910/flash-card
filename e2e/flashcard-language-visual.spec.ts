import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

const FIXTURE_PORT_BASE = 4955;
const fixturePath = '/e2e/fixtures/flashcard-language-visual.html';
const cardPhoto = readFileSync('docs/design/sonflash-redesign/canvas/assets/blob/ed058680c239cce56bb63500ca7dd0e4.jpg');

const themes = [
  { family: 'classic', mode: 'light', look: 'paper' },
  { family: 'classic', mode: 'dark', look: 'aurora' },
  { family: 'crystal', mode: 'light', look: 'crystal' },
  { family: 'crystal', mode: 'dark', look: 'crystal' },
] as const;
const viewports = [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844 }] as const;

// One card per script family; cards without a photo show the headword's first glyph as a watermark.
const languages = [
  { kind: 'en', headword: 'immediate', translation: /ngay lập tức/i, art: 'image', glyph: null },
  { kind: 'ko', headword: '결심하다', translation: /quyết tâm/i, art: 'glyph', glyph: '결' },
  { kind: 'ja', headword: '経験', translation: /kinh nghiệm/i, art: 'glyph', glyph: '経' },
  { kind: 'zh', headword: '机会', translation: /cơ hội/i, art: 'glyph', glyph: '机' },
] as const;

type Theme = (typeof themes)[number];
type Viewport = (typeof viewports)[number];

let fixturePort = FIXTURE_PORT_BASE;
let fixtureOrigin = `http://127.0.0.1:${fixturePort}`;
let fixtureServer: ViteDevServer | undefined;

test.beforeAll(async ({}, testInfo) => {
  fixturePort = FIXTURE_PORT_BASE + testInfo.parallelIndex;
  fixtureOrigin = `http://127.0.0.1:${fixturePort}`;
  fixtureServer = await createServer({
    configFile: 'vite.config.ts', cacheDir: `node_modules/.vite-e2e/flashcard-language-${testInfo.parallelIndex}`,
    appType: 'mpa', server: { host: '127.0.0.1', port: fixturePort, strictPort: true, hmr: false },
    optimizeDeps: { entries: ['e2e/fixtures/flashcard-language-visual.html'] },
  });
  await fixtureServer.listen();
});
test.afterAll(async () => { await fixtureServer?.close(); });

async function openFixture(page: Page, theme: Theme, viewport: Viewport, query: string, view: string) {
  page.on('pageerror', error => { throw error; });
  await page.setViewportSize(viewport);
  await page.emulateMedia({ colorScheme: theme.mode, reducedMotion: 'reduce' });
  // The last matching route runs first: block everything off the fixture origin, then answer the card photo.
  await page.route(new RegExp(`^https?://(?!127\\.0\\.0\\.1:${fixturePort})`), route => route.abort());
  await page.route(url => url.hostname === 'images.pexels.com', route => route.fulfill({ body: cardPhoto, contentType: 'image/jpeg' }));
  await page.addInitScript(({ family, mode }) => {
    localStorage.setItem('sonflash_theme_family', family);
    localStorage.setItem('lingoflash_theme', mode);
    localStorage.setItem('sonflash_theme_follow_system', 'false');
    localStorage.setItem('sonflash_reduced_motion', 'true');
  }, theme);
  await page.goto(`${fixtureOrigin}${fixturePath}?${query}&locale=en`);
  await expect(page.locator(`[data-flashcard-language-view="${view}"]`)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('html')).toHaveAttribute('data-theme-family', theme.family);
  if (theme.mode === 'dark') await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  else await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
}

async function expectAccessibleAndContained(page: Page, label: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${label} has horizontal overflow`).toBe(true);
  const violations = (await new AxeBuilder({ page }).include('main')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze()).violations
    .filter(violation => violation.impact === 'serious' || violation.impact === 'critical')
    .map(violation => ({ id: violation.id, nodes: violation.nodes.map(node => node.target) }));
  expect(violations, `${label}: ${JSON.stringify(violations)}`).toEqual([]);
  // Every visible control keeps a 44 px target and stays inside the viewport.
  const undersized = await page.locator('main').evaluate(main => [...main.querySelectorAll('button, summary, input, [role="button"]')]
    .filter(element => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && Number.parseFloat(style.opacity) > 0.01 && box.width > 1 && box.height > 1;
    })
    .map(element => {
      const box = element.getBoundingClientRect();
      return { name: (element.getAttribute('aria-label') || element.textContent || element.tagName).trim().slice(0, 40), width: box.width, height: box.height, left: box.left, right: box.right };
    })
    .filter(control => control.width < 43.5 || control.height < 43.5 || control.left < -1 || control.right > window.innerWidth + 1));
  expect(undersized, `${label} has undersized or clipped controls`).toEqual([]);
}

async function expectBackFooterClear(shell: Locator) {
  const more = await shell.locator('[data-card-disclosure="learning-tools"]').boundingBox();
  const footer = await shell.locator('[data-return-to-english]').first().boundingBox();
  expect(more).not.toBeNull();
  expect(footer).not.toBeNull();
  if (more && footer) expect(more.y + more.height, 'Explore more sits under the card footer').toBeLessThanOrEqual(footer.y + 1);
}

for (const theme of themes) for (const viewport of viewports) for (const language of languages) {
  test(`${theme.family} ${theme.mode} ${language.kind} language card front and back at ${viewport.name}`, async ({ page }) => {
    const name = `flashcard-language-${language.kind}-${theme.family}-${theme.mode}-${viewport.name}`;
    await openFixture(page, theme, viewport, `kind=${language.kind}&side=front`, `${language.kind}-front`);
    const shell = page.locator('.flashcard-shell');
    const face = shell.locator('.flashcard-face');
    await expect(shell).toHaveAttribute('data-card-side', 'front');
    await expect(face).toHaveAttribute('data-card-look', theme.look);
    await expect(face.locator('[data-card-headword]')).toContainText(language.headword);
    await expect(face.locator('[data-card-art]')).toHaveAttribute('data-card-art-kind', language.art);
    if (language.glyph) {
      await expect(face.locator('[data-card-glyph]')).toHaveText(language.glyph);
      await expect(face.locator('[data-card-glyph]')).toHaveAttribute('aria-hidden', 'true');
      await expect(face.getByText('Image cue unavailable')).toHaveCount(0);
    } else {
      const image = face.locator('img');
      await expect(image).toBeVisible();
      await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    }
    if (theme.look === 'crystal') await expect(face).toHaveCSS('border-top-left-radius', '0px');
    await expect(face.locator('[data-card-actions]')).toBeVisible();
    await expectAccessibleAndContained(page, `${name} front`);
    await expect(page.locator('main')).toHaveScreenshot(`${name}-front.png`, { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01 });

    await openFixture(page, theme, viewport, `kind=${language.kind}&side=back`, `${language.kind}-back`);
    const back = shell.locator('.flashcard-back');
    await expect(shell).toHaveAttribute('data-card-side', 'back');
    await expect(back).toHaveAttribute('data-card-look', theme.look);
    await expect(back.getByText(language.translation).first()).toBeVisible();
    await expectBackFooterClear(shell);
    await expectAccessibleAndContained(page, `${name} back`);
    await expect(page.locator('main')).toHaveScreenshot(`${name}-back.png`, { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01 });
  });
}

for (const theme of themes) for (const viewport of viewports) {
  test(`${theme.family} ${theme.mode} review prompt and grade row at ${viewport.name}`, async ({ page }) => {
    const name = `flashcard-review-${theme.family}-${theme.mode}-${viewport.name}`;
    await openFixture(page, theme, viewport, 'kind=en&side=front&view=review', 'en-review-front');
    const recall = page.locator('[data-active-recall]');
    const grades = page.locator('.review-grades');
    await expect(recall).toHaveAttribute('data-card-look', theme.look);
    await expect(recall.getByRole('button', { name: /Reveal answer/ })).toBeVisible();
    await expect(grades).toHaveAttribute('data-card-look', theme.look);
    await expect(grades).toHaveAttribute('data-review-state', 'locked');
    await expect(grades.locator('[data-rating]')).toHaveCount(4);
    for (const grade of await grades.locator('[data-rating]').all()) await expect(grade).toBeDisabled();
    await expectAccessibleAndContained(page, `${name} prompt`);
    await expect(page.locator('main')).toHaveScreenshot(`${name}-prompt.png`, { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01 });

    await openFixture(page, theme, viewport, 'kind=en&side=back&view=review', 'en-review-back');
    await expect(page.locator('.flashcard-shell')).toHaveAttribute('data-card-side', 'back');
    await expect(grades).toHaveAttribute('data-review-state', 'ready');
    for (const grade of await grades.locator('[data-rating]').all()) await expect(grade).toBeEnabled();
    const card = await page.locator('[data-study-card]').boundingBox();
    const row = await grades.boundingBox();
    expect(card && row && row.y >= card.y + card.height - 1, 'grade row sits below the card').toBe(true);
    await expectBackFooterClear(page.locator('.flashcard-shell'));
    await expectAccessibleAndContained(page, `${name} answer`);
    await expect(page.locator('main')).toHaveScreenshot(`${name}-answer.png`, { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01 });
  });
}
