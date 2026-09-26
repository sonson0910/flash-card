import { expect, test } from './fixtures/firebase-emulator';

const card = {
  id: 'pilot-edit-card', word: 'lead', normalizedWord: 'lead', translation: 'chì',
  explanation: 'A metal.', explanationTranslation: 'Một kim loại.', phonetic: '/liːd/',
  emoji: '📚', category: 'Reading', audioUrl: null, imageUrl: null,
  origin: 'ai', createdAt: '2026-09-24T00:00:00.000Z', bookmarked: false,
  difficulty: 'unrated', customDeck: null, reviews: 0,
};

test('an AI card can be edited, bookmarked and reviewed from the local queue', async ({ page, seedCards, signIn }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedCards([card]);
  await signIn(page, '/?view=library');
  const flashcard = page.getByRole('group', { name: /lead flashcard/i });
  await flashcard.getByRole('button', { name: 'Edit card' }).click();
  const dialog = page.getByRole('dialog', { name: 'Sửa thẻ' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('Nghĩa tiếng Việt').fill('dẫn đầu');
  await dialog.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(dialog).toHaveCount(0);
  await flashcard.getByRole('button', { name: 'Star this word' }).click();
  await flashcard.getByRole('button', { name: /Reveal the Vietnamese meaning/ }).click();
  await expect(flashcard.getByRole('heading', { name: 'dẫn đầu' })).toBeVisible();
  await expect(flashcard.locator('[data-ai-disclosure]')).toBeVisible();
  await page.getByRole('button', { name: /Start a review|Review \d+ due/ }).first().click();
  await page.getByRole('button', { name: 'Reveal answer' }).click();
  await expect(page.locator('[data-study-rating]')).toBeVisible();
  await page.getByRole('button', { name: /Good/i }).last().click();
  await expect(page.locator('[data-study-progress]')).toBeVisible();
});
