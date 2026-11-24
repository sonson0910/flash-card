import { expect, test } from './fixtures/firebase-emulator';
import type { Locator, Page, TestInfo } from '@playwright/test';
import type { Firestore } from 'firebase-admin/firestore';

const themes = [
  { family: 'classic', mode: 'light' },
  { family: 'classic', mode: 'dark' },
  { family: 'crystal', mode: 'light' },
  { family: 'crystal', mode: 'dark' },
] as const;

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

async function prepareTheme(page: Page, theme: (typeof themes)[number], viewport: (typeof viewports)[number]) {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ colorScheme: theme.mode, reducedMotion: 'reduce' });
  await page.addInitScript(({ family, mode }) => {
    localStorage.setItem('sonflash_theme_family', family);
    localStorage.setItem('lingoflash_theme', mode);
    localStorage.setItem('sonflash_theme_follow_system', 'false');
    localStorage.setItem('sonflash_reduced_motion', 'true');
  }, theme);
}

/**
 * `hidden` lists selectors of text that changes from day to day. Such text is left unpainted rather than
 * masked, because a mask covers the element's box and the box is as wide as that day's text.
 */
async function expectScreen(page: Page, testInfo: TestInfo, name: string, mask: Locator[] = [], hidden: string[] = []) {
  await expect(page.locator('html')).toHaveAttribute('data-theme-family', /classic|crystal/);
  // WebKit antialiases an outline differently while one of its transitions runs and until the frame after it ends,
  // so the capture waits for running transitions to end and then for two frames.
  await page.evaluate(async () => {
    await Promise.all(document.getAnimations()
      .filter(animation => animation.playState === 'running' && animation.effect?.getComputedTiming().endTime !== Infinity)
      .map(animation => animation.finished.catch(() => undefined)));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  // The onboarding mascot loads lazily and decodes off the main thread, so the capture waits until it can paint.
  const mascot = page.locator('.onb-lumi-figure');
  if (await mascot.isVisible()) await mascot.evaluate(image => (image as HTMLImageElement).decode());
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${name} has horizontal overflow`).toBe(true);
  const screenshot = testInfo.outputPath(`${name}.png`);
  const style = hidden.length ? `${hidden.join(', ')} { visibility: hidden !important; }` : undefined;
  const image = await page.screenshot({ path: screenshot, fullPage: true, animations: 'disabled', caret: 'hide', mask, style });
  await testInfo.attach(name, { path: screenshot, contentType: 'image/png' });
  return { image, name };
}

/** A date the browser sees as `days` local calendar days ahead, so the countdown on screen never drifts. */
async function dateFromToday(page: Page, days: number) {
  return page.evaluate(offset => {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }, days);
}

async function expectBox(locator: Locator, name: string) {
  const box = await locator.boundingBox();
  expect(box, `${name} has a rendered bounding box`).toBeTruthy();
  if (!box) throw new Error(`${name} has no rendered bounding box`);
  return box;
}

async function seedCourses(db: Firestore, ownerId: string) {
  await db.collection('users').doc(ownerId).collection('profile').doc('courses').set({
    activeCourseId: 'course-ko',
    courses: [
      {
        id: 'course-ko', targetLanguage: 'ko', nativeLanguage: 'vi', status: 'active',
        goals: [{ id: 'goal-topik', kind: 'topik', level: 'TOPIK II', targetDate: '2026-12-01', status: 'active', createdAt: '2026-01-01T00:00:00.000Z' }],
        preferences: { pronunciationVariant: null, showRomanization: true, zhScript: null },
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'course-en', targetLanguage: 'en', nativeLanguage: 'vi', status: 'active', goals: [],
        preferences: { pronunciationVariant: null, showRomanization: false, zhScript: null },
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  });
}

/** Five Korean cards: three never reviewed and two reviewed, none due, so the due count read before them stays true. */
async function seedKoreanCards(db: Firestore, ownerId: string) {
  const cards = db.collection('users').doc(ownerId).collection('cards');
  const batch = db.batch();
  for (const [index, word] of ['학교', '친구', '책', '사람', '물'].entries()) {
    const reviewed = index < 2;
    batch.set(cards.doc(`course-surface-ko-${index}`), {
      id: `course-surface-ko-${index}`, word, normalizedWord: word, translation: `nghĩa ${index + 1}`,
      language: 'ko', translationLanguage: 'vi', difficulty: reviewed ? 'good' : 'unrated', reviews: reviewed ? 2 : 0,
      ...(reviewed ? { nextReviewDate: '2099-01-01T00:00:00.000Z' } : {}),
      libraryEpoch: 0, createdAt: `2026-01-01T00:0${index}:00.000Z`,
    });
  }
  await batch.commit();
}

for (const theme of themes) for (const viewport of viewports) {
  test(`${theme.family} ${theme.mode} courses, goals, settings and onboarding capture at ${viewport.name}`, async ({ page, db, testUser, signIn, blockExternalNetwork }, testInfo) => {
    // Eight full-page captures at the desktop size use most of the default budget in WebKit.
    test.setTimeout(60_000);
    await prepareTheme(page, theme, viewport);
    await blockExternalNetwork(page);
    await signIn(page, '/?view=today&locale=en');

    const root = page.locator('html');
    await expect(root).toHaveAttribute('data-theme-family', theme.family);
    if (theme.mode === 'dark') await expect(root).toHaveClass(/\bdark\b/);
    else await expect(root).not.toHaveClass(/\bdark\b/);

    // This owner starts without a profile, so the app's actual gate exposes
    // its first onboarding state before the course fixture is introduced.
    const onboarding = page.getByRole('dialog', { name: 'Set up your course' });
    await expect(onboarding.getByRole('heading', { name: 'Choose your language' })).toBeVisible();
    await expect(onboarding.getByRole('button', { name: 'English' })).toBeVisible();
    await expect(onboarding.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '1 / 7');
    const onboardingSurface = page.locator('.claude-onboarding-journey');
    const onboardingBox = await expectBox(onboardingSurface, 'onboarding journey');
    expect(onboardingBox.width, 'onboarding fills the viewport width').toBe(viewport.width);
    expect(onboardingBox.height, 'onboarding fills the viewport height').toBe(viewport.height);
    const onboardingScreenshot = await expectScreen(page, testInfo, `course-onboarding-${theme.family}-${theme.mode}-${viewport.name}`);
    await onboarding.getByRole('button', { name: 'Continue' }).click();
    await onboarding.getByRole('button', { name: /Korean/ }).click();
    await onboarding.getByRole('button', { name: 'Continue' }).click();
    const examGoal = onboarding.getByRole('button', { name: /^Pass TOPIK/ });
    await examGoal.click();
    await expect(examGoal).toHaveAttribute('aria-pressed', 'true');
    await expect(onboarding.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '3 / 9');
    await expect(onboarding.getByRole('button', { name: 'Continue' })).toBeInViewport();
    const goalScreenshot = await expectScreen(page, testInfo, `course-onboarding-goal-${theme.family}-${theme.mode}-${viewport.name}`);

    await onboarding.getByRole('button', { name: 'Continue' }).click();
    await expect(onboarding.getByRole('heading', { name: 'Which test, and what score?' })).toBeVisible();
    await expect(onboarding.getByRole('group', { name: 'Exam' }).getByRole('button', { name: 'TOPIK', exact: true })).toHaveAttribute('aria-pressed', 'true');
    for (const chip of await onboarding.getByRole('group', { name: 'Exam' }).getByRole('button').all()) {
      expect((await expectBox(chip, 'exam chip')).height, 'exam chips meet the 44px touch target').toBeGreaterThanOrEqual(44);
    }
    await onboarding.getByRole('textbox', { name: 'Level or target (optional)' }).fill('TOPIK II');
    await onboarding.getByLabel('Exam date (optional)').fill(await dateFromToday(page, 86));
    await onboarding.getByRole('heading', { name: 'Which test, and what score?' }).click();
    const countdown = onboarding.getByRole('region', { name: 'Countdown' });
    await expect(countdown.locator('.onb-countdown-number')).toHaveText('86');
    await expect(countdown.locator('.onb-weeks > span')).toHaveCount(12);
    await expect(countdown).toContainText('13 weeks until exam day.');
    await expect(onboarding.getByRole('button', { name: 'Continue' })).toBeInViewport();
    // The date field and the footer summary show a day 86 days from today, so they change every day; the
    // countdown beside them does not.
    const examScreenshot = await expectScreen(page, testInfo, `course-onboarding-exam-${theme.family}-${theme.mode}-${viewport.name}`, [onboarding.getByLabel('Exam date (optional)')], ['.onb-footer-note']);

    await seedCourses(db, testUser.uid);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Build your first learning plan', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Learn → Immerse → Communicate', exact: true })).toBeVisible();

    const switcher = page.locator('.claude-course-switcher-trigger:visible');
    await expect(switcher).toContainText('Korean');
    await switcher.click();
    const courses = page.getByRole('dialog', { name: 'Courses' });
    await expect(courses).toBeVisible();
    const surface = await courses.evaluate(element => {
      const probe = document.createElement('span');
      probe.style.backgroundColor = 'var(--sf-surface)';
      element.append(probe);
      const expected = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return { actual: getComputedStyle(element).backgroundColor, expected, face: getComputedStyle(element, '::after').backgroundImage };
    });
    if (theme.family === 'crystal' && viewport.name === 'desktop') {
      // The Crystal desktop popover draws its face on a chamfered layer inside the gradient rim, so that layer,
      // not the popover box, is what must be opaque.
      expect(surface.face, 'course overlay hides text underneath it').toMatch(/^linear-gradient\(/);
      expect(surface.face, 'course overlay hides text underneath it').not.toMatch(/rgba\(|transparent/);
    } else {
      expect(surface.actual, 'course overlay hides text underneath it').toBe(surface.expected);
      expect(surface.actual).toMatch(/^rgb\(/);
    }
    await expect(courses.getByRole('button', { name: /Korean.*Vietnamese/ })).toHaveAttribute('aria-current', 'true');
    const coursesBox = await expectBox(courses, 'course switcher');
    if (viewport.name === 'desktop') {
      expect(coursesBox.width, 'desktop course switcher uses the Canvas-aligned popover width').toBeCloseTo(480, 3);
    } else {
      expect(coursesBox.width, 'mobile course switcher spans the viewport as a bottom sheet').toBe(viewport.width);
      expect(coursesBox.y + coursesBox.height, 'mobile course switcher is anchored to the viewport bottom').toBe(viewport.height);
    }
    const activeCourseButton = courses.getByRole('button', { name: /Korean.*Vietnamese/ });
    expect((await expectBox(activeCourseButton, 'active course control')).height, 'course switcher controls meet the 44px touch target').toBeGreaterThanOrEqual(44);
    await expect(activeCourseButton).toContainText('TOPIK II');
    for (const name of ['Close', 'Add a language', 'Manage courses']) {
      const box = await expectBox(courses.getByRole('button', { name, exact: true }), `${name} control`);
      expect(box.width, `${name} width meets the 44px touch target`).toBeGreaterThanOrEqual(44);
      expect(box.height, `${name} height meets the 44px touch target`).toBeGreaterThanOrEqual(44);
    }
    const switcherScreenshot = await expectScreen(page, testInfo, `course-switcher-${theme.family}-${theme.mode}-${viewport.name}`);
    await courses.getByRole('button', { name: 'Add a language' }).click();
    const addLanguage = page.getByRole('dialog', { name: 'Add a language' });
    await expect(addLanguage).toBeVisible();
    const targetCards = addLanguage.locator('.course-target-card');
    await expect(targetCards).toHaveCount(4);
    await expect(addLanguage.getByRole('radio', { name: /Korean/ })).toBeDisabled();
    await expect(addLanguage.getByRole('radio', { name: /Japanese/ })).toBeChecked();
    await expect(addLanguage.getByRole('radio', { name: /Chinese/ })).not.toBeChecked();
    for (const card of await targetCards.all()) {
      expect((await expectBox(card, 'language card')).height, 'language cards meet the 44px touch target').toBeGreaterThanOrEqual(44);
    }
    for (const name of ['Close', 'Cancel']) {
      expect((await expectBox(addLanguage.getByRole('button', { name, exact: true }), `${name} add-language control`)).height, `${name} meets the 44px touch target`).toBeGreaterThanOrEqual(44);
    }
    const createScreenshot = await expectScreen(page, testInfo, `course-switcher-create-${theme.family}-${theme.mode}-${viewport.name}`);
    await addLanguage.getByRole('button', { name: 'Cancel' }).click();
    await expect(addLanguage).toHaveCount(0);

    await expect(courses).toBeVisible();
    // Cards arrive after the switcher read its due counts; the courses surface counts them when it opens.
    await seedKoreanCards(db, testUser.uid);
    await courses.getByRole('button', { name: 'Manage courses' }).click();
    // Manage courses opens the courses page, with its own URL and focused heading.
    await expect(page).toHaveURL(/[?&]view=courses(&|$)/);
    const manage = page.locator('[data-courses-page]');
    await expect(page.getByRole('heading', { level: 1, name: theme.family === 'crystal' ? 'Pick your star' : 'Your languages' })).toBeFocused();
    await expect(manage).toContainText('My languages · 2 active · meanings in Tiếng Việt');
    const koreanCard = manage.locator('.course-card[data-course-language="ko"]');
    await expect(koreanCard.locator('.course-card__select')).toHaveAttribute('aria-current', 'true');
    await expect(koreanCard).toContainText('TOPIK II');
    await expect(koreanCard.locator('[data-stat="new"] .course-card__stat-value')).toHaveText('3');
    await expect(koreanCard.locator('.course-card__progress-text')).toHaveText('2 / 5 reviewed');
    const bar = await expectBox(koreanCard.locator('.course-card__bar'), 'course progress bar');
    const fill = await expectBox(koreanCard.locator('.course-card__bar-fill'), 'course progress fill');
    expect(fill.width / bar.width, 'the bar shows the reviewed share of the course').toBeCloseTo(0.4, 1);
    const englishCard = manage.locator('.course-card[data-course-language="en"]');
    await expect(englishCard.locator('[data-stat="new"] .course-card__stat-value')).toHaveText('0');
    await expect(englishCard.locator('.course-card__bar')).toHaveCount(0);
    await expect(manage.getByRole('button', { name: 'Close courses' })).toHaveCount(0);
    for (const [scope, name] of [[koreanCard, 'Manage goals'], [koreanCard, 'Archive course']] as const) {
      const box = await expectBox(scope.getByRole('button', { name, exact: true }), `${name} control`);
      expect(box.width, `${name} width meets the 44px touch target`).toBeGreaterThanOrEqual(44);
      expect(box.height, `${name} height meets the 44px touch target`).toBeGreaterThanOrEqual(44);
    }
    const manageScreenshot = await expectScreen(page, testInfo, `course-manage-${theme.family}-${theme.mode}-${viewport.name}`);

    await koreanCard.getByRole('button', { name: 'Manage goals' }).click();
    const goals = manage.locator('.claude-course-goals-panel');
    await expect(goals.getByText('TOPIK', { exact: true })).toBeVisible();
    await expect(goals.getByText('TOPIK II · 2026-12-01', { exact: true })).toBeVisible();
    for (const control of await goals.locator('li button').all()) {
      const box = await expectBox(control, 'course goal action');
      expect(box.width, 'goal action width meets the 44px touch target').toBeGreaterThanOrEqual(44);
      expect(box.height, 'goal action height meets the 44px touch target').toBeGreaterThanOrEqual(44);
    }
    await expectScreen(page, testInfo, `course-goals-${theme.family}-${theme.mode}-${viewport.name}`);
    await manage.getByRole('button', { name: 'Back to courses' }).click();
    await expect(koreanCard).toBeVisible();

    await page.goto('/?view=settings&locale=en');
    const settingsSections = page.getByRole('navigation', { name: 'Settings sections' });
    await settingsSections.getByRole('button', { name: 'Language & courses' }).click();
    await expect(settingsSections.getByRole('button', { name: 'Language & courses' })).toHaveAttribute('aria-current', 'page');
    const settings = page.getByRole('region', { name: 'Language & courses' });
    await expect(settings).toBeVisible();
    await expect(settings.getByText('Meanings and explanations in')).toBeVisible();
    await expect(settings.getByText('Daily pace')).toBeVisible();
    await expect(settings.getByRole('switch')).toBeChecked();
    await expect(settings.getByText('Applies to new cards. Existing card meanings do not change.')).toBeVisible();
    const activeCourse = settings.locator('[data-settings-active-course]');
    const courseLanguage = settings.locator('[data-settings-course-language]');
    const coursePreferences = settings.locator('[data-settings-course-preferences]');
    const [activeCourseBox, courseLanguageBox, coursePreferencesBox] = await Promise.all([
      activeCourse.boundingBox(),
      courseLanguage.boundingBox(),
      coursePreferences.boundingBox(),
    ]);
    expect(activeCourseBox && courseLanguageBox && coursePreferencesBox).toBeTruthy();
    if (activeCourseBox && courseLanguageBox && coursePreferencesBox) {
      if (viewport.name === 'desktop') {
        expect(courseLanguageBox.x + courseLanguageBox.width, 'language controls stay left of the active course on desktop').toBeLessThanOrEqual(activeCourseBox.x);
        expect(activeCourseBox.y, 'active course stays above course preferences on desktop').toBeLessThan(coursePreferencesBox.y);
      } else {
        expect(activeCourseBox.y, 'active course stays before language controls on mobile').toBeLessThan(courseLanguageBox.y);
        // Course preferences live inside the active course card, so the card carries them ahead of the language controls.
        expect(coursePreferencesBox.y, 'course preferences stay inside the active course card on mobile').toBeGreaterThan(activeCourseBox.y);
        expect(coursePreferencesBox.y + coursePreferencesBox.height, 'course preferences stay inside the active course card on mobile').toBeLessThanOrEqual(activeCourseBox.y + activeCourseBox.height);
        expect(coursePreferencesBox.y + coursePreferencesBox.height, 'course preferences come before the language controls on mobile').toBeLessThanOrEqual(courseLanguageBox.y);
      }
    }
    for (const control of await settings.locator('select').all()) {
      expect((await expectBox(control, 'course settings select')).height, 'settings selects meet the 44px touch target').toBeGreaterThanOrEqual(44);
    }
    await expect(page.getByRole('heading', { level: 1, name: 'Language & courses' })).toBeVisible();
    await expectScreen(page, testInfo, `course-settings-${theme.family}-${theme.mode}-${viewport.name}`);
    // Compared last so a changed screen still leaves every later capture to review.
    expect(onboardingScreenshot.image).toMatchSnapshot(`${onboardingScreenshot.name}.png`);
    expect(goalScreenshot.image).toMatchSnapshot(`${goalScreenshot.name}.png`);
    expect(examScreenshot.image).toMatchSnapshot(`${examScreenshot.name}.png`);
    expect(switcherScreenshot.image).toMatchSnapshot(`${switcherScreenshot.name}.png`);
    expect(createScreenshot.image).toMatchSnapshot(`${createScreenshot.name}.png`);
    expect(manageScreenshot.image).toMatchSnapshot(`${manageScreenshot.name}.png`);
  });
}

for (const theme of themes) for (const viewport of viewports) {
  test(`${theme.family} ${theme.mode} onboarding pace, card trial and reminder capture at ${viewport.name}`, async ({ page, signIn, blockExternalNetwork }, testInfo) => {
    // The starter cards come from a callable that can be cold on its first call.
    test.setTimeout(60_000);
    await prepareTheme(page, theme, viewport);
    await blockExternalNetwork(page);
    await signIn(page, '/?view=today&locale=en');
    const onboarding = page.getByRole('dialog', { name: 'Set up your course' });
    await onboarding.getByRole('button', { name: 'Continue' }).click();
    await onboarding.getByRole('button', { name: /Korean/ }).click();
    await onboarding.getByRole('button', { name: 'Continue' }).click();
    await expect(onboarding.getByRole('button', { name: /^Just curious/ })).toHaveAttribute('aria-pressed', 'true');
    await onboarding.getByRole('button', { name: 'Continue' }).click();

    await expect(onboarding.getByRole('heading', { name: 'Where are you starting from?' })).toBeVisible();
    await expect(onboarding.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '4 / 8');
    const levels = onboarding.getByRole('group', { name: 'Starting level' }).getByRole('button');
    await expect(levels).toHaveCount(3);
    for (const level of await levels.all()) {
      expect((await expectBox(level, 'starting level')).height, 'starting levels meet the 44px touch target').toBeGreaterThanOrEqual(44);
    }
    await expect(onboarding.getByRole('button', { name: 'Continue' })).toBeInViewport();
    const levelScreenshot = await expectScreen(page, testInfo, `course-onboarding-level-${theme.family}-${theme.mode}-${viewport.name}`);
    await onboarding.getByRole('button', { name: 'Continue' }).click();

    await expect(onboarding.getByRole('heading', { name: 'Read Hangul before your first words' })).toBeVisible();
    await expect(onboarding.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '5 / 8');
    await expect(onboarding.getByRole('region', { name: 'Basic consonants' }).locator('.onb-primer-jamo')).toHaveCount(14);
    await expect(onboarding.getByRole('region', { name: 'Basic vowels' }).locator('.onb-primer-jamo')).toHaveCount(10);
    const primerScreenshot = await expectScreen(page, testInfo, `course-onboarding-script-${theme.family}-${theme.mode}-${viewport.name}`);
    await onboarding.getByRole('button', { name: 'Continue' }).click();

    await expect(onboarding.getByRole('heading', { name: 'How many cards each day?' })).toBeVisible();
    await expect(onboarding.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '6 / 8');
    await expect(onboarding.locator('.onboarding-pace-grid > button')).toHaveCount(4);
    await expect(onboarding.locator('.onb-pace-minutes')).toHaveText(['≈ 4 min a day', '≈ 6 min a day', '≈ 8 min a day', '≈ 9 min a day']);
    await expect(onboarding.locator('.onb-projection')).toHaveText('70cards a week at 10 a day.About 6 min a day at this pace.');
    const paceScreenshot = await expectScreen(page, testInfo, `course-onboarding-daily-pace-${theme.family}-${theme.mode}-${viewport.name}`);

    await onboarding.getByRole('button', { name: 'Try 5 cards' }).click();
    const firstCard = onboarding.getByRole('group', { name: /^안녕하세요 flashcard/ });
    await expect(firstCard).toBeVisible({ timeout: 30_000 });
    await expect(onboarding.getByText('Card 1 of 5', { exact: true })).toBeVisible();
    const trialScreenshot = await expectScreen(page, testInfo, `course-onboarding-trial-${theme.family}-${theme.mode}-${viewport.name}`);
    const grades = onboarding.getByRole('group', { name: 'Did you know this word?' });
    for (const answer of ['Got it', 'Got it', 'Forgot', 'Got it', 'Forgot']) {
      await grades.getByRole('button', { name: answer }).click();
    }
    await expect(onboarding.getByRole('heading', { name: '3 of 5 remembered.' })).toBeVisible();
    const trialDoneScreenshot = await expectScreen(page, testInfo, `course-onboarding-trial-done-${theme.family}-${theme.mode}-${viewport.name}`);

    await onboarding.getByRole('button', { name: 'Set my reminder' }).click();
    await expect(onboarding.getByRole('heading', { name: 'When should we nudge you?' })).toBeVisible();
    await expect(onboarding.getByRole('region', { name: 'Study reminders' }).getByRole('button', { name: 'Save reminders' })).toBeEnabled();
    // The preview counts the five starter cards; this learner chose no exam, so it shows no countdown.
    const preview = onboarding.getByRole('figure', { name: 'Reminder preview' });
    await expect(preview).toContainText('5 cards are ready for review.');
    await expect(preview.locator('.onb-phone-countdown')).toHaveCount(0);
    // The lock-screen preview prints today's date.
    const reminderScreenshot = await expectScreen(page, testInfo, `course-onboarding-reminder-${theme.family}-${theme.mode}-${viewport.name}`, [], ['.onb-phone-date']);

    for (const screen of [levelScreenshot, primerScreenshot, paceScreenshot, trialScreenshot, trialDoneScreenshot, reminderScreenshot]) {
      expect(screen.image).toMatchSnapshot(`${screen.name}.png`);
    }
  });
}

test('mobile onboarding keeps selected options and actions clear through the study setup', async ({ page, signIn, blockExternalNetwork }, testInfo) => {
  test.setTimeout(60_000);
  await prepareTheme(page, themes[0], viewports[1]);
  await blockExternalNetwork(page);
  await signIn(page, '/?view=today&locale=en');
  const onboarding = page.getByRole('dialog', { name: 'Set up your course' });
  await onboarding.getByRole('button', { name: 'Continue' }).click();

  const korean = onboarding.getByRole('button', { name: /Korean/ });
  await korean.click();
  await expect(korean).toHaveAttribute('aria-pressed', 'true');
  const targetScreenshot = await expectScreen(page, testInfo, 'course-onboarding-target-classic-light-mobile');
  await onboarding.getByRole('button', { name: 'Continue' }).click();

  const topik = onboarding.getByRole('button', { name: /^Pass TOPIK/ });
  await topik.click();
  await expect(topik).toHaveAttribute('aria-pressed', 'true');
  await expect(onboarding.getByRole('button', { name: 'Continue' })).toBeInViewport();
  await expect(onboarding.getByRole('button', { name: 'Back' })).toBeInViewport();
  const goalScreenshot = await expectScreen(page, testInfo, 'course-onboarding-goal-classic-light-mobile');
  await onboarding.getByRole('button', { name: 'Continue' }).click();

  await onboarding.getByLabel('Exam date (optional)').scrollIntoViewIfNeeded();
  await expect(onboarding.getByLabel('Exam date (optional)')).toBeInViewport();
  await expect(onboarding.getByRole('button', { name: 'Continue' })).toBeInViewport();
  await expect(onboarding.getByRole('button', { name: 'Back' })).toBeInViewport();
  await onboarding.getByRole('button', { name: 'Continue' }).click();

  await expect(onboarding.getByRole('heading', { name: 'Where are you starting from?' })).toBeVisible();
  await expect(onboarding.getByRole('button', { name: 'Continue' })).toBeInViewport();
  await onboarding.getByRole('button', { name: 'Continue' }).click();
  await expect(onboarding.getByRole('heading', { name: 'Read Hangul before your first words' })).toBeVisible();
  await expect(onboarding.getByRole('button', { name: 'Continue' })).toBeInViewport();
  await onboarding.getByRole('button', { name: 'Continue' }).click();

  const pace = onboarding.locator('.onboarding-pace-grid > button').filter({ hasText: 'Recommended' });
  await expect(pace).toContainText('10');
  await expect(pace).toHaveAttribute('aria-pressed', 'true');
  await expect(onboarding.locator('.onboarding-pace-grid > button')).toHaveCount(4);
  const paceScreenshot = await expectScreen(page, testInfo, 'course-onboarding-pace-classic-light-mobile');
  for (const name of ['Back', 'Try 5 cards']) {
    const button = onboarding.getByRole('button', { name });
    const box = await button.boundingBox();
    expect(box?.width, `${name} spans the mobile content width`).toBeGreaterThan(300);
  }

  await onboarding.getByRole('button', { name: 'Try 5 cards' }).click();
  const firstCard = onboarding.getByRole('group', { name: /^안녕하세요 flashcard/ });
  await expect(firstCard).toBeVisible({ timeout: 30_000 });
  await expect(firstCard.getByText('안녕하세요', { exact: true })).toBeVisible();
  // Korean cards show the romanization under each syllable block.
  await expect(firstCard.locator('[data-reading-romanization]')).toHaveText(['an', 'nyeong', 'ha', 'se', 'yo']);
  const createdCards = onboarding.getByRole('list', { name: 'Your first 5 cards' }).getByRole('listitem');
  await expect(createdCards).toHaveCount(5);
  for (const name of ['Forgot', 'Got it']) {
    const box = await expectBox(onboarding.getByRole('button', { name, exact: true }), `${name} grade`);
    expect(box.height, `${name} meets the 44px touch target`).toBeGreaterThanOrEqual(44);
  }
  const ahaScreenshot = await expectScreen(page, testInfo, 'course-onboarding-aha-success-classic-light-mobile');
  expect(targetScreenshot.image).toMatchSnapshot(`${targetScreenshot.name}.png`);
  expect(goalScreenshot.image).toMatchSnapshot(`${goalScreenshot.name}.png`);
  expect(paceScreenshot.image).toMatchSnapshot(`${paceScreenshot.name}.png`);
  expect(ahaScreenshot.image).toMatchSnapshot(`${ahaScreenshot.name}.png`);
});

test('desktop onboarding presents the four pace choices in one row', async ({ page, signIn, blockExternalNetwork }, testInfo) => {
  await prepareTheme(page, themes[0], viewports[0]);
  await blockExternalNetwork(page);
  await signIn(page, '/?view=today&locale=en');
  const onboarding = page.getByRole('dialog', { name: 'Set up your course' });
  await onboarding.getByRole('button', { name: 'Continue' }).click();
  await onboarding.getByRole('button', { name: /Korean/ }).click();
  await onboarding.getByRole('button', { name: 'Continue' }).click();
  await onboarding.getByRole('button', { name: 'Continue' }).click();
  await expect(onboarding.getByRole('heading', { name: 'Where are you starting from?' })).toBeVisible();
  await onboarding.getByRole('button', { name: 'Continue' }).click();
  await expect(onboarding.getByRole('heading', { name: 'Read Hangul before your first words' })).toBeVisible();
  await onboarding.getByRole('button', { name: 'Continue' }).click();
  const paceCards = onboarding.locator('.onboarding-pace-grid > button');
  await expect(paceCards).toHaveCount(4);
  const firstRow = await Promise.all([0, 1, 2, 3].map(index => paceCards.nth(index).boundingBox()));
  const rowPositions = firstRow.map(box => box?.y ?? Number.NaN);
  expect(Math.max(...rowPositions) - Math.min(...rowPositions)).toBeLessThanOrEqual(1);
  const paceScreenshot = await expectScreen(page, testInfo, 'course-onboarding-pace-classic-light-desktop');
  expect(paceScreenshot.image).toMatchSnapshot(`${paceScreenshot.name}.png`);
});
