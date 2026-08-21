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

test('landing has no automated WCAG violations at any impact on desktop and mobile', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });

  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 375, height: 812 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto('/?view=landing');
    await expect(page.getByRole('heading', { name: /Master Vocabulary/ })).toBeVisible();

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const violations = results.violations
      .map(violation => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        nodes: violation.nodes.map(node => ({
          target: node.target,
          failureSummary: node.failureSummary,
        })),
      }));

    expect(violations, `${viewport.width}px axe violations: ${JSON.stringify(violations, null, 2)}`).toEqual([]);
  }
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
