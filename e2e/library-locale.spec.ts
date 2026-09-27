import { expect, test } from './fixtures/firebase-emulator';

test('first Vietnamese library visit and live English switch translate the create surface', async ({ page, signIn, seedCourseProfile }) => {
  // A brand-new signed-in user with no course profile yet is shown the
  // full-screen OnboardingJourney modal, which blocks the shell's own
  // language switcher until completed. Seed a legacy profile so this test
  // exercises the ordinary library shell instead of the onboarding flow.
  await seedCourseProfile();
  await signIn(page, '/?view=library&locale=vi');

  // A fresh emulator test user has zero cards, so the library renders the
  // empty-state creator (EmptyLibraryPanel.tsx's #empty-library-word and its
  // "Start with your first word." heading), not the LibraryCardGrid-only
  // "Your library" heading or the "More library tools" disclosure's
  // #new-word input — those only mount once at least one card is seeded.
  const wordInput = page.locator('#empty-library-word');
  await expect(page.getByRole('heading', { name: 'Bắt đầu với từ đầu tiên.' })).toBeVisible();
  await expect(wordInput).toHaveAttribute('placeholder', /Nhập một từ hoặc cụm từ/);
  await expect(wordInput).toHaveAttribute('lang', 'en');

  await page.getByRole('button', { name: 'Chọn ngôn ngữ' }).click();
  await page.getByRole('menuitemradio', { name: 'English' }).click();

  await expect(page.getByRole('heading', { name: 'Start with your first word.' })).toBeVisible();
  await expect(wordInput).toHaveAttribute('placeholder', 'Type a word or phrase…');
  await expect(wordInput).toHaveAttribute('lang', 'en');
});
