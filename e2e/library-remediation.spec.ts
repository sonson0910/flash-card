import { expect, test } from '@playwright/test';

const libraryCards = Array.from({ length: 12 }, (_, index) => ({
  id: `library-remediation-${index}`,
  word: `word-${index}`,
  normalizedWord: `word-${index}`,
  translation: `translation ${index}`,
  explanation: `Explanation ${index}`,
  phonetic: '',
  emoji: '📚',
  category: index % 2 === 0 ? 'Travel' : 'IELTS',
  audioUrl: null,
  imageUrl: null,
  createdAt: new Date(2026, 6, 15, 10, index).toISOString(),
  bookmarked: false,
  difficulty: 'unrated',
  customDeck: null,
}));

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(cards => {
    localStorage.setItem('lingoflash_cards', JSON.stringify(cards));
    localStorage.removeItem('lingoflash_cards_owner');
    localStorage.setItem('lingoflash_theme', 'light');
  }, libraryCards);
  await page.goto('/?view=library');
  await expect(page.getByRole('heading', { name: 'Your library' })).toBeVisible();
});

test('mobile prioritises the card grid before the secondary tools', async ({ page }) => {
  const gridBox = await page.locator('#library-card-grid').boundingBox();
  const toolsBox = await page.locator('#library-tools').boundingBox();

  expect(gridBox).not.toBeNull();
  expect(toolsBox).not.toBeNull();
  expect(gridBox!.y).toBeLessThan(toolsBox!.y);
});

test('mobile brings the first vocabulary card into the opening viewport', async ({ page }) => {
  await expect(page.getByRole('heading', { name: 'Make every word unforgettable.' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Start a review|Review \d+ due/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create card' })).toBeVisible();
  await expect(page.locator('[data-library-evidence] dd')).toHaveCount(4);
  const actionHeights = await page.locator('[data-library-region="overview"] button').evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().height));
  expect(actionHeights.every(height => height >= 44)).toBe(true);

  const introCard = page.locator('[data-library-intro-index]').first();
  const introBox = await introCard.boundingBox();
  expect(introBox).not.toBeNull();
  expect(introBox!.y).toBeLessThan(844);
});

test('mobile exposes one touch-sized library search', async ({ page }) => {
  const visibleSearches = page.locator('input[placeholder="Search English words…"]:visible');
  await expect(visibleSearches).toHaveCount(1);

  const searchBox = await visibleSearches.first().boundingBox();
  expect(searchBox).not.toBeNull();
  expect(searchBox!.height).toBeGreaterThanOrEqual(44);
});

test('mobile navigation does not expose a dead practice action', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Open Practice Mode' })).toHaveCount(0);
});

test('category filters expose their selected state programmatically', async ({ page }) => {
  const travelFilter = page.getByRole('button', { name: /^Travel/ });
  await travelFilter.scrollIntoViewIfNeeded();
  await travelFilter.click();
  await expect(travelFilter).toHaveAttribute('aria-pressed', 'true');
});

test('desktop gives the card collection the richest region and keeps tools secondary', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?view=library');

  await expect(page.locator('[data-library-region="collection"]')).toBeVisible();
  await expect(page.locator('[data-library-region="tools"]')).toBeVisible();
  await expect(page.locator('[data-library-tool="create"]')).toHaveAttribute('data-tool-priority', 'primary');
  await expect(page.locator('[data-library-tool="filters"]')).toHaveAttribute('data-tool-priority', 'secondary');

  const collectionBox = await page.locator('[data-library-region="collection"]').boundingBox();
  const toolsBox = await page.locator('[data-library-region="tools"]').boundingBox();
  expect(collectionBox).not.toBeNull();
  expect(toolsBox).not.toBeNull();
  expect(collectionBox!.width).toBeGreaterThan(toolsBox!.width);
});
