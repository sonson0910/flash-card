import { expect, test } from './fixtures/firebase-emulator';

const cardWithBrokenRuntimeImage = {
  id: 'runtime-image-failure',
  word: 'resilient',
  normalizedWord: 'resilient',
  translation: 'kiên cường',
  explanation: 'Able to recover quickly from difficulty.',
  phonetic: '',
  emoji: '🌱',
  category: 'General',
  audioUrl: null,
  imageUrl: 'https://images.pexels.com/photos/123/runtime-missing.jpg',
  createdAt: '2026-08-01T03:00:00.000Z',
  nextReviewDate: '2026-08-01T03:00:00.000Z',
  difficulty: 'hard',
};

test('a runtime image error moves Image to Word study to a usable text cue', async ({ page, seedCards, signIn }) => {
  await page.route('https://images.pexels.com/**', route => route.abort('failed'));
  await seedCards([cardWithBrokenRuntimeImage]);
  await signIn(page, '/?view=library');

  await page.getByRole('button', { name: /Start review|Review \d+ due/ }).click();
  const recallMode = page.getByLabel('Recall mode');
  await recallMode.selectOption('image-to-word');

  await expect(recallMode).toHaveValue('native-to-target');
  await expect(recallMode.locator('option[value="image-to-word"]')).toHaveAttribute('disabled', '');
  await expect(page.getByText('Recall the English word')).toBeVisible();
  await expect(page.getByText('Name what you see')).toHaveCount(0);
});
