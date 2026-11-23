import { expect, test } from './fixtures/firebase-emulator';

test('a caught-up learner can leave Today for Vocabulary and Paths', async ({ page, seedCards, signIn, blockExternalNetwork }) => {
  await seedCards([{
    id: 'word-resilient',
    word: 'resilient',
    normalizedWord: 'resilient',
    translation: 'kiên cường',
    createdAt: '2026-09-01T08:00:00.000Z',
    difficulty: 'good',
    reviews: 2,
    correctStreak: 2,
    nextReviewDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    schemaVersion: 2,
    revision: 1,
  }]);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await blockExternalNetwork(page);
  await signIn(page, '/?view=today&locale=en');

  const caughtUp = page.locator('[data-today-caught-up="true"]');
  await expect(caughtUp).toBeVisible();
  await expect(caughtUp.getByText('No due or new cards are available in this daily plan.')).toBeVisible();
  await expect(caughtUp.getByText(/Next review/)).toHaveCount(0);

  await caughtUp.getByRole('button', { name: 'Add vocabulary' }).click();
  await expect(page).toHaveURL(/view=library/);
  await expect(page.getByRole('heading', { level: 1, name: 'Vocabulary library' })).toBeVisible();

  await page.getByRole('button', { name: 'Today', exact: true }).first().click();
  await expect(caughtUp).toBeVisible();
  await caughtUp.getByRole('button', { name: 'Browse paths' }).click();
  await expect(page).toHaveURL(/view=catalog/);
  await expect(page.getByRole('heading', { name: 'Catalog unavailable' })).toBeVisible();
});
