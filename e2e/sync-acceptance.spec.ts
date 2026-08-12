import { expect, test } from '@playwright/test';
import { readCardCacheState } from './card-cache';

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
    if (localStorage.getItem('lingoflash_cards_scoped_v1') === null) {
      localStorage.setItem('lingoflash_cards', JSON.stringify([card]));
      localStorage.removeItem('lingoflash_cards_owner');
    }
  }, offlineCard);

  const expectMigratedCache = () => expect.poll(async () => {
    const cache = await readCardCacheState<unknown>(page);
    return {
      version: cache.scoped?.version,
      ownerId: cache.scoped?.ownerId,
      cardCount: cache.scoped?.cards.length,
      legacy: cache.legacy,
    };
  }).toEqual({ version: 1, ownerId: null, cardCount: 1, legacy: null });

  await page.goto('/?view=library');
  await expect(page.getByRole('group', { name: /^resilient flashcard\./i })).toBeVisible();
  await expect(page.getByText('Your library is available offline.', { exact: true })).toBeVisible();
  await expectMigratedCache();

  await page.reload();

  await expect(page.getByRole('group', { name: /^resilient flashcard\./i })).toBeVisible();
  await expect(page.getByText('Your library is available offline.', { exact: true })).toBeVisible();
  await expectMigratedCache();
});
