import { expect, test } from './fixtures/firebase-emulator';

const existingCard = {
  id: 'creator-existing-card', word: 'resilient', normalizedWord: 'resilient',
  translation: 'kiên cường', explanation: 'Able to recover after difficulty.',
  phonetic: '', emoji: '🌱', category: 'Personal growth', audioUrl: null, imageUrl: null,
  createdAt: '2026-09-01T08:00:00.000Z', origin: 'manual',
};

test('the visible Create card action opens a focused dialog and returns focus on Escape', async ({ page, seedCards, signIn, blockExternalNetwork }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedCards([existingCard]);
  await blockExternalNetwork(page);
  await signIn(page, '/?view=library&locale=en');
  const create = page.locator('[data-library-create-action]');
  await expect(create).toBeVisible();
  await create.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(create).toBeFocused();
});
