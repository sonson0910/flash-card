import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const guestCards = ['accessible', 'inclusive'].map((word, index) => ({
  id: `axe-${index}`,
  word,
  normalizedWord: word,
  translation: index === 0 ? 'có thể tiếp cận' : 'bao quát',
  explanation: `Guest-library accessibility fixture for ${word}.`,
  phonetic: '',
  emoji: '📘',
  category: 'Accessibility',
  audioUrl: null,
  imageUrl: null,
  createdAt: `2026-07-26T00:0${index}:00.000Z`,
  bookmarked: false,
  difficulty: 'unrated',
  customDeck: null,
}));

const zenCard = {
  ...guestCards[0],
  id: 'axe-zen-cefr',
  word: 'focus',
  normalizedWord: 'focus',
  translation: 'tập trung',
  explanation: 'A Zen accessibility fixture with a truthful CEFR level.',
  difficulty: 'hard',
  cefrLevel: 'A2',
};

test.skip(({ browserName }) => browserName !== 'chromium', 'The deterministic axe gate runs on Chromium.');

test('guest library has no serious or critical automated WCAG violations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(cards => {
    localStorage.setItem('lingoflash_cards', JSON.stringify(cards));
    localStorage.removeItem('lingoflash_cards_owner');
  }, guestCards);
  await page.goto('/?view=library');
  await expect(page.getByRole('heading', { name: 'Your library' })).toBeVisible();
  await expect(page.locator('#library-card-grid')).toHaveAttribute('aria-busy', 'false');

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const blocking = results.violations
    .filter(violation => violation.impact === 'serious' || violation.impact === 'critical')
    .map(violation => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      nodes: violation.nodes.map(node => ({
        target: node.target,
        failureSummary: node.failureSummary,
      })),
    }));

  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
});

test('Zen card CEFR stays truthful and readable in light and dark themes', async ({ page }) => {
  await page.addInitScript(card => {
    localStorage.setItem('lingoflash_cards', JSON.stringify([card]));
    localStorage.removeItem('lingoflash_cards_owner');
    localStorage.setItem('lingoflash_theme', 'light');
    localStorage.setItem('sonflash_zen_glass_mode', 'true');
  }, zenCard);
  await page.goto('/?view=library');

  const card = page.locator('.zen-glass-slab').first();
  await expect(card).toBeVisible();
  await expect(card).toContainText('CEFR A2');
  await expect(card).not.toContainText('B2 UPPER-INT');

  const lightResults = await new AxeBuilder({ page }).include('.zen-glass-slab').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(lightResults.violations.filter(violation => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);

  await card.scrollIntoViewIfNeeded();
  await card.getByRole('button', { name: 'Reveal meaning' }).click();
  await expect(page.locator('[data-card-side="back"]')).toHaveCount(1);
  const lightBackResults = await new AxeBuilder({ page }).include('.zen-glass-slab').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(lightBackResults.violations.filter(violation => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);

  await card.getByRole('button', { name: 'Return to English' }).click();
  await expect(page.locator('[data-card-side="front"]')).toHaveCount(1);

  await page.getByRole('button', { name: 'Use dark theme' }).click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await expect(card).toContainText('CEFR A2');
  await expect(card).not.toContainText('B2 UPPER-INT');

  const darkFrontResults = await new AxeBuilder({ page }).include('.zen-glass-slab').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(darkFrontResults.violations.filter(violation => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);

  await card.scrollIntoViewIfNeeded();
  await card.getByRole('button', { name: 'Reveal meaning' }).click();
  await expect(page.locator('[data-card-side="back"]')).toHaveCount(1);
  const darkBackResults = await new AxeBuilder({ page }).include('.zen-glass-slab').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(darkBackResults.violations.filter(violation => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);
  await expect(card).toContainText('CEFR A2');
  await expect(card).not.toContainText('B2 UPPER-INT');
});

test('library supports 320px reflow, 200% text and visible keyboard focus', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.addInitScript(cards => {
    localStorage.setItem('lingoflash_cards', JSON.stringify(cards));
    localStorage.removeItem('lingoflash_cards_owner');
  }, guestCards);
  await page.goto('/?view=library');
  await page.locator('html').evaluate(element => { element.style.fontSize = '200%'; });
  await expect(page.getByRole('heading', { name: 'Your library' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  await page.keyboard.press('Tab');
  const focus = await page.evaluate(() => {
    const element = document.activeElement;
    if (!(element instanceof HTMLElement)) return null;
    const bounds = element.getBoundingClientRect();
    return { visible: element.matches(':focus-visible'), width: bounds.width, height: bounds.height };
  });
  expect(focus).not.toBeNull();
  expect(focus?.visible).toBe(true);
  expect(focus?.width ?? 0).toBeGreaterThanOrEqual(24);
  expect(focus?.height ?? 0).toBeGreaterThanOrEqual(24);

  const manage = page.getByRole('button', { name: 'Manage library' });
  await manage.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Export library to Excel' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitem', { name: 'Clear the entire library' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(manage).toBeFocused();
});

test('landing presents one trustworthy, accessible product story', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?view=landing');

  const main = page.getByRole('main');
  await expect(main).toHaveCount(1);
  await expect(main.locator('#features')).toBeVisible();
  await expect(main.locator('#methods')).toBeVisible();
  await expect(main.getByRole('button', { name: 'Start learning' }).first()).toBeInViewport();

  const mobileMenu = page.locator('summary[aria-label="Open navigation menu"]');
  await mobileMenu.click();
  const mobileNavigation = page.getByRole('navigation', { name: 'Mobile navigation' });
  await expect(mobileNavigation.getByRole('link', { name: 'AI Features' })).toBeVisible();
  await expect(mobileNavigation.getByRole('link', { name: 'FSRS Method' })).toBeVisible();
  await expect(mobileNavigation.getByRole('button', { name: 'Curriculum' })).toBeVisible();
  await expect(mobileNavigation.getByRole('button', { name: 'Vocabulary Library' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(mobileMenu).toBeFocused();
  await expect(page.locator('details').filter({ has: mobileMenu })).not.toHaveAttribute('open', '');

  const copy = await page.locator('body').innerText();
  expect(copy).not.toMatch(/60,000|70%|forever|permanent|Start Now|Start Learning Free/i);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  const headingLevels = await page.locator('h1, h2, h3, h4, h5, h6').evaluateAll(headings =>
    headings.map(heading => Number(heading.tagName.slice(1))),
  );
  headingLevels.slice(1).forEach((level, index) => {
    expect(level - headingLevels[index]).toBeLessThanOrEqual(1);
  });

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  expect(results.violations.filter(violation => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([]);

  await page.setViewportSize({ width: 1024, height: 900 });
  const desktopTargets = page.getByRole('navigation', { name: 'Landing navigation' }).locator('a, button');
  const targetHeights = await desktopTargets.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height));
  expect(targetHeights.every(height => height >= 44)).toBe(true);
});
