import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

const cards = Array.from({ length: 12 }, (_, index) => {
  const word = ['analyse', 'benefit', 'context', 'develop', 'evidence', 'focus', 'generate', 'hypothesis', 'identify', 'justify', 'knowledge', 'language'][index];
  return {
    id: `daily-visual-${index}`,
    word,
    normalizedWord: word,
    translation: `nghĩa kiểm thử ${index + 1}`,
    explanation: `A deterministic explanation for ${word}.`,
    phonetic: '',
    emoji: '📚',
    category: 'IELTS',
    audioUrl: null,
    imageUrl: null,
    createdAt: `2026-08-01T10:${String(index).padStart(2, '0')}:00.000Z`,
    difficulty: 'unrated',
    cefrLevel: index < 4 ? 'A2' : index < 8 ? 'B2' : 'C1',
    exampleSentence: `We ${word} this visual acceptance example carefully.`,
    exampleTranslation: `Ví dụ kiểm thử ${index + 1}`,
  };
});

const themes = [
  { family: 'classic', mode: 'light' },
  { family: 'classic', mode: 'dark' },
  { family: 'crystal', mode: 'light' },
  { family: 'crystal', mode: 'dark' },
] as const;

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

async function expectAccessibleAndContained(page: Page, screen: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${screen} has horizontal overflow`).toBeLessThanOrEqual(1);

  const clippedControls = await page.locator('button:visible, input:visible, select:visible, textarea:visible, summary:visible').evaluateAll(elements => elements
    .map(element => {
      const box = element.getBoundingClientRect();
      return {
        name: element.getAttribute('aria-label') || element.textContent?.trim() || element.tagName.toLowerCase(),
        left: box.left,
        right: box.right,
        width: box.width,
        height: box.height,
      };
    })
    .filter(control => control.width > 0 && control.height > 0)
    .filter(control => control.left < -1 || control.right > window.innerWidth + 1));
  expect(clippedControls, `${screen} has horizontally clipped controls`).toEqual([]);

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const blocking = results.violations
    .filter(violation => violation.impact === 'serious' || violation.impact === 'critical')
    .map(violation => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map(node => ({ target: node.target, failureSummary: node.failureSummary })),
    }));
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
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

async function expectReducedProgressMotion(page: Page) {
  const durations = await page.locator('[role="progressbar"] div[style]').evaluateAll(elements => elements.map(element => {
    const duration = getComputedStyle(element).transitionDuration;
    return Number.parseFloat(duration) || 0;
  }));
  expect(durations).not.toEqual([]);
  expect(durations.every(duration => duration <= 0.001)).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173)/, route => route.abort());
  await page.addInitScript(initialCards => {
    localStorage.setItem('lingoflash_cards', JSON.stringify(initialCards));
    localStorage.setItem('lingoflash_cards_scoped_v1', JSON.stringify({ version: 1, ownerId: null, cards: initialCards }));
    localStorage.removeItem('lingoflash_cards_owner');
  }, cards);
});

for (const theme of themes) {
  for (const viewport of viewports) {
    test(`${theme.family} ${theme.mode} daily learning screens are visually accessible at ${viewport.name}`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript(({ family, mode }) => {
        localStorage.setItem('sonflash_theme_family', family);
        localStorage.setItem('lingoflash_theme', mode);
        localStorage.setItem('sonflash_theme_follow_system', 'false');
      }, theme);

      await page.goto('/?locale=en');
      const root = page.locator('html');
      await expect(root).toHaveAttribute('data-theme-family', theme.family);
      if (theme.mode === 'dark') await expect(root).toHaveClass(/\bdark\b/);
      else await expect(root).not.toHaveClass(/\bdark\b/);

      await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
      await expect(page.getByRole('button', { name: /Recognition/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /study days?/i })).toHaveCount(0);
      await expectAccessibleAndContained(page, 'Today');
      await attachScreen(page, testInfo, `${theme.family}-${theme.mode}-${viewport.name}-today`);

      await page.evaluate(() => {
        const now = new Date();
        const day = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        localStorage.setItem('lingoflash_gamification:anonymous:snapshot', JSON.stringify({
          version: 1,
          snapshot: { streak: 3, xp: 30, lastActive: now.toDateString(), history: { [day]: 30 } },
        }));
      });
      await page.reload();
      await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
      await page.getByRole('button', { name: '3 study days' }).click();
      await expect(page.getByRole('dialog', { name: 'Your study rhythm' })).toBeVisible();
      await expectAccessibleAndContained(page, 'Study streak');
      await attachScreen(page, testInfo, `${theme.family}-${theme.mode}-${viewport.name}-streak`);
      await page.getByRole('button', { name: 'Close streak details' }).click();

      await page.getByRole('button', { name: /Recognition/ }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Lesson' })).toBeVisible();
      await expect(page.getByRole('progressbar', { name: 'Lesson progress' })).toBeVisible();
      await expectReducedProgressMotion(page);
      await expectAccessibleAndContained(page, 'Lesson');
      await attachScreen(page, testInfo, `${theme.family}-${theme.mode}-${viewport.name}-lesson`);

      await page.goto('/?lesson=placement&locale=en');
      await expect(page.getByRole('heading', { level: 1, name: 'Placement check' })).toBeVisible();
      await page.getByRole('button', { name: 'Start placement check' }).click();
      await expect(page.getByRole('progressbar', { name: 'Placement progress' })).toBeVisible();
      await expectReducedProgressMotion(page);
      await expectAccessibleAndContained(page, 'Placement');
      await attachScreen(page, testInfo, `${theme.family}-${theme.mode}-${viewport.name}-placement`);
    });
  }
}
