import { expect, test } from './fixtures/firebase-emulator';

test('partial Study summary distinguishes skipping from saved reviews', async ({ page, seedCards, seedCourseProfile, signIn, blockExternalNetwork, db, testUser }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await blockExternalNetwork(page);
  await seedCourseProfile();
  await seedCards(['water', 'work'].map(word => ({
      id: `word-${word}`, schemaVersion: 2, revision: 1, createdAt: '2026-09-01T00:00:00.000Z', word, normalizedWord: word, translation: word, explanation: 'Example.',
      category: 'Test', phonetic: '', emoji: '', audioUrl: null, imageUrl: null,
      reviews: 1, difficulty: 'hard', nextReviewDate: '2020-01-01T00:00:00.000Z',
    })));
  await signIn(page, '/?view=library&locale=en');
  await page.getByRole('button', { name: 'Study now' }).click();
  await expect(page.getByRole('progressbar', { name: 'Study progress' })).toHaveAttribute('aria-valuenow', '0');
  await page.getByRole('button', { name: 'Next card', exact: true }).click();
  await page.getByRole('button', { name: 'Summary', exact: true }).click();
  const summary = page.getByRole('dialog', { name: 'Session summary' });
  await expect(summary).toContainText('Skipped: 1');
  await expect(summary).toContainText('Not started: 1');
  await expect(summary).toContainText('0 / 2');
  expect((await db.collection('users').doc(testUser.uid).collection('cards').get()).docs.every(card => card.data().reviews === 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect.poll(() => summary.locator('[data-session-recap]').evaluate(element => getComputedStyle(element).opacity)).toBe('1');
  await testInfo.attach('partial-recap-mobile', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  await summary.getByRole('button', { name: 'Close recap', exact: true }).last().click();
  await expect(summary).toHaveCount(0);
});
