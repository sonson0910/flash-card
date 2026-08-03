import { expect, test } from '@playwright/test';

const offlineCard = {
  id: 'offline-resilient',
  word: 'resilient',
  normalizedWord: 'resilient',
  translation: 'kiên cường',
  explanation: 'Able to recover after difficulty.',
  phonetic: '',
  emoji: '🌱',
  category: 'Character',
  audioUrl: null,
  imageUrl: null,
  createdAt: '2026-07-20T03:00:00.000Z',
  bookmarked: false,
  difficulty: 'unrated',
  customDeck: null,
};

test('offline reload keeps the local card and exposes deterministic sync health', async ({ page }) => {
  await page.addInitScript(card => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false });
    localStorage.setItem('lingoflash_cards', JSON.stringify([card]));
    localStorage.removeItem('lingoflash_cards_owner');
  }, offlineCard);

  await page.goto('/');
  await expect(page.getByRole('group', { name: /^resilient flashcard\./i })).toBeVisible();
  await expect(page.getByText('Your library is available offline.', { exact: true })).toBeVisible();

  await page.reload();

  await expect(page.getByRole('group', { name: /^resilient flashcard\./i })).toBeVisible();
  await expect(page.getByText('Your library is available offline.', { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const cards = JSON.parse(localStorage.getItem('lingoflash_cards') ?? '[]') as unknown[];
    return cards.length;
  })).toBe(1);
});
