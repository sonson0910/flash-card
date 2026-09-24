import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('appearance choices switch live and follow the system until a manual choice', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto('/?view=settings&locale=en');
  await expect(page.getByRole('heading', { name: 'Make your study space yours' })).toBeVisible();
  await page.evaluate(() => Object.defineProperty(window, '__appearanceMarker', { value: 'mounted' }));

  await page.getByRole('radio', { name: /Midnight Aurora/ }).locator('..').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-family', 'classic');
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  await page.getByRole('radio', { name: /Ink & Paper/ }).locator('..').click();
  await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);

  await page.getByRole('radio', { name: /Crystal Star/ }).locator('..').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme-family', 'crystal');
  await page.getByRole('radio', { name: 'Starry Night' }).locator('..').click();
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
  await page.getByRole('radio', { name: 'Prism Day' }).locator('..').click();
  await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);

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

test('Lumi, motion and sound settings persist after reload', async ({ page }) => {
  await page.goto('/?view=settings&locale=en');
  await page.getByRole('radio', { name: /Crystal Star/ }).locator('..').click();
  await page.getByRole('switch', { name: /^Lumi/ }).uncheck();
  await expect(page.locator('html')).toHaveAttribute('data-lumi', 'off');
  await expect(page.locator('[data-settings-lumi] [data-lumi-pose]')).toBeHidden();
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

test('mobile shell opens settings and keeps the page inside 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/assets/settings-screen-*.js', async route => {
    await new Promise(resolve => setTimeout(resolve, 900));
    await route.continue();
  });
  await page.goto('/?view=library&locale=en');
  await page.getByRole('button', { name: 'Manage library' }).click();
  await page.getByRole('menuitem', { name: 'Appearance settings' }).click();
  await expect(page).toHaveURL(/view=settings/);
  await expect(page.getByRole('heading', { name: 'Make your study space yours' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Make your study space yours' })).toBeFocused();
  expect(await page.locator('[data-async-content="settings"]').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
});

for (const theme of [
  { family: 'classic', mode: 'dark' },
  { family: 'classic', mode: 'light' },
  { family: 'crystal', mode: 'dark' },
  { family: 'crystal', mode: 'light' },
] as const) {
  for (const width of [1440, 390]) {
    test(`${theme.family} ${theme.mode} settings fit at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript(({ family, mode }) => {
        localStorage.setItem('sonflash_theme_family', family);
        localStorage.setItem('lingoflash_theme', mode);
      }, theme);
      await page.goto('/?view=settings&locale=en');
      await expect(page.getByRole('heading', { name: 'Make your study space yours' })).toBeVisible();
      const stage = page.locator('[data-async-content="settings"]');
      expect(await stage.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.screenshot({ path: test.info().outputPath(`settings-${theme.family}-${theme.mode}-${width}.png`) });
      const result = await new AxeBuilder({ page }).withRules(['color-contrast', 'aria-required-attr', 'button-name', 'landmark-one-main']).analyze();
      expect(result.violations.map(violation => violation.id)).toEqual([]);
    });
  }
}
