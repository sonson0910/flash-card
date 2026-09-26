import { expect, test } from '@playwright/test';

test('the visible Create card action opens a focused dialog and returns focus on Escape', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    localStorage.setItem('lingoflash_cards_scoped_v1', JSON.stringify({ version: 1, ownerId: null, cards: [{
      id: 'creator-existing-card', word: 'resilient', normalizedWord: 'resilient',
      translation: 'kiên cường', explanation: 'Able to recover after difficulty.',
      phonetic: '', emoji: '🌱', category: 'Personal growth', audioUrl: null, imageUrl: null,
      createdAt: '2026-09-01T08:00:00.000Z', origin: 'manual',
    }] }));
  });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1:4173)/, route => route.abort());
  await page.goto('/?view=library&locale=en');
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
