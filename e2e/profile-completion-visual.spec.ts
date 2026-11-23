import AxeBuilder from '@axe-core/playwright';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures/firebase-emulator';

test.use({ accountProfile: 'none' });

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

const copy = {
  classic: {
    title: 'Make SonFlash yours.', outcomes: 'Keep the next step visible.',
    restricted: 'We cannot create this account yet.', returned: 'Return location preserved · Vocabulary library',
  },
  crystal: {
    title: 'Make it yours', outcomes: 'Keep the next action clear.',
    restricted: 'Account creation paused', returned: 'Return anchor · Vocabulary library',
  },
} as const;

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

async function expectTarget(locator: Locator, name: string) {
  const box = await locator.boundingBox();
  expect(box, `${name} is rendered`).toBeTruthy();
  expect(box!.width, `${name} is at least 44px wide`).toBeGreaterThanOrEqual(44);
  expect(box!.height, `${name} is at least 44px tall`).toBeGreaterThanOrEqual(44);
}

async function expectAccessibleScreen(page: Page, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${name} has horizontal overflow`).toBe(true);
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  expect(results.violations
    .filter(violation => violation.impact === 'serious' || violation.impact === 'critical')
    .map(violation => ({ id: violation.id, targets: violation.nodes.map(node => node.target) })), `${name} axe violations`).toEqual([]);
}

for (const theme of themes) for (const viewport of viewports) {
  test(`${theme.family} ${theme.mode} profile step and restricted account at ${viewport.name}`, async ({ page, signIn, blockExternalNetwork }) => {
    const text = copy[theme.family];
    await prepareTheme(page, theme, viewport);
    await blockExternalNetwork(page);
    await signIn(page, '/?view=library&locale=en');

    const root = page.locator('html');
    await expect(root).toHaveAttribute('data-theme-family', theme.family);
    if (theme.mode === 'dark') await expect(root).toHaveClass(/\bdark\b/);
    else await expect(root).not.toHaveClass(/\bdark\b/);

    await expect(page.getByRole('heading', { level: 1, name: text.title })).toBeVisible();
    const outcomes = page.getByRole('complementary', { name: text.outcomes });
    if (viewport.name === 'desktop') {
      await expect(page.getByRole('banner').getByText(text.returned)).toBeVisible();
      await expect(outcomes.getByText('Return + outcomes')).toBeVisible();
      await expect(outcomes.getByText(text.returned)).toBeVisible();
      await expect(outcomes.getByText('Vocabulary library', { exact: true })).toBeVisible();
    } else {
      // The phone layout keeps only the card; the footer names the return location.
      await expect(outcomes).toBeHidden();
    }
    await expect(page.getByRole('contentinfo').getByText('Return location · Vocabulary library')).toBeVisible();
    await expectTarget(page.getByLabel('Birth year'), 'birth year field');
    await expectTarget(page.getByLabel('App language'), 'app language field');
    await expectTarget(page.getByLabel('Native language'), 'native language field');
    await expectTarget(page.locator('.profile-gate__check-target'), 'consent checkbox target');
    await expectTarget(page.getByRole('button', { name: 'Save and continue' }), 'save button');
    await expectTarget(page.getByRole('button', { name: 'Sign out' }), 'sign-out button');
    await expect(page.getByText(/Focused desktop|Step 3 of 3/)).toHaveCount(0);
    await expectAccessibleScreen(page, `profile step ${theme.family} ${theme.mode} ${viewport.name}`);
    await expect.soft(page).toHaveScreenshot(`profile-completion-${theme.family}-${theme.mode}-${viewport.name}.png`, {
      fullPage: true, animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01,
    });

    await page.getByLabel('Birth year').fill(String(new Date().getUTCFullYear() - 12));
    await page.getByRole('checkbox', { name: /I am 18 or older/ }).check();
    await page.getByRole('button', { name: 'Save and continue' }).click();
    await expect(page.getByRole('heading', { level: 1, name: text.restricted })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: text.restricted })).toBeFocused();
    await expectTarget(page.getByRole('button', { name: 'Return to sign in' }), 'return to sign-in button');
    await expect(page.getByText(text.returned)).toHaveCount(0);
    await expectAccessibleScreen(page, `restricted ${theme.family} ${theme.mode} ${viewport.name}`);
    await expect.soft(page).toHaveScreenshot(`profile-restricted-${theme.family}-${theme.mode}-${viewport.name}.png`, {
      fullPage: true, animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01,
    });
  });
}
