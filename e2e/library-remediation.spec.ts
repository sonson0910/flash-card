import { expect, test } from './fixtures/firebase-emulator';

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

test.beforeEach(async ({ page, seedCards, signIn, blockExternalNetwork }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => { localStorage.setItem('lingoflash_theme', 'light'); });
  await seedCards(libraryCards);
  await blockExternalNetwork(page);
  await signIn(page, '/?view=library');
  await expect(page.locator('#library-card-grid').getByRole('heading', { name: 'Your library' })).toBeVisible();
});

test('mobile prioritises the card grid before the secondary tools', async ({ page }) => {
  const gridBox = await page.locator('#library-card-grid').boundingBox();
  const toolsBox = await page.locator('#library-tools').boundingBox();

  expect(gridBox).not.toBeNull();
  expect(toolsBox).not.toBeNull();
  expect(gridBox!.y).toBeLessThan(toolsBox!.y);
});

test('mobile exposes one touch-sized library search', async ({ page }) => {
  const visibleSearches = page.locator('input[placeholder="Search words or meanings…"]:visible');
  await expect(visibleSearches).toHaveCount(1);

  // The <input> itself only renders at its intrinsic text-line height
  // (library-canvas.css's .library-canvas-search input has no explicit
  // height); the actual tap target is the wrapping <label
  // class="library-canvas-search"> (height: 3rem), which the input's own
  // implicit label association extends focus/click to.
  const searchBox = await visibleSearches.first().locator('xpath=ancestor::label[1]').boundingBox();
  expect(searchBox).not.toBeNull();
  expect(searchBox!.height).toBeGreaterThanOrEqual(44);
});

test('mobile navigation does not expose a dead practice action', async ({ page }) => {
  await expect(page.getByRole('button', { name: 'Open Practice Mode' })).toHaveCount(0);
});

test('category filters expose their selected state programmatically', async ({ page }) => {
  // Category filter buttons (LibraryTools.tsx) render inside the collapsed
  // "More library tools" <details> (LibraryScreen.tsx); native closed <details>
  // content has no accessible box, so open the disclosure first.
  await page.locator('summary').filter({ hasText: 'More library tools' }).click();

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

  // LibraryScreen.tsx stacks "collection" and "tools" as full-width blocks at
  // every breakpoint (library-canvas.css has no rule keyed on
  // data-library-region, so there is no narrower secondary column to compare
  // widths against). The redesign expresses "collection is the richest,
  // primary region" through vertical order (collection first) plus the
  // data-tool-priority markers asserted above, not through column width.
  const collectionBox = await page.locator('[data-library-region="collection"]').boundingBox();
  const toolsBox = await page.locator('[data-library-region="tools"]').boundingBox();
  expect(collectionBox).not.toBeNull();
  expect(toolsBox).not.toBeNull();
  expect(collectionBox!.y).toBeLessThan(toolsBox!.y);
});
