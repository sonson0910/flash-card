import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures/firebase-emulator';

const cards = [
  'analyse', 'benefit', 'context', 'develop', 'evidence', 'focus',
  'generate', 'hypothesis', 'identify', 'justify', 'knowledge', 'language',
].map((word, index) => ({
  // reviewCardV2's `cardForValidation` (functions/src/reviewPersistence.ts)
  // requires the stored document's own `id` to equal the canonical id
  // `canonicalCard` derives from its word — for a plain lowercase English
  // word that is `word-${word}` (`createWordCardId`'s legacy branch in
  // src/lib/cardIdentity.ts) — and requires `schemaVersion: 2` plus a safe
  // `revision`, or every rating submitted against this card fails with
  // `identity-conflict` before the lesson can advance (see unified-session
  // .spec.ts's `buildCard`, which documents the same requirement).
  id: `word-${word}`,
  word,
  normalizedWord: word,
  translation: `nghĩa riêng ${index + 1}`,
  explanation: `A reviewed explanation for ${word}.`,
  phonetic: '',
  emoji: '📚',
  category: 'IELTS',
  audioUrl: null,
  imageUrl: null,
  createdAt: new Date(2026, 7, 1, 10, index).toISOString(),
  difficulty: 'unrated',
  cefrLevel: index < 4 ? 'A2' : index < 8 ? 'B2' : 'C1',
  exampleSentence: `We ${word} this example carefully.`,
  exampleTranslation: `Ví dụ ${index + 1}`,
  schemaVersion: 2,
  revision: 1,
}));

const emptyTodayHoverContrastTest = 'empty Today primary action retains compliant contrast while hovered';

test.beforeEach(async ({ page, seedCards, blockExternalNetwork }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem('lingoflash_theme', 'dark');
  });
  await blockExternalNetwork(page);
  if (testInfo.title !== emptyTodayHoverContrastTest) await seedCards(cards);
});

test('Today is the default four-part shell and completes the answer-feedback-rating transition', async ({ page, signIn }) => {
  test.setTimeout(60_000);
  await signIn(page, '/?view=today');

  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your daily plan' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement === document.body)).toBe(true);
  await expect(page.getByText('12 items')).toBeVisible();
  for (const label of ['Today', 'Paths', 'Vocabulary', 'Progress']) {
    await expect(page.getByRole('button', { name: label, exact: true }).first()).toBeVisible();
  }
  await page.getByRole('button', { name: 'More practice' }).click();
  // The dialog and each practice view below are behind their own lazy chunk
  // (AppOverlays, then QuizView/SpellingView/StoryView); the first mount of
  // each can be slower than the default 5s under a cold dev server, so these
  // specific checks get a longer budget rather than a shorter, flakier one.
  await expect(page.getByRole('dialog', { name: 'Choose a practice mode' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: /^Story/ })).toBeVisible();
  await page.getByRole('button', { name: /^Quiz/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Vocabulary quiz' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Exit' }).click();
  await page.getByRole('button', { name: 'Today', exact: true }).first().click();

  await page.getByRole('button', { name: 'More practice' }).click();
  await page.getByRole('button', { name: /^Spelling/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Spelling practice' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Exit' }).click();
  await page.getByRole('button', { name: 'Today', exact: true }).first().click();

  await page.getByRole('button', { name: 'More practice' }).click();
  await page.getByRole('button', { name: /^Story/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Context story' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Close story' }).click();
  await page.getByRole('button', { name: 'Today', exact: true }).first().click();

  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeFocused();
  await expect(page.locator('[data-app-view-stage]')).toHaveCSS('transform', 'none');
  const recognition = page.getByRole('button', { name: /Recognition/ });
  await recognition.scrollIntoViewIfNeeded();
  await recognition.click();
  await expect(page).toHaveURL(/lesson=recognition/);
  await expect(page.getByRole('heading', { level: 1, name: 'Lesson' })).toBeVisible();
  await expect(page.getByText('Question 1 of 12', { exact: true })).toBeVisible();
  await expect(page.getByText('Correct answer:')).toHaveCount(0);

  await page.getByRole('group', { name: 'Choose one answer' }).getByRole('button').first().click();
  await page.getByRole('button', { name: 'Submit answer' }).click();
  await expect(page.getByText('Correct answer:')).toBeVisible();
  await page.getByRole('button', { name: /Good/ }).press('Enter');
  // Advancing waits on the reviewCardV2 callable round-trip (no optimistic
  // local advance), so give it the same generous budget as the lazy-chunk
  // checks above rather than the tight 5s default.
  await expect(page.getByText('Question 2 of 12', { exact: true })).toBeVisible({ timeout: 15_000 });

  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
});

test('Quiz and Spelling accept an answer and advance from the Today practice menu', async ({ page, signIn }) => {
  await signIn(page, '/?view=today');

  await page.getByRole('button', { name: 'More practice' }).click();
  await page.getByRole('button', { name: /^Quiz/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Vocabulary quiz' })).toBeVisible();
  await page.getByRole('group', { name: 'Choose one answer' }).getByRole('button').first().click();
  await expect(page.getByRole('status').filter({ hasText: /Correct answer\.|Incorrect\. The correct answer is/ })).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText(/^Question 2 \/ \d+$/)).toBeVisible();
  await page.getByRole('button', { name: 'Exit' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Vocabulary library' })).toBeVisible();
  await page.getByRole('button', { name: 'Today', exact: true }).first().click();

  await page.getByRole('button', { name: 'More practice' }).click();
  await page.getByRole('button', { name: /^Spelling/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Spelling practice' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Type the English word' }).fill('not-the-card');
  await page.getByRole('textbox', { name: 'Type the English word' }).press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'Incorrect. The correct answer is' })).toBeVisible();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.getByText(/^Question 2 \/ \d+$/)).toBeVisible();
  await page.getByRole('button', { name: 'Exit' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Vocabulary library' })).toBeVisible();
});

test('placement is diagnostic and Progress is a real URL-backed lazy workspace', async ({ page, signIn }) => {
  await signIn(page, '/?view=today&lesson=placement');
  await expect(page.getByRole('heading', { name: 'Placement check' })).toBeVisible();
  await expect(page.getByText(/does not change learning history/i)).toBeVisible();
  await page.getByRole('button', { name: 'Start placement check' }).click();
  await expect(page.getByRole('button', { name: 'Exit placement check' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Choose one answer' }).getByRole('button').first()).toHaveAttribute('lang', 'vi');
  const placementAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(placementAxe.violations.filter(item => ['serious', 'critical'].includes(item.impact ?? ''))).toEqual([]);
  await page.getByRole('group', { name: 'Choose one answer' }).getByRole('button').first().click();
  await page.getByRole('button', { name: 'Submit answer' }).click();
  await expect(page.getByText('Question 2 of 12', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Placement check' })).toBeFocused();

  await page.getByRole('button', { name: 'Exit placement check' }).click();
  await page.getByRole('button', { name: 'Progress', exact: true }).first().click();
  await expect(page).toHaveURL(/view=progress/);
  // AppRuntime.tsx excludes 'progress' (along with catalog/today/settings)
  // from its generic sr-only view heading because ProgressScreen.tsx already
  // renders its own more specific level-1 heading ("Progress", `progress.title`)
  // — "Learning progress" (`shell.heading.progress`) is only ever the
  // document title (useAppNavigation.ts's `viewHeading`), never an on-page
  // heading.
  await expect(page.getByRole('heading', { level: 1, name: 'Progress' })).toBeFocused();
  await expect(page.getByText('Complete a review to begin your progress history.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Daily XP rhythm' })).toHaveCount(0);
  const progressAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(progressAxe.violations.filter(item => ['serious', 'critical'].includes(item.impact ?? ''))).toEqual([]);
});

test('Today and legacy Vocabulary routes satisfy serious WCAG checks', async ({ page, signIn }) => {
  await signIn(page, '/?view=today');
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  const today = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(today.violations.filter(item => ['serious', 'critical'].includes(item.impact ?? ''))).toEqual([]);

  await page.goto('/library?share=legacy');
  await expect(page).toHaveURL(/\/library\?share=legacy/);
  await expect(page.getByRole('heading', { name: 'Your library' })).toBeVisible();
});

test(emptyTodayHoverContrastTest, async ({ page, signIn, seedCourseProfile }) => {
  // This test signs in with an empty library on purpose (see the beforeEach guard
  // above), so it needs the onboarding-suppression seed the other tests get for free
  // from `seedCards`; without it, the OnboardingJourney overlay covers the empty
  // Today screen this test is actually checking.
  await seedCourseProfile();
  await signIn(page, '/?view=today');
  const openVocabulary = page.getByRole('button', { name: 'Add vocabulary' });
  await expect(openVocabulary).toBeVisible();
  await openVocabulary.hover();

  const hoveredToday = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(hoveredToday.violations.filter(item => ['serious', 'critical'].includes(item.impact ?? ''))).toEqual([]);
});

test('Today reflows at 320px with 200% text without horizontal loss', async ({ page, signIn }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await signIn(page, '/?view=today');
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Recognition/ })).toBeVisible();
  const navButtons = page.locator('[role="navigation"][aria-label="Primary"] button:visible');
  for (let index = 0; index < await navButtons.count(); index += 1) {
    const box = await navButtons.nth(index).boundingBox();
    const labelBox = await navButtons.nth(index).locator('span').boundingBox();
    expect(box).not.toBeNull();
    expect(labelBox).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(320);
    expect(labelBox!.x).toBeGreaterThanOrEqual(box!.x);
    expect(labelBox!.x + labelBox!.width).toBeLessThanOrEqual(box!.x + box!.width);
  }
});
