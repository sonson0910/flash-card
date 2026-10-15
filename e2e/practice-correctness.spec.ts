import { expect, test } from '@playwright/test';

const cards = ['alpha', 'bravo', 'charlie', 'delta'].map((word, index) => ({
  id: `match-${index}`, word, normalizedWord: word, translation: `nghĩa ${index}`,
  explanation: `Meaning of ${word}`, phonetic: '', emoji: '', category: 'Test',
  audioUrl: null, imageUrl: null, createdAt: '2026-09-01T00:00:00.000Z', difficulty: 'unrated',
}));

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.title.includes('late mismatch')) {
    const now = new Date('2026-09-12T12:00:00Z');
    await page.clock.install({ time: now });
  }
  await page.addInitScript(initial => {
    if (!localStorage.getItem('lingoflash_cards_scoped_v1')) {
      localStorage.setItem('lingoflash_cards', JSON.stringify(initial));
      localStorage.removeItem('lingoflash_cards_owner');
    }
  }, cards);
  await page.goto('/?view=today');
  await page.getByRole('button', { name: 'More practice' }).click();
  await page.getByRole('button', { name: /Word Match \(60s/ }).click();
  await expect(page.getByRole('heading', { name: 'Word Match Speed-Run' })).toBeVisible();
});

test('PracticeScreen awards the advertised XP once and persists it across reload', async ({ page }) => {
  const readXp = () => page.evaluate(() => Number(JSON.parse(localStorage.getItem('lingoflash_gamification:anonymous:snapshot') ?? '{}').snapshot?.xp ?? 0));
  const before = await readXp();
  for (const card of cards) {
    await page.getByRole('button', { name: card.word, exact: true }).click();
    await page.getByRole('button', { name: card.translation, exact: true }).click();
  }
  await expect(page.getByText('+20 XP Speed bonus', { exact: true })).toBeVisible();
  await expect.poll(readXp).toBe(before + 20);
  await page.reload();
  await expect.poll(readXp).toBe(before + 20);
});

test('a late mismatch timeout cannot clear a selection in the next round', async ({ page }) => {
  // Let startup timers run, then begin a fresh round under a paused clock.
  await page.clock.pauseAt(new Date('2026-09-12T12:02:00Z'));
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await page.clock.runFor(59_700);
  await page.getByRole('button', { name: 'alpha', exact: true }).click();
  await page.getByRole('button', { name: 'nghĩa 1', exact: true }).click();
  await page.clock.runFor(300);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  const selected = page.getByRole('button', { name: 'alpha', exact: true });
  await selected.click();
  await expect(selected).toHaveClass(/ring-2/);
  await page.clock.runFor(500);
  await expect(selected).toHaveClass(/ring-2/);
});
