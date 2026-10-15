import { expect, test } from './fixtures/firebase-emulator';

const card = {
  id: 'word-lead', word: 'lead', normalizedWord: 'lead', translation: 'chì',
  explanation: 'A metal.', explanationTranslation: 'Một kim loại.', phonetic: '/liːd/',
  emoji: '📚', category: 'Reading', audioUrl: null, imageUrl: null,
  origin: 'ai', createdAt: '2026-09-24T00:00:00.000Z', bookmarked: false,
  difficulty: 'unrated', customDeck: null, reviews: 0,
  schemaVersion: 2, revision: 1,
};

test('an AI card can be edited, bookmarked and reviewed from the local queue', async ({ page, db, testUser, seedCards, signIn }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedCards([card]);
  await signIn(page, '/?view=library');
  // LibraryCardGrid renders each card as a row with its own icon buttons; the
  // flip-card Flashcard view (role="group" "{word} flashcard", the "Reveal the
  // Vietnamese meaning" flip button, and the translation heading) only mounts
  // once the row's "Open card" trigger opens the detail dialog.
  const row = page.locator('[data-library-card-row][data-library-card-id="word-lead"]');
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
  await page.getByRole('button', { name: 'Edit card' }).click();
  const studyDialog = page.getByRole('dialog', { name: 'Edit card' });
  await studyDialog.getByRole('textbox', { name: 'Translation', exact: true }).fill('dẫn đường');
  await studyDialog.getByRole('button', { name: 'Save & resume' }).click();
  await expect(studyDialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'dẫn đường' })).toBeVisible();
  await expect(page.locator('[data-study-rating]')).toBeVisible();
  await page.getByRole('button', { name: /Good/i }).last().click();
  await expect.poll(async () => Number((await db.doc(`users/${testUser.uid}/cards/${card.id}`).get()).get('reviews') ?? 0)).toBe(1);
  await expect(page.locator('[data-session-recap]')).toBeVisible();
});

test('mobile Library card actions and edit sheet stay usable', async ({ page, db, testUser, seedCards, signIn }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    localStorage.setItem('sonflash_theme_family', 'crystal');
    localStorage.setItem('lingoflash_theme', 'light');
    localStorage.setItem('sonflash_theme_follow_system', 'false');
  });
  await seedCards([{ ...card, nextReviewDate: '2026-01-01T00:00:00.000Z' }]);
  await signIn(page, '/?view=library');

  const row = page.locator('[data-library-card-row][data-library-card-id="word-lead"]');
  await expect(page.locator('html')).toHaveAttribute('data-theme-family', 'crystal');
  await expect(row.locator('.library-word-grade')).toBeVisible();
  await expect(row.locator('.library-word-due')).toBeVisible();
  const assertMobileActions = async () => {
    const { cardBox, targets, indicators } = await row.evaluate(element => {
      const boxes = (selector: string) => Array.from(element.querySelectorAll(selector), node => {
        const { x, y, width, height } = node.getBoundingClientRect();
        return { x, y, width, height };
      });
      const { x, y, width, height } = element.getBoundingClientRect();
      return {
        cardBox: { x, y, width, height },
        targets: boxes('.library-word-controls button, .library-word-select'),
        indicators: boxes('.library-word-grade, .library-word-due'),
      };
    });
    expect(targets).toHaveLength(4);
    expect(indicators).toHaveLength(2);
    for (const [index, target] of targets.entries()) {
      expect(target.width, `action ${index} width`).toBeGreaterThanOrEqual(44);
      expect(target.height, `action ${index} height`).toBeGreaterThanOrEqual(44);
      expect(target.x).toBeGreaterThanOrEqual(0);
      expect(target.x + target.width).toBeLessThanOrEqual(390);
      expect(target.x).toBeGreaterThanOrEqual(cardBox.x - 1);
      expect(target.y).toBeGreaterThanOrEqual(cardBox.y - 1);
      expect(target.x + target.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1);
      expect(target.y + target.height).toBeLessThanOrEqual(cardBox.y + cardBox.height + 1);
      for (const other of [...targets.slice(index + 1), ...indicators]) {
        expect(target.x + target.width <= other.x || other.x + other.width <= target.x || target.y + target.height <= other.y || other.y + other.height <= target.y).toBe(true);
      }
    }
  };
  await assertMobileActions();
  await page.getByRole('button', { name: 'List view' }).click();
  await expect(page.locator('[data-library-view]')).toHaveAttribute('data-library-view', 'list');
  await assertMobileActions();
  const bookmark = row.getByRole('button', { name: 'Bookmark card' });
  await bookmark.click();
  await expect(bookmark).toHaveAttribute('aria-pressed', 'true');
  await expect(row.locator('.library-word-star')).toBeHidden();
  await row.getByRole('button', { name: 'Edit card' }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit card' });
  await expect(dialog).toBeVisible();
  const bounds = await dialog.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: rect.right, viewport: window.innerWidth };
  });
  expect(bounds.left).toBeGreaterThanOrEqual(-1);
  expect(bounds.right).toBeLessThanOrEqual(bounds.viewport + 1);
  await testInfo.attach('mobile Library edit sheet', { body: await page.screenshot(), contentType: 'image/png' });

  await dialog.getByRole('textbox', { name: 'Translation', exact: true }).fill('dẫn đầu');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await db.doc(`users/${testUser.uid}/cards/${card.id}`).get()).get('translation')).toBe('dẫn đầu');
});
