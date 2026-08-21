import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const cards = [
  'analyse', 'benefit', 'context', 'develop', 'evidence', 'focus',
  'generate', 'hypothesis', 'identify', 'justify', 'knowledge', 'language',
].map((word, index) => ({
  id: `phase5-${index}`,
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
}));

const emptyTodayHoverContrastTest = 'empty Today primary action retains compliant contrast while hovered';

test.beforeEach(async ({ page }, testInfo) => {
  // Keep the long multi-route learning journey deterministic on WebKit CI.
  // Motion is covered by the dedicated shell/motion specs; this suite asserts
  // route, focus, and persistence behavior rather than animation timing.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(initialCards => {
    localStorage.setItem('lingoflash_cards', JSON.stringify(initialCards));
    localStorage.removeItem('lingoflash_cards_owner');
    localStorage.setItem('lingoflash_theme', 'dark');
  }, testInfo.title === emptyTodayHoverContrastTest ? [] : cards);
});

test('Today is the default four-part shell and completes the answer-feedback-rating transition', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your daily plan' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement === document.body)).toBe(true);
  await expect(page.getByText('12 items')).toBeVisible();
  for (const label of ['Today', 'Paths', 'Vocabulary', 'Progress']) {
    await expect(page.getByRole('button', { name: label, exact: true }).first()).toBeVisible();
  }
  await page.getByRole('button', { name: 'More practice' }).click();
  await expect(page.getByRole('dialog', { name: 'Choose a practice mode' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Context story/ })).toBeVisible();
  await page.getByRole('button', { name: /Multiple-choice quiz/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Vocabulary quiz' })).toBeVisible();
  await page.getByRole('button', { name: 'Exit' }).click();
  await page.getByRole('button', { name: 'Today', exact: true }).first().click();

  await page.getByRole('button', { name: 'More practice' }).click();
  await page.getByRole('button', { name: /Spelling practice/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Spelling practice' })).toBeVisible();
  await page.getByRole('button', { name: 'Exit' }).click();
  await page.getByRole('button', { name: 'Today', exact: true }).first().click();

  await page.getByRole('button', { name: 'More practice' }).click();
  await page.getByRole('button', { name: /Context story/ }).click();
  await expect(page.locator('h1:not(.sr-only):visible').filter({ hasText: 'Context story' })).toBeVisible();
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
  await page.getByRole('button', { name: /Good/ }).click();
  await expect(page.getByText('Question 2 of 12', { exact: true })).toBeVisible();

  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
});

test('placement is diagnostic and Progress is a real URL-backed lazy workspace', async ({ page }) => {
  await page.goto('/?lesson=placement');
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
  await expect(page.getByRole('heading', { level: 1, name: 'Learning progress' })).toBeFocused();
  await expect(page.getByText('Complete a review to begin your progress history.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Daily XP rhythm' })).toHaveCount(0);
  const progressAxe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(progressAxe.violations.filter(item => ['serious', 'critical'].includes(item.impact ?? ''))).toEqual([]);
});

test('Today and legacy Vocabulary routes satisfy serious WCAG checks', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Today' })).toBeVisible();
  const today = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(today.violations.filter(item => ['serious', 'critical'].includes(item.impact ?? ''))).toEqual([]);

  await page.goto('/library?share=legacy');
  await expect(page).toHaveURL(/\/library\?share=legacy/);
  await expect(page.getByRole('heading', { name: 'Your library' })).toBeVisible();
});

test(emptyTodayHoverContrastTest, async ({ page }) => {
  await page.goto('/');
  const openVocabulary = page.getByRole('button', { name: 'Add vocabulary' });
  await expect(openVocabulary).toBeVisible();
  await openVocabulary.hover();

  const hoveredToday = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(hoveredToday.violations.filter(item => ['serious', 'critical'].includes(item.impact ?? ''))).toEqual([]);
});

test('Today reflows at 320px with 200% text without horizontal loss', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
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
