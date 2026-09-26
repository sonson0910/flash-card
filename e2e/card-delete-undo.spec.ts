import { expect, test } from '@playwright/test';

const card = {
  id: 'delete-undo-card',
  word: 'resilient',
  normalizedWord: 'resilient',
  language: 'en',
  translation: 'kiên cường',
  explanation: 'Able to recover after difficulty.',
  phonetic: '/rɪˈzɪliənt/',
  emoji: '🌱',
  category: 'Personal growth',
  partOfSpeech: 'adjective',
  audioUrl: null,
  imageUrl: null,
  createdAt: '2026-09-01T08:00:00.000Z',
  bookmarked: true,
  difficulty: 'good',
  origin: 'manual',
  customDeck: 'IELTS',
  reviews: 3,
  interval: 8,
  easeFactor: 2.5,
  nextReviewDate: '2026-10-01T08:00:00.000Z',
  reviewHistory: [{ rating: 'good', reviewedAt: '2026-09-23T08:00:00.000Z', elapsedDays: 4, scheduledDays: 8 }],
};

test('deleting and undoing a device card preserves learning data after reload', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(initialCard => {
    if (sessionStorage.getItem('delete-undo-seeded')) return;
    localStorage.setItem('lingoflash_cards', JSON.stringify([initialCard]));
    localStorage.removeItem('lingoflash_cards_owner');
    localStorage.setItem('lingoflash_theme', 'light');
    sessionStorage.setItem('delete-undo-seeded', 'true');
  }, card);
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173)/, route => route.abort());
  await page.goto('/?view=library&locale=en');
  const flashcard = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'resilient', exact: true }) });
  await expect(flashcard).toBeVisible();
  await flashcard.getByRole('button', { name: 'Delete card' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete card' }).click();
  await expect(flashcard).toHaveCount(0);
  const undo = page.locator('[data-undo-toast]');
  await expect(undo).toContainText('Card deleted.');
  await undo.getByRole('button', { name: /^Undo/ }).click();
  await expect(undo).toHaveCount(0);
  await expect(flashcard).toBeVisible();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('lingoflash_cards_scoped_v1') ?? 'null'))).toEqual({
    version: 1,
    ownerId: null,
    cards: [expect.objectContaining(card)],
  });

  await page.reload();
  await expect(flashcard).toBeVisible();
  await expect(undo).toHaveCount(0);
  const restored = await page.evaluate(() => JSON.parse(localStorage.getItem('lingoflash_cards_scoped_v1') ?? 'null'));
  expect(restored).toEqual({ version: 1, ownerId: null, cards: [expect.objectContaining(card)] });
});

test('clearing the library dismisses an invalidated delete Undo', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(initialCard => {
    localStorage.setItem('lingoflash_cards_scoped_v1', JSON.stringify({ version: 1, ownerId: null, cards: [initialCard] }));
  }, card);
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173)/, route => route.abort());
  await page.goto('/?view=library&locale=en');
  const flashcard = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'resilient', exact: true }) });
  await flashcard.getByRole('button', { name: 'Delete card' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete card' }).click();
  const undo = page.locator('[data-undo-toast]');
  await expect(undo).toBeVisible();
  await undo.hover();
  await page.getByRole('button', { name: 'Manage library' }).click();
  await page.getByRole('menuitem', { name: 'Clear the entire library' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete everything' }).click();
  await expect(undo).toHaveCount(0);
  await expect(flashcard).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('lingoflash_cards_scoped_v1') ?? 'null')?.cards)).toEqual([]);
});
