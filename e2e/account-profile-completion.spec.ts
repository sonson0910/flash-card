import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures/firebase-emulator';

// These owners start without an account profile, exactly like an account that
// signed in before the profile step existed.
test.use({ accountProfile: 'none' });

const existingCard = {
  id: 'profile-step-existing-card',
  word: 'threshold',
  normalizedWord: 'threshold',
  translation: 'ngưỡng cửa',
  createdAt: '2026-10-01T00:00:00.000Z',
  bookmarked: false,
  difficulty: 'unrated',
  origin: 'manual',
  customDeck: null,
};

const profileStep = (page: Page) => page.getByRole('heading', { level: 1, name: 'Make SonFlash yours.' });
const restrictedStep = (page: Page) => page.getByRole('heading', { level: 1, name: 'We cannot create this account yet.' });
const consent = (page: Page) => page.getByRole('checkbox', { name: /I am 18 or older and I agree to the Terms and the Privacy policy/ });

async function expectNoBlockingAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations
    .filter(violation => violation.impact === 'serious' || violation.impact === 'critical')
    .map(violation => ({ id: violation.id, targets: violation.nodes.map(node => node.target) }))).toEqual([]);
}

test('an existing account completes its profile once and returns to the screen it was opening', async ({
  page, db, testUser, seedCards, seedCourseProfile, signIn, blockExternalNetwork,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedCourseProfile();
  await seedCards([existingCard]);
  await blockExternalNetwork(page);
  await signIn(page, '/?view=library&locale=en');

  await expect(profileStep(page)).toBeVisible();
  await expect(page.getByText('Return location preserved · Vocabulary library').first()).toBeVisible();
  await expect(page.locator('[data-library-card-id="profile-step-existing-card"]')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms.html');
  await expect(page.getByRole('link', { name: 'Privacy policy' })).toHaveAttribute('href', '/privacy.html');
  await expectNoBlockingAxeViolations(page);

  const birthYear = page.getByLabel('Birth year');
  const save = page.getByRole('button', { name: 'Save and continue' });
  await save.click();
  await expect(birthYear).toBeFocused();
  await expect(birthYear).toHaveAttribute('aria-invalid', 'true');
  await expect(birthYear).toHaveAccessibleDescription('Enter your birth year as four digits, for example 1994.');

  await birthYear.fill(String(new Date().getUTCFullYear() + 1));
  await save.click();
  await expect(birthYear).toHaveAccessibleDescription('The birth year cannot be in the future.');

  await birthYear.fill('1990');
  await save.click();
  await expect(consent(page)).toBeFocused();
  await expect(consent(page)).toHaveAttribute('aria-invalid', 'true');
  await expect(consent(page)).toHaveAccessibleDescription('Required before continuing.');
  await expect.poll(async () => (await db.doc(`users/${testUser.uid}/profile/account`).get()).exists).toBe(false);

  await consent(page).check();
  await save.click();

  await expect(page.locator('[data-library-card-id="profile-step-existing-card"]')).toBeVisible();
  await expect(profileStep(page)).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('view')).toBe('library');

  const stored = (await db.doc(`users/${testUser.uid}/profile/account`).get()).data();
  expect(stored).toMatchObject({ birthYear: 1990, uiLocale: 'en', nativeLanguage: 'en', termsVersion: '2026-10-01', privacyVersion: '2026-11-19' });
  expect(typeof stored?.consentAcceptedAt).toBe('string');
  expect(typeof stored?.completedAt).toBe('string');
  expect((await db.doc(`users/${testUser.uid}/profile/age_restriction`).get()).exists).toBe(false);

  // Asked once: later loads open the app directly.
  await page.reload();
  await expect(page.locator('[data-library-card-id="profile-step-existing-card"]')).toBeVisible();
  await expect(profileStep(page)).toHaveCount(0);
});

test('the chosen app language applies at once and the native language seeds course onboarding', async ({
  page, db, testUser, signIn, blockExternalNetwork,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await blockExternalNetwork(page);
  await signIn(page, '/?view=today');

  await expect(profileStep(page)).toBeVisible();
  await page.getByLabel('App language').selectOption('vi');
  await expect(page.getByRole('heading', { level: 1, name: 'Cá nhân hóa SonFlash của bạn.' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', /^vi/);
  await expect(page.getByLabel('Tiếng mẹ đẻ')).toHaveValue('vi');

  // The native language is independent of the app language once chosen.
  await page.getByLabel('Tiếng mẹ đẻ').selectOption('en');
  await page.getByLabel('Năm sinh').fill('1994');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Lưu và tiếp tục' }).click();

  const onboarding = page.getByRole('dialog');
  await expect(onboarding.getByRole('heading', { name: 'Chọn ngôn ngữ của bạn' })).toBeVisible();
  await expect(onboarding.getByRole('button', { name: /^English/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(onboarding.getByRole('button', { name: /^Tiếng Việt/ })).toHaveAttribute('aria-pressed', 'false');

  const stored = (await db.doc(`users/${testUser.uid}/profile/account`).get()).data();
  expect(stored).toMatchObject({ birthYear: 1994, uiLocale: 'vi', nativeLanguage: 'en' });

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', /^vi/);
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Chọn ngôn ngữ của bạn' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1, name: 'Cá nhân hóa SonFlash của bạn.' })).toHaveCount(0);
});

test('an under-18 birth year restricts the account without storing the year, and the restriction survives reloads and sign-ins', async ({
  page, db, testUser, signIn, blockExternalNetwork,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await blockExternalNetwork(page);
  await signIn(page, '/?view=today&locale=en');

  await expect(profileStep(page)).toBeVisible();
  await page.getByLabel('Birth year').fill(String(new Date().getUTCFullYear() - 12));
  await consent(page).check();
  await page.getByRole('button', { name: 'Save and continue' }).click();

  await expect(restrictedStep(page)).toBeVisible();
  await expect(page.getByLabel('Birth year')).toHaveCount(0);
  await expect(page.getByText('Your birth year was not saved. If it was entered by mistake, contact support.')).toBeVisible();
  await expectNoBlockingAxeViolations(page);

  const marker = await db.doc(`users/${testUser.uid}/profile/age_restriction`).get();
  expect(Object.keys(marker.data() ?? {})).toEqual(['restrictedAt']);
  expect((await db.doc(`users/${testUser.uid}/profile/account`).get()).exists).toBe(false);
  expect((await db.doc(`users/${testUser.uid}/profile/courses`).get()).exists).toBe(false);
  expect((await db.collection(`users/${testUser.uid}/cards`).limit(1).get()).empty).toBe(true);

  await page.reload();
  await expect(restrictedStep(page)).toBeVisible();
  await expect(page.getByLabel('Birth year')).toHaveCount(0);

  await page.getByRole('button', { name: 'Return to sign in' }).click();
  await expect(page.locator('.landing-canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__SONFLASH_TEST__?.getCurrentUid?.() ?? null)).toBeNull();

  await signIn(page, '/?view=library&locale=en');
  await expect(restrictedStep(page)).toBeVisible();
  await expect(page.getByLabel('Birth year')).toHaveCount(0);
  expect((await db.collection(`users/${testUser.uid}/cards`).limit(1).get()).empty).toBe(true);
  expect((await db.doc(`users/${testUser.uid}/profile/courses`).get()).exists).toBe(false);
});
