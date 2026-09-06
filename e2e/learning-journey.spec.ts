import { expect, test } from '@playwright/test';

const cards = [
  'analyse', 'benefit', 'context', 'develop', 'evidence', 'focus',
  'generate', 'hypothesis', 'identify', 'justify', 'knowledge', 'language',
].map((word, index) => ({
  id: `learning-journey-${index}`,
  word,
  normalizedWord: word,
  translation: `nghĩa ${index + 1}`,
  explanation: `Reviewed explanation for ${word}.`,
  phonetic: '',
  emoji: '📚',
  category: 'Learning journey',
  audioUrl: null,
  imageUrl: null,
  createdAt: new Date(2026, 8, 6, 10, index).toISOString(),
  bookmarked: false,
  difficulty: 'unrated',
  customDeck: null,
}));

test.beforeEach(async ({ page }) => {
  await page.addInitScript(initialCards => {
    localStorage.setItem('lingoflash_cards', JSON.stringify(initialCards));
    localStorage.removeItem('lingoflash_cards_owner');
    localStorage.removeItem('lingoflash_cards_scoped_v1');
  }, cards);
});

test('exposes the published listening pilot in the built learner journey', async ({ page }) => {
  await page.goto('/?view=today');

  await expect(page.getByRole('heading', { name: 'Your daily plan' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Learn → Immerse → Communicate' })).toBeVisible();
  const listening = page.getByRole('button', { name: 'Immerse: start listening practice' });
  await expect(listening).toBeVisible();
  await expect(listening).toBeEnabled();
  await listening.click();

  await expect(page).toHaveURL(/lesson=listening/);
  await expect(page.getByRole('heading', { level: 1, name: 'Immerse · Listen' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'break the news' })).toBeVisible();
  await expect(page.locator('audio[aria-label="Listen to break the news"]')).toHaveAttribute(
    'src',
    /media\/listen-mvp\/break-the-news\.m4a$/,
  );
  await expect(page.locator('[aria-label="Source and attribution"]')).toContainText('Voice of America Learning English');
  await expect(page.getByText('A listening lesson is not available yet.', { exact: true })).toHaveCount(0);
});

test('integrated listening save-to-conversation happy path uses the published pilot', async ({ page }) => {
  await page.goto('/?view=today');

  await page.getByRole('button', { name: 'Immerse: start listening practice' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'break the news' })).toBeVisible();
  await page.getByRole('button', { name: 'Tell someone bad or upsetting news' }).click();
  await expect(page.getByText('Correct — nice listening.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save phrase' })).toBeVisible();
  await page.getByRole('button', { name: 'Save phrase' }).click();
  await expect(page.getByRole('button', { name: 'Practise this phrase' })).toBeVisible();
});
