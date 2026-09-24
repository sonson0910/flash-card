import { expect, test } from '@playwright/test';

const card = {
  id: 'flashcard-effects',
  word: 'luminous',
  normalizedWord: 'luminous',
  translation: 'phát sáng',
  explanation: 'Giving off light.',
  explanationTranslation: 'Tỏa ra ánh sáng.',
  phonetic: '/ˈluːmɪnəs/',
  emoji: '✨',
  category: 'Science',
  partOfSpeech: 'adjective',
  audioUrl: 'https://ssl.gstatic.com/dictionary/static/sounds/20200429/luminous--_us_1.mp3',
  imageUrl: 'https://images.pexels.com/photos/123/luminous.jpg',
  createdAt: '2026-09-24T00:00:00.000Z',
  bookmarked: false,
  difficulty: 'unrated',
  origin: 'ai',
  customDeck: null,
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(storedCard => {
    localStorage.setItem('lingoflash_cards_scoped_v1', JSON.stringify({
      version: 1,
      ownerId: null,
      cards: [storedCard],
    }));
    localStorage.setItem('lingoflash_cards', JSON.stringify([storedCard]));
    localStorage.removeItem('lingoflash_cards_owner');
    localStorage.setItem('lingoflash_theme', 'light');
    HTMLMediaElement.prototype.play = () => Promise.resolve();
    HTMLMediaElement.prototype.pause = () => undefined;
  }, card);
});

test('card effects retain their observable desktop states', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/?view=library');

  const shell = page.getByRole('group', { name: /luminous flashcard/i });
  const face = shell.locator('.flashcard-face');
  const aura = shell.locator(':scope > div[aria-hidden="true"]').first();
  await shell.scrollIntoViewIfNeeded();
  const box = await shell.boundingBox();
  if (!box) throw new Error('Flashcard shell is not measurable');

  await expect(shell).toHaveAttribute('data-flip-animation', 'spatial');
  await expect(aura).toHaveCSS('opacity', '0');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.2);

  await expect.poll(() => face.evaluate(element => getComputedStyle(element).transform)).not.toBe('none');
  await expect.poll(() => shell.evaluate(element => [...element.querySelectorAll('div')]
    .find(node => node.style.getPropertyValue('--spotlight-x'))?.style.getPropertyValue('--spotlight-x') ?? ''))
    .not.toBe('');
  await expect(aura).toHaveCSS('opacity', '0.35');

  await shell.getByRole('button', { name: 'Star this word' }).click();
  await expect(shell.locator('.flashcard-star-selected')).toBeVisible();

  await shell.getByRole('button', { name: 'Hide image and definition' }).click();
  const blindHint = () => shell.evaluate(element => [...element.querySelectorAll('[aria-hidden="true"]')]
    .map(node => ({ ariaHidden: node.getAttribute('aria-hidden'), filter: getComputedStyle(node).filter }))
    .find(state => state.filter.includes('blur')) ?? null);
  await expect.poll(blindHint).toMatchObject({ ariaHidden: 'true', filter: expect.stringMatching(/blur/) });

  await shell.getByRole('button', { name: 'Play pronunciation' }).click();
  const waves = shell.locator('.wave-bar-1');
  await expect(waves).toBeVisible();
  await expect(waves).toHaveCSS('animation-name', 'audio-wave-bounce');

  await shell.getByRole('button', { name: /Reveal the Vietnamese meaning of luminous/ }).click();
  await expect(shell).toHaveAttribute('data-card-side', 'back');
  await expect(shell.locator('.flashcard-back')).toBeVisible();
});

test('reduced motion keeps card effects static while retaining accessible states', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?view=library');

  const shell = page.getByRole('group', { name: /luminous flashcard/i });
  const face = shell.locator('.flashcard-face');
  await shell.scrollIntoViewIfNeeded();
  const box = await shell.boundingBox();
  if (!box) throw new Error('Flashcard shell is not measurable');

  await expect(shell).toHaveAttribute('data-flip-animation', 'reduced');
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.2);
  await expect(face).toHaveCSS('transform', 'none');
  await expect(await shell.locator('div').evaluateAll(elements => elements.some(element =>
    Boolean(element.style.getPropertyValue('--spotlight-x')) || Boolean(element.style.getPropertyValue('--spotlight-y')),
  ))).toBe(false);

  await shell.getByRole('button', { name: /Reveal the Vietnamese meaning of luminous/ }).click();
  await expect(shell).toHaveAttribute('data-card-side', 'back');
  await expect(shell.locator('.flashcard-back')).toHaveCSS('transform', 'none');
});
