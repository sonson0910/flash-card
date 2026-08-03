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

test('opening an existing local word does not require AI sign-in or rewrite its creation date', async ({ page }) => {
  const cardsWithExistingImage = cards.map(card => card.normalizedWord === 'consider'
    ? {
        ...card,
        imageUrl: 'https://images.pexels.com/photos/3184465/pexels-photo-3184465.jpeg',
        imageSearchQuery: 'person considering a decision',
      }
    : card);
  const originalCreatedAt = cardsWithExistingImage.find(card => card.normalizedWord === 'consider')?.createdAt;
  await page.addInitScript(initialCards => {
    localStorage.setItem('lingoflash_cards', JSON.stringify(initialCards));
    localStorage.removeItem('lingoflash_cards_owner');
  }, cardsWithExistingImage);

  await page.goto('/?utm_source=acceptance&q=chance&category=Test%20deck');
  await page.locator('#new-word').fill('consider');
  await page.getByRole('button', { name: 'Generate smart card' }).click();

  await expect(page.getByText(/already in your library/)).toBeVisible();
  await expect(page.locator('#new-word')).toHaveValue('');
  await expect(page.locator('input[placeholder="Search English words…"]:visible').first()).toHaveValue('');
  await expect(page.getByRole('heading', { name: 'Your library' })).toBeFocused();
  await expect(page.getByRole('group', { name: /^consider flashcard\./i })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Illustration for consider' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Generate smart card' })).toBeVisible();
  await page.locator('#new-word').fill('consider');
  await page.getByRole('button', { name: 'Generate smart card' }).click();
  await expect(page.locator('#new-word')).toHaveValue('');
  await expect(page.getByRole('group', { name: /^consider flashcard\./i })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Illustration for consider' })).toBeVisible();
  await expect.poll(() => {
    const url = new URL(page.url());
    return {
      q: url.searchParams.get('q'),
      category: url.searchParams.get('category'),
      source: url.searchParams.get('utm_source'),
    };
  }).toEqual({ q: null, category: null, source: 'acceptance' });
  const storedCard = await page.evaluate(() => {
    const library = JSON.parse(localStorage.getItem('lingoflash_cards') ?? '[]') as Array<{
      normalizedWord?: string;
      createdAt?: string;
      lastOpenedAt?: string;
    }>;
    return library.find(card => card.normalizedWord === 'consider');
  });
  expect(storedCard?.createdAt).toBe(originalCreatedAt);
  expect(storedCard?.lastOpenedAt).toBeTruthy();
});
