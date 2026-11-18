import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures/firebase-emulator';

test('appearance choices switch live and follow the system until a manual choice', async ({ page, signIn, seedCourseProfile }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  // Signs in with an empty library; without a course-profile doc the
  // OnboardingJourney overlay can mount asynchronously mid-test (its cloud
  // check settles on its own timer) and intercept a later click — see
  // seedCourseProfile's own doc comment in fixtures/firebase-emulator.ts.
  await seedCourseProfile();
  await signIn(page, '/?view=settings&locale=en');
  await expect(page.getByRole('heading', { name: 'Make your study space yours' })).toBeVisible();
  await page.evaluate(() => Object.defineProperty(window, '__appearanceMarker', { value: 'mounted' }));

  await page.getByRole('radio', { name: /Midnight Aurora/ }).locator('..').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-family', 'classic');
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  await expect(page.locator('[data-theme-preview="classic-dark"]')).toHaveAttribute('data-selected', 'true');
  await page.getByRole('radio', { name: /Ink & Paper/ }).locator('..').click();
  await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
  await expect(page.locator('[data-theme-preview="classic-light"]')).toHaveAttribute('data-selected', 'true');

  await page.getByRole('radio', { name: /Crystal Star/ }).locator('..').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-family', 'crystal');
  await expect(page.locator('[data-theme-preview="crystal-light"]')).toHaveAttribute('data-selected', 'true');
  await page.getByRole('radio', { name: 'Starry Night' }).locator('..').click();
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  await expect(page.locator('[data-theme-preview="crystal-dark"]')).toHaveAttribute('data-selected', 'true');
  await page.getByRole('radio', { name: 'Prism Day' }).locator('..').click();
  await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
  await expect(page.locator('[data-theme-preview="crystal-light"]')).toHaveAttribute('data-selected', 'true');

  await page.getByRole('switch', { name: /Follow system/ }).check();
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
  await page.getByRole('radio', { name: 'Starry Night' }).locator('..').click();
  await expect(page.getByRole('switch', { name: /Follow system/ })).not.toBeChecked();
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  expect(await page.evaluate(() => (window as Window & { __appearanceMarker?: string }).__appearanceMarker)).toBe('mounted');
});

test('appearance previews carry the four Canvas token palettes', async ({ page, signIn, seedCourseProfile }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sonflash_theme_family', 'classic');
    localStorage.setItem('lingoflash_theme', 'dark');
  });
  await seedCourseProfile();
  await signIn(page, '/?view=settings&locale=en');

  await expect(page.locator('[data-theme-preview]')).toHaveCount(4);
  await expect.poll(async () => page.locator('[data-theme-preview]').evaluateAll(elements => Object.fromEntries(
    elements.map(element => [element.getAttribute('data-theme-preview'), getComputedStyle(element).getPropertyValue('--preview-canvas').trim()]),
  ))).toEqual({
    'classic-dark': '#06161f',
    'classic-light': '#f7f2e8',
    'crystal-dark': '#04060c',
    'crystal-light': '#dff1ff',
  });
});

test('Lumi, motion and sound settings persist after reload', async ({ page, signIn, seedCourseProfile }) => {
  // A fresh signed-in test user with no course profile can have the
  // full-screen OnboardingJourney overlay reappear mid-test once its async
  // course-profile check resolves (tracked as a product bug owned by the
  // onboarding lane; see the identical workaround in
  // phase6-touch-targets.spec.ts). Seed a legacy profile so this test's long
  // sequence of settings interactions never races that overlay.
  await seedCourseProfile();
  await signIn(page, '/?view=settings&locale=en');
  await page.getByRole('radio', { name: /Crystal Star/ }).locator('..').click();
  const lumi = page.getByRole('switch', { name: /^Lumi/ });
  await expect(lumi).toBeChecked();
  await expect(page.locator('[data-settings-lumi] [data-lumi-pose]')).toBeVisible();
  await lumi.uncheck();
  await expect(page.locator('html')).toHaveAttribute('data-lumi', 'off');
  await expect(page.locator('[data-settings-lumi] [data-lumi-pose]')).toBeHidden();
  await lumi.check();
  await expect(page.locator('html')).toHaveAttribute('data-lumi', 'on');
  await expect(page.locator('[data-settings-lumi] [data-lumi-pose]')).toBeVisible();
  await lumi.uncheck();
  await page.getByRole('switch', { name: /Reduced motion/ }).check();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await page.getByRole('switch', { name: /Study sounds/ }).uncheck();

  await page.reload();
  await expect(page.getByRole('switch', { name: /^Lumi/ })).not.toBeChecked();
  await expect(page.getByRole('switch', { name: /Reduced motion/ })).toBeChecked();
  await expect(page.getByRole('switch', { name: /Study sounds/ })).not.toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-lumi', 'off');
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
});

test('reminder schedule saves to the signed-in owner and loads after reload', async ({ page, signIn, seedCourseProfile }) => {
  await seedCourseProfile();
  await signIn(page, '/?view=settings&locale=en');
  const reminders = page.getByRole('region', { name: 'Study reminders' });
  await expect(reminders.getByRole('button', { name: 'Save reminders' })).toBeEnabled();
  await reminders.getByLabel('Send at').fill('09:30');
  await reminders.getByLabel('Sun', { exact: true }).uncheck();
  await reminders.getByRole('button', { name: 'Save reminders' }).click();
  await expect(reminders.getByRole('status')).toHaveText('Reminder settings saved.');

  await page.reload();
  await expect(reminders.getByLabel('Send at')).toHaveValue('09:30');
  await expect(reminders.getByLabel('Sun', { exact: true })).not.toBeChecked();
});

test('mobile shell opens settings and keeps the page inside 390px', async ({ page, seedCourseProfile, signIn }) => {
  await seedCourseProfile();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/assets/settings-screen-*.js', async route => {
    await new Promise(resolve => setTimeout(resolve, 900));
    await route.continue();
  });
  await signIn(page, '/?view=library&locale=en');
  await page.getByRole('button', { name: 'Manage library' }).click();
  await expect(page.getByRole('menuitem', { name: 'See Pro plan' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Appearance settings' }).click();
  await expect(page).toHaveURL(/view=settings/);
  await expect(page.getByRole('heading', { name: 'Make your study space yours' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Make your study space yours' })).toBeFocused();
  expect(await page.locator('[data-async-content="settings"]').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});

for (const motion of ['reduced', 'interrupted'] as const) {
  test(`mobile navigation preserves destination focus with ${motion} motion`, async ({ page, seedCourseProfile, signIn }) => {
    await seedCourseProfile();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ reducedMotion: motion === 'reduced' ? 'reduce' : 'no-preference' });
    await page.route('**/assets/settings-screen-*.js', async route => {
      await new Promise(resolve => setTimeout(resolve, 500));
      await route.continue();
    });
    await signIn(page, '/?view=library&locale=en');
    const themeTrigger = page.getByRole('button', { name: 'Choose theme' });
    await themeTrigger.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menuitemradio', { name: 'Midnight Aurora' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(themeTrigger).toBeFocused();
    await page.getByRole('button', { name: 'Manage library' }).click();
    await expect(page.getByRole('menuitem', { name: 'See Pro plan' })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Appearance settings' }).click();
    if (motion === 'interrupted') await page.emulateMedia({ reducedMotion: 'reduce' });
    const heading = page.getByRole('heading', { name: 'Make your study space yours' });
    await expect(heading).toBeFocused();
    await expect(heading).toBeInViewport();
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'system');
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    await expect.poll(() => page.locator('[data-async-content="settings"]').evaluate(element =>
      element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length,
    )).toBe(0);
  });
}

for (const theme of [
  { family: 'classic', mode: 'dark' },
  { family: 'classic', mode: 'light' },
  { family: 'crystal', mode: 'dark' },
  { family: 'crystal', mode: 'light' },
] as const) {
  for (const { width, locale } of ['en', 'vi'].flatMap(locale => [1440, 390].map(width => ({ width, locale })))) {
    test(`${theme.family} ${theme.mode} ${locale} settings fit at ${width}px`, async ({ page, seedCourseProfile, signIn }) => {
      await seedCourseProfile();
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript(({ family, mode }) => {
        localStorage.setItem('sonflash_theme_family', family);
        localStorage.setItem('lingoflash_theme', mode);
      }, theme);
      await signIn(page, `/?view=settings&locale=${locale}`);
      const stage = page.locator('[data-async-content="settings"]');
      await expect(stage.getByRole('heading', { level: 1 })).toBeVisible();
      expect(await stage.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`settings-${theme.family}-${theme.mode}-${locale}-${width}.png`) });
      const lastSwitch = stage.getByRole('switch').last();
      await lastSwitch.focus();
      await expect(lastSwitch).toBeFocused();
      await expect(lastSwitch).toBeInViewport();
      const switchGeometry = await lastSwitch.evaluate(element => {
        const bounds = element.getBoundingClientRect();
        const row = element.closest('label')!.getBoundingClientRect();
        const target = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        return { width: bounds.width, height: bounds.height, rowHeight: row.height, reachable: target === element, appearance: getComputedStyle(element).appearance };
      });
      expect(switchGeometry.rowHeight).toBeGreaterThanOrEqual(44);
      expect(switchGeometry.reachable).toBe(true);
      expect(switchGeometry.appearance).toBe('none');
      if (theme.family === 'classic') {
        expect(switchGeometry.width).toBe(42);
        expect(switchGeometry.height).toBe(24);
      }
      await page.screenshot({ path: test.info().outputPath(`settings-controls-${theme.family}-${theme.mode}-${locale}-${width}.png`) });
      const result = await new AxeBuilder({ page }).withRules(['color-contrast', 'aria-required-attr', 'button-name', 'landmark-one-main']).analyze();
      expect(result.violations.map(violation => violation.id)).toEqual([]);
    });
  }
}
