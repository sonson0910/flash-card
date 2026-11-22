import { expect, test } from './fixtures/firebase-emulator';

test('course switcher exposes goals, switches active courses, and keeps course settings visible', async ({ page, db, testUser, signIn, blockExternalNetwork }) => {
  test.setTimeout(60_000);
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
  const englishRow = dialog.getByRole('button', { name: /English.*Vietnamese/ });
  await expect(englishRow).toHaveAttribute('aria-current', 'true');
  await expect(englishRow).toContainText('IELTS 7.0');
  await dialog.getByRole('button', { name: 'Manage courses' }).click();
  await expect(dialog).toHaveCount(0);
  // Manage courses opens the courses page, a view of its own with a URL, under Today.
  await expect(page).toHaveURL(/[?&]view=courses(&|$)/);
  const courses = page.locator('[data-courses-page]');
  const coursesHeading = page.getByRole('heading', { level: 1, name: 'Your languages' });
  await expect(coursesHeading).toBeFocused();
  await expect(page.getByRole('navigation', { name: 'Primary navigation' }).locator('[aria-current="page"]')).toHaveText('Today');
  await expect(courses.getByRole('button', { name: 'Close courses' })).toHaveCount(0);
  await courses.locator('.course-card[data-course-language="en"]').getByRole('button', { name: 'Manage goals' }).click();
  // The address names the open goals, so a reload returns to them; it is the same history entry.
  await expect(page).toHaveURL(/[?&]goals=course-en(&|$)/);
  const goalRow = courses.locator('.claude-course-goals-panel li');
  await expect(goalRow.getByText('IELTS', { exact: true })).toBeVisible();
  await expect(goalRow.getByText('7.0 · 2026-12-01', { exact: true })).toBeVisible();
  await expect(goalRow.getByRole('group', { name: 'Your latest IELTS score' })).toBeVisible();
  await goalRow.getByRole('button', { name: 'Edit goal' }).click();
  const band = goalRow.getByRole('group', { name: 'Target band' });
  await expect(band.getByRole('radio', { name: '7.0' })).toBeChecked();
  await band.getByRole('radio', { name: '7.5' }).check();
  await expect(band.getByRole('radio', { name: '7.5' })).toBeChecked();
  await goalRow.getByLabel('Exam or target date (optional)').fill('2027-01-15');
  await goalRow.getByRole('button', { name: 'Save goal' }).click();
  // The save goes through a course callable, which can be cold on the first call of a run.
  await expect(goalRow.getByText('7.5 · 2027-01-15', { exact: true })).toBeVisible({ timeout: 30_000 });
  const savedProfile = await db.collection('users').doc(testUser.uid).collection('profile').doc('courses').get();
  expect(savedProfile.data()?.courses?.find((course: { id: string }) => course.id === 'course-en')
    ?.goals?.find((goal: { id: string }) => goal.id === 'goal-ielts'))
    .toEqual(expect.objectContaining({ level: '7.5', targetDate: '2027-01-15' }));
  await courses.getByRole('button', { name: 'Back to courses' }).click();
  await expect(courses.locator('.course-card[data-course-language="en"]')).toBeVisible();
  await expect(page).not.toHaveURL(/[?&]goals=/);

  // Back returns to the view the page was opened from, and forward reopens the page with its heading focused.
  await page.goBack();
  await expect(page).toHaveURL(/[?&]view=library(&|$)/);
  await expect(courses).toHaveCount(0);
  await page.goForward();
  await expect(page).toHaveURL(/[?&]view=courses(&|$)/);
  await expect(coursesHeading).toBeFocused();
  await page.goBack();
  await expect(page).toHaveURL(/[?&]view=library(&|$)/);

  await trigger.click();
  await dialog.getByRole('button', { name: /Korean.*Vietnamese/ }).click();
  // The first switch of a run reaches a cold course callable in the emulator.
  await expect(trigger).toHaveText(/Korean/, { timeout: 30_000 });
  await expect(trigger).toBeFocused();
  const toast = page.locator('.course-switched-toast');
  await expect(toast).toContainText('Switched to 한국어');
  await toast.getByRole('button', { name: 'Back to English' }).click();
  await expect(trigger).toHaveText(/English/);
  await expect(toast).toContainText('Switched to English');
  await toast.getByRole('button', { name: 'Back to 한국어' }).click();
  await expect(trigger).toHaveText(/Korean/);

  await trigger.click();
  await dialog.getByRole('button', { name: 'Add a language' }).click();
  const addLanguage = page.getByRole('dialog', { name: 'Add a language' });
  const targets = addLanguage.locator('.course-target-card');
  await expect(targets).toHaveCount(4);
  await expect(addLanguage.getByRole('radio', { name: /English/ })).toBeDisabled();
  await expect(addLanguage.getByRole('radio', { name: /Korean/ })).toBeDisabled();
  await expect(addLanguage.getByRole('radio', { name: /Japanese/ })).toBeChecked();
  await expect(addLanguage.getByRole('radio', { name: /Chinese/ })).not.toBeChecked();
  await targets.filter({ hasText: 'Chinese' }).click();
  await expect(addLanguage.getByRole('radio', { name: /Chinese/ })).toBeChecked();
  await expect(addLanguage.getByRole('button', { name: 'Add 中文' })).toBeEnabled();
  await addLanguage.getByRole('button', { name: 'Cancel' }).click();
  await expect(addLanguage).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toHaveCount(0);

  await page.goto('/?view=settings&locale=en');
  await expect(page.getByRole('heading', { name: 'Make your study space yours' })).toBeVisible();
  await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'Language & courses' }).click();
  const settings = page.getByRole('region', { name: 'Language & courses' });
  await expect(settings.locator('[data-settings-active-course]')).toContainText('Korean ← Vietnamese');
  await expect(settings.getByText('Meanings and explanations in')).toBeVisible();
  await expect(settings.getByText('Daily pace')).toBeVisible();
  await expect(settings.getByText('Show romanization')).toBeVisible();
  await expect(settings.getByText(/Korean 2-set \(두벌식\)/)).toBeVisible();
  await expect(settings.getByRole('switch')).toHaveCount(1);
});

test('the courses page opens from a deep link and on the goals a goals link names', async ({ page, db, testUser, signIn, blockExternalNetwork }) => {
  test.setTimeout(60_000);
  await db.collection('users').doc(testUser.uid).collection('profile').doc('courses').set({
    activeCourseId: 'course-en',
    courses: [{
      id: 'course-en', targetLanguage: 'en', nativeLanguage: 'vi', status: 'active',
      goals: [{ id: 'goal-ielts', kind: 'ielts', level: '7.0', targetDate: '2026-12-01', status: 'active', createdAt: '2026-01-01T00:00:00.000Z' }],
      preferences: { pronunciationVariant: null, showRomanization: false, zhScript: null },
      createdAt: '2026-01-01T00:00:00.000Z',
    }],
  });
  await blockExternalNetwork(page);
  await signIn(page, '/?view=courses&locale=en');

  const courses = page.locator('[data-courses-page]');
  await expect(page.getByRole('heading', { level: 1, name: 'Your languages' })).toBeVisible({ timeout: 15_000 });
  await expect(courses.locator('.course-card[data-course-language="en"]')).toContainText('IELTS');
  await courses.getByRole('button', { name: /Start .*English.* lesson/ }).click();
  await expect(page).toHaveURL(/[?&]view=today(&|$)/);
  await expect(courses).toHaveCount(0);

  await page.goto('/?view=courses&goals=course-en&locale=en');
  const goalRow = courses.locator('.claude-course-goals-panel li');
  await expect(goalRow.getByText('IELTS', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(goalRow.getByRole('group', { name: 'Your latest IELTS score' })).toBeVisible();
  await courses.getByRole('button', { name: 'Back to courses' }).click();
  await expect(courses.locator('.course-card[data-course-language="en"]')).toBeVisible();
  await expect(page).not.toHaveURL(/[?&]goals=/);
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
      language: 'ko', translationLanguage: 'vi', difficulty: 'good', reviews: 1,
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
  await expect(trigger).toHaveText(/Korean/, { timeout: 30_000 });
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
  test.setTimeout(90_000);
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

  // The goal comes first; an exam goal adds the score and countdown step, and Korean adds the Hangul primer.
  const progress = dialog.getByRole('progressbar', { name: 'Setup progress' });
  await expect(dialog.getByRole('heading', { name: 'What are you learning for?' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /^Just curious/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(progress).toHaveAttribute('aria-valuetext', '3 / 8');
  const examGoal = dialog.getByRole('button', { name: /^Pass TOPIK/ });
  await examGoal.click();
  await expect(examGoal).toHaveAttribute('aria-pressed', 'true');
  await expect(progress).toHaveAttribute('aria-valuetext', '3 / 9');
  await continueButton.click();
  await expect(dialog.getByRole('heading', { name: 'Which test, and what score?' })).toBeVisible();
  const exams = dialog.getByRole('group', { name: 'Exam' });
  await expect(exams.getByRole('button', { name: 'TOPIK', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const countdown = dialog.getByRole('region', { name: 'Countdown' });
  await expect(countdown).toContainText('Pick a date to start your countdown.');
  await dialog.getByRole('textbox', { name: 'Level or target (optional)' }).fill('TOPIK II');
  const examDate = await page.evaluate(() => {
    const date = new Date();
    date.setDate(date.getDate() + 30);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  });
  await dialog.getByLabel('Exam date (optional)').fill(examDate);
  await expect(countdown.locator('.onb-countdown-number')).toHaveText('30');
  await expect(countdown).toContainText('days to TOPIK');
  await expect(countdown).toContainText('5 weeks until exam day.');
  await expect(dialog.locator('.onb-footer-note')).toHaveText(`Selected: TOPIK · TOPIK II · ${examDate}`);
  await page.screenshot({ path: testInfo.outputPath('onboarding-goal-details.png'), animations: 'disabled', caret: 'hide' });

  // Changing the language drops the goal chosen for the old one.
  await dialog.getByRole('button', { name: 'Back' }).click();
  await dialog.getByRole('button', { name: 'Back' }).click();
  await dialog.getByRole('button', { name: /Chinese/ }).click();
  await expect(dialog.getByLabel('Chinese script')).toHaveValue('hans');
  await dialog.getByLabel('Chinese script').selectOption('hant');
  await expect(dialog.getByLabel('Chinese script')).toHaveValue('hant');
  await page.screenshot({ path: testInfo.outputPath('onboarding-chinese-script.png'), animations: 'disabled', caret: 'hide' });
  await continueButton.click();
  await expect(dialog.getByRole('button', { name: /^Just curious/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(progress).toHaveAttribute('aria-valuetext', '3 / 7');
  await continueButton.click();

  // The starting level is the learner's own answer and stays optional; Chinese has no script primer.
  await expect(dialog.getByRole('heading', { name: 'Where are you starting from?' })).toBeVisible();
  const levels = dialog.getByRole('group', { name: 'Starting level' });
  await expect(levels.getByRole('button')).toHaveCount(3);
  await levels.getByRole('button', { name: /^Core/ }).click();
  await expect(levels.getByRole('button', { name: /^Core/ })).toHaveAttribute('aria-pressed', 'true');
  await continueButton.click();

  await expect(dialog.getByRole('heading', { name: 'How many new words each day?' })).toBeVisible();
  await expect(progress).toHaveAttribute('aria-valuetext', '5 / 7');
  await expect(dialog.locator('.onb-projection')).toHaveText('70new words a week in your plan at 10 a day.About 7 min a day for new words, plus the reviews that come due.');
  await dialog.getByRole('button', { name: 'Try 5 cards' }).click();

  // The trial grades the real starter cards the server wrote for this course.
  // The starter cards are written by a callable before the trial opens; it can be cold on its first call.
  await expect(dialog.getByRole('heading', { name: 'Flip each card, then grade yourself.' })).toBeVisible({ timeout: 30_000 });
  const firstCard = dialog.getByRole('group', { name: /^你好 flashcard/ });
  await expect(firstCard).toBeVisible({ timeout: 15_000 });
  await expect(firstCard).toHaveAccessibleName(/Showing the Chinese word/);
  await firstCard.getByRole('button', { name: /^Reveal the .*meaning of 你好$/ }).click();
  await expect(firstCard).toHaveAccessibleName(/meaning/);
  await expect(firstCard).toContainText('hello');
  const words = dialog.getByRole('list', { name: 'Your first 5 cards' }).getByRole('listitem');
  await expect(words).toHaveCount(5);
  const grades = dialog.getByRole('group', { name: 'Did you know this word?' });
  await grades.getByRole('button', { name: 'Got it' }).click();
  // Onboarding is a dialog; a tap on the card face must still turn the card it hosts.
  const secondCard = dialog.getByRole('group', { name: / flashcard/ });
  await expect(secondCard).toHaveAccessibleName(/Showing the Chinese word/);
  await secondCard.locator('[data-flashcard-stage]').click({ position: { x: 16, y: 120 } });
  await expect(secondCard).toHaveAccessibleName(/meaning/);
  for (const answer of ['Forgot', 'Got it', 'Got it', 'Forgot']) {
    await grades.getByRole('button', { name: answer }).click();
  }
  await expect(dialog.getByRole('heading', { name: 'You remembered 3 of 5.' })).toBeVisible();
  await expect(grades).toHaveCount(0);
  await expect(words.filter({ hasText: 'Again' })).toHaveCount(2);
  await expect.poll(async () => (await db.collection('users').doc(testUser.uid).collection('cards').where('language', '==', 'zh').get()).size).toBe(5);

  await dialog.getByRole('button', { name: 'Set my reminder' }).click();
  await expect(dialog.getByRole('heading', { name: 'When should we nudge you?' })).toBeVisible();
  // The preview counts the starter cards the trial just graded, not an invented number.
  await expect(dialog.getByRole('figure', { name: 'Reminder preview' })).toContainText('5 cards are ready for review.');
  await dialog.getByRole('button', { name: 'Start learning' }).click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('.claude-course-switcher-trigger')).toHaveText(/Chinese/);
  const profile = (await db.collection('users').doc(testUser.uid).collection('profile').doc('courses').get()).data();
  const selectedCourse = profile?.courses?.find((course: { targetLanguage: string }) => course.targetLanguage === 'zh');
  expect(selectedCourse?.preferences?.zhScript).toBe('hant');
  expect(profile?.activeCourseId).toBe(selectedCourse?.id);
  // The starting level stays on this device for the course language; it costs no Firestore write.
  expect(await page.evaluate(key => localStorage.getItem(key), `sonflash_starting_tier_v1_${testUser.uid}_zh`)).toBe('core');
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
  await expect(dialog.getByRole('heading', { name: 'Where are you starting from?' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await expect(dialog.getByRole('heading', { name: 'Read Hangul before your first words' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Continue' }).click();
  await dialog.getByRole('button', { name: 'Try 5 cards' }).click();
  await dialog.getByRole('button', { name: 'Set my reminder' }).click();

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
