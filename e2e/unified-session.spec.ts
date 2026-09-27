import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures/firebase-emulator';
import type { Locator, Page, TestInfo } from '@playwright/test';

// The sequenced daily session (Today → review → bridge → new words → bridge →
// Word Match → recap) needs at least one due/weak card to enter the review
// stage at all — `daily-learning-visual.spec.ts`'s all-`unrated` fixture only
// ever produces the 'new' bucket (see `reasonFor` in dailyPlan.ts), so it can
// never reach `beginMultiStageSession`'s review branch. This file's fixture
// is split so every stage in the plan is non-empty and gets exercised for
// real: 6 due cards (reviews > 0 with a past `nextReviewDate`) and 6 unrated
// cards, all with distinct word/translation pairs so Word Match also clears
// its 4-pair minimum on the same pool.
const dueWords = ['analyse', 'benefit', 'context', 'develop', 'evidence', 'focus'];
const newWords = ['generate', 'hypothesis', 'identify', 'justify', 'knowledge', 'language'];

function buildCard(word: string, index: number, kind: 'due' | 'new') {
  return {
    // reviewCardV2's `cardForValidation` (functions/src/reviewPersistence.ts)
    // requires the stored document's own `id` to equal the canonical id
    // `canonicalCard` would derive from its word — for a plain lowercase
    // English word that is `word-${word}` (`createWordCardId` in
    // src/lib/cardIdentity.ts's legacy branch) — or every rating in this
    // spec fails with `identity-conflict` before it can advance a question.
    id: `word-${word}`,
    word,
    normalizedWord: word,
    translation: `nghĩa hợp nhất ${kind} ${index + 1}`,
    explanation: `A unified-session explanation for ${word}.`,
    phonetic: '',
    emoji: '📚',
    category: 'IELTS',
    audioUrl: null,
    imageUrl: null,
    createdAt: `2026-08-01T09:${String(index).padStart(2, '0')}:00.000Z`,
    exampleSentence: `We ${word} this unified session example carefully.`,
    exampleTranslation: `Ví dụ hợp nhất ${index + 1}`,
    // Also required by `cardForValidation`: it rejects any stored card whose
    // `schemaVersion` isn't already 2, and `revision` must already be a safe
    // non-negative integer (`safeCounter`) before a review can advance it.
    schemaVersion: 2,
    revision: 1,
    ...(kind === 'due'
      ? { difficulty: 'good', reviews: 3, nextReviewDate: '2020-01-01T00:00:00.000Z' }
      : { difficulty: 'unrated', reviews: 0 }),
  };
}

const reviewCount = dueWords.length;
const freshCount = newWords.length;
const cards = [
  ...dueWords.map((word, index) => buildCard(word, index, 'due')),
  ...newWords.map((word, index) => buildCard(word, index, 'new')),
];

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

// Same acceptance check as `daily-learning-visual.spec.ts`: no horizontal
// overflow, no horizontally clipped controls, no serious/critical axe
// violations. Kept as a local copy rather than a shared import because that
// is the established pattern across this suite's visual specs.
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

/**
 * Answers the current lesson question with the first offered choice, rates it
 * "Good", and waits for either the next question or the stage's own "Lesson
 * complete" screen. Rating commits through the non-optimistic `reviewCardV2`
 * callable (no local optimistic advance — `DailyLearningWorkspace.tsx`'s
 * `rate` action), so the wait after rating gets the same generous budget the
 * rest of this suite already uses for that round-trip.
 */
async function rateCurrentQuestion(page: Page, complete: Locator): Promise<void> {
  await page.getByRole('group', { name: 'Choose one answer' }).getByRole('button').first().click();
  await page.getByRole('button', { name: 'Submit answer' }).click();
  await expect(page.locator('[data-lesson-feedback]')).toBeVisible();
  await page.getByRole('button', { name: 'Good' }).click();
  // `AnswerControl`'s <fieldset> is the same DOM node across questions (only
  // its `disabled` attribute and options change), so waiting for its "group"
  // role to reappear never proves advancement. "Submit answer" is only
  // rendered while `model.status === 'answering'` (LessonScreen.tsx), so its
  // remount is the real signal that a fresh question is ready.
  const submitButton = page.getByRole('button', { name: 'Submit answer' });
  await expect(submitButton.or(complete)).toBeVisible({ timeout: 15_000 });
}

/**
 * Drives one full review/new-word lesson stage to completion and on into the
 * next bridge. `onFront`/`onBack` are only invoked once, on the stage's first
 * question, so a caller can capture the "review front" and "review back" (or
 * "new word") states without also capturing five near-duplicate repeats.
 */
async function runLessonStage(
  page: Page,
  itemCount: number,
  onFront: () => Promise<void>,
  onBack?: () => Promise<void>,
): Promise<void> {
  await expect(page.locator('[data-session-shell="lesson"]')).toBeVisible();
  await onFront();

  const complete = page.getByRole('heading', { level: 1, name: 'Lesson complete' });
  await page.getByRole('group', { name: 'Choose one answer' }).getByRole('button').first().click();
  await page.getByRole('button', { name: 'Submit answer' }).click();
  await expect(page.locator('[data-lesson-feedback]')).toBeVisible();
  if (onBack) await onBack();
  await page.getByRole('button', { name: 'Good' }).click();
  const submitButton = page.getByRole('button', { name: 'Submit answer' });
  await expect(submitButton.or(complete)).toBeVisible({ timeout: 15_000 });

  for (let index = 1; index < itemCount; index += 1) {
    if (await complete.isVisible()) break;
    await rateCurrentQuestion(page, complete);
  }
  if (await complete.isVisible()) await page.getByRole('button', { name: 'Back to Today' }).click();
  await expect(page.locator('[data-session-shell="bridge"]')).toBeVisible({ timeout: 15_000 });
}

test.beforeEach(async ({ seedCards, blockExternalNetwork, page }) => {
  await blockExternalNetwork(page);
  await seedCards(cards);
});

for (const theme of themes) {
  for (const viewport of viewports) {
    test(`${theme.family} ${theme.mode} unified daily session flow is visually accessible at ${viewport.name}`, async ({ page, signIn }, testInfo) => {
      // Six lesson items per stage plus a Word Match round, each rated
      // through the real reviewCardV2 emulator round-trip, comfortably
      // exceeds Playwright's 30s default under cold-dev-server load.
      test.setTimeout(150_000);
      const label = `${theme.family}-${theme.mode}-${viewport.name}`;
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript(({ family, mode }) => {
        localStorage.setItem('sonflash_theme_family', family);
        localStorage.setItem('lingoflash_theme', mode);
        localStorage.setItem('sonflash_theme_follow_system', 'false');
      }, theme);

      await signIn(page, '/?view=today&locale=en');
      await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
      await expect(page.getByText('12 items')).toBeVisible();
      await page.getByRole('button', { name: "Start today's session" }).click();

      // Review: the plan's 6 due cards. Captures the answering ("front") and
      // feedback ("back") states of the same first question.
      await runLessonStage(
        page,
        reviewCount,
        async () => {
          await expectAccessibleAndContained(page, 'Review front');
          await attachScreen(page, testInfo, `${label}-review-front`);
        },
        async () => {
          await expectAccessibleAndContained(page, 'Review back');
          await attachScreen(page, testInfo, `${label}-review-back`);
        },
      );
      await expectAccessibleAndContained(page, 'Bridge');
      await attachScreen(page, testInfo, `${label}-bridge`);
      await page.getByRole('button', { name: 'Continue' }).click();

      // New words: the plan's 6 unrated cards. Only the front is a distinct
      // named state for this task; the feedback tone is already covered by
      // "review back" above.
      await runLessonStage(page, freshCount, async () => {
        await expectAccessibleAndContained(page, 'New word');
        await attachScreen(page, testInfo, `${label}-new-word`);
      });
      // The review→new bridge above already covers the Bridge board's
      // fidelity; this second bridge (new→match) is only a transition, not a
      // distinct state to capture.
      await page.getByRole('button', { name: 'Continue' }).click();

      // Word Match: the same 12-card pool clears the 4-pair minimum.
      await expect(page.getByRole('button', { name: 'Close word match' })).toBeVisible({ timeout: 15_000 });
      await expectAccessibleAndContained(page, 'Match');
      await attachScreen(page, testInfo, `${label}-match`);
      await page.getByRole('button', { name: 'Close word match' }).click();

      // Recap: the session-finale modal, reached through the real flow
      // rather than the isolated fixture `daily-recap-visual.spec.ts` uses.
      await expect(page.locator('[data-session-recap]')).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('Tomorrow', { exact: true })).toBeVisible();
      await expect(page.getByText(/\d+ cards? due/)).toBeVisible();
      await expectAccessibleAndContained(page, 'Recap');
      await attachScreen(page, testInfo, `${label}-recap`);
    });
  }
}
