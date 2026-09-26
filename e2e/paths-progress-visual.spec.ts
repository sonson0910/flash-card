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
  reviews: index + 1,
  reviewHistory: [{ rating: index < 4 ? 'easy' : 'good', reviewedAt: `2026-09-${String(index + 1).padStart(2, '0')}T12:00:00.000Z`, scheduledDays: 2, elapsedDays: 1 }],
  cefrLevel: index < 4 ? 'A2' : index < 8 ? 'B2' : 'C1',
  exampleSentence: `We ${['analyse', 'benefit', 'context', 'develop', 'evidence', 'focus', 'generate', 'hypothesis', 'identify', 'justify', 'knowledge', 'language'][index]} this visual acceptance example carefully.`,
  exampleTranslation: `Ví dụ kiểm thử ${index + 1}`,
}));

const xpHistory = {
  'Aug 14, 2026': 12,
  'Aug 20, 2026': 38,
  'Aug 27, 2026': 84,
  'Sep 2, 2026': 26,
  'Sep 7, 2026': 112,
  'Sep 12, 2026': 55,
  'Sep 18, 2026': 148,
  'Sep 23, 2026': 72,
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

const summary = {
  release: { catalogId: 'english-core', releaseId: 'reviewed-visual-1', schemaVersion: 1, contentLanguage: 'en', chunkCount: 1, membershipCount: 9, encodedBytes: 2048 },
  scannedMemberships: 9,
  tracks: [
    { trackId: 'ielts', total: 4, started: 3, mastered: 1, tiers: [{ tier: 'foundation', total: 2, started: 2, mastered: 1 }, { tier: 'core', total: 1, started: 1, mastered: 0 }, { tier: 'advanced', total: 1, started: 0, mastered: 0 }], facets: { cefrLevels: ['A2', 'B2', 'C1'], topics: ['education', 'science'], partsOfSpeech: ['noun', 'verb'], skills: ['reading', 'writing'] } },
    { trackId: 'toeic', total: 3, started: 1, mastered: 0, tiers: [{ tier: 'foundation', total: 1, started: 1, mastered: 0 }, { tier: 'core', total: 1, started: 0, mastered: 0 }, { tier: 'advanced', total: 1, started: 0, mastered: 0 }], facets: { cefrLevels: ['A2', 'B1'], topics: ['business'], partsOfSpeech: ['noun'], skills: ['listening'] } },
    { trackId: 'general', total: 2, started: 1, mastered: 1, tiers: [{ tier: 'foundation', total: 1, started: 1, mastered: 1 }, { tier: 'core', total: 1, started: 0, mastered: 0 }, { tier: 'advanced', total: 0, started: 0, mastered: 0 }], facets: { cefrLevels: ['A1', 'B1'], topics: ['daily-life'], partsOfSpeech: ['adjective'], skills: ['speaking'] } },
  ],
};

const actions = { selectLanguage() {}, selectTrack() {}, selectTier() {}, changeTerm() {}, changeCefr() {}, changeTopic() {}, changePartOfSpeech() {}, changeSkill() {}, resetFilters() {}, download() {}, retry() {}, loadMore() {}, addToLibrary() {}, openVocabulary() {}, continueReview() {} };

function CatalogReadyFixture() {
  const locale = useUiLocale();
  const [ready, setReady] = useState(false);
  useEffect(() => { void loadCatalog(locale, 'catalog').then(() => setReady(true)); }, [locale]);
  if (!ready) return null;
  const tracks = catalogTracksFromSummary(summary);
  return <main className="min-h-screen p-4 sm:p-8"><CatalogScreen model={{
    status: { kind: 'ready', isOnline: false, isAvailableOffline: true, message: 'Reviewed catalog reviewed-visual-1 is ready on this device.' },
    selectedLanguage: 'en', languages: [{ code: 'en', label: 'English', nativeLabel: 'English', isAvailable: true }, { code: 'ja', label: 'Japanese', nativeLabel: '日本語', isAvailable: false }],
    selectedTrack: 'ielts', tracks, selectedTier: 'foundation', tiers: catalogTiersFromSummary(summary, 'ielts'), filters: catalogFiltersFromSummary(summary, 'ielts'),
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

test.beforeEach(async ({ page, testUser, seedCards, blockExternalNetwork }) => {
  await page.clock.install({ time: fixedTime });
  // beforeAll (below) runs before any beforeEach/test in this worker, so
  // catalogFixturePort is already set to this worker's value by the time
  // this executes.
  await blockExternalNetwork(page, [catalogFixturePort]);
  await page.addInitScript(({ uid, history }) => {
    localStorage.setItem(`lingoflash_gamification:${uid}:snapshot`, JSON.stringify({
      version: 1,
      snapshot: { streak: 2, xp: 547, lastActive: 'Wed Sep 23 2026', history },
    }));
  }, { uid: testUser.uid, history: xpHistory });
  await seedCards(cards);
});

test.beforeAll(async ({}, testInfo) => {
  catalogFixturePort = CATALOG_FIXTURE_PORT_BASE + testInfo.parallelIndex;
  catalogFixtureOrigin = `http://127.0.0.1:${catalogFixturePort}`;
  catalogFixtureServer = await createServer({
    configFile: 'vite.config.ts',
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
      await expectAccessibleAndContained(page, 'Paths');
      await expectReducedMotion(page, 'Paths');
      await attachScreen(page, testInfo, `paths-${theme.family}-${theme.mode}-${viewport.name}`);

      await page.goto('/?view=progress&locale=en');
      await expect(page.getByRole('heading', { level: 1, name: /progress/i })).toBeVisible();
      await expect(page.getByRole('region', { name: /study activity/i })).toBeVisible();
      await expect(page.locator('[data-native-chart="xp"]')).toBeVisible();
      await expectAccessibleAndContained(page, 'Progress');
      await expectReducedMotion(page, 'Progress');
      await attachScreen(page, testInfo, `progress-${theme.family}-${theme.mode}-${viewport.name}`);
    });
  }
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
      await expect(page.getByRole('heading', { name: /choose the path that fits/i })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Foundation to advanced' })).toBeVisible();
      await expect(page.getByRole('heading', { name: 'Vocabulary explorer' })).toBeVisible();
      const vocabularyCard = page.getByRole('article', { name: /analysis/i });
      await expect(vocabularyCard).toBeVisible();
      await vocabularyCard.scrollIntoViewIfNeeded();
      await expectAccessibleAndContained(page, 'Reviewed catalog Paths');
      await expectReducedMotion(page, 'Reviewed catalog Paths');
      await attachScreen(page, testInfo, `paths-reviewed-${theme.family}-${theme.mode}-${viewport.name}`);
    });
  }
}
