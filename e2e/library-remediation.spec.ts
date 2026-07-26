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
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your library' })).toBeVisible();
});

test('mobile prioritises the card grid before the secondary tools', async ({ page }) => {
  const gridBox = await page.locator('#library-card-grid').boundingBox();
  const toolsBox = await page.locator('#library-tools').boundingBox();

  expect(gridBox).not.toBeNull();
  expect(toolsBox).not.toBeNull();
  expect(gridBox!.y).toBeLessThan(toolsBox!.y);
});

test('mobile exposes one touch-sized library search', async ({ page }) => {
  const visibleSearches = page.locator('input[placeholder="Search English words…"]:visible');
  await expect(visibleSearches).toHaveCount(1);

  const searchBox = await visibleSearches.first().boundingBox();
  expect(searchBox).not.toBeNull();
  expect(searchBox!.height).toBeGreaterThanOrEqual(44);
});

test('category filters expose their selected state programmatically', async ({ page }) => {
  const travelFilter = page.getByRole('button', { name: /^Travel/ });
  await travelFilter.scrollIntoViewIfNeeded();
  await travelFilter.click();
  await expect(travelFilter).toHaveAttribute('aria-pressed', 'true');
});
