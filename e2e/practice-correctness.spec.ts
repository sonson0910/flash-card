import { expect, test } from './fixtures/firebase-emulator';

const cards = ['alpha', 'bravo', 'charlie', 'delta'].map((word, index) => ({
  id: `word-${word}`, schemaVersion: 2, revision: 1, word, normalizedWord: word, translation: `nghĩa ${index}`,
  explanation: `Meaning of ${word}`, phonetic: '', emoji: '', category: 'Test',
  audioUrl: null, imageUrl: null, createdAt: '2026-09-01T00:00:00.000Z', difficulty: 'good', reviews: 3,
}));

test.beforeEach(async ({ page, seedCards, seedCourseProfile, signIn, blockExternalNetwork }, testInfo) => {
  if (testInfo.title.includes('late mismatch')) {
    await page.clock.install({ time: new Date() });
  }
  await blockExternalNetwork(page);
  await seedCourseProfile();
  await seedCards(cards);
  await signIn(page, '/?view=today&locale=en');
  await page.getByRole('button', { name: 'More practice' }).click();
  await page.getByRole('dialog').getByRole('button', { name: /^Word Match / }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Word match', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'alpha', exact: true })).toBeVisible();
});

test('PracticeScreen awards the advertised XP once and persists it across reload', async ({ page, db, testUser }) => {
  const readXp = async () => Number((await db.doc(`users/${testUser.uid}/profile/stats`).get()).data()?.verifiedXp ?? 0);
  const before = await readXp();
  for (const card of cards) {
    await page.getByRole('button', { name: card.word, exact: true }).click();
    await page.getByRole('button', { name: card.translation, exact: true }).click();
  }
  await expect(page.getByText('Verified +20 XP', { exact: true })).toBeVisible();
  await expect.poll(readXp).toBe(before + 20);
  await page.reload();
  await expect.poll(readXp).toBe(before + 20);
  await expect(page.getByLabel('Level 1, 20 XP')).toBeVisible();
});

test('a late mismatch timeout cannot clear a selection in the next round', async ({ page }) => {
  // Let startup timers run, then begin a fresh round under a paused clock.
  await page.clock.pauseAt(new Date(Date.now() + 120_000));
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.clock.runFor(59_700);
  await page.getByRole('button', { name: 'alpha', exact: true }).click();
  await page.getByRole('button', { name: 'nghĩa 1', exact: true }).click();
  await page.clock.runFor(300);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  const selected = page.getByRole('button', { name: 'alpha', exact: true });
  await selected.click();
  await expect(selected).toHaveClass(/ring-2/);
  await page.clock.runFor(500);
  await expect(selected).toHaveClass(/ring-2/);
});
