import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures/firebase-emulator';
import type { Page, TestInfo } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

const fixedTime = new Date('2026-09-24T12:00:00.000Z');
const cards = Array.from({ length: 12 }, (_, index) => ({
  id: `paths-progress-${index}`,
  word: ['analyse', 'benefit', 'context', 'develop', 'evidence', 'focus', 'generate', 'hypothesis', 'identify', 'justify', 'knowledge', 'language'][index],
  normalizedWord: ['analyse', 'benefit', 'context', 'develop', 'evidence', 'focus', 'generate', 'hypothesis', 'identify', 'justify', 'knowledge', 'language'][index],
  translation: `nghĩa kiểm thử ${index + 1}`,
  explanation: `A deterministic learning record for visual acceptance ${index + 1}.`,
  phonetic: '',
  emoji: '📚',
  category: index < 4 ? 'IELTS' : index < 8 ? 'Work' : 'Travel',
  audioUrl: null,
  imageUrl: null,
  createdAt: `2026-08-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`,
  difficulty: index < 4 ? 'easy' : index < 8 ? 'good' : 'hard',
  ...(index < 2 ? { masteredAt: `2026-09-${String(22 + index)}T12:00:00.000Z` } : {}),
  ...(index === 0 ? { nextReviewDate: '2026-09-25T12:00:00.000Z' } : {}),
  reviews: index + 1,
  reviewHistory: [{ rating: index < 4 ? 'easy' : 'good', reviewedAt: `2026-09-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`, scheduledDays: 2, elapsedDays: 1 }],
  cefrLevel: index < 4 ? 'A2' : index < 8 ? 'B2' : 'C1',
  exampleSentence: `We ${['analyse', 'benefit', 'context', 'develop', 'evidence', 'focus', 'generate', 'hypothesis', 'identify', 'justify', 'knowledge', 'language'][index]} this visual acceptance example carefully.`,
  exampleTranslation: `Ví dụ kiểm thử ${index + 1}`,
}));

const xpHistory = {
  '2026-08-14': 12,
  '2026-08-20': 38,
  '2026-08-27': 84,
  '2026-09-02': 26,
  '2026-09-07': 112,
  '2026-09-12': 55,
  '2026-09-18': 148,
  '2026-09-23': 72,
};

const reviewActivity = {
  coverageStartedOnByLanguage: { en: '2026-03-27' },
  daysByLanguage: { en: Object.fromEntries(Array.from({ length: 26 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 3, 1 + index * 7)).toISOString().slice(0, 10);
    const reviewed = 3 + index % 5;
    const again = index % 4 === 0 ? 1 : 0;
    const hard = index % 3 === 0 ? 1 : 0;
    const easy = index % 5 === 0 ? 1 : 0;
    return [date, { reviewed, again, hard, good: reviewed - again - hard - easy, easy }];
  })) },
};

const themes = [
  { family: 'classic', mode: 'light' },
  { family: 'classic', mode: 'dark' },
  { family: 'crystal', mode: 'light' },
  { family: 'crystal', mode: 'dark' },
] as const;

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: '390px', width: 390, height: 844 },
] as const;

// Base port for this spec's own Vite fixture server, offset per-worker below.
// See practice-visual.spec.ts for why: `fullyParallel: false` still lets
// different spec files run concurrently on separate workers, and four
// unrelated -visual specs each bound a strictPort Vite server to this exact
// literal port, so two running on different workers at once raced for the
// same socket.
const CATALOG_FIXTURE_PORT_BASE = 4475;
let catalogFixturePort = CATALOG_FIXTURE_PORT_BASE;
let catalogFixtureOrigin = `http://127.0.0.1:${catalogFixturePort}`;
const catalogFixturePath = '/catalog-ready-fixture.html';
const catalogFixtureModuleId = '/virtual/catalog-ready-fixture.tsx';
let catalogFixtureServer: ViteDevServer | undefined;

const catalogFixtureModule = `
import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import '/src/index.css';
import { I18nProvider, useUiLocale } from '/src/i18n/I18nProvider';
import { loadCatalog } from '/src/i18n/loadCatalog';
import { ThemeProvider } from '/src/features/theme/ThemeProvider';
import { CatalogScreen } from '/src/features/catalogWorkspace/CatalogScreen';
import { catalogFiltersFromSummary, catalogTiersFromSummary, catalogTracksFromSummary } from '/src/features/catalogWorkspace/catalogWorkspacePresenter';
import { projectCatalogPathUnits } from '/src/features/catalogWorkspace/catalogProgressProjectionService';

const summary = {
  release: { catalogId: 'english-core', releaseId: 'reviewed-visual-1', schemaVersion: 2, contentLanguage: 'en', chunkCount: 1, membershipCount: 9, encodedBytes: 2048 },
  scannedMemberships: 9,
  tracks: [
    { trackId: 'ielts', total: 4, started: 3, mastered: 1, tiers: [{ tier: 'foundation', total: 2, started: 2, mastered: 1 }, { tier: 'core', total: 1, started: 1, mastered: 0 }, { tier: 'advanced', total: 1, started: 0, mastered: 0 }], facets: { cefrLevels: ['A2', 'B2', 'C1'], topics: ['education', 'science'], partsOfSpeech: ['noun', 'verb'], skills: ['reading', 'writing'] } },
    { trackId: 'toeic', total: 3, started: 1, mastered: 0, tiers: [{ tier: 'foundation', total: 1, started: 1, mastered: 0 }, { tier: 'core', total: 1, started: 0, mastered: 0 }, { tier: 'advanced', total: 1, started: 0, mastered: 0 }], facets: { cefrLevels: ['A2', 'B1'], topics: ['business'], partsOfSpeech: ['noun'], skills: ['listening'] } },
    { trackId: 'general', total: 2, started: 1, mastered: 1, tiers: [{ tier: 'foundation', total: 1, started: 1, mastered: 1 }, { tier: 'core', total: 1, started: 0, mastered: 0 }, { tier: 'advanced', total: 0, started: 0, mastered: 0 }], facets: { cefrLevels: ['A1', 'B1'], topics: ['daily-life'], partsOfSpeech: ['adjective'], skills: ['speaking'] } },
  ],
  units: [
    { unitId: 'analysis-basics', trackId: 'ielts', tier: 'foundation', ordinal: 1, titles: [{ language: 'en', text: 'Ideas and evidence' }, { language: 'vi', text: 'Ý tưởng và dẫn chứng' }], total: 2, started: 2, mastered: 1, preview: [{ lexemeId: 'analysis', lemma: 'analysis' }, { lexemeId: 'evidence', lemma: 'evidence' }] },
    { unitId: 'research-terms', trackId: 'ielts', tier: 'core', ordinal: 2, titles: [{ language: 'en', text: 'Research language' }, { language: 'vi', text: 'Ngôn ngữ nghiên cứu' }], total: 1, started: 1, mastered: 0, preview: [{ lexemeId: 'hypothesis', lemma: 'hypothesis' }] },
    { unitId: 'academic-argument', trackId: 'ielts', tier: 'advanced', ordinal: 3, titles: [{ language: 'en', text: 'Academic argument' }, { language: 'vi', text: 'Lập luận học thuật' }], total: 1, started: 0, mastered: 0, preview: [{ lexemeId: 'justify', lemma: 'justify' }] },
  ],
};

function CatalogReadyFixture() {
  const locale = useUiLocale();
  const continueDemo = new URLSearchParams(window.location.search).has('continueDemo');
  const [ready, setReady] = useState(false);
  const [selectedUnitId, setSelectedUnitId] = useState(null);
  const [confirmationUnitId, setConfirmationUnitId] = useState(null);
  useEffect(() => { void loadCatalog(locale, 'catalog').then(() => setReady(true)); }, [locale]);
  if (!ready) return null;
  const tracks = catalogTracksFromSummary(summary);
  const currentUnitId = selectedUnitId ?? 'ielts\\u0000analysis-basics';
  const actions = { selectLanguage() {}, selectTrack() {}, selectTier() {}, selectPathUnit(trackId, unitId) { setSelectedUnitId(trackId + '\\u0000' + unitId); setConfirmationUnitId(null); }, openNextUnitPreview() { setSelectedUnitId('ielts\\u0000analysis-basics'); setConfirmationUnitId('ielts\\u0000analysis-basics'); }, prepareSelectedUnit() { setConfirmationUnitId(currentUnitId); }, confirmSelectedUnit() {}, changeTerm() {}, changeCefr() {}, changeTopic() {}, changePartOfSpeech() {}, changeSkill() {}, resetFilters() {}, download() {}, retry() {}, loadMore() {}, addToLibrary() {}, openVocabulary() {}, continueReview() {} };
  return <main className="min-h-screen p-4 sm:p-8"><CatalogScreen model={{
    status: { kind: 'ready', isOnline: false, message: 'Reviewed catalog reviewed-visual-1 is ready on this device.' },
    selectedLanguage: 'en', uiLocale: locale, languages: [{ code: 'en', label: 'English', nativeLabel: 'English', isAvailable: true }, { code: 'ja', label: 'Japanese', nativeLabel: '日本語', isAvailable: false }],
    selectedTrack: 'ielts', tracks, selectedTier: 'foundation', tiers: catalogTiersFromSummary(summary, 'ielts'), filters: catalogFiltersFromSummary(summary, 'ielts'),
    pathUnits: projectCatalogPathUnits(summary), selectedPathUnitId: selectedUnitId,
    ...(continueDemo ? { pathUnitContinue: { selectedUnitId: currentUnitId, confirmationUnitId, busy: false, error: null, etaDays: currentUnitId.endsWith('academic-argument') ? 1 : 0, allComplete: false } } : {}),
    cards: [{ id: 'catalog-analysis', lemma: 'analysis', language: 'en', phonetic: '/əˈnæləsɪs/', partOfSpeech: 'noun', cefr: 'B2', tier: 'Foundation', topics: ['Education'], skills: ['Reading'], meaning: 'a careful study of something', meaningLanguage: 'en', translation: 'sự phân tích', translationLanguage: 'vi', example: 'The report provides a detailed analysis of the results.', exampleTranslation: 'Báo cáo cung cấp phân tích chi tiết về kết quả.', collocations: ['detailed analysis', 'data analysis'], provenance: { sourceLabel: 'Reviewed editorial catalog', licenseLabel: 'CC BY 4.0', reviewerLabel: 'Human editorial review' }, libraryState: 'available' }],
    resultSummary: 'Showing 1 reviewed IELTS Foundation word.', hasMore: false, isLoadingPage: false, isLoadingMore: false,
  }} actions={actions} /></main>;
}

createRoot(document.getElementById('root')).render(<ThemeProvider><I18nProvider><CatalogReadyFixture /></I18nProvider></ThemeProvider>);
`;

async function expectAccessibleAndContained(page: Page, screen: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${screen} has horizontal overflow`).toBeLessThanOrEqual(1);

  const clippedControls = await page.locator('button:visible, input:visible, select:visible, textarea:visible, summary:visible').evaluateAll(elements => elements
    .map(element => {
      const box = element.getBoundingClientRect();
      return { name: element.getAttribute('aria-label') || element.textContent?.trim() || element.tagName, left: box.left, right: box.right, width: box.width, height: box.height };
    })
    .filter(control => control.width > 0 && control.height > 0 && (control.left < -1 || control.right > window.innerWidth + 1)));
  expect(clippedControls, `${screen} has horizontally clipped controls`).toEqual([]);

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const blocking = results.violations
    .filter(violation => violation.impact === 'serious' || violation.impact === 'critical')
    .map(violation => ({ id: violation.id, impact: violation.impact, nodes: violation.nodes.map(node => node.target) }));
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

async function expectReducedMotion(page: Page, screen: string) {
  const activeAnimations = await page.evaluate(() => document.getAnimations()
    .filter(animation => Number(animation.effect?.getComputedTiming().duration ?? 0) > 1)
    .map(animation => animation.effect instanceof KeyframeEffect && animation.effect.target instanceof Element
      ? getComputedStyle(animation.effect.target).animationName
      : 'unnamed animation'));
  expect(activeAnimations, `${screen} starts motion despite the reduced-motion preference`).toEqual([]);
}

async function attachScreen(page: Page, testInfo: TestInfo, name: string) {
  await expect(page).toHaveScreenshot(`${name}.png`, {
    fullPage: true,
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixelRatio: 0.01,
  });
  const screenshot = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: screenshot, fullPage: true });
  await testInfo.attach(name, { path: screenshot, contentType: 'image/png' });
}

test.beforeEach(async ({ page, db, testUser, seedCards, blockExternalNetwork }) => {
  await page.clock.install({ time: fixedTime });
  // beforeAll (below) runs before any beforeEach/test in this worker, so
  // catalogFixturePort is already set to this worker's value by the time
  // this executes.
  await blockExternalNetwork(page, [catalogFixturePort]);
  await Promise.all([
    db.doc(`users/${testUser.uid}/profile/stats`).set({ verifiedXp: 547, verifiedStreak: 2, rewardTimeZone: 'UTC', reviewActivityV1: reviewActivity }),
    db.doc(`users/${testUser.uid}/profile/xp_history`).set({ verifiedByDayV1: xpHistory }),
  ]);
  await seedCards(cards);
});

test.beforeAll(async ({}, testInfo) => {
  catalogFixturePort = CATALOG_FIXTURE_PORT_BASE + testInfo.parallelIndex;
  catalogFixtureOrigin = `http://127.0.0.1:${catalogFixturePort}`;
  catalogFixtureServer = await createServer({
    configFile: 'vite.config.ts', cacheDir: `node_modules/.vite-e2e/paths-progress-visual-${testInfo.parallelIndex}`,
    appType: 'spa',
    plugins: [{
      name: 'catalog-ready-visual-fixture',
      resolveId(id) { return id === catalogFixtureModuleId ? id : null; },
      load(id) { return id === catalogFixtureModuleId ? catalogFixtureModule : null; },
      configureServer(server) {
        server.middlewares.use(catalogFixturePath, (_request, response) => {
          response.setHeader('Content-Type', 'text/html');
          response.end(`<!doctype html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Reviewed catalog Paths</title><script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script></head><body><div id="root"></div><script type="module" src="${catalogFixtureModuleId}"></script></body></html>`);
        });
      },
    }],
    server: { host: '127.0.0.1', port: catalogFixturePort, strictPort: true, preTransformRequests: false },
    // No `optimizeDeps` override: this fixture serves a synthetic HTML page
    // (no real entry file on disk for Vite to crawl), and a former
    // `noDiscovery: true, include: []` here skipped esbuild's CJS-to-ESM
    // interop pre-bundling for every CJS dependency the rendered tree needs —
    // not just `@messageformat/parser` (Lingui's ICU plural compilation,
    // "does not provide an export named 'parse'") but also `react-dom`
    // itself ("does not provide an export named 'createRoot'"), served raw
    // and crashing with a blank page. Explicitly listing each offender is
    // whack-a-mole against Vite's own dependency graph; let Vite's default
    // on-demand discovery pre-bundle whatever this tree actually imports.
  });
  await catalogFixtureServer.listen();
});

test.afterAll(async () => {
  await catalogFixtureServer?.close();
});

for (const theme of themes) {
  for (const viewport of viewports) {
    test(`${theme.family} ${theme.mode} Paths and Progress are visually accessible at ${viewport.name}`, async ({ page, signIn }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript(({ family, mode }) => {
        localStorage.setItem('sonflash_theme_family', family);
        localStorage.setItem('lingoflash_theme', mode);
        localStorage.setItem('sonflash_theme_follow_system', 'false');
      }, theme);

      await signIn(page, '/?view=catalog&locale=en');
      const root = page.locator('html');
      await expect(root).toHaveAttribute('data-theme-family', theme.family);
      if (theme.mode === 'dark') await expect(root).toHaveClass(/\bdark\b/);
      else await expect(root).not.toHaveClass(/\bdark\b/);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Continue review' })).toBeVisible();
      await expectAccessibleAndContained(page, 'Paths');
      await expectReducedMotion(page, 'Paths');
      await attachScreen(page, testInfo, `paths-${theme.family}-${theme.mode}-${viewport.name}`);

      await page.goto('/?view=progress&locale=en');
      await expect(page.getByRole('heading', { level: 1, name: /progress/i })).toBeVisible();
      await expect(page.getByRole('region', { name: /study activity/i })).toBeVisible();
      await expect(page.locator('[data-native-chart="xp"]')).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Due over the next 13 days' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Recently mastered' })).toBeVisible();
      await expectAccessibleAndContained(page, 'Progress');
      await expectReducedMotion(page, 'Progress');
      await attachScreen(page, testInfo, `progress-${theme.family}-${theme.mode}-${viewport.name}`);
      const evidence = page.getByRole('region', { name: 'Forecast and recently mastered cards' });
      const evidenceName = `progress-evidence-${theme.family}-${theme.mode}-${viewport.name}`;
      const evidenceScreenshot = testInfo.outputPath(`${evidenceName}.png`);
      await evidence.screenshot({ path: evidenceScreenshot, animations: 'disabled' });
      await testInfo.attach(evidenceName, { path: evidenceScreenshot, contentType: 'image/png' });
      await expect(evidence).toHaveScreenshot(`${evidenceName}.png`, {
        animations: 'disabled',
        caret: 'hide',
        maxDiffPixelRatio: 0.01,
      });
    });
  }
}

test('weekly recap opens with real totals computed from verified XP history', async ({ page, signIn }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signIn(page, '/?view=progress&locale=en');
  await expect(page.getByRole('heading', { level: 1, name: /progress/i })).toBeVisible();

  await page.getByRole('button', { name: /view weekly recap/i }).click();
  const dialog = page.getByRole('dialog', { name: /your weekly recap/i });
  await expect(dialog).toBeVisible();

  // The fixed clock is 2026-09-24T12:00:00Z, so the 7-day window is Sep 18–Sep 24.
  // Of the seeded xpHistory, only Sep 18 (148) and Sep 23 (72) fall
  // inside it; every other entry (Aug/Sep 2/7/12) must be excluded from the totals.
  // These figures come from plain number formatting, not from Lingui message
  // catalogs, so they are meaningful even before the new weeklyRecap.* ids below
  // go through the controller's i18n:extract/compile/translate pass.
  await expect(dialog.getByText('Sep 18')).toBeVisible();
  await expect(dialog.getByText('Sep 24')).toBeVisible();
  await expect(dialog.getByText('XP this week')).toBeVisible();
  await expect(dialog.getByText('220', { exact: true })).toBeVisible();
  await expect(dialog.getByText('2 / 7')).toBeVisible();
  await expect(dialog.getByText('148', { exact: true })).toBeVisible(); // Best day metric: Sep 18 alone.

  const captionField = dialog.getByRole('textbox', { name: /caption/i });
  await expect(captionField).not.toHaveValue('');

  // Toggling a field off removes its metric card. Targeted by the stable
  // data-selection-key attribute rather than the (not-yet-extracted) toggle
  // label text, so this assertion does not depend on the translation pass.
  await dialog.locator('input[data-selection-key="bestDay"]').uncheck();
  await expect(dialog.getByText('148', { exact: true })).toHaveCount(0);
  await dialog.locator('input[data-selection-key="bestDay"]').check();
  await expect(dialog.getByText('148', { exact: true })).toBeVisible();

  // Editing the caption is a real user action; the character budget updates live
  // (also plain number formatting, independent of the translation pass).
  await captionField.fill('A great study week!');
  await expect(dialog.getByText('19 / 220')).toBeVisible();

  // Closing and reopening resets the caption to the suggested draft, not the edited one.
  await dialog.getByRole('button', { name: /close/i }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: /view weekly recap/i }).click();
  await expect(page.getByRole('dialog', { name: /your weekly recap/i }).getByRole('textbox', { name: /caption/i })).not.toHaveValue('A great study week!');
});

for (const theme of themes) for (const viewport of viewports) {
  test(`${theme.family} ${theme.mode} weekly recap is visible at ${viewport.name}`, async ({ page, signIn }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(({ family, mode }) => {
      localStorage.setItem('sonflash_theme_family', family);
      localStorage.setItem('lingoflash_theme', mode);
      localStorage.setItem('sonflash_theme_follow_system', 'false');
    }, theme);
    await signIn(page, '/?view=progress&locale=en');
    await page.getByRole('button', { name: /view weekly recap/i }).click();
    const dialog = page.getByRole('dialog', { name: /your weekly recap/i });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('220', { exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Share' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Download PNG' })).toBeVisible();
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await expect(dialog).toHaveScreenshot(`weekly-recap-${theme.family}-${theme.mode}-${viewport.name}.png`, {
      animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01,
    });
    const screenshot = testInfo.outputPath(`weekly-recap-${theme.family}-${theme.mode}-${viewport.name}.png`);
    await dialog.screenshot({ path: screenshot, animations: 'disabled', caret: 'hide' });
    await testInfo.attach('Weekly recap', { path: screenshot, contentType: 'image/png' });
  });
}

for (const theme of themes) for (const viewport of viewports) {
  test(`${theme.family} ${theme.mode} achievements are visible at ${viewport.name}`, async ({ page, signIn }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(({ family, mode }) => {
      localStorage.setItem('sonflash_theme_family', family);
      localStorage.setItem('lingoflash_theme', mode);
      localStorage.setItem('sonflash_theme_follow_system', 'false');
    }, theme);
    await signIn(page, '/?view=progress&locale=en');
    await page.getByRole('button', { name: 'View achievements' }).click();
    await expect(page.getByRole('heading', { name: 'Your word garden' })).toBeVisible();
    await expect(page.getByText(/\d \/ 6 unlocked/)).toBeVisible();
    await expectAccessibleAndContained(page, 'Achievements');
    await expect.poll(() => page.locator('.claude-workspace').evaluate(element => element.scrollTop)).toBe(0);
    await expect(page).toHaveScreenshot(`achievements-${theme.family}-${theme.mode}-${viewport.name}.png`, {
      animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01,
    });
    const screenshot = testInfo.outputPath(`achievements-${theme.family}-${theme.mode}-${viewport.name}.png`);
    await page.screenshot({ path: screenshot, animations: 'disabled', caret: 'hide' });
    await testInfo.attach('Achievements', { path: screenshot, contentType: 'image/png' });
    await page.getByRole('button', { name: 'Back to Progress' }).click();
    await expect(page.getByRole('button', { name: 'View achievements' })).toBeVisible();
    await expect.poll(() => page.locator('.claude-workspace').evaluate(element => element.scrollTop)).toBe(0);
  });
}

for (const theme of themes) {
  for (const viewport of viewports) {
    test(`${theme.family} ${theme.mode} reviewed catalog Paths are visually accessible at ${viewport.name}`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript(({ family, mode }) => {
        localStorage.setItem('sonflash_theme_family', family);
        localStorage.setItem('lingoflash_theme', mode);
        localStorage.setItem('sonflash_theme_follow_system', 'false');
      }, theme);

      await page.goto(`${catalogFixtureOrigin}${catalogFixturePath}?locale=en`);
      const root = page.locator('html');
      await expect(root).toHaveAttribute('data-theme-family', theme.family);
      if (theme.mode === 'dark') await expect(root).toHaveClass(/\bdark\b/);
      else await expect(root).not.toHaveClass(/\bdark\b/);
      await expect(page.getByRole('heading', { level: 1, name: 'Language paths' })).toBeVisible();
      await expect(page.getByRole('region', { name: 'IELTS' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Choose a unit' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Preview: Ideas and evidence' })).toBeVisible();
      await expect(page.getByRole('heading', { name: /choose the path that fits/i })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Foundation to advanced' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Vocabulary explorer' })).toBeVisible();
      const vocabularyCard = page.getByRole('article', { name: /analysis/i });
      await expect(vocabularyCard).toBeVisible();
      await vocabularyCard.scrollIntoViewIfNeeded();
      // Regression guard: the reviewed catalog description dropped the "available offline" claim
      // (only the Firestore-backed cache persists offline, and only until the account is deleted).
      await expect(page.getByText(/available offline/i)).toHaveCount(0);
      await expectAccessibleAndContained(page, 'Reviewed catalog Paths');
      await expectReducedMotion(page, 'Reviewed catalog Paths');
      await attachScreen(page, testInfo, `paths-reviewed-${theme.family}-${theme.mode}-${viewport.name}`);
      await page.getByRole('button', { name: /Unit 2 · Research language/i }).click();
      await expect(page.getByRole('heading', { name: 'Preview: Research language' })).toBeVisible();
    });
  }
}

for (const theme of themes) {
  for (const viewport of viewports) {
    test(`${theme.family} ${theme.mode} Paths Continue confirmation is visible at ${viewport.name}`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript(({ family, mode }) => {
        localStorage.setItem('sonflash_theme_family', family);
        localStorage.setItem('lingoflash_theme', mode);
        localStorage.setItem('sonflash_theme_follow_system', 'false');
      }, theme);

      await page.goto(`${catalogFixtureOrigin}${catalogFixturePath}?locale=en&continueDemo=1`);
      await page.getByRole('button', { name: /Unit 3 · Academic argument/i }).click();
      await expect(page.getByRole('heading', { name: 'Preview: Academic argument' })).toBeVisible();
      await expect(page.getByText('Estimated 1 day left at your pace.')).toBeVisible();
      await page.getByRole('button', { name: 'Continue with this unit' }).click();
      await expect(page.getByText('Any missing unit words will be added to your Library before study.')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Add missing words and study' })).toBeVisible();
      await expectAccessibleAndContained(page, 'Paths Continue');
      await expectReducedMotion(page, 'Paths Continue');
      await page.getByRole('article', { name: /analysis/i }).scrollIntoViewIfNeeded();
      await attachScreen(page, testInfo, `paths-continue-${theme.family}-${theme.mode}-${viewport.name}`);
    });
  }
}
