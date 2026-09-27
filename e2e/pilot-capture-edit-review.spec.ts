import { expect, test } from './fixtures/firebase-emulator';

const card = {
  id: 'pilot-edit-card', word: 'lead', normalizedWord: 'lead', translation: 'chì',
  explanation: 'A metal.', explanationTranslation: 'Một kim loại.', phonetic: '/liːd/',
  emoji: '📚', category: 'Reading', audioUrl: null, imageUrl: null,
  origin: 'ai', createdAt: '2026-09-24T00:00:00.000Z', bookmarked: false,
  difficulty: 'unrated', customDeck: null, reviews: 0,
};

test('an AI card can be edited, bookmarked and reviewed from the local queue', async ({ page, seedCards, signIn }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedCards([card]);
  await signIn(page, '/?view=library');
  // LibraryCardGrid renders each card as a row with its own icon buttons; the
  // flip-card Flashcard view (role="group" "{word} flashcard", the "Reveal the
  // Vietnamese meaning" flip button, and the translation heading) only mounts
  // once the row's "Open card" trigger opens the detail dialog.
  const row = page.locator('[data-library-card-row][data-library-card-id="pilot-edit-card"]');
  await row.getByRole('button', { name: 'Edit card' }).click();
  // Default UI locale is English (EditCardDialog.tsx's `library.edit-card.*`
  // catalog ids), not Vietnamese: the dialog title is "Edit card", the
  // translation field label is "Translation", and the save button reads
  // "Save changes". Typed values (the actual Vietnamese translation text)
  // are unaffected and still asserted below.
  const dialog = page.getByRole('dialog', { name: 'Edit card' });
  await expect(dialog).toBeVisible();
  // EditCardDialog.tsx also renders "Definition translation" and "Example
  // translation" fields, both of which contain "Translation" as a substring;
  // exact match is required to target the word-translation field only.
  await dialog.getByRole('textbox', { name: 'Translation', exact: true }).fill('dẫn đầu');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toHaveCount(0);
  await row.getByRole('button', { name: 'Bookmark card' }).click();
  await expect(row.locator('[aria-label="Starred"]')).toBeVisible();

  await row.getByRole('button', { name: 'Open card' }).click();
  const flashcard = page.getByRole('group', { name: /lead flashcard/i });
  await flashcard.getByRole('button', { name: /Reveal the Vietnamese meaning/ }).click();
  await expect(flashcard.getByRole('heading', { name: 'dẫn đầu' })).toBeVisible();
  await expect(flashcard.locator('[data-ai-disclosure]')).toBeVisible();
  await page.getByRole('button', { name: 'Close' }).click();

  // LibraryCardGrid.tsx's collection actions render a single "Study now"
  // button (library.grid.study-now); see study-runtime-image.spec.ts.
  await page.getByRole('button', { name: 'Study now' }).click();
  await page.getByRole('button', { name: 'Reveal answer' }).click();
  await expect(page.locator('[data-study-rating]')).toBeVisible();
  await page.getByRole('button', { name: /Good/i }).last().click();
  await expect(page.locator('[data-study-progress]')).toBeVisible();
});
