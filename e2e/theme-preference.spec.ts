import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures/firebase-emulator';

const themes = [
  { family: 'classic', mode: 'dark' },
  { family: 'classic', mode: 'light' },
  { family: 'crystal', mode: 'dark' },
  { family: 'crystal', mode: 'light' },
] as const;

test('saved theme is selected before the application script and survives reload', async ({ page }) => {
  await page.goto('/?view=landing');
  await page.evaluate(() => {
    localStorage.setItem('sonflash_theme_family', 'crystal');
    localStorage.setItem('lingoflash_theme', 'light');
  });
  await page.route('**/assets/*.js', async route => {
    await new Promise(resolve => setTimeout(resolve, 800));
    await route.continue();
  });

  await page.reload({ waitUntil: 'commit' });
  await page.waitForFunction(() => (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type === 'reload');
  await expect(page.locator('html')).toHaveAttribute('data-theme-family', 'crystal');
  await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
  await page.screenshot({ path: test.info().outputPath('theme-first-frame.png') });
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme-family', 'crystal');
  await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
});

test('system color preference applies only without a saved mode', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/?view=landing');
  await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);

  await page.evaluate(() => localStorage.setItem('lingoflash_theme', 'dark'));
  await page.reload();
  await expect(page.locator('html')).toHaveClass(/\bdark\b/);
});

test('a fresh runtime follows system light without saving a choice', async ({ page, signIn }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await signIn(page, '/?view=today');
  await expect(page.locator('[data-app-view-stage]')).toBeVisible();
  await page.waitForTimeout(250);
  await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
  expect(await page.evaluate(() => localStorage.getItem('lingoflash_theme'))).toBeNull();
});

test('crystal colors are present before application JavaScript loads', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('sonflash_theme_family', 'crystal');
    localStorage.setItem('lingoflash_theme', 'dark');
  });
  await page.route('**/assets/*.js', async route => {
    await new Promise(resolve => setTimeout(resolve, 1500));
    await route.continue();
  });
  await page.goto('/?view=landing', { waitUntil: 'commit' });
  await page.waitForFunction(() => document.documentElement.dataset.themeFamily === 'crystal');
  await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--sf-canvas').trim() !== '');
  expect(await page.locator('html').evaluate(element => getComputedStyle(element).getPropertyValue('--sf-canvas').trim())).toBe('#04060c');
  await expect(page.locator('link#sonflash-crystal-theme')).toHaveAttribute('href', '/theme-crystal.css');
});

test('classic startup does not request the Crystal theme stylesheet', async ({ page }) => {
  const crystalRequests: string[] = [];
  page.on('request', request => {
    if (request.url().includes('/theme-crystal.css')) crystalRequests.push(request.url());
  });
  await page.addInitScript(() => {
    localStorage.setItem('sonflash_theme_family', 'classic');
    localStorage.setItem('lingoflash_theme', 'dark');
  });
  await page.goto('/?view=landing');
  await expect(page.getByRole('main')).toBeVisible();
  expect(crystalRequests).toEqual([]);
  await expect(page.locator('link#sonflash-crystal-theme')).toHaveCount(0);
});

test('shared glass surfaces retain a computed shadow in every theme', async ({ page }) => {
  await page.goto('/?view=landing');
  for (const { family, mode } of themes) {
    await page.evaluate(({ family, mode }) => {
      localStorage.setItem('sonflash_theme_family', family);
      localStorage.setItem('lingoflash_theme', mode);
    }, { family, mode });
    await page.reload();
    const shadow = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.className = 'liquid-glass';
      document.body.append(probe);
      const value = getComputedStyle(probe).boxShadow;
      probe.remove();
      return value;
    });
    expect(shadow, `${family}/${mode}`).not.toBe('none');
  }
});

test('theme changes reach another tab without a document reload', async ({ context, page }) => {
  const other = await context.newPage();
  await Promise.all([page.goto('/?view=landing'), other.goto('/?view=landing')]);
  await other.evaluate(() => Object.defineProperty(window, '__themeMarker', { value: 'still-mounted' }));
  await page.evaluate(() => {
    localStorage.setItem('sonflash_theme_family', 'crystal');
    localStorage.setItem('lingoflash_theme', 'light');
  });
  await expect(other.locator('html')).toHaveAttribute('data-theme-family', 'crystal');
  await expect(other.locator('html')).not.toHaveClass(/\bdark\b/);
  await expect.poll(() => other.locator('html').evaluate(element => getComputedStyle(element).getPropertyValue('--sf-canvas').trim())).toBe('#dff1ff');
  expect(await other.evaluate(() => (window as Window & { __themeMarker?: string }).__themeMarker)).toBe('still-mounted');
  await other.close();
});

for (const theme of themes) {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    test(`${theme.family} ${theme.mode} renders at ${viewport.width}px with readable text`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.addInitScript(({ family, mode }) => {
        localStorage.setItem('sonflash_theme_family', family);
        localStorage.setItem('lingoflash_theme', mode);
      }, theme);
      await page.goto('/?view=landing');
      await expect(page.locator('html')).toHaveAttribute('data-theme-family', theme.family);
      if (theme.mode === 'dark') await expect(page.locator('html')).toHaveClass(/\bdark\b/);
      else await expect(page.locator('html')).not.toHaveClass(/\bdark\b/);
      await expect(page.getByRole('main')).toBeVisible();
      await page.screenshot({ path: test.info().outputPath(`${theme.family}-${theme.mode}-${viewport.width}.png`) });

      const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
      expect(results.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) }))).toEqual([]);
    });
  }
}

for (const mode of ['dark', 'light'] as const) {
  test(`crystal ${mode} runtime controls have readable text`, async ({ page, signIn }) => {
    await page.addInitScript(savedMode => {
      localStorage.setItem('sonflash_theme_family', 'crystal');
      localStorage.setItem('lingoflash_theme', savedMode);
    }, mode);
    await signIn(page, '/?view=today');
    await expect(page.locator('[data-app-view-stage]')).toBeVisible();
    const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
    expect(results.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) }))).toEqual([]);
  });
}
