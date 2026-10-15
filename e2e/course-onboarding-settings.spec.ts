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
  await goalRow.getByRole('button', { name: 'Edit goal' }).click();
  await goalRow.getByRole('textbox', { name: 'Level or target (optional)' }).fill('7.5');
  await goalRow.getByLabel('Exam or target date (optional)').fill('2027-01-15');
  await goalRow.getByRole('button', { name: 'Save goal' }).click();
  await expect(goalRow.getByText('7.5', { exact: true })).toBeVisible();
  await expect(goalRow.getByText('2027-01-15', { exact: true })).toBeVisible();
  const savedProfile = await db.collection('users').doc(testUser.uid).collection('profile').doc('courses').get();
  expect(savedProfile.data()?.courses?.find((course: { id: string }) => course.id === 'course-en')
    ?.goals?.find((goal: { id: string }) => goal.id === 'goal-ielts'))
    .toEqual(expect.objectContaining({ level: '7.5', targetDate: '2027-01-15' }));
  await dialog.getByRole('button', { name: 'Back to courses' }).click();
  await dialog.getByRole('button', { name: /Korean.*Vietnamese/ }).click();
  await expect(trigger).toHaveText(/Korean/);
  await expect(trigger).toBeFocused();
  await expect(page.locator('.claude-course-switcher').getByRole('status')).toHaveText('Switched to Korean');
  await trigger.click();
  await dialog.getByRole('button', { name: 'Add a language' }).click();
  const targets = dialog.locator('.course-target-card');
  const japanese = targets.filter({ hasText: 'Japanese' });
  const chinese = targets.filter({ hasText: 'Chinese' });
  await expect(targets).toHaveCount(2);
  await expect(japanese).toHaveAttribute('aria-pressed', 'true');
  await expect(chinese).toHaveAttribute('aria-pressed', 'false');
  await chinese.click();
  await expect(chinese).toHaveAttribute('aria-pressed', 'true');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await dialog.getByRole('button', { name: 'Close' }).click();

  await page.goto('/?view=settings&locale=en');
  await expect(page.getByRole('heading', { name: 'Make your study space yours' })).toBeVisible();
  const settings = page.getByRole('heading', { name: 'Course and learning' }).locator('xpath=ancestor::section');
  await expect(settings.locator('[data-settings-active-course]')).toContainText('Korean ← Vietnamese');
  await expect(settings.getByText('Meaning language')).toBeVisible();
  await expect(settings.getByText('Daily pace')).toBeVisible();
  await expect(settings.getByText('Show romanization')).toBeVisible();
  await expect(settings.getByText(/Korean 2-set \(두벌식\)/)).toBeVisible();
  await expect(settings.getByRole('switch')).toHaveCount(1);
});

test('switching courses isolates Library cards and spelling practice by language pair', async ({ page, db, testUser, seedCards, signIn, blockExternalNetwork }) => {
  test.setTimeout(60_000);
  const koreanCards = [
    ['학교', 'nghĩa Hàn 1'], ['친구', 'nghĩa Hàn 2'], ['책', 'nghĩa Hàn 3'], ['사람', 'nghĩa Hàn 4'],
  ] as const;
  await db.collection('users').doc(testUser.uid).collection('profile').doc('courses').set({
    activeCourseId: 'course-en',
    courses: [
      {
        id: 'course-en', targetLanguage: 'en', nativeLanguage: 'vi', status: 'active', goals: [],
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
  await seedCards([
    {
      id: 'course-pair-en', word: 'isolation', normalizedWord: 'isolation', translation: 'sự tách biệt',
      language: 'en', translationLanguage: 'vi', difficulty: 'unrated', createdAt: '2026-01-01T00:00:00.000Z',
    },
    ...koreanCards.map(([word, translation], index) => ({
      id: `course-pair-ko-${index}`, word, normalizedWord: word, translation,
      language: 'ko', translationLanguage: 'vi', difficulty: 'unrated',
      createdAt: `2026-01-01T00:0${index}:00.000Z`,
    })),
  ]);
  await blockExternalNetwork(page);
  await signIn(page, '/?view=library&locale=en');

  const englishCard = page.locator('[data-library-card-id="course-pair-en"]');
  const koreanCard = page.locator('[data-library-card-id="course-pair-ko-0"]');
  const trigger = page.locator('.claude-course-switcher-trigger');
  await expect(englishCard).toBeVisible({ timeout: 15_000 });
  await expect(koreanCard).toHaveCount(0);

  await trigger.click();
  await page.getByRole('dialog', { name: 'Courses' }).getByRole('button', { name: /Korean.*Vietnamese/ }).click();
  await expect(trigger).toHaveText(/Korean/);
  await expect(koreanCard).toBeVisible({ timeout: 15_000 });
  await expect(englishCard).toHaveCount(0);

  await page.goto('/?view=today&locale=en');
  await expect(trigger).toHaveText(/Korean/);
  await page.getByRole('button', { name: 'More practice' }).click();
  await page.getByRole('button', { name: /^Spelling/ }).click();
  await expect(page.getByRole('heading', { name: 'Spelling practice' })).toBeVisible({ timeout: 15_000 });
  const answer = page.getByRole('textbox', { name: 'Type the Korean word' });
  await expect(answer).toBeVisible();
  const prompt = await page.locator('#spelling-question-heading').textContent();
  const koreanAnswer = koreanCards.find(([, translation]) => translation === prompt)?.[0];
  if (!koreanAnswer) throw new Error(`Unexpected Korean spelling prompt: ${prompt}`);
  await answer.fill(koreanAnswer);
  await answer.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: 'Correct answer.' })).toBeVisible();

  await page.getByRole('button', { name: 'Exit' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Vocabulary library' })).toBeVisible();
  await trigger.click();
  await page.getByRole('dialog', { name: 'Courses' }).getByRole('button', { name: /English.*Vietnamese/ }).click();
  await expect(trigger).toHaveText(/English/);
  await expect(englishCard).toBeVisible({ timeout: 15_000 });
  await expect(koreanCard).toHaveCount(0);
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
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('.claude-course-switcher-trigger')).toHaveText(/Chinese/);
  const profile = (await db.collection('users').doc(testUser.uid).collection('profile').doc('courses').get()).data();
  const selectedCourse = profile?.courses?.find((course: { targetLanguage: string }) => course.targetLanguage === 'zh');
  expect(selectedCourse?.preferences?.zhScript).toBe('hant');
  expect(profile?.activeCourseId).toBe(selectedCourse?.id);
});

test('onboarding keeps reminder save failure visible until the learner explicitly skips it', async ({ page, signIn, blockExternalNetwork }) => {
  await blockExternalNetwork(page);
  await signIn(page, '/?view=today&locale=en');
  const dialog = page.getByRole('dialog', { name: 'Set up your course' });
  await dialog.getByRole('button', { name: 'English' }).click();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByRole('button', { name: /Korean/ }).click();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByRole('button', { name: 'Skip for now' }).last().click();

  const reminders = dialog.getByRole('region', { name: 'Study reminders' });
  await expect(reminders.getByRole('button', { name: 'Save reminders' })).toBeEnabled();
  let releaseRequest!: () => void;
  const heldRequest = new Promise<void>(resolve => { releaseRequest = resolve; });
  let sawRequest = false;
  await page.route(/\/updateReminderSettings(?:\?|$)/, async route => {
    if (route.request().method() !== 'POST') { await route.continue(); return; }
    sawRequest = true;
    await heldRequest;
    await route.abort('failed');
  });
  try {
    await reminders.getByRole('button', { name: 'Save reminders' }).click();
    await expect.poll(() => sawRequest).toBe(true);
    await expect(dialog.getByRole('button', { name: 'Back' })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Start learning' })).toBeDisabled();
    await expect(dialog.locator('header').getByRole('button', { name: 'Skip for now' })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();

    releaseRequest();
    await expect(reminders.getByRole('alert')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Back' })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Start learning' })).toBeDisabled();
    await reminders.getByRole('button', { name: 'Skip for now' }).click();
    await expect(dialog.getByRole('button', { name: 'Back' })).toBeEnabled();
    await expect(dialog.getByRole('button', { name: 'Start learning' })).toBeEnabled();
  } finally {
    releaseRequest();
  }
});
