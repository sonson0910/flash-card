import { expect, test } from '@playwright/test';
import { readCardCacheState } from './card-cache';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lingoflash_cards', JSON.stringify(['work', 'water', 'world', 'can', 'walk', 'word'].map((word, index) => ({
      id: `forgotten-${index}`, word, normalizedWord: word, translation: `meaning ${index}`, explanation: 'Learn this word again.',
      category: 'Test', phonetic: '', emoji: '', audioUrl: null, imageUrl: null,
      reviews: 3, difficulty: 'hard', nextReviewDate: '2020-01-01T00:00:00.000Z',
    }))));
    localStorage.removeItem('lingoflash_cards_owner');
  });
});

test('Today offers guidance for reviewed words without recording failure', async ({ page }) => {
  await page.goto('/?view=today');
  await page.getByRole('button', { name: /Recognition/ }).click();
  await page.getByRole('button', { name: "I don't know this — learn first", exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Meet this word' })).toBeVisible();
  await page.getByRole('button', { name: "I don't know this yet", exact: true }).click();
  await expect(page.getByRole('heading', { name: 'See it in context' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue to independent recall' }).click();
  await expect(page.getByText('Independent recall', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: "I don't know this — learn first", exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Meet this word' })).toBeVisible();
  expect((await readCardCacheState<{ reviews: number }>(page)).scoped?.cards.every(card => card.reviews === 3)).toBe(true);
});

for (const mode of ['Multiple-choice quiz', 'Spelling practice']) {
  test(`${mode} can switch to learning without answering`, async ({ page, browserName }) => {
    await page.goto('/?view=today');
    await page.getByRole('button', { name: 'More practice' }).click();
    await page.getByRole('button', { name: new RegExp(mode) }).click();
    await page.locator(mode === 'Spelling practice' ? '#spelling-question-heading' : '#quiz-question-heading').focus();
    // macOS WebKit uses Option-Tab for all controls with default keyboard settings.
    await page.keyboard.press(browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab');
    await expect(page.getByRole('button', { name: "I don't know this — learn first", exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'I’ve reviewed it — start recall' })).toBeVisible();
    expect((await readCardCacheState<{ reviews: number }>(page)).scoped?.cards.every(card => card.reviews === 3)).toBe(true);
    await page.getByRole('button', { name: 'I’ve reviewed it — start recall' }).click();
    await page.getByRole('button', { name: "I don't know this — learn first", exact: true }).click();
    await expect(page.getByRole('button', { name: 'I’ve reviewed it — start recall' })).toBeVisible();
  });
}
