import { expect, test } from '@playwright/test';

const cards = [
  'serendipity', 'resilient', 'curious', 'flourish', 'meticulous', 'eloquent',
  'adaptable', 'insightful', 'persistent', 'vibrant', 'concise', 'diligent',
].map((word, index) => ({
  id: `shell-${index}`,
  word,
  normalizedWord: word,
  translation: `translation ${index + 1}`,
  explanation: `Explanation for ${word}.`,
  phonetic: '',
  emoji: '',
  category: 'Test deck',
  partOfSpeech: 'noun',
  audioUrl: null,
  imageUrl: null,
  createdAt: (() => {
    const today = new Date();
    today.setHours(10, index, 0, 0);
    return today.toISOString();
  })(),
  bookmarked: true,
  difficulty: 'hard',
  customDeck: 'IELTS',
}));

test.beforeEach(async ({ page }) => {
  await page.addInitScript(initialCards => {
    localStorage.setItem('lingoflash_cards', JSON.stringify(initialCards));
    localStorage.removeItem('lingoflash_cards_owner');
    localStorage.setItem('lingoflash_custom_decks', JSON.stringify(['IELTS']));
    localStorage.setItem('lingoflash_theme', 'dark');
  }, cards);
});

test('tablet shell keeps every visible header control in bounds and nav targets at least 44px tall', async ({ page }) => {
  for (const width of [768, 800, 920, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.locator('nav')).toHaveAttribute('data-motion-state', 'ready');

    const controls = page.locator('nav button:visible');
    for (let index = 0; index < await controls.count(); index += 1) {
      const box = await controls.nth(index).boundingBox();
      expect(box, `header control ${index} should have a box at ${width}px`).not.toBeNull();
      expect(box!.x, `header control ${index} should start on-screen at ${width}px`).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, `header control ${index} should end on-screen at ${width}px`).toBeLessThanOrEqual(width);
      expect(box!.height, `header control ${index} should be touch-sized at ${width}px`).toBeGreaterThanOrEqual(44);
    }
  }
});

test('desktop utility controls align with the card-count pill', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('nav')).toHaveAttribute('data-motion-state', 'ready');

  const controls = [
    page.getByRole('button', { name: 'Use light theme' }),
    page.getByRole('button', { name: 'Export library to Excel' }),
    page.getByRole('button', { name: 'Clear the entire library' }),
    page.getByText('12 CARDS', { exact: true }).locator('..'),
  ];
  const boxes = await Promise.all(controls.map(control => control.boundingBox()));
  boxes.forEach(box => expect(box).not.toBeNull());
  const top = boxes[0]!.y;
  boxes.forEach(box => {
    expect(Math.abs(box!.y - top)).toBeLessThanOrEqual(1);
    expect(Math.abs(box!.height - 44)).toBeLessThanOrEqual(0.25);
  });
});

test('starring a card preserves the current library page', async ({ page }) => {
  await page.goto('/?page=2');
  await expect(page.getByText('Page 2 / 2')).toBeVisible();

  await page.getByRole('button', { name: 'Remove star' }).first().click();

  await expect(page.getByText('Page 2 / 2')).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get('page')).toBe('2');
});

test('practice dialog fits and scrolls in short portrait and landscape viewports', async ({ page }) => {
  for (const viewport of [{ width: 320, height: 480 }, { width: 667, height: 320 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    const opener = page.locator('button:visible').filter({ hasText: 'Practice' }).first();
    await opener.click();

    const dialog = page.getByRole('dialog', { name: 'Choose a practice mode' });
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(15);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height - 15);
    await expect(dialog).toHaveCSS('overflow-y', 'auto');
    await dialog.getByRole('button', { name: /Context story/ }).scrollIntoViewIfNeeded();
    await expect(dialog.getByRole('button', { name: /Context story/ })).toBeInViewport();
    await page.keyboard.press('Escape');
    await expect(opener).toBeFocused();
  }
});

test('controlled dialogs restore focus to their stable openers', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  const practice = page.locator('nav button:visible').filter({ hasText: 'Practice' }).first();
  await practice.click();
  await page.getByRole('button', { name: 'Close practice menu' }).click();
  await expect(practice).toBeFocused();

  const insights = page.locator('nav button:visible').filter({ hasText: 'Insights' }).first();
  await insights.click();
  await page.getByRole('button', { name: 'Close learning insights' }).click();
  await expect(insights).toBeFocused();

  const clear = page.getByRole('button', { name: 'Clear the entire library' });
  await clear.click();
  await page.getByRole('button', { name: 'Keep library' }).click();
  await expect(clear).toBeFocused();
});

test('library query state deep-links and responds to browser history without dropping unrelated params', async ({ page }) => {
  await page.goto('/?utm_source=audit&category=Test%20deck&deck=IELTS&difficulty=hard&pos=noun&starred=1&date=Today&page=2');

  await expect(page.getByRole('heading', { name: 'Test deck' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Filter by part of speech' })).toHaveValue('noun');
  await expect(page.getByRole('combobox', { name: 'Filter by memory status' })).toHaveValue('hard');
  await expect(page.getByRole('combobox', { name: 'Filter cards by date created' })).toHaveValue('Today');
  await expect(page.getByRole('switch', { name: 'Show starred cards only' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('Page 2 / 2')).toBeVisible();

  const search = page.locator('input[placeholder="Search English words…"]:visible').first();
  await search.fill('serendipity');
  await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBe('serendipity');
  expect(new URL(page.url()).searchParams.get('utm_source')).toBe('audit');

  await page.goBack();
  await expect(search).toHaveValue('');
  await expect(page.getByText('Page 2 / 2')).toBeVisible();
});

test('mobile library presents the card grid before tools and the filter shortcut reaches tools', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  const tools = page.locator('#library-tools');
  const grid = page.locator('#library-card-grid');
  expect(await grid.evaluate(element => Boolean(
    element.compareDocumentPosition(document.querySelector('#library-tools')!) & Node.DOCUMENT_POSITION_FOLLOWING,
  ))).toBe(true);

  const toolsBox = await tools.boundingBox();
  const gridBox = await grid.boundingBox();
  expect(gridBox!.y).toBeLessThan(toolsBox!.y);

  await page.getByRole('button', { name: 'Open library filters' }).click();
  await expect(tools).toBeInViewport();
});

test('study shortcuts require modifiers for single-character commands and views expose a focused heading', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await page.locator('button:visible').filter({ hasText: 'Study' }).first().click();
  const studyHeading = page.getByRole('heading', { level: 1, name: 'Study session' });
  await expect(studyHeading).toBeFocused();

  await page.keyboard.press('Space');
  await expect(page.getByText('How well did you remember this card?')).toBeVisible();
  await page.keyboard.press('1');
  await expect(page.getByText('How well did you remember this card?')).toBeVisible();
  await page.keyboard.press('Alt+1');
  await expect(page.getByText('Review saved. Move to the next card.')).toBeVisible();

  await page.getByRole('button', { name: 'Close study mode' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Vocabulary library' })).toBeFocused();

  await page.locator('button:visible').filter({ hasText: 'Practice' }).first().click();
  await page.getByRole('button', { name: /Multiple-choice quiz/ }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Vocabulary quiz' })).toBeFocused();
  await expect(page.locator('button[aria-current="page"]:visible').filter({ hasText: 'Practice' })).toBeVisible();
});
