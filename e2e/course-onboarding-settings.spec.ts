import { expect, test } from './fixtures/firebase-emulator';

test('course switcher exposes goals, switches active courses, and keeps course settings visible', async ({ page, db, testUser, signIn, blockExternalNetwork }) => {
  await db.collection('users').doc(testUser.uid).collection('profile').doc('courses').set({
    activeCourseId: 'course-en',
    courses: [
      {
        id: 'course-en', targetLanguage: 'en', nativeLanguage: 'vi', status: 'active',
        goals: [{ id: 'goal-ielts', kind: 'ielts', level: '7.0', targetDate: '2026-12-01', status: 'active', createdAt: '2026-01-01T00:00:00.000Z' }],
        preferences: { pronunciationVariant: null, showRomanization: false, zhScript: null },
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'course-ko', targetLanguage: 'ko', nativeLanguage: 'vi', status: 'active', goals: [],
        preferences: { pronunciationVariant: null, showRomanization: false, zhScript: null },
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  });
  await blockExternalNetwork(page);
  await signIn(page, '/?view=library&locale=en');

  const trigger = page.locator('.claude-course-switcher-trigger');
  await expect(trigger).toHaveText(/English/);
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Courses' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('listitem').filter({ hasText: 'English ← Vietnamese' })
    .getByRole('button', { name: 'Manage goals' }).click();
  const goalRow = dialog.locator('.claude-course-goals-panel li');
  await expect(goalRow.getByText('IELTS', { exact: true })).toBeVisible();
  await expect(goalRow.getByText('7.0', { exact: true })).toBeVisible();
  await expect(goalRow.getByText('2026-12-01', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Back to courses' }).click();
  await dialog.getByRole('button', { name: /Korean.*Vietnamese/ }).click();
  await expect(trigger).toHaveText(/Korean/);

  await page.goto('/?view=settings&locale=en');
  await expect(page.getByRole('heading', { name: 'Make your study space yours' })).toBeVisible();
  const settings = page.getByRole('heading', { name: 'Course and learning' }).locator('xpath=ancestor::section');
  await expect(settings.locator('[data-settings-active-course]')).toContainText('Korean ← Vietnamese');
  await expect(settings.getByText('Meaning language')).toBeVisible();
  await expect(settings.getByText('Daily pace')).toBeVisible();
  await expect(settings.getByText('Show romanization')).toBeVisible();
  await expect(settings.getByRole('switch')).toHaveCount(1);
});

test('a new signed-in learner advances from language selection to a target choice', async ({ page, db, testUser, signIn, blockExternalNetwork }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await blockExternalNetwork(page);
  await signIn(page, '/?view=today&locale=en');

  const dialog = page.getByRole('dialog', { name: 'Set up your course' });
  await expect(dialog.getByRole('heading', { name: 'Choose your language' })).toBeVisible();
  await dialog.getByRole('button', { name: 'English' }).click();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog.getByRole('heading', { name: 'What are you learning?' })).toBeVisible();
  const continueButton = dialog.getByRole('button', { name: 'Continue' });
  await expect(continueButton).toBeDisabled();
  await dialog.getByRole('button', { name: /Korean/ }).click();
  await expect(continueButton).toBeEnabled();
  await continueButton.click();
  await dialog.getByRole('button', { name: /^TOPIK\b/ }).click();
  await expect(dialog.getByRole('textbox', { name: 'Level or target (optional)' })).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Level or target (optional)' }).fill('TOPIK II');
  await dialog.getByLabel('Exam or target date (optional)').fill('2027-01-17');
  await page.screenshot({ path: testInfo.outputPath('onboarding-goal-details.png'), animations: 'disabled', caret: 'hide' });
  await dialog.getByRole('button', { name: 'Back' }).click();
  await dialog.getByRole('button', { name: /Chinese/ }).click();
  await continueButton.click();
  await expect(dialog.getByRole('textbox', { name: 'Level or target (optional)' })).toHaveCount(0);
  await expect(dialog.getByLabel('Chinese script')).toHaveValue('hans');
  await dialog.getByLabel('Chinese script').selectOption('hant');
  await expect(dialog.getByLabel('Chinese script')).toHaveValue('hant');
  await page.screenshot({ path: testInfo.outputPath('onboarding-chinese-script.png'), animations: 'disabled', caret: 'hide' });
  await continueButton.click();
  await expect(dialog.getByRole('heading', { name: 'How many cards a day?' })).toBeVisible();
  await continueButton.click();
  await dialog.getByRole('button', { name: 'Skip for now' }).last().click();
  await dialog.getByRole('button', { name: 'Start learning' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.claude-course-switcher-trigger')).toHaveText(/Chinese/);
  const profile = (await db.collection('users').doc(testUser.uid).collection('profile').doc('courses').get()).data();
  const selectedCourse = profile?.courses?.find((course: { targetLanguage: string }) => course.targetLanguage === 'zh');
  expect(selectedCourse?.preferences?.zhScript).toBe('hant');
  expect(profile?.activeCourseId).toBe(selectedCourse?.id);
});
