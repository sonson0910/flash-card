import { expect, test, type Page } from './fixtures/firebase-emulator';
import type { Locator } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

const layouts = [
  { name: 'normal', width: 1280, height: 900, zoom: '100%' },
  { name: '320px/200%', width: 320, height: 700, zoom: '200%' },
] as const;

let fixtureServer: ViteDevServer | undefined;
let fixtureOrigin = '';

const cards = Array.from({ length: 4 }, (_, index) => ({
  id: `phase6-target-${index}`,
  word: ['focus', 'practice', 'repeat', 'remember'][index],
  normalizedWord: ['focus', 'practice', 'repeat', 'remember'][index],
  translation: ['tập trung', 'luyện tập', 'lặp lại', 'ghi nhớ'][index],
  explanation: 'A compact card used to measure interactive controls.',
  phonetic: '/test/',
  emoji: '📘',
  category: 'Accessibility',
  audioUrl: null,
  imageUrl: null,
  exampleSentence: 'Practice helps you remember.',
  createdAt: `2026-07-26T00:0${index}:00.000Z`,
  bookmarked: false,
  difficulty: 'unrated',
  customDeck: null,
}));

async function expectTargets(locator: Locator, label: string) {
  const count = await locator.count();
  expect(count, `${label} should expose at least one reachable control`).toBeGreaterThan(0);
  for (let index = 0; index < count; index += 1) {
    const control = locator.nth(index);
    const name = await control.evaluate(element => element.getAttribute('aria-label') || element.textContent?.trim() || element.className);
    await expect.poll(
      async () => (await control.boundingBox())?.width ?? 0,
      { message: `${label} control ${index} (${name}) width` },
    ).toBeGreaterThanOrEqual(44);
    await expect.poll(
      async () => (await control.boundingBox())?.height ?? 0,
      { message: `${label} control ${index} (${name}) height` },
    ).toBeGreaterThanOrEqual(44);
  }
}

async function openLibrary(page: Page, navigate: (page: Page, url: string) => Promise<void> = async (p, url) => { await p.goto(url); }) {
  await navigate(page, '/?view=library');
  await expect(page.getByRole('heading', { name: 'Your library' })).toBeVisible();
}

async function applyLayout(page: Page, layout: typeof layouts[number]) {
  await page.setViewportSize({ width: layout.width, height: layout.height });
  await page.locator('html').evaluate((element, zoom) => { element.style.fontSize = zoom; }, layout.zoom);
}

// Vite can serve the first dependency-optimization request before its module
// graph is ready, leaving a blank page (same race library-visual.spec.ts's
// gotoFixture already works around for its own standalone fixture server).
// RecapHarness's SessionRecapModal renders through a Radix Dialog.Portal
// (into document.body, not #root), so the mounted check must look for the
// dialog itself there instead of a direct #root child.
async function gotoFixtureView(page: Page, view: 'undo' | 'recap') {
  await page.goto(`${fixtureOrigin}/e2e/fixtures/phase6-touch-targets.html?view=${view}`);
  const mounted = view === 'recap' ? page.getByRole('dialog').first() : page.locator('#root > *').first();
  if (await mounted.isVisible({ timeout: 5_000 }).catch(() => false)) return;
  await page.reload();
  await expect(mounted).toBeVisible({ timeout: 15_000 });
}

test.beforeAll(async ({}, testInfo) => {
  const port = 4174 + ['chromium', 'firefox', 'webkit'].indexOf(testInfo.project.name);
  fixtureOrigin = `http://127.0.0.1:${port}`;
  fixtureServer = await createServer({
    configFile: 'vite.config.ts', cacheDir: `node_modules/.vite-e2e/phase6-touch-targets-${testInfo.parallelIndex}`,
    appType: 'mpa',
    server: { host: '127.0.0.1', port, strictPort: true },
    optimizeDeps: { entries: ['e2e/fixtures/phase6-touch-targets.html'] },
  });
  await fixtureServer.listen();
});

test.afterAll(async () => {
  await fixtureServer?.close();
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lingoflash_theme', 'light');
  });
});

test('LibraryTools, Flashcard, and CardMnemonicSection measure at least 44px in both layouts', async ({ page, seedCards, seedCourseProfile, signIn }) => {
  await seedCards(cards);
  // A fresh signed-in test user with no course profile currently sees the
  // full-screen OnboardingJourney overlay even though it already has cards
  // (tracked as a product bug owned by the onboarding lane); seed a legacy
  // profile so this test can reach the ordinary library shell.
  await seedCourseProfile();
  let signedIn = false;
  for (const layout of layouts) {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    if (signedIn) await openLibrary(page);
    else { await openLibrary(page, signIn); signedIn = true; }
    await applyLayout(page, layout);

    const tools = page.locator('#library-tools');
    // The "More library tools" disclosure's <summary> is a sibling of
    // #library-tools (LibraryScreen.tsx), not a descendant, and Chromium
    // exposes <summary> with role "generic", not "button".
    await page.locator('summary').filter({ hasText: 'More library tools' }).click();
    await expectTargets(tools.locator('button:visible, input:not([type="file"]):visible, select:visible'), `LibraryTools ${layout.name}`);

    // The flashcard only renders inside the "Open card" detail dialog
    // (LibraryCardGrid.tsx's Dialog.Root), not inline in the grid.
    await page.locator('[data-library-card-id="phase6-target-0"] .library-word-open').click();
    const card = page.getByRole('group', { name: /focus flashcard/i });
    await card.getByRole('button', { name: /Reveal the Vietnamese meaning/ }).click();
    await expect(card.locator('[data-mnemonic-generate]')).toBeVisible();
    const revealedContent = card.locator('[data-card-content="revealed"]');
    await expectTargets(revealedContent.locator('button[data-card-control]:visible, button[data-mnemonic-generate]:visible'), `Flashcard and CardMnemonicSection ${layout.name}`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  }
});

test('undo pauses on hover and focus, then dismisses once after the remaining time', async ({ page }) => {
  await page.clock.install();
  for (const layout of layouts) {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    await gotoFixtureView(page, 'undo');
    await applyLayout(page, layout);
    // UndoToast.tsx renders role="status" (a polite live region), not "alert".
    const toast = page.getByRole('status').filter({ hasText: 'Card deleted' });
    await expect(toast).toBeVisible();
    await expectTargets(toast.getByRole('button'), `UndoToast ${layout.name}`);

    await toast.hover();
    await expect(toast.locator('.undo-toast-progress')).toHaveCSS('animation-play-state', 'paused');
    await page.clock.runFor(5_100);
    await expect(toast).toBeVisible();

    await page.getByRole('button', { name: 'Replace dismiss callback' }).click();
    await toast.getByRole('button', { name: 'Undo' }).focus();
    await page.mouse.move(0, 0);
    await page.clock.runFor(5_100);
    await expect(toast).toBeVisible();

    await page.getByRole('button', { name: 'Replace dismiss callback' }).focus();
    await expect(toast.locator('.undo-toast-progress')).toHaveCSS('animation-play-state', 'running');
    await page.clock.runFor(5_000);
    await expect(toast).toBeHidden();
    await expect.poll(() => page.evaluate(() => (window as Window & { undoDismissVersion?: number }).undoDismissVersion)).toBe(1);
  }
});

test('Shadowing and SessionRecapModal controls measure at least 44px in both layouts', async ({ page, seedCards, seedCourseProfile, signIn }) => {
  await seedCards(cards);
  // See the identical onboarding-overlay note in the previous test.
  await seedCourseProfile();
  let signedIn = false;
  for (const layout of layouts) {
    await page.setViewportSize({ width: layout.width, height: layout.height });
    if (signedIn) await page.goto('/?view=today');
    else { await signIn(page, '/?view=today'); signedIn = true; }
    await applyLayout(page, layout);
    await page.getByRole('button', { name: 'More practice' }).click();
    // practiceModeRegistry.ts's shadowing mode label is "Shadowing" (its
    // description text is concatenated into the same choice's accessible
    // name); there is no "Shadowing Arena" copy anywhere in the app.
    await page.getByRole('dialog').getByRole('button', { name: /^Shadowing / }).click();
    await expect(page.getByRole('button', { name: 'Close shadowing practice' })).toBeVisible();
    await expectTargets(page.locator('main button:visible'), `Shadowing ${layout.name}`);

    await gotoFixtureView(page, 'recap');
    await applyLayout(page, layout);
    // SessionRecapModal.tsx's title is "Session complete" (recap.title), not
    // "Session Complete!".
    const recap = page.getByRole('dialog').filter({ has: page.getByText('Session complete') });
    await expect(recap).toBeVisible();
    await expectTargets(recap.getByRole('button'), `SessionRecapModal ${layout.name}`);
  }
});
