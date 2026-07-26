import { expect, test } from '@playwright/test';

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
    localStorage.setItem('lingoflash_cards', JSON.stringify(cards));
    localStorage.removeItem('lingoflash_cards_owner');
  }, anonymousCards);
});

test('anonymous library loads and unlocks practice from the known library size', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Your library' })).toBeVisible();
  await expect(page.getByText('serendipity', { exact: true }).first()).toBeVisible();

  const practiceButton = page.locator('button:visible').filter({ hasText: 'Practice' }).first();
  await expect(practiceButton).toBeEnabled();
  await practiceButton.click();
  await expect(page.getByRole('heading', { name: 'Choose a practice mode' })).toBeVisible();
});

test('anonymous library retains every card across local pages', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByText('serendipity', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Page 1 / 2')).toBeVisible();
  await expect.poll(() => page.evaluate(() => {
    const cards = JSON.parse(localStorage.getItem('lingoflash_cards') ?? '[]') as unknown[];
    return cards.length;
  })).toBe(12);

  await page.getByRole('button', { name: 'Next library page' }).click();
  await expect(page.getByText('Page 2 / 2')).toBeVisible();
  await expect(page.getByText('vibrant', { exact: true }).first()).toBeVisible();
});

test('mobile DOM and visual order prioritise the card grid before secondary tools', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

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
