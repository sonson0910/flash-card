import { expect, test } from '@playwright/test';

test('partial Study summary distinguishes skipping from saved reviews', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lingoflash_cards', JSON.stringify(['water', 'work'].map((word, index) => ({
      id: `summary-${index}`, word, normalizedWord: word, translation: word, explanation: 'Example.',
      category: 'Test', phonetic: '', emoji: '', audioUrl: null, imageUrl: null,
      reviews: 1, difficulty: 'hard', nextReviewDate: '2020-01-01T00:00:00.000Z',
    }))));
    localStorage.removeItem('lingoflash_cards_owner');
  });
  await page.goto('/?view=library');
  await page.getByRole('button', { name: /Start review|Review \d+ due/ }).click();
  await expect(page.getByRole('progressbar', { name: 'Study progress' })).toHaveAttribute('aria-valuenow', '0');
  await page.getByRole('button', { name: 'Next card', exact: true }).click();
  await page.getByRole('button', { name: 'Summary', exact: true }).click();
  const summary = page.getByRole('dialog', { name: 'Session summary' });
  await expect(summary).toContainText('Skipped: 1');
  await expect(summary).toContainText('Not started: 1');
  await expect(summary).toContainText('0 / 2');
  await summary.getByRole('button', { name: 'Close recap', exact: true }).last().click();
  await expect(summary).toHaveCount(0);
});
