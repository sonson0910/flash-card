import { expect, test } from '@playwright/test';

const cards = Array.from({ length: 12 }, (_, index) => ({
  id: `atelier-${index}`,
  word: `memory-${index}`,
  normalizedWord: `memory-${index}`,
  translation: `meaning ${index + 1}`,
  explanation: `A memorable explanation for word ${index + 1}.`,
  phonetic: '',
  emoji: '✦',
  category: 'Memory atelier',
  partOfSpeech: 'noun',
  audioUrl: null,
  imageUrl: null,
  createdAt: new Date(2026, 7, 27, 10, index).toISOString(),
  bookmarked: true,
  difficulty: 'hard',
  customDeck: null,
}));

test.beforeEach(async ({ page }) => {
  await page.addInitScript(initialCards => {
    localStorage.setItem('lingoflash_cards', JSON.stringify(initialCards));
    localStorage.removeItem('lingoflash_cards_owner');
    localStorage.setItem('lingoflash_theme', 'dark');
  }, cards);
  await page.setViewportSize({ width: 1440, height: 1000 });
});

test('Today has a visibly editorial learning-journal hierarchy', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Today', exact: true }).first().click();

  const pageHeading = page.getByRole('heading', { name: 'Today', exact: true });
  const focus = page.locator('[data-today-focus="primary"] > div');

  await expect(pageHeading).toBeVisible();
  await expect.poll(async () => Number.parseFloat(await pageHeading.evaluate(node => getComputedStyle(node).fontSize)))
    .toBeGreaterThanOrEqual(72);
  await expect(focus).toHaveCSS('border-left-width', '4px');
});

test('Progress carries the same oversized journal hierarchy', async ({ page }) => {
  await page.goto('/?view=progress');

  const pageHeading = page.getByRole('heading', { name: 'Learning progress' });
  const narrative = page.locator('[data-progress-narrative="true"]');

  await expect(pageHeading).toBeVisible();
  await expect.poll(async () => Number.parseFloat(await pageHeading.evaluate(node => getComputedStyle(node).fontSize)))
    .toBeGreaterThanOrEqual(64);
  await expect(narrative).toHaveCSS('border-left-width', '4px');
});

test('Vocabulary reads as an editorial collection instead of a stock card grid', async ({ page }) => {
  await page.goto('/?view=library');

  const heroHeading = page.getByRole('heading', { name: 'Make every word unforgettable.' });
  const collectionHeading = page.getByRole('heading', { name: 'Your library' });
  const hero = page.locator('[data-library-hero="true"]');

  await expect(heroHeading).toBeVisible();
  await expect.poll(async () => Number.parseFloat(await heroHeading.evaluate(node => getComputedStyle(node).fontSize)))
    .toBeGreaterThanOrEqual(72);
  await expect.poll(async () => Number.parseFloat(await collectionHeading.evaluate(node => getComputedStyle(node).fontSize)))
    .toBeGreaterThanOrEqual(44);
  await expect(hero).toHaveCSS('border-left-width', '4px');
});

test('Paths presents the personal roadmap as a deliberate editorial spread', async ({ page }) => {
  await page.goto('/?view=catalog');

  const pageHeading = page.getByRole('heading', { name: 'Language paths' });
  const personalHeading = page.getByRole('heading', { name: 'Your personal paths' });
  const personalPath = page.locator('[data-catalog-personal="true"]');

  await expect(pageHeading).toBeVisible();
  await expect.poll(async () => Number.parseFloat(await pageHeading.evaluate(node => getComputedStyle(node).fontSize)))
    .toBeGreaterThanOrEqual(88);
  await expect.poll(async () => Number.parseFloat(await personalHeading.evaluate(node => getComputedStyle(node).fontSize)))
    .toBeGreaterThanOrEqual(44);
  await expect(personalPath).toHaveCSS('border-left-width', '4px');
});
