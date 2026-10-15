import { expect, test } from './fixtures/firebase-emulator';

test.beforeEach(async ({ page, seedCards, blockExternalNetwork }) => {
  await blockExternalNetwork(page);
  await seedCards(['work', 'water', 'world', 'can', 'walk', 'word'].map((word, index) => ({
      id: `word-${word}`, schemaVersion: 2, revision: 1, createdAt: '2026-09-01T00:00:00.000Z', word, normalizedWord: word, translation: `meaning ${index}`, explanation: 'Learn this word again.',
      category: 'Test', phonetic: '', emoji: '', audioUrl: null, imageUrl: null,
      reviews: 3, difficulty: 'hard', nextReviewDate: '2020-01-01T00:00:00.000Z',
    })));
});

test('Today offers guidance for reviewed words without recording failure', async ({ page, signIn, db, testUser }) => {
  await signIn(page, '/?view=today');
  await page.getByRole('button', { name: /Recognition/ }).click();
  await page.getByRole('button', { name: "I don't know this — learn first", exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Meet this word' })).toBeVisible();
  await page.getByRole('button', { name: "I don't know this yet", exact: true }).click();
  await expect(page.getByRole('heading', { name: 'See it in context' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue to independent recall' }).click();
  await expect(page.getByText('Independent recall', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: "I don't know this — learn first", exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Meet this word' })).toBeVisible();
  expect((await db.collection('users').doc(testUser.uid).collection('cards').get()).docs.every(card => card.data().reviews === 3)).toBe(true);
});

for (const mode of ['Multiple-choice quiz', 'Spelling practice']) {
  test(`${mode} can switch to learning without answering`, async ({ page, browserName, signIn, db, testUser }) => {
    await signIn(page, '/?view=today');
    await page.getByRole('button', { name: 'More practice' }).click();
    await page.getByRole('button', { name: new RegExp(mode) }).click();
    const heading = page.locator(mode === 'Spelling practice' ? '#spelling-question-heading' : '#quiz-question-heading');
    // focus() does not wait for the entrance animation to make its target visible.
    await expect(heading).toBeVisible();
    await heading.focus();
    await expect(heading).toBeFocused();
    // macOS WebKit uses Option-Tab for all controls with default keyboard settings.
    await page.keyboard.press(browserName === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab');
    await expect(page.getByRole('button', { name: "I don't know this — learn first", exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'I’ve reviewed it — start recall' })).toBeVisible();
    expect((await db.collection('users').doc(testUser.uid).collection('cards').get()).docs.every(card => card.data().reviews === 3)).toBe(true);
    await page.getByRole('button', { name: 'I’ve reviewed it — start recall' }).click();
    await page.getByRole('button', { name: "I don't know this — learn first", exact: true }).click();
    await expect(page.getByRole('button', { name: 'I’ve reviewed it — start recall' })).toBeVisible();
  });
}
