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

test('keeps the unpublished listening pilot honest in the built learner journey', async ({ page }) => {
  await page.goto('/?view=today');

  await expect(page.getByRole('heading', { name: 'Your daily plan' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Learn → Immerse → Communicate' })).toBeVisible();
  const listening = page.getByRole('button', { name: 'Immerse: available after your first plan' });
  await expect(listening).toBeVisible();
  await expect(listening).toBeDisabled();
  await expect(page.getByText('A listening lesson is not available yet.', { exact: true })).toBeVisible();
  await expect(page.getByText('Practise this phrase', { exact: true })).toHaveCount(0);
});

test('integrated listening save-to-conversation happy path is deferred until pilot publication evidence exists', async () => {
  test.skip(true, 'Deferred: LISTEN_MVP_PILOT_LESSONS is intentionally empty pending external publication evidence.');
});
