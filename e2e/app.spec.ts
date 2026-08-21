import { expect, test } from '@playwright/test';
import { readCardCacheState } from './card-cache';

const anonymousCards = [
  'serendipity', 'resilient', 'curious', 'flourish', 'meticulous', 'eloquent',
  'adaptable', 'insightful', 'persistent', 'vibrant', 'concise', 'diligent',
].map((word, index) => ({
  id: `anonymous-${index}`,
  word,
  normalizedWord: word,
  translation: `translation ${index + 1}`,
  explanation: `Explanation for ${word}.`,
  phonetic: '',
  emoji: '📚',
  category: 'Test deck',
  audioUrl: null,
  imageUrl: null,
  createdAt: new Date(2026, 6, 15, 10, index).toISOString(),
  bookmarked: false,
  difficulty: 'unrated',
  customDeck: null,
}));

test.beforeEach(async ({ page }) => {
  await page.addInitScript(cards => {
    if (window.top !== window) return;
    localStorage.setItem('lingoflash_cards', JSON.stringify(cards));
    localStorage.removeItem('lingoflash_cards_owner');
  }, anonymousCards);
});

test('anonymous library loads and Today unlocks a bounded daily lesson', async ({ page }) => {
  await page.goto('/?view=library');

  await expect(page.getByRole('heading', { name: 'Your library' })).toBeVisible();
  await expect(page.getByText('serendipity', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Today', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Your daily plan' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Recognition/ })).toBeEnabled();
});

test('anonymous library retains every card across local pages', async ({ page }) => {
  await page.goto('/?view=library');

  await expect(page.getByText('serendipity', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Page 1 / 2')).toBeVisible();
  await expect.poll(async () => {
    const cache = await readCardCacheState<unknown>(page);
    return {
      version: cache.scoped?.version,
      ownerId: cache.scoped?.ownerId,
      cardCount: cache.scoped?.cards.length,
      legacy: cache.legacy,
    };
  }).toEqual({ version: 1, ownerId: null, cardCount: 12, legacy: null });

  await page.getByRole('button', { name: 'Next library page' }).click();
  await expect(page.getByText('Page 2 / 2')).toBeVisible();
  await expect(page.locator('#library-card-grid')).toHaveAttribute('aria-busy', 'false');
  const vibrantCard = page.locator('[data-library-intro-index]').filter({ hasText: 'vibrant' });
  await expect(vibrantCard).toHaveCSS('visibility', 'visible');
  await expect.poll(async () => Number(await vibrantCard.evaluate(element => getComputedStyle(element).opacity)))
    .toBeGreaterThanOrEqual(0.99);
  await expect(vibrantCard.getByText('vibrant', { exact: true }).first()).toBeVisible();
});

test('mobile DOM and visual order prioritise the card grid before secondary tools', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?view=library');

  const tools = page.locator('#library-tools');
  const grid = page.locator('#library-card-grid');
  await expect(tools).toBeVisible();
  await expect(grid).toBeVisible();

  const gridComesFirst = await grid.evaluate(element => {
    const libraryTools = document.querySelector('#library-tools');
    return libraryTools !== null && Boolean(
      element.compareDocumentPosition(libraryTools) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
  const toolsBox = await tools.boundingBox();
  const gridBox = await grid.boundingBox();

  expect(gridComesFirst).toBe(true);
  expect(toolsBox).not.toBeNull();
  expect(gridBox).not.toBeNull();
  expect(gridBox!.y).toBeLessThan(toolsBox!.y);
});

test('release static endpoints return machine-readable content', async ({ request }) => {
  const health = await request.get('/health.json');
  const robots = await request.get('/robots.txt');

  expect(health.ok()).toBe(true);
  expect(health.headers()['content-type']).toContain('application/json');
  expect(robots.ok()).toBe(true);
  await expect(robots.text()).resolves.toContain('User-agent: *');
});

test('empty Progress opens without downloading the chart bundle', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  const scripts: string[] = [];
  page.on('request', request => {
    if (request.resourceType() === 'script') scripts.push(request.url());
  });

  await page.goto('/?view=progress');

  await expect(page.getByRole('heading', { name: 'Learning progress' })).toBeVisible();
  await expect(page.getByText('Complete a review to begin your progress history.')).toBeVisible();
  expect(scripts.some(url => url.includes('StatsCharts'))).toBe(false);
});
