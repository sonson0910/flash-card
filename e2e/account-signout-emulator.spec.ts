import { expect, test } from './fixtures/firebase-emulator';

const ownerOnlyCard = {
  id: 'signout-owner-only-card',
  word: 'ephemeral',
  normalizedWord: 'ephemeral',
  translation: 'phù du',
  createdAt: '2026-10-01T00:00:00.000Z',
  bookmarked: false,
  difficulty: 'unrated',
  origin: 'manual',
  customDeck: null,
};

test('signing out from the account menu lands safely without the previous owner content', async ({
  page, db, testUser, seedCards, seedCourseProfile, signIn, blockExternalNetwork,
}) => {
  try {
    await seedCourseProfile();
    await seedCards([ownerOnlyCard]);
    await blockExternalNetwork(page);
    await signIn(page, '/?view=library&locale=en');

    await expect(page.locator('[data-library-card-id="signout-owner-only-card"]')).toBeVisible();
    await page.getByRole('button', { name: 'Manage library' }).click();
    await page.getByRole('menuitem', { name: 'Sign out of cloud sync' }).click();

    await expect(page.locator('.landing-canvas')).toBeVisible();
    await expect(page.locator('.landing-canvas #landing-heading')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
    await expect(page.locator('[data-library-card-id="signout-owner-only-card"]')).toHaveCount(0);
    await expect(page.getByText(testUser.email, { exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Manage library' })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => window.__SONFLASH_TEST__?.getCurrentUid?.() ?? null)).toBeNull();
  } finally {
    await db.recursiveDelete(db.doc(`users/${testUser.uid}`));
  }
});
