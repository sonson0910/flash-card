import { expect, test } from './fixtures/firebase-emulator';

test('a signed-in learner can use the 390px mobile navigation to reach Vocabulary and Progress', async ({
  page,
  seedCourseProfile,
  signIn,
  blockExternalNetwork,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedCourseProfile();
  await blockExternalNetwork(page);
  await signIn(page, '/?view=today');

  const mobileNavigation = page.locator('nav[data-shell-layer="mobile"]');
  const vocabulary = mobileNavigation.getByRole('button', { name: /^(Vocabulary|Collection)$/ });
  await expect(vocabulary).toBeVisible();
  await vocabulary.click();
  await expect(page).toHaveURL(/view=library/);
  await expect(vocabulary).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { level: 1, name: 'Vocabulary library' })).toBeFocused();

  const progress = mobileNavigation.getByRole('button', { name: 'Progress', exact: true });
  await progress.click();
  await expect(page).toHaveURL(/view=progress/);
  await expect(progress).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { level: 1, name: 'Progress' })).toBeFocused();
});
