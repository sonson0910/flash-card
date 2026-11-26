import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { createServer, type Plugin, type ViteDevServer } from 'vite';

// Base port for this spec's own Vite fixture server, offset per-worker below.
// See practice-visual.spec.ts for why: `fullyParallel: false` still lets
// different spec files run concurrently on separate workers, and four
// unrelated -visual specs each bound a strictPort Vite server to this exact
// literal port, so two running on different workers at once raced for the
// same socket.
const FIXTURE_PORT_BASE = 4275;
let fixturePort = FIXTURE_PORT_BASE;
let fixtureOrigin = `http://127.0.0.1:${fixturePort}`;
const fixturePath = '/e2e/fixtures/library-visual.html';
const themes = [
  { family: 'classic', mode: 'light' }, { family: 'classic', mode: 'dark' },
  { family: 'crystal', mode: 'light' }, { family: 'crystal', mode: 'dark' },
] as const;

async function gotoFixture(page: Page, query = 'locale=en') {
  const url = `${fixtureOrigin}${fixturePath}?${query}`;
  await page.goto(url);
  const root = page.locator('[data-library-visual-view]');
  await expect(root).toBeVisible({ timeout: 15_000 });
}
// LibraryScreen.tsx keeps LibraryTools inside a closed-by-default <details data-library-region="tools">.
// The disclosure is uncontrolled and sits below the card grid, so a click sent while the fixture's cards
// are still arriving can miss it or be undone by the re-render. Open it until the wanted tool is there.
async function openLibraryTools(page: Page, tool: Locator) {
  const tools = page.locator('[data-library-region="tools"]');
  await expect(async () => {
    if (!await tools.evaluate(element => (element as HTMLDetailsElement).open)) await tools.locator('summary').click();
    await expect(tool).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}
const viewports = [{ name: 'desktop', width: 1440, height: 900 }, { name: '390px', width: 390, height: 844 }] as const;

let fixtureServer: ViteDevServer | undefined;

// The word extractor's AI call answers from this list instead of the network.
const extractorPassage = 'When the river crested at dawn, residents who spent years lobbying for new barriers felt vindicated. '
  + 'The council’s response was immediate, yet engineers called the embankments a provisional fix and asked for a resilient, comprehensive plan.';
const extractorItems = [
  ['crested', 'đạt đỉnh (lũ)', 'verb', 'C1'], ['lobbying', 'vận động hành lang', 'noun', 'C1'],
  ['barriers', 'rào chắn', 'noun', 'B1'], ['vindicated', 'được minh oan', 'adjective', 'C2'],
  ['immediate', 'ngay lập tức', 'adjective', 'B1'], ['embankments', 'đê, bờ kè', 'noun', 'C1'],
  ['provisional', 'tạm thời', 'adjective', 'C1'], ['resilient', 'kiên cường', 'adjective', 'B2'],
  ['comprehensive', 'toàn diện', 'adjective', 'B2'],
].map(([word, translation, partOfSpeech, cefrLevel]) => ({
  word, surface: word, translation, partOfSpeech, cefrLevel, example: `The passage uses ${word}.`,
}));
const extractorFixtureId = '\0library-visual-extract';
const extractorFixturePlugin = (): Plugin => ({
  name: 'library-visual-extractor-fixture',
  enforce: 'pre',
  resolveId(source, importer) {
    return source === '../../lib/gemini' && importer?.endsWith('/src/features/library/WordExtractorModal.tsx')
      ? extractorFixtureId
      : null;
  },
  load(id) {
    return id === extractorFixtureId
      ? `export async function extractVocabulary() { return ${JSON.stringify(extractorItems)}; }`
      : null;
  },
});

async function expectAccessibleAndContained(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label} has horizontal overflow`).toBeLessThanOrEqual(1);
  const clipped = await page.locator('button:visible, input:visible, select:visible, textarea:visible').evaluateAll(elements => elements.map(element => {
    const box = element.getBoundingClientRect();
    return { label: element.getAttribute('aria-label') || element.textContent?.trim(), left: box.left, right: box.right, width: box.width, height: box.height };
  }).filter(control => control.width > 0 && control.height > 0 && (control.left < -1 || control.right > window.innerWidth + 1)));
  expect(clipped, `${label} has horizontally clipped controls`).toEqual([]);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  const blocking = results.violations.filter(violation => violation.impact === 'serious' || violation.impact === 'critical');
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

/**
 * Crystal paints a library dialog's fill on the frame's chamfered ::after layer, so the frame's drop-shadow glow is
 * not clipped. The fill must still end in an opaque gradient so nothing behind the dialog shows through.
 */
async function expectOpaqueCrystalFill(dialog: Locator, stops: readonly [string, string]) {
  const fill = await dialog.evaluate(element => {
    const style = getComputedStyle(element, '::after');
    return { content: style.content, position: style.position, image: style.backgroundImage };
  });
  expect(fill.content).not.toBe('none');
  expect(fill.position).toBe('absolute');
  expect(fill.image.endsWith(`linear-gradient(170deg, ${stops[0]} 0%, ${stops[1]} 100%)`)).toBe(true);
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

async function expectDialogScreen(page: Page, testInfo: TestInfo, name: string) {
  const dialog = page.locator('[role="dialog"], [role="alertdialog"]').last();
  const screenshot = testInfo.outputPath(`${name}.png`);
  await dialog.screenshot({ path: screenshot });
  await testInfo.attach(name, { path: screenshot, contentType: 'image/png' });
  await expect(dialog).toHaveScreenshot(`${name}.png`, { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01 });
}

async function expectDialogInViewport(page: Page, testInfo: TestInfo, name: string) {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeInViewport({ ratio: 1 });
  await expect(dialog.getByRole('button').last()).toBeInViewport({ ratio: 1 });
  await testInfo.attach(`${name}-viewport`, { body: await page.screenshot(), contentType: 'image/png' });
}

test.beforeAll(async ({}, testInfo) => {
  fixturePort = FIXTURE_PORT_BASE + testInfo.parallelIndex;
  fixtureOrigin = `http://127.0.0.1:${fixturePort}`;
  fixtureServer = await createServer({ configFile: 'vite.config.ts', cacheDir: `node_modules/.vite-e2e/library-visual-${testInfo.parallelIndex}`, appType: 'mpa', server: { host: '127.0.0.1', port: fixturePort, strictPort: true }, optimizeDeps: { entries: ['e2e/fixtures/library-visual.html'] }, plugins: [extractorFixturePlugin()] });
  await fixtureServer.listen();
});
test.afterAll(async () => { await fixtureServer?.close(); });

test('Library create input defers submit during IME composition', async ({ page }) => {
  await gotoFixture(page);
  // LibraryScreen.tsx now tucks LibraryTools (and its #new-word input) inside
  // a closed-by-default <details data-library-region="tools"> disclosure —
  // the primary create-card path is the dialog opened from LibraryOverview's
  // "Create card" button. Expand it before the input becomes visible.
  const input = page.locator('#new-word');
  await openLibraryTools(page, input);
  const count = page.locator('[data-library-generate-count]');
  await expect(input).toBeVisible({ timeout: 15_000 });
  await input.dispatchEvent('compositionstart');
  await input.press('Enter');
  await expect(count).toHaveText('0');
  await input.dispatchEvent('compositionend');
  // A separate Enter follows the guard's queued composition-end reset.
  await page.evaluate(() => new Promise<void>(resolve => setTimeout(resolve, 0)));
  await input.press('Enter');
  await expect(count).toHaveText('1');
});

for (const mode of ['light', 'dark'] as const) {
  test(`Crystal ${mode} library dialogs keep an opaque surface without backdrop blur`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: mode, reducedMotion: 'reduce' });
    await page.addInitScript(mode => {
      localStorage.setItem('sonflash_theme_family', 'crystal');
      localStorage.setItem('lingoflash_theme', mode);
      localStorage.setItem('sonflash_theme_follow_system', 'false');
      localStorage.setItem('sonflash_reduced_motion', 'true');
    }, mode);
    await gotoFixture(page, 'locale=en&dialog=clear');
    await page.addStyleTag({ content: '.library-dialog-overlay { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }' });
    const dialog = page.getByRole('alertdialog');
    await expectOpaqueCrystalFill(dialog, mode === 'light' ? ['rgb(255, 245, 248)', 'rgb(227, 239, 255)'] : ['rgb(26, 16, 32)', 'rgb(11, 10, 20)']);
    await expect(dialog.getByRole('button', { name: 'Keep library' })).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByRole('button', { name: 'Delete everything' })).toBeDisabled();
    await expectAccessibleAndContained(page, `Crystal ${mode} clear dialog without backdrop blur`);
    await testInfo.attach(`crystal-${mode}-clear-without-blur`, { body: await page.screenshot(), contentType: 'image/png' });
    await gotoFixture(page, 'locale=en&dialog=import-error');
    await page.addStyleTag({ content: '.library-dialog-overlay { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }' });
    const importDialog = page.getByRole('dialog');
    await expectOpaqueCrystalFill(importDialog, mode === 'light' ? ['rgb(245, 251, 255)', 'rgb(219, 238, 255)'] : ['rgb(20, 26, 43)', 'rgb(10, 13, 23)']);
    await expect(importDialog.getByRole('alert')).toBeVisible();
    await expectAccessibleAndContained(page, `Crystal ${mode} import dialog without backdrop blur`);
    await testInfo.attach(`crystal-${mode}-import-without-blur`, { body: await page.screenshot(), contentType: 'image/png' });
  });
}

for (const theme of themes) for (const viewport of viewports) {
  test(`${theme.family} ${theme.mode} Library and dialogs are visually accessible at ${viewport.name}`, async ({ page }, testInfo) => {
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
    const name = `library-${theme.family}-${theme.mode}-${viewport.name}`;
    await gotoFixture(page);
    await expect(page.locator('[data-library-visual-view]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#new-word')).toHaveAttribute('lang', 'en');
    await expect(page.locator('#new-word')).toHaveAttribute('inputmode', 'text');
    await expect(page.locator('html')).toHaveAttribute('data-theme-family', theme.family);
    if (theme.mode === 'dark') await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    else await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
    if (theme.family === 'crystal') await expect(page.locator('#sonflash-crystal-theme')).toHaveAttribute('href', '/theme-crystal.css');
    if (theme.family === 'crystal') await expect(page.locator('.library-word-grade').first()).toBeVisible();
    else await expect(page.locator('.library-word-grade').first()).toBeHidden();
    await expect(page.getByText('/əˈdæpt/')).toBeVisible();
    await expect(page.getByText('in 2d')).toBeVisible();
    await expectAccessibleAndContained(page, name);
    await expectReducedMotion(page, name);
    await expectScreen(page, testInfo, name);

    // LibraryScreen.tsx now tucks LibraryTools (and its "AI Dialogue"/"Scan
    // Text" buttons) inside a closed-by-default <details data-library-region="tools">
    // disclosure — see the IME test above for the same pattern.
    await openLibraryTools(page, page.getByRole('button', { name: 'AI Dialogue' }));
    await page.getByRole('button', { name: 'AI Dialogue' }).click();
    await expect(page.getByRole('heading', { name: 'Practice in context' })).toBeVisible();
    await expectAccessibleAndContained(page, `${name}-dialogue`);
    await expectReducedMotion(page, `${name}-dialogue`);
    await expectDialogInViewport(page, testInfo, `${name}-dialogue`);
    await expectScreen(page, testInfo, `${name}-dialogue`);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();

    await page.getByRole('button', { name: 'Scan Text' }).click();
    await expect(page.getByRole('heading', { name: 'Scan text' })).toBeVisible();
    await expectAccessibleAndContained(page, `${name}-extractor`);
    await expectReducedMotion(page, `${name}-extractor`);
    await expectDialogInViewport(page, testInfo, `${name}-extractor`);
    await expectScreen(page, testInfo, `${name}-extractor`);
  });
}

for (const mode of ['light', 'dark'] as const) for (const viewport of viewports) {
  test(`crystal ${mode} Library list view keeps every row inside its rim at ${viewport.name}`, async ({ page }, testInfo) => {
    page.on('pageerror', error => { throw error; });
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: mode, reducedMotion: 'reduce' });
    await page.route(new RegExp(`^https?://(?!127\\.0\\.0\\.1:${fixturePort})`), route => route.abort());
    await page.addInitScript(mode => {
      localStorage.setItem('sonflash_theme_family', 'crystal');
      localStorage.setItem('lingoflash_theme', mode);
      localStorage.setItem('sonflash_theme_follow_system', 'false');
      localStorage.setItem('sonflash_reduced_motion', 'true');
    }, mode);
    const name = `library-crystal-${mode}-${viewport.name}-list`;
    await gotoFixture(page);
    const listView = page.getByRole('button', { name: 'List view' });
    await listView.click();
    await expect(listView).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-library-view="list"]')).toBeVisible();
    await expect(page.getByText('/əˈdæpt/')).toBeVisible();
    await expect(page.getByText('in 2d')).toBeVisible();
    // Each row grows with its content, so no part of it may reach past the row's box: a part that did would
    // cover the rim's chamfered corner or spill into the next row.
    const spills = await page.locator('.library-word-card').evaluateAll(cards => cards.flatMap((card, index) => {
      const row = card.getBoundingClientRect();
      return [...card.children].flatMap(part => {
        const box = part.getBoundingClientRect();
        const outside = box.width > 0 && box.height > 0
          && (box.top < row.top - 0.5 || box.left < row.left - 0.5 || box.bottom > row.bottom + 0.5 || box.right > row.right + 0.5);
        return outside ? [`row ${index + 1}: ${part.className}`] : [];
      });
    }));
    expect(spills, `${name} has parts outside their row`).toEqual([]);
    if (viewport.name === '390px') {
      // On a phone the row actions stay visible and keep a 44 px touch target.
      const targets = await page.locator('.library-word-card :is(.library-word-controls button, .library-word-select)').evaluateAll(elements => elements
        .map(element => element.getBoundingClientRect())
        .filter(box => box.width > 0 && box.height > 0)
        .map(box => Math.min(box.width, box.height)));
      expect(targets.length).toBeGreaterThan(0);
      expect(Math.min(...targets), `${name} has a row action under 44 px`).toBeGreaterThanOrEqual(44);
    }
    await expectAccessibleAndContained(page, name);
    await expectReducedMotion(page, name);
    await expectScreen(page, testInfo, name);
  });
}

const otherDialogViews = [
  ['edit', 'Edit card'], ['edit-review', 'Edit card'], ['deck-delete', /Delete “IELTS”/],
  // AppOverlays.tsx's share dialog title is now dynamic: outgoing shows
  // `Share "{category}"` (shell.share.outgoing-title), incoming shows the
  // category name alone as the heading (with a "Shared with you" kicker
  // above it) instead of a generic "Review shared deck"/"ready to share"
  // phrase. The fixture (library-visual.tsx) always uses category "IELTS".
  ['share', 'Share “IELTS”'], ['share-in', 'IELTS'],
  ['clear', 'Clear the entire library?'], ['insights', 'Learning insights'],
] as const;
const deckDialogViews = [
  ['deck-create-ready', 'New deck'], ['deck-create-progress', 'New deck'], ['deck-create-error', 'New deck'],
] as const;
const importDialogViews = [
  ['import-ready', 'Import from spreadsheet'], ['import-progress', 'Import from spreadsheet'], ['import-error', 'Import from spreadsheet'],
  ['import-deck', 'Import from spreadsheet'],
] as const;
const dialogGroups = [
  ['other', otherDialogViews], ['deck', deckDialogViews], ['import', importDialogViews],
] as const;
const inlineViews = [['import', 'Import cards']] as const;

for (const theme of themes) for (const viewport of viewports) for (const [group, dialogViews] of dialogGroups) {
  test(`${theme.family} ${theme.mode} Library ${group} dialog surfaces are visually accessible at ${viewport.name}`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
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
    for (const [dialog, title] of dialogViews) {
      const name = `library-${dialog}-${theme.family}-${theme.mode}-${viewport.name}`;
      await gotoFixture(page, `locale=en&dialog=${dialog}`);
      await expect(page.getByRole(dialog === 'clear' || dialog === 'deck-delete' ? 'alertdialog' : 'dialog')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('heading', { name: title })).toBeVisible();
      if (dialog === 'deck-create-progress') {
        await expect(page.getByRole('status').filter({ hasText: 'Creating…' })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Create deck' })).toHaveAttribute('aria-busy', 'true');
      }
      if (dialog === 'deck-create-error') await expect(page.getByRole('alert')).toBeVisible();
      if (dialog === 'import-progress') {
        // Crystal keeps the native bar; Classic draws its own so the fill can animate.
        await expect(page.getByRole('progressbar', { name: 'Importing 12 of 24' })).toHaveAttribute(theme.family === 'crystal' ? 'value' : 'aria-valuenow', '12');
      }
      if (dialog === 'import-error') await expect(page.getByRole('alert')).toBeVisible();
      if (dialog === 'edit-review') {
        await expect(page.getByText('Card 2 of 6')).toBeVisible();
        await expect(page.getByText('This review stays paused while you edit.')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Save & resume' })).toBeVisible();
      }
      await expectAccessibleAndContained(page, name);
      await expectReducedMotion(page, name);
      if (dialog === 'edit' || dialog === 'edit-review') {
        const backdropPreview = page.locator('[data-edit-preview-backdrop]');
        const sheetPreview = page.locator('[data-edit-preview]');
        if (dialog === 'edit') {
          // From the library the editor is a centred dialog with no card behind it.
          await expect(backdropPreview).toHaveCount(0);
          if (viewport.name === 'desktop') await expect(sheetPreview).toBeHidden();
          else await expect(sheetPreview).toBeVisible();
        } else if (viewport.name === 'desktop') {
          await expect(backdropPreview).toBeVisible();
          await expect(sheetPreview).toBeHidden();
          const previewLayer = await backdropPreview.evaluate(element => Number(getComputedStyle(element).zIndex));
          const overlayLayer = await page.locator('[data-edit-overlay]').evaluate(element => Number(getComputedStyle(element).zIndex));
          expect(previewLayer).toBeGreaterThan(overlayLayer);
        } else {
          await expect(backdropPreview).toBeHidden();
          await expect(sheetPreview).toBeVisible();
        }
        const screenshot = testInfo.outputPath(`${name}-page.png`);
        await page.screenshot({ path: screenshot, fullPage: true, animations: 'disabled', caret: 'hide' });
        await testInfo.attach(`${name}-page`, { path: screenshot, contentType: 'image/png' });
      }
      await expectDialogScreen(page, testInfo, name);
      if (dialog === 'deck-create-ready') {
        const classicLight = theme.family === 'classic' && theme.mode === 'light';
        const violet = page.getByRole('radio', { name: classicLight ? 'Moss' : 'Violet' });
        await expect(violet).toBeChecked();
        await violet.focus();
        await page.keyboard.press('ArrowRight');
        await expect(page.getByRole('radio', { name: classicLight ? 'Gold' : 'Amber' })).toBeChecked();
      }
      if (dialog === 'import-progress') {
        await expect(page.getByText('Results so far')).toBeVisible();
        await expect(page.getByText('Row 7')).toBeVisible();
        await expect(page.getByText('Column 3')).toBeVisible();
      }
      if (dialog === 'import-deck') {
        await expect(page.getByText('3 new cards named decks you do not have, so they were saved to Unassigned.')).toBeVisible();
      }
      if (dialog === 'import-error') {
        await expect(page.getByText('Row 4')).toBeVisible();
        await expect(page.getByText('Column 2')).toBeVisible();
        await expect(page.getByText('Row 7')).toBeVisible();
        await expect(page.getByText('Column 3')).toBeVisible();
      }
    }
  });
}

async function scanExtractorPassage(page: Page) {
  await gotoFixture(page, 'locale=en&dialog=extract');
  await openLibraryTools(page, page.getByRole('button', { name: 'Scan Text' }));
  await page.getByRole('button', { name: 'Scan Text' }).click();
  const dialog = page.getByRole('dialog', { name: 'Scan text' });
  await dialog.getByRole('textbox', { name: 'Text to scan' }).fill(extractorPassage);
  await dialog.getByRole('button', { name: 'Extract vocabulary' }).click();
  await expect(dialog.getByText('Found 9 words')).toBeVisible();
  return dialog;
}

for (const theme of themes) for (const viewport of viewports) {
  test(`${theme.family} ${theme.mode} Library word extractor marks the scanned words and saves them to a deck at ${viewport.name}`, async ({ page }, testInfo) => {
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
    const name = `library-extract-results-${theme.family}-${theme.mode}-${viewport.name}`;
    const dialog = await scanExtractorPassage(page);

    const marks = dialog.locator('[data-testid="extractor-highlights"] mark');
    await expect(marks).toHaveText(extractorItems.map(item => item.word));
    await expect(dialog.locator('[data-testid="extractor-highlights"] mark.is-owned')).toHaveText(['immediate', 'resilient']);
    const deck = dialog.getByRole('combobox', { name: 'Deck' });
    await expect(deck).toHaveValue('');
    await expect(dialog.getByText('Deck: Unassigned')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Save 7 cards' })).toBeEnabled();
    await expectAccessibleAndContained(page, name);
    await expectReducedMotion(page, name);
    await expectDialogInViewport(page, testInfo, name);
    await expectDialogScreen(page, testInfo, name);

    await deck.selectOption('IELTS');
    await expect(dialog.getByText('Deck: IELTS')).toBeVisible();
    await dialog.getByRole('button', { name: 'Save 7 cards' }).click();
    const imported = page.locator('[data-library-imported-file]');
    await expect(imported).toContainText('"Deck"');
    const rows = (await imported.textContent() ?? '').split('\n');
    expect(rows.slice(1).map(row => [row.split(',')[0], row.split(',').at(-1)])).toEqual(
      ['crested', 'lobbying', 'barriers', 'vindicated', 'embankments', 'provisional', 'comprehensive'].map(word => [`"${word}"`, '"IELTS"']),
    );
  });
}

test('Library word extractor drops its marks when the passage is edited', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const dialog = await scanExtractorPassage(page);
  const layer = dialog.locator('[data-testid="extractor-highlights"]');
  await expect(layer.locator('mark')).toHaveCount(9);

  const passage = dialog.getByRole('textbox', { name: 'Text to scan' });
  await passage.press('End');
  await passage.pressSequentially(' More.');
  await expect(layer).toHaveCount(0);
  await expect(dialog.getByText('Found 9 words')).toBeVisible();
  await dialog.getByRole('button', { name: 'Extract vocabulary' }).click();
  await expect(layer.locator('mark')).toHaveCount(9);
  await expect(dialog.getByRole('button', { name: 'Extract vocabulary' })).toHaveCount(0);
});

test('Library edit image removal makes the unsaved draft state explicit', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.route(new RegExp(`^https?://(?!127\\.0\\.0\\.1:${fixturePort})`), route => route.abort());
  await page.addInitScript(() => {
    localStorage.setItem('sonflash_theme_family', 'classic');
    localStorage.setItem('lingoflash_theme', 'light');
    localStorage.setItem('sonflash_theme_follow_system', 'false');
    localStorage.setItem('sonflash_reduced_motion', 'true');
  });
  await gotoFixture(page, 'locale=en&dialog=edit-image-remove');

  await expect(page.locator('[data-edit-image-remove]')).toBeVisible();
  await page.locator('[data-edit-image-remove]').click();

  await expect(page.locator('[data-edit-image-remove]')).toHaveCount(0);
  await expect(page.locator('[data-edit-preview] img')).toHaveCount(0);
  await expect(page.locator('[data-edit-dirty]')).toHaveText('Unsaved');
  await expect(page.getByRole('button', { name: 'Discard' })).toBeVisible();
  // Where the form rests after the photo is removed can differ by a pixel from run to run, so the capture
  // first scrolls the settled form to a fixed place, with the pointer off the form.
  await page.locator('[data-edit-image-find]').evaluate(element => element.scrollIntoView({ block: 'center', behavior: 'instant' }));
  await page.mouse.move(0, 0);
  const screenshot = testInfo.outputPath('library-edit-image-removed-classic-light-mobile.png');
  const image = await page.locator('[role="dialog"]').last().screenshot({ path: screenshot, animations: 'disabled', caret: 'hide' });
  await testInfo.attach('library-edit-image-removed-classic-light-mobile', { path: screenshot, contentType: 'image/png' });
  expect(image).toMatchSnapshot('library-edit-image-removed-classic-light-mobile.png');
});

test('Library edit mutation states render their real field and submit feedback', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.route(new RegExp(`^https?://(?!127\\.0\\.0\\.1:${fixturePort})`), route => route.abort());
  await page.route(/https:\/\/images\.pexels\.com\/photos\/267885\//, route => route.fulfill({
    path: 'docs/design/sonflash-redesign/canvas/assets/blob/dc9678b28352d8aeb0fea95d3a58a38d.jpg',
    contentType: 'image/jpeg',
  }));
  await page.addInitScript(() => {
    localStorage.setItem('sonflash_theme_family', 'classic');
    localStorage.setItem('lingoflash_theme', 'light');
    localStorage.setItem('sonflash_theme_follow_system', 'false');
    localStorage.setItem('sonflash_reduced_motion', 'true');
  });

  await gotoFixture(page, 'locale=en&dialog=edit-ready');
  await expect(page.locator('[data-edit-word-input]')).toHaveValue('adapt');
  await expect(page.locator('[data-edit-partofspeech-input]')).toHaveValue('verb');
  await expect(page.locator('[data-edit-category-input]')).toHaveValue('IELTS');
  await expect(page.locator('[data-edit-image-remove]')).toBeVisible();
  await expect(page.locator('[data-edit-image-find]')).toBeEnabled();
  await expect.poll(() => page.locator('img[src*="267885"]').first().evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  for (const control of [page.locator('[data-edit-word-save]'), page.locator('[data-edit-image-find]'), page.locator('[data-edit-image-remove]')]) {
    const box = await control.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await expectDialogScreen(page, testInfo, 'library-edit-ready-fields-classic-light-mobile');
  await page.locator('[data-edit-image-find]').click({ trial: true });
  await page.locator('[data-edit-image-remove]').click({ trial: true });

  await page.locator('[data-edit-category-input]').fill('Academic');
  await expect(page.locator('[data-edit-dirty]')).toHaveText('Unsaved');
  await page.getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByRole('alertdialog', { name: 'Discard unsaved changes?' })).toBeVisible();
  await expectDialogScreen(page, testInfo, 'library-edit-discard-classic-light-mobile');
  await page.getByRole('button', { name: 'Keep editing' }).click();

  for (const state of ['working', 'conflict', 'error'] as const) {
    await gotoFixture(page, `locale=en&dialog=edit-${state}`);
    await expect.poll(() => page.locator('img[src*="267885"]').first().evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    await page.locator('[data-edit-category-input]').fill('Academic');
    await page.getByRole('button', { name: 'Save changes' }).click();
    if (state === 'working') {
      await expect(page.locator('form#edit-card-form')).toHaveAttribute('aria-busy', 'true');
      await expect(page.getByRole('button', { name: 'Saving changes…' })).toBeDisabled();
    } else {
      await expect(page.getByRole('alert')).toHaveText('Your changes could not be saved. This card may have changed elsewhere. Try again.');
      await expect(page.getByRole('button', { name: 'Retry save' })).toBeVisible();
      await page.getByRole('alert').scrollIntoViewIfNeeded();
    }
    await expectDialogScreen(page, testInfo, `library-edit-${state}-classic-light-mobile`);
  }
});

for (const theme of themes) for (const viewport of viewports) {
  test(`${theme.family} ${theme.mode} Library inline tools are visually accessible at ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: theme.mode, reducedMotion: 'reduce' });
    await page.route(new RegExp(`^https?://(?!127\\.0\\.0\\.1:${fixturePort})`), route => route.abort());
    await page.addInitScript(({ family, mode }) => {
      localStorage.setItem('sonflash_theme_family', family);
      localStorage.setItem('lingoflash_theme', mode);
      localStorage.setItem('sonflash_theme_follow_system', 'false');
      localStorage.setItem('sonflash_reduced_motion', 'true');
    }, theme);
    for (const [dialog, title] of inlineViews) {
      const name = `library-${dialog}-${theme.family}-${theme.mode}-${viewport.name}`;
      await gotoFixture(page, `locale=en&dialog=${dialog}`);
      const surface = page.locator('[data-library-inline-visual]');
      await expect(surface).toBeVisible({ timeout: 15_000 });
      await expect(surface.getByRole('heading', { name: title })).toBeVisible();
      await expectAccessibleAndContained(page, name);
      await expectReducedMotion(page, name);
      await expect(surface).toHaveScreenshot(`${name}.png`, { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01 });
      const screenshot = testInfo.outputPath(`${name}.png`);
      await surface.screenshot({ path: screenshot });
      await testInfo.attach(name, { path: screenshot, contentType: 'image/png' });
    }
  });
}
