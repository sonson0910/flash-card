import { expect, test } from './fixtures/firebase-emulator';
import type { Page, TestInfo } from '@playwright/test';
import { createServer, type Plugin, type ViteDevServer } from 'vite';

const stateFixturePath = '/e2e/fixtures/web-words-visual.html';
const STATE_FIXTURE_PORT_BASE = 4775;
const webWordsHookFixtureId = '\0web-words-visual-hook';
let stateFixturePort = STATE_FIXTURE_PORT_BASE;
let stateFixtureOrigin = `http://127.0.0.1:${stateFixturePort}`;
let stateFixtureServer: ViteDevServer | undefined;

const themes = [
  { family: 'classic', mode: 'light' }, { family: 'classic', mode: 'dark' },
  { family: 'crystal', mode: 'light' }, { family: 'crystal', mode: 'dark' },
] as const;
const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const;
const visualStates = ['loading', 'empty', 'error', 'signed-out'] as const;

const webWordsStateFixturePlugin = (): Plugin => ({
  name: 'web-words-state-visual-fixture',
  enforce: 'pre',
  resolveId(source, importer) {
    return source === './useWebWordsPage' && importer?.endsWith('/src/features/webWords/WebWordsPage.tsx')
      ? webWordsHookFixtureId
      : null;
  },
  load(id) {
    if (id !== webWordsHookFixtureId) return null;
    return `
      const actions = {
        setSiteFilter: () => undefined, setDayFilter: () => undefined, setTierFilter: () => undefined,
        toggleSelected: () => undefined, clearSelection: () => undefined, loadMore: () => undefined,
        addSelectedToToday: () => undefined, retry: () => undefined,
      };
      export function useWebWordsPage() {
        const status = new URLSearchParams(location.search).get('state') || 'loading';
        return { state: {
          status, groups: [], filters: { site: null, day: null, tier: null }, availableSites: [], availableDays: [],
          hasNext: false, isLoadingMore: false, selectedCardIds: new Set(), addToTodayStatus: 'idle',
        }, actions };
      }
    `;
  },
});

const webCard = (id: string, word: string, translation: string, source: { url: string; title: string; capturedAt: string; context?: string }) => ({
  id,
  word,
  normalizedWord: word,
  translation,
  explanation: 'Seeded for WebWords visual evidence.',
  phonetic: '',
  emoji: '📝',
  category: 'Other',
  partOfSpeech: 'noun',
  audioUrl: null,
  imageUrl: null,
  language: 'en',
  createdAt: source.capturedAt,
  reviews: 0,
  source,
});

async function expectNoHorizontalOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label} has horizontal overflow`).toBeLessThanOrEqual(1);
  const clipped = await page.locator('button:visible, select:visible, input:visible').evaluateAll(elements => elements.map(element => {
    const box = element.getBoundingClientRect();
    return { label: element.getAttribute('aria-label') || element.textContent?.trim(), left: box.left, right: box.right };
  }).filter(control => control.left < -1 || control.right > window.innerWidth + 1));
  expect(clipped, `${label} has horizontally clipped controls`).toEqual([]);
}

async function attachScreen(page: Page, testInfo: TestInfo, name: string) {
  const screenshot = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: screenshot, fullPage: true, animations: 'disabled', caret: 'hide' });
  await testInfo.attach(name, { path: screenshot, contentType: 'image/png' });
  await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true, animations: 'disabled', caret: 'hide' });
}

async function expectStateAccessibleAndContained(page: Page, name: string, state: (typeof visualStates)[number]) {
  const dialog = page.getByRole('dialog', { name: 'Web words' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Close web words' })).toBeVisible();
  if (state === 'loading') {
    await expect(dialog.getByRole('status')).toHaveText('Loading your web words…');
    await expect(dialog.getByRole('status')).toHaveAttribute('aria-live', 'polite');
  } else if (state === 'empty') {
    await expect(dialog.getByText('No web words yet', { exact: true })).toBeVisible();
    await expect(dialog.getByText('Save a word while reading on the web, and it will show up here.')).toBeVisible();
  } else if (state === 'error') {
    await expect(dialog.getByText('Web words could not load. Try again.')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Try again' })).toBeVisible();
  } else {
    await expect(dialog.getByText('Sign in to see words you saved from the web.')).toBeVisible();
  }
  await expectNoHorizontalOverflow(page, name);
}

test.beforeAll(async ({}, testInfo) => {
  stateFixturePort = STATE_FIXTURE_PORT_BASE + testInfo.parallelIndex;
  stateFixtureOrigin = `http://127.0.0.1:${stateFixturePort}`;
  stateFixtureServer = await createServer({
    configFile: 'vite.config.ts',
    cacheDir: `node_modules/.vite-e2e/web-words-visual-${testInfo.parallelIndex}`,
    appType: 'mpa',
    plugins: [webWordsStateFixturePlugin()],
    server: { host: '127.0.0.1', port: stateFixturePort, strictPort: true },
    optimizeDeps: { entries: ['e2e/fixtures/web-words-visual.html'] },
  });
  await stateFixtureServer.listen();
});

test.afterAll(async () => { await stateFixtureServer?.close(); });

for (const theme of themes) for (const viewport of viewports) {
  test(`${theme.family} ${theme.mode} WebWords has runtime visual evidence at ${viewport.name}`, async ({
    page, seedCards, signIn, blockExternalNetwork,
  }, testInfo) => {
    const name = `web-words-${theme.family}-${theme.mode}-${viewport.name}`;
    await seedCards([
      webCard('web-words-resilient', 'resilient', 'kiên cường', {
        url: 'https://www.bbc.com/news/example', title: 'The flood that rewrote a city’s plans overnight', capturedAt: '2026-09-26T09:00:00.000Z', context: 'The resilient community rebuilt the bridge after the flood.',
      }),
      webCard('web-words-scrutiny', 'scrutiny', 'sự giám sát', {
        url: 'https://www.bbc.com/news/example', title: 'The flood that rewrote a city’s plans overnight', capturedAt: '2026-09-26T09:00:00.000Z',
      }),
      webCard('web-words-unprecedented', 'unprecedented', 'chưa từng có', {
        url: 'https://www.theguardian.com/environment/example', title: 'Oceans are heating faster than models predicted', capturedAt: '2026-09-21T09:00:00.000Z', context: 'Unprecedented temperatures changed the ocean currents.',
      }),
      webCard('web-words-mitigate', 'mitigate', 'giảm thiểu', {
        url: 'https://www.theguardian.com/environment/example', title: 'Oceans are heating faster than models predicted', capturedAt: '2026-09-21T09:00:00.000Z',
      }),
    ]);
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: theme.mode, reducedMotion: 'reduce' });
    await page.addInitScript(({ family, mode }) => {
      localStorage.setItem('sonflash_theme_family', family);
      localStorage.setItem('lingoflash_theme', mode);
      localStorage.setItem('sonflash_theme_follow_system', 'false');
      localStorage.setItem('sonflash_reduced_motion', 'true');
    }, theme);
    await blockExternalNetwork(page);
    await signIn(page, '/?view=today&locale=en&webWords=1');

    const dialog = page.getByRole('dialog', { name: 'Web words' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Words captured while reading the web.')).toBeVisible();
    await expect(dialog.getByLabel('Site')).toBeVisible();
    await expect(dialog.getByLabel('Day')).toBeVisible();
    await expect(dialog.getByLabel('Status')).toBeVisible();
    await expect(dialog.getByText('The flood that rewrote a city’s plans overnight')).toBeVisible();
    await expect(dialog.getByText('Oceans are heating faster than models predicted')).toBeVisible();
    await expect(dialog.getByText('resilient', { exact: true })).toBeVisible();
    await expect(dialog.getByText('unprecedented', { exact: true })).toBeVisible();
    await expect(dialog.getByText('The resilient community rebuilt the bridge after the flood.')).toBeVisible();
    await expect(dialog.getByRole('checkbox')).toHaveCount(4);
    await dialog.getByRole('checkbox', { name: 'Select resilient' }).check();
    await expect(dialog.getByRole('button', { name: 'Add to today' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-theme-family', theme.family);
    if (theme.mode === 'dark') await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    else await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
    await expectNoHorizontalOverflow(page, name);
    await attachScreen(page, testInfo, name);
  });
}

for (const theme of themes) for (const viewport of viewports) for (const state of visualStates) {
  test(`${theme.family} ${theme.mode} WebWords ${state} state has visual evidence at ${viewport.name}`, async ({ page }, testInfo) => {
    const name = `web-words-${state}-${theme.family}-${theme.mode}-${viewport.name}`;
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: theme.mode, reducedMotion: 'reduce' });
    await page.route(new RegExp(`^https?://(?!127\\.0\\.0\\.1:${stateFixturePort})`), route => route.abort());
    await page.addInitScript(({ family, mode }) => {
      localStorage.setItem('sonflash_theme_family', family);
      localStorage.setItem('lingoflash_theme', mode);
      localStorage.setItem('sonflash_theme_follow_system', 'false');
      localStorage.setItem('sonflash_reduced_motion', 'true');
    }, theme);
    await page.goto(`${stateFixtureOrigin}${stateFixturePath}?locale=en&state=${state}`);
    await expect(page.locator('html')).toHaveAttribute('data-theme-family', theme.family);
    if (theme.mode === 'dark') await expect(page.locator('html')).toHaveClass(/\bdark\b/);
    else await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
    await expectStateAccessibleAndContained(page, name, state);
    await attachScreen(page, testInfo, name);
  });
}
