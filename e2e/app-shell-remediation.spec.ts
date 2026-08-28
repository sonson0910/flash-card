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

test('library exposes one canonical heading and a keyboard-operable skip link', async ({ page, browserName }) => {
  await page.goto('/?view=library');

  const skipLink = page.getByRole('link', { name: 'Skip to content' });
  const main = page.locator('main#learning-workspace');
  await expect(page.locator('nav.app-navigation')).toBeVisible();
  const activeTag = await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    return document.activeElement?.tagName;
  });
  expect(activeTag).toBe('BODY');
  await page.keyboard.press(browserName === 'webkit' ? 'Alt+Tab' : 'Tab');

  await expect(skipLink).toBeFocused();
  await expect(skipLink).toBeVisible();
  await expect(skipLink).toHaveAttribute('href', '#learning-workspace');
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByRole('heading', { level: 1, name: 'Vocabulary library' })).toBeAttached();
  await expect(page.getByRole('heading', { level: 2, name: 'Make every word unforgettable.' })).toBeVisible();
  await expect(main).toHaveAttribute('tabindex', '-1');

  await page.keyboard.press('Enter');
  await expect(main).toBeFocused();
});

test('shell settles when WebKit animation signals and the timer fallback both stall', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(Animation.prototype, 'finished', {
      configurable: true,
      get: () => new Promise<Animation>(() => undefined),
    });
    const nativeAddEventListener = Animation.prototype.addEventListener;
    Animation.prototype.addEventListener = function (
      this: Animation,
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (type === 'finish' || type === 'cancel') return;
      if (!listener) return;
      return nativeAddEventListener.call(this, type, listener, options);
    };
    const nativeSetTimeout = window.setTimeout.bind(window);
    window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      if (timeout === 1_000) return 0;
      return nativeSetTimeout(handler, timeout, ...args);
    }) as typeof window.setTimeout;
  });

  await page.goto('/?view=library');

  await expect(page.locator('nav.app-navigation')).toHaveAttribute('data-motion-state', 'ready');
});

test('tablet shell keeps every visible header control in bounds and nav targets at least 44px tall', async ({ page }) => {
  for (const width of [768, 800, 920, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await expect(page.locator('nav.app-navigation')).toHaveAttribute('data-motion-state', 'ready');

    const controls = page.locator('nav.app-navigation button:visible');
    for (let index = 0; index < await controls.count(); index += 1) {
      await expect.poll(async () => {
        const box = await controls.nth(index).boundingBox();
        return Boolean(box
          && box.x >= 0
          && box.x + box.width <= width
          && box.height >= 44);
      }, {
        message: `header control ${index} should settle on-screen at no less than 44px tall at ${width}px`,
      }).toBe(true);
    }
  }
});

test('mobile library settings menu stays in bounds and restores trigger focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?view=library');

  const manage = page.getByRole('button', { name: 'Manage library' });
  await manage.click();
  const menu = page.getByRole('menu', { name: 'Library management' });
  const menuBox = await menu.boundingBox();
  expect(menuBox).not.toBeNull();
  expect(menuBox!.x).toBeGreaterThanOrEqual(0);
  expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(390);

  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(manage).toBeFocused();
});

test('starring a card preserves the current library page', async ({ page }) => {
  await page.goto('/?view=library&page=2');
  await expect(page.getByText('Page 2 / 2')).toBeVisible();

  await page.getByRole('button', { name: 'Remove star' }).first().click();

  await expect(page.getByText('Page 2 / 2')).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get('page')).toBe('2');
});

test('Today practice choices reflow in short portrait and landscape viewports', async ({ page }) => {
  for (const viewport of [{ width: 320, height: 480 }, { width: 667, height: 320 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    const choices = page.locator('[data-practice-mode="true"]');
    await expect(choices).toHaveCount(3);
    for (let index = 0; index < 3; index += 1) {
      const box = await choices.nth(index).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeLessThanOrEqual(viewport.width - 32);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await expect(page.getByRole('button', { name: 'Spelling' })).toBeHidden();
    await page.getByText('More lesson modes').click();
    await expect(page.getByRole('button', { name: 'Spelling' })).toBeVisible();
  }
});

test('the destructive library dialog restores focus to its stable opener', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?view=library');

  const manage = page.getByRole('button', { name: 'Manage library' });
  await manage.click();
  const clear = page.getByRole('menuitem', { name: 'Clear the entire library' });
  await clear.click();
  await page.getByRole('button', { name: 'Keep library' }).click();
  await expect(manage).toBeFocused();
});

test('Today and Progress empty states expose concrete next actions without initial autofocus', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lingoflash_cards', '[]');
    localStorage.removeItem('lingoflash_cards_owner');
  });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => document.activeElement === document.body)).toBe(true);
  await expect(page.getByRole('button', { name: 'Add vocabulary' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Explore learning paths' })).toBeVisible();

  await page.getByRole('button', { name: 'Progress' }).last().click();
  await expect(page.getByRole('heading', { name: 'Learning progress' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Add vocabulary' })).toBeVisible();
});

test('library query state deep-links and responds to browser history without dropping unrelated params', async ({ page }) => {
  await page.goto('/?view=library&utm_source=audit&category=Test%20deck&deck=IELTS&difficulty=hard&pos=noun&starred=1&date=Today&page=2');

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
  await page.goto('/?view=library');

  const tools = page.locator('#library-tools');
  const grid = page.locator('#library-card-grid');
  await expect(tools).toBeAttached();
  await expect(grid).toBeAttached();
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
  await page.goto('/?view=library');

  await page.getByRole('button', { name: /Start a review|Review \d+ due/ }).click();
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

});
