import { expect, test } from './fixtures/firebase-emulator';
import type { Page, TestInfo } from '@playwright/test';
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

async function expectScreen(page: Page, testInfo: TestInfo, name: string) {
  await expect(page.locator('html')).toHaveAttribute('data-theme-family', /classic|crystal/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${name} has horizontal overflow`).toBe(true);
  const screenshot = testInfo.outputPath(`${name}.png`);
  const image = await page.screenshot({ path: screenshot, fullPage: true, animations: 'disabled', caret: 'hide' });
  await testInfo.attach(name, { path: screenshot, contentType: 'image/png' });
  return { image, name };
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

for (const theme of themes) for (const viewport of viewports) {
  test(`${theme.family} ${theme.mode} courses, goals, settings and onboarding capture at ${viewport.name}`, async ({ page, db, testUser, signIn, blockExternalNetwork }, testInfo) => {
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
    await expectScreen(page, testInfo, `course-onboarding-${theme.family}-${theme.mode}-${viewport.name}`);

    await seedCourses(db, testUser.uid);
    await page.reload();

    const switcher = page.locator('.claude-course-switcher-trigger:visible');
    await expect(switcher).toContainText('Korean');
    await switcher.click();
    const courses = page.getByRole('dialog', { name: 'Courses' });
    await expect(courses).toBeVisible();
    await expect(courses.getByRole('button', { name: /Korean.*Vietnamese/ })).toHaveAttribute('aria-current', 'true');
    await expectScreen(page, testInfo, `course-switcher-${theme.family}-${theme.mode}-${viewport.name}`);
    await courses.getByRole('button', { name: 'Add a language' }).click();
    const targetCards = courses.locator('.course-target-card');
    await expect(targetCards).toHaveCount(2);
    await expect(targetCards.filter({ hasText: 'Japanese' })).toHaveAttribute('aria-pressed', 'true');
    await expect(targetCards.filter({ hasText: 'Chinese' })).toHaveAttribute('aria-pressed', 'false');
    const createScreenshot = await expectScreen(page, testInfo, `course-switcher-create-${theme.family}-${theme.mode}-${viewport.name}`);
    await courses.getByRole('button', { name: 'Cancel' }).click();

    await courses.getByRole('listitem').filter({ hasText: 'Korean ← Vietnamese' }).getByRole('button', { name: 'Manage goals' }).click();
    const goals = courses.locator('.claude-course-goals-panel');
    await expect(goals.getByText('TOPIK', { exact: true })).toBeVisible();
    await expect(goals.getByText('TOPIK II', { exact: true })).toBeVisible();
    await expectScreen(page, testInfo, `course-goals-${theme.family}-${theme.mode}-${viewport.name}`);

    await page.goto('/?view=settings&locale=en');
    const settings = page.getByRole('heading', { name: 'Course and learning' }).locator('xpath=ancestor::section');
    await expect(settings).toBeVisible();
    await expect(settings.getByText('Meaning language')).toBeVisible();
    await expect(settings.getByText('Daily pace')).toBeVisible();
    await expect(settings.getByRole('switch')).toBeChecked();
    const appearance = page.getByRole('heading', { name: 'Appearance' }).locator('xpath=ancestor::section');
    const coursePosition = await settings.boundingBox();
    const appearancePosition = await appearance.boundingBox();
    expect(coursePosition && appearancePosition && coursePosition.y < appearancePosition.y).toBeTruthy();
    await expectScreen(page, testInfo, `course-settings-${theme.family}-${theme.mode}-${viewport.name}`);
    expect(createScreenshot.image).toMatchSnapshot(`${createScreenshot.name}.png`);
  });
}

test('mobile onboarding keeps selected options and actions clear through the study setup', async ({ page, signIn, blockExternalNetwork }, testInfo) => {
  await prepareTheme(page, themes[0], viewports[1]);
  await blockExternalNetwork(page);
  await signIn(page, '/?view=today&locale=en');
  const onboarding = page.getByRole('dialog', { name: 'Set up your course' });
  await onboarding.getByRole('button', { name: 'Continue' }).click();

  const korean = onboarding.getByRole('button', { name: /Korean/ });
  await korean.click();
  await expect(korean).toHaveAttribute('aria-pressed', 'true');
  await expectScreen(page, testInfo, 'course-onboarding-target-classic-light-mobile');
  await onboarding.getByRole('button', { name: 'Continue' }).click();

  const topik = onboarding.getByRole('button', { name: /^TOPIK Target level/ });
  await topik.click();
  await expect(topik).toHaveAttribute('aria-pressed', 'true');
  await expectScreen(page, testInfo, 'course-onboarding-goal-classic-light-mobile');
  await onboarding.getByRole('button', { name: 'Continue' }).click();

  const pace = onboarding.getByRole('button', { name: /10 cards \/ day/ });
  await expect(pace).toHaveAttribute('aria-pressed', 'true');
  await expect(onboarding.locator('.onboarding-pace-grid > button')).toHaveCount(4);
  const paceScreenshot = await expectScreen(page, testInfo, 'course-onboarding-pace-classic-light-mobile');
  for (const name of ['Back', 'Continue']) {
    const button = onboarding.getByRole('button', { name });
    const box = await button.boundingBox();
    expect(box?.width, `${name} spans the mobile content width`).toBeGreaterThan(300);
  }

  await onboarding.getByRole('button', { name: 'Continue' }).click();
  await onboarding.getByRole('button', { name: 'Add 5 starter cards' }).click();
  const createdCards = onboarding.locator('.onboarding-created-starter-cards');
  await expect(createdCards).toHaveCount(1);
  await expect(createdCards.getByText('안녕하세요', { exact: true })).toBeVisible();
  await expect(createdCards.getByText('annyeonghaseyo', { exact: true })).toBeVisible();
  await expect(createdCards.getByText('hello', { exact: true })).toBeVisible();
  const ahaScreenshot = await expectScreen(page, testInfo, 'course-onboarding-aha-success-classic-light-mobile');
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
  const paceCards = onboarding.locator('.onboarding-pace-grid > button');
  await expect(paceCards).toHaveCount(4);
  const firstRow = await Promise.all([0, 1, 2, 3].map(index => paceCards.nth(index).boundingBox()));
  const rowPositions = firstRow.map(box => box?.y ?? Number.NaN);
  expect(Math.max(...rowPositions) - Math.min(...rowPositions)).toBeLessThanOrEqual(1);
  const paceScreenshot = await expectScreen(page, testInfo, 'course-onboarding-pace-classic-light-desktop');
  expect(paceScreenshot.image).toMatchSnapshot(`${paceScreenshot.name}.png`);
});
