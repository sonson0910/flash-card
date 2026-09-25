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

test('guest library has no serious or critical automated WCAG violations', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(cards => {
    localStorage.setItem('lingoflash_cards', JSON.stringify(cards));
    localStorage.removeItem('lingoflash_cards_owner');
  }, guestCards);
  await page.goto('/?view=library&locale=en');
  await expect(page.locator('#library-card-grid').getByRole('heading', { name: 'Your library' })).toBeVisible();
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

test('library supports 320px reflow, 200% text and visible keyboard focus', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.addInitScript(cards => {
    localStorage.setItem('lingoflash_cards', JSON.stringify(cards));
    localStorage.removeItem('lingoflash_cards_owner');
  }, guestCards);
  await page.goto('/?view=library&locale=en');
  await page.locator('html').evaluate(element => { element.style.fontSize = '200%'; });
  await expect(page.locator('#library-card-grid').getByRole('heading', { name: 'Your library' })).toBeVisible();
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
  await expect(page.getByRole('menu', { name: 'Library management' })).toBeVisible();
  const identityActions = await page.getByRole('menuitem', { name: 'Sign in & sync', exact: true }).count()
    ? ['Sign in & sync'] : [];
  const menuNames = [
    ...identityActions,
    'Privacy',
    'Terms',
    'Extension privacy',
    'Account data',
    'Appearance settings',
    /Card style:/,
    'Export library to Excel',
    'Clear the entire library',
  ];
  for (const [index, name] of menuNames.entries()) {
    if (index > 0) await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitem', { name, exact: typeof name === 'string' })).toBeFocused();
  }
  await page.keyboard.press('Escape');
  await expect(manage).toBeFocused();
});

test('landing presents one trustworthy, accessible product story', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?view=landing');

  const main = page.getByRole('main');
  await expect(main).toHaveCount(1);
  await expect(main.locator('#how-it-works')).toBeVisible();
  await expect(main.locator('#methods-heading')).toBeVisible();
  await expect(main.locator('#pricing')).toBeVisible();
  await expect(main.getByRole('button', { name: 'Start learning' }).first()).toBeInViewport();

  const mobileMenu = page.locator('summary[aria-label="Open navigation menu"]');
  await mobileMenu.click();
  const mobileNavigation = page.getByRole('navigation', { name: 'Mobile navigation' });
  await expect(mobileNavigation.getByRole('link', { name: 'How it works' })).toBeVisible();
  await expect(mobileNavigation.getByRole('link', { name: 'Pricing & access' })).toHaveAttribute('href', '#pricing');
  await expect(mobileNavigation.getByRole('button', { name: 'Curriculum' })).toBeVisible();
  await expect(mobileNavigation.getByRole('button', { name: 'Vocabulary' })).toBeVisible();
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
