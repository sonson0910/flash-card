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
// Language-pack cards (Korean, Japanese, Chinese) teach from the example and phrases on the front.
const languages = [
  { kind: 'en', name: 'English', headword: 'immediate', translation: /ngay lập tức/i, art: 'image', glyph: null, pack: null },
  { kind: 'ko', name: 'Korean', headword: '결심하다', translation: /quyết tâm/i, art: 'glyph', glyph: '결', pack: { exampleWord: '결심했어요', phrase: '굳게 결심하다', aid: '[data-reading-romanization]', switch: 'Romanization', backReading: 'gyeolsimhada' } },
  { kind: 'ja', name: 'Japanese', headword: '経験', translation: /kinh nghiệm/i, art: 'glyph', glyph: '経', pack: { exampleWord: '経験', phrase: '経験を積む', aid: '[data-reading-romaji]', switch: 'Romaji', backReading: 'けいけん · keiken' } },
  { kind: 'zh', name: 'Chinese', headword: '机会', translation: /cơ hội/i, art: 'glyph', glyph: '机', pack: { exampleWord: '机会', phrase: '抓住机会', aid: '[data-reading-pinyin]', switch: 'Pinyin', backReading: 'jī huì' } },
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
    // Ruby readings sit inside the headword, so compare the written word without them.
    await expect.poll(() => face.locator('[data-card-headword] h2').evaluate(node => {
      const copy = node.cloneNode(true) as HTMLElement;
      copy.querySelectorAll('rt').forEach(rt => rt.remove());
      return copy.textContent?.trim();
    })).toBe(language.headword);
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
    await expect(shell).toHaveAccessibleName(`${language.headword} flashcard. Showing the ${language.name} word.`);
    await expect(face.getByRole('button', { name: `Reveal the Vietnamese meaning of ${language.headword}` })).toBeVisible();
    if (language.pack) {
      await expect(face).toHaveAttribute('data-card-kind', 'language');
      await expect(face.locator('.flashcard-definition')).toHaveCount(0);
      await expect(face.locator('[data-card-section="example"] [data-example-word]')).toContainText(language.pack.exampleWord);
      await expect(face.locator('[data-card-section="phrases"]').getByRole('listitem')).toHaveCount(3);
      await expect(face.locator('[data-card-section="phrases"]')).toContainText(language.pack.phrase);
      await expect(face.locator(language.pack.aid).first()).toBeVisible();
      await expect(face.getByRole('button', { name: `Toggle ${language.pack.switch} for ${language.headword}` })).toHaveAttribute('aria-pressed', 'true');
    } else {
      await expect(face).not.toHaveAttribute('data-card-kind', 'language');
      await expect(face.locator('.flashcard-definition')).toBeVisible();
      await expect(face.locator('[data-card-section="example"]')).toHaveCount(0);
    }
    await expectAccessibleAndContained(page, `${name} front`);
    await expect(page.locator('main')).toHaveScreenshot(`${name}-front.png`, { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01 });

    await openFixture(page, theme, viewport, `kind=${language.kind}&side=back`, `${language.kind}-back`);
    const back = shell.locator('.flashcard-back');
    await expect(shell).toHaveAttribute('data-card-side', 'back');
    await expect(back).toHaveAttribute('data-card-look', theme.look);
    await expect(back.getByText(language.translation).first()).toBeVisible();
    await expect(shell).toHaveAccessibleName(`${language.headword} flashcard. Showing the Vietnamese meaning.`);
    await expect(back.getByRole('button', { name: `Return to the ${language.name} side of ${language.headword}` })).toBeVisible();
    if (language.pack) await expect(back.locator('[data-card-back-reading]')).toHaveText(language.pack.backReading);
    await expectBackFooterClear(shell);
    await expectAccessibleAndContained(page, `${name} back`);
    await expect(page.locator('main')).toHaveScreenshot(`${name}-back.png`, { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01 });
  });
}

for (const theme of themes) for (const viewport of viewports) {
  test(`${theme.family} ${theme.mode} language card reading, pitch and blind states at ${viewport.name}`, async ({ page }) => {
    const name = `flashcard-language-states-${theme.family}-${theme.mode}-${viewport.name}`;
    const shell = page.locator('.flashcard-shell');
    const face = shell.locator('.flashcard-face');

    // A verified pitch accent draws the contour; a card without an example or phrases leaves both blocks out.
    await openFixture(page, theme, viewport, 'kind=ja-pitch&side=front', 'ja-pitch-front');
    await expect(face.getByRole('img', { name: 'Pitch accent: Nakadaka' })).toBeVisible();
    await expect(face.locator('.flashcard-lang-mora[data-high="true"]')).toHaveCount(2);
    await expect(face.locator('[data-reading-romaji]')).toHaveText('nippon');
    await expect(face.locator('[data-card-section]')).toHaveCount(0);
    await expect(face.locator('.flashcard-definition')).toHaveCount(0);
    await expectAccessibleAndContained(page, `${name} pitch`);
    await expect(page.locator('main')).toHaveScreenshot(`${name}-pitch.png`, { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01 });

    // The reading switch hides the Latin aid and keeps the card on its front.
    await openFixture(page, theme, viewport, 'kind=ko&side=front', 'ko-front');
    const readingSwitch = face.getByRole('button', { name: 'Toggle Romanization for 결심하다' });
    await expect(face.locator('[data-reading-romanization]')).toHaveText(['gyeol', 'sim', 'ha', 'da']);
    await readingSwitch.click();
    await expect(readingSwitch).toHaveAttribute('aria-pressed', 'false');
    await expect(face.locator('[data-reading-romanization]')).toHaveCount(0);
    await expect(shell).toHaveAttribute('data-card-side', 'front');
    await expectAccessibleAndContained(page, `${name} reading off`);
    await expect(page.locator('main')).toHaveScreenshot(`${name}-reading-off.png`, { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01 });

    // Blind mode blurs the reading aids and hides them from assistive technology; the example stays.
    await openFixture(page, theme, viewport, 'kind=zh&side=front', 'zh-front');
    await shell.getByRole('button', { name: 'Hide readings' }).click();
    await expect(shell.getByRole('button', { name: 'Show readings' })).toHaveAttribute('aria-pressed', 'true');
    await expect(shell).toHaveAttribute('data-card-blind', 'true');
    await expect(face.locator('.flashcard-lang-tones')).toHaveAttribute('aria-hidden', 'true');
    await expect(face.locator('.flashcard-lang-tones')).toHaveCSS('filter', 'blur(7px)');
    await expect(face.locator('[data-card-section="example"]')).toBeVisible();
    await expect(shell).toHaveAttribute('data-card-side', 'front');
    await expectAccessibleAndContained(page, `${name} blind`);
    await expect(page.locator('main')).toHaveScreenshot(`${name}-blind.png`, { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01 });
  });
}

test('a card hosted in a dialog turns on a tap on its face but not on its controls', async ({ page }) => {
  await openFixture(page, themes[1], viewports[1], 'kind=zh&side=front&view=dialog', 'zh-dialog-front');
  const card = page.getByRole('dialog', { name: 'Card trial' }).getByRole('group', { name: /^机会 flashcard/ });
  await expect(card).toHaveAccessibleName('机会 flashcard. Showing the Chinese word.');
  await card.getByRole('button', { name: 'Toggle Pinyin for 机会' }).click();
  await expect(card).toHaveAccessibleName('机会 flashcard. Showing the Chinese word.');
  await card.locator('[data-flashcard-stage]').click({ position: { x: 16, y: 120 } });
  await expect(card).toHaveAccessibleName('机会 flashcard. Showing the Vietnamese meaning.');
  await card.getByRole('button', { name: 'Return to the Chinese side of 机会' }).click();
  await expect(card).toHaveAccessibleName('机会 flashcard. Showing the Chinese word.');
});

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
