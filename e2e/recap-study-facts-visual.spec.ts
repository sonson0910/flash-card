import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';

// The weekly recap card, the session recap's duration and estimate, and the Progress study facts
// render from the verified stats the app already holds. The emulator journeys cannot reach the
// counted states until the app passes those stats down, so this spec renders the components
// from the shared verified-stats fixtures and checks every theme at both widths. It records
// screenshots as attachments and compares no goldens.
const fixturePath = '/e2e/fixtures/recap-study-facts.html';
// Base port for this spec's own Vite fixture server, offset per worker (see practice-visual.spec.ts).
const FIXTURE_PORT_BASE = 5255;
let fixtureOrigin = `http://127.0.0.1:${FIXTURE_PORT_BASE}`;
// The fixtures' "now": Thursday 19 Nov 2026, 20:05 in Ho Chi Minh City.
const fixedTime = new Date('2026-11-19T13:05:00.000Z');

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

let fixtureServer: ViteDevServer | undefined;

test.beforeAll(async ({}, testInfo) => {
  const port = FIXTURE_PORT_BASE + testInfo.parallelIndex;
  fixtureOrigin = `http://127.0.0.1:${port}`;
  fixtureServer = await createServer({
    configFile: 'vite.config.ts', cacheDir: `node_modules/.vite-e2e/recap-study-facts-visual-${testInfo.parallelIndex}`,
    appType: 'mpa',
    server: { host: '127.0.0.1', port, strictPort: true },
    optimizeDeps: { entries: ['e2e/fixtures/recap-study-facts.html'] },
  });
  await fixtureServer.listen();
});

test.afterAll(async () => {
  await fixtureServer?.close();
});

async function openFixture(page: Page, theme: typeof themes[number], viewport: typeof viewports[number], query: string) {
  page.on('pageerror', error => { throw error; });
  await page.clock.setFixedTime(fixedTime);
  await page.setViewportSize(viewport);
  await page.emulateMedia({ colorScheme: theme.mode, reducedMotion: 'reduce' });
  await page.addInitScript(({ family, mode }) => {
    localStorage.setItem('sonflash_theme_family', family);
    localStorage.setItem('lingoflash_theme', mode);
    localStorage.setItem('sonflash_theme_follow_system', 'false');
    localStorage.setItem('sonflash_reduced_motion', 'true');
  }, theme);
  await page.goto(`${fixtureOrigin}${fixturePath}?${query}`);
  await expect(page.locator('html')).toHaveAttribute('data-theme-family', theme.family);
  if (theme.family === 'crystal') await expect(page.locator('#sonflash-crystal-theme')).toHaveAttribute('href', '/theme-crystal.css');
}

async function expectAccessibleAndContained(page: Page, scope: string, label: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${label} has horizontal overflow`).toBe(true);
  const clipped = await page.locator(`${scope} button:visible`).evaluateAll(elements => elements
    .map(element => ({ name: element.getAttribute('aria-label') || element.textContent?.trim(), box: element.getBoundingClientRect() }))
    .filter(({ box }) => box.width > 0 && (box.left < -1 || box.right > window.innerWidth + 1))
    .map(({ name }) => name));
  expect(clipped, `${label} has clipped controls`).toEqual([]);
  const results = await new AxeBuilder({ page })
    .include(scope)
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const blocking = results.violations.filter(violation => violation.impact === 'serious' || violation.impact === 'critical');
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
}

async function attach(target: Locator, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`);
  await target.screenshot({ path, animations: 'disabled' });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

for (const theme of themes) {
  for (const viewport of viewports) {
    const label = `${theme.family} ${theme.mode} ${viewport.name}`;

    test(`${label} weekly recap shows the counted Monday week`, async ({ page }, testInfo) => {
      await openFixture(page, theme, viewport, 'view=weekly&state=counted&locale=en');
      const dialog = page.getByRole('dialog', { name: 'Your weekly recap' });
      await expect(dialog).toBeVisible({ timeout: 15_000 });
      const card = dialog.locator('.weekly-recap-card');
      await expect(card.locator('.weekly-recap-card__range').first()).toHaveText(/^16\s?–\s?22 Nov$/);
      await expect(card.locator('.weekly-recap-card__hero-metric strong')).toHaveText('146');
      await expect(card.locator('[data-chip="streak"] dd')).toHaveText('12 d');
      // Recall counts Hard as recalled: 130 graded reviews this week, 12 of them Again.
      await expect(card.locator('[data-chip="recall"] dd')).toHaveText('91%');
      await expect(card.locator('[data-chip="studied"] dd')).toHaveText('14 min');
      await expect(card.locator('.weekly-recap-card__heatmap-cell[data-future="true"]')).toHaveCount(3);
      // 146 words against the best complete week since counting began, 108 last week.
      await expect(dialog.getByRole('heading', { level: 1 })).toHaveText('Your best week since 2 Nov.');
      await expect(dialog.locator('.weekly-recap-controls__lead')).toHaveText('+38 words compared with last week.');
      // The word of the week is offered but off until the learner turns it on.
      const wordToggle = dialog.locator('input[data-selection-key="wordOfWeek"]');
      await expect(wordToggle).not.toBeChecked();
      await expect(card.locator('.weekly-recap-card__word')).toHaveCount(0);
      await expectAccessibleAndContained(page, '[role="dialog"]', `${label} weekly recap`);
      await attach(dialog, testInfo, `weekly-recap-counted-${theme.family}-${theme.mode}-${viewport.name}`);

      await wordToggle.check();
      await expect(card.locator('.weekly-recap-card__word-value')).toHaveText('immediate');
      await attach(card, testInfo, `weekly-recap-word-of-week-${theme.family}-${theme.mode}-${viewport.name}`);
    });

    test(`${label} weekly recap writes the first counted week and the empty week`, async ({ page }, testInfo) => {
      await openFixture(page, theme, viewport, 'view=weekly&state=ship&locale=en');
      let dialog = page.getByRole('dialog', { name: 'Your weekly recap' });
      await expect(dialog).toBeVisible({ timeout: 15_000 });
      await expect(dialog.locator('.weekly-recap-card__hero-metric')).toContainText('since Tuesday');
      await expect(dialog.locator('[data-chip="studied"] dt')).toHaveText('studied since Tuesday');
      await expect(dialog.getByText('Weekly word counts started on 17 Nov.')).toBeVisible();
      await expect(dialog.getByRole('heading', { level: 1 })).toHaveText('Your week so far.');
      await expectAccessibleAndContained(page, '[role="dialog"]', `${label} first counted week`);
      await attach(dialog, testInfo, `weekly-recap-ship-${theme.family}-${theme.mode}-${viewport.name}`);

      await page.goto(`${fixtureOrigin}${fixturePath}?view=weekly&state=empty&locale=en`);
      dialog = page.getByRole('dialog', { name: 'Your weekly recap' });
      await expect(dialog.locator('.weekly-recap-card__empty')).toBeVisible({ timeout: 15_000 });
      await expect(dialog.locator('.weekly-recap-card')).not.toContainText(/\b0\b/);
      await expect(dialog.locator('input[data-selection-key]')).toHaveCount(0);
      // The empty sentence stays clear of the Crystal companion.
      const companion = await dialog.locator('.weekly-recap-card__companion').boundingBox();
      const empty = await dialog.locator('.weekly-recap-card__empty').boundingBox();
      if (companion && empty) expect(empty.x + empty.width).toBeLessThanOrEqual(companion.x + 1);
      await expectAccessibleAndContained(page, '[role="dialog"]', `${label} empty week`);
      await attach(dialog, testInfo, `weekly-recap-empty-${theme.family}-${theme.mode}-${viewport.name}`);
    });

    test(`${label} session recap shows the real duration and the next-review estimate`, async ({ page }, testInfo) => {
      for (const locale of ['en', 'vi'] as const) {
        await openFixture(page, theme, viewport, `view=session&locale=${locale}`);
        const recap = page.locator('[data-session-recap]');
        await expect(recap).toBeVisible({ timeout: 15_000 });
        // Classic writes the duration into the title; Crystal gives it a Study time tile.
        if (theme.family === 'crystal') await expect(recap.locator('[data-recap-duration]')).toHaveText('04:05');
        else await expect(recap.getByRole('heading', { name: locale === 'vi' ? 'Hoàn thành phiên học · 4 phút 5 giây' : 'Session complete · 4 min 5 s' })).toBeVisible();
        // 61 timed reviews over 1,290 s in the last four weeks: 24 cards take about 8 minutes.
        await expect(recap.getByText(locale === 'vi' ? '24 thẻ · khoảng 8 phút' : '24 cards · about 8 min', { exact: true })).toBeVisible();
        await expectAccessibleAndContained(page, '[data-session-recap]', `${label} ${locale} session recap`);
        await attach(recap, testInfo, `session-recap-${theme.family}-${theme.mode}-${viewport.name}-${locale}`);
      }
    });

    test(`${label} Progress study facts and ranges read the verified stats`, async ({ page }, testInfo) => {
      await openFixture(page, theme, viewport, 'view=stats&locale=en');
      const board = page.locator('[data-study-facts-board]');
      await expect(board).toBeVisible({ timeout: 15_000 });
      await expect(board.locator('[data-progress-learning-since="subtitle"]')).toHaveText('Learning since 2 June 2026');
      await expect(board.locator('[data-progress-learning-since="kicker"]')).toHaveText('since 2 Jun 2026');
      await expect(board.locator('[data-progress-studied]')).toHaveText('25 m studied since 12 Nov');
      await expect(board.locator('[data-fact="pace"]')).toHaveText('Study pace5 min a day');
      // The stored best is 11, but the current 12-day run is longer.
      await expect(board.locator('[data-fact="best-streak"] dd')).toHaveText('12 days');

      const activity = board.getByRole('region', { name: 'Activity', exact: true });
      const allTime = activity.getByRole('button', { name: 'All time' });
      await expect(allTime).toBeVisible();
      await expect.poll(async () => (await allTime.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      await allTime.click();
      await expect(allTime).toHaveAttribute('aria-pressed', 'true');
      await expect(activity).toContainText('Reviews per day since');
      await expectAccessibleAndContained(page, '[data-study-facts-board]', `${label} study facts`);
      await attach(board, testInfo, `progress-study-facts-${theme.family}-${theme.mode}-${viewport.name}`);
    });
  }
}
