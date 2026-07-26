import { expect, test } from '@playwright/test';

const uniqueWords = [
  'ability', 'chance', 'confidential', 'consider', 'delegate',
  'inspire', 'interrupt', 'opportunity', 'similar', 'sufficient',
];

const cards = uniqueWords.map((word, index) => ({
  id: `original-${index}`,
  word,
  normalizedWord: word,
  translation: `translation ${index + 1}`,
  explanation: `Explanation for ${word}.`,
  phonetic: '',
  emoji: '📚',
  category: 'Test deck',
  audioUrl: null,
  imageUrl: null,
  createdAt: new Date(2026, 6, 18, 10, index).toISOString(),
  bookmarked: false,
  difficulty: 'unrated',
  customDeck: null,
}));

cards.splice(2, 0, {
  ...cards[1],
  id: 'duplicate-chance',
  word: ' Chance ',
  normalizedWord: 'chance',
  createdAt: new Date(2026, 6, 19, 10).toISOString(),
});

test('the local library renders one card per normalized word even when old ids are duplicated', async ({ page }) => {
  await page.addInitScript(initialCards => {
    localStorage.setItem('lingoflash_cards', JSON.stringify(initialCards));
    localStorage.removeItem('lingoflash_cards_owner');
  }, cards);

  await page.goto('/');

  await expect(page.getByRole('group', { name: /^chance flashcard\./i })).toHaveCount(1);
  await expect(page.getByText('10 CARDS', { exact: true })).toBeVisible();
});
