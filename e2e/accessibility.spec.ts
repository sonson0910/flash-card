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
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your library' })).toBeVisible();
  await expect(page.locator('#library-card-grid')).toHaveAttribute('aria-busy', 'false');

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
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
