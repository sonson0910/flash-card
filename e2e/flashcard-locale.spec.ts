import { expect, test } from './fixtures/firebase-emulator';

const card = {
  id: 'flashcard-locale',
  word: 'りんご',
  normalizedWord: 'りんご',
  translation: 'quả táo',
  explanation: 'A fruit.',
  phonetic: '/ringo/',
  emoji: '🍎',
  category: 'Food',
  language: 'ja',
  translationLanguage: 'vi',
  audioUrl: null,
  imageUrl: null,
  createdAt: '2026-09-24T00:00:00.000Z',
  bookmarked: false,
  difficulty: 'unrated',
  customDeck: null,
};

for (const locale of [
  { query: 'en', document: 'en', tier: 'New' },
  { query: 'vi', document: 'vi', tier: 'Mới' },
  { query: 'pseudo', document: 'en-XA', tier: /\[New/ },
] as const) {
  test(`card languages and tier label render with ${locale.query} UI locale`, async ({ page, seedCards, signIn }) => {
    await seedCards([card]);
    await signIn(page, `/?view=library&locale=${locale.query}`);

    const shell = page.locator('.flashcard-shell');
    await expect(page.locator('html')).toHaveAttribute('lang', locale.document);
    await expect(shell.locator('[data-card-headword]')).not.toHaveAttribute('lang', 'ja');
    await expect(shell.locator('[data-card-headword] h2')).toHaveAttribute('lang', 'ja');
    await expect(shell.locator('[data-card-headword] h2')).toHaveText('りんご');
    await expect(shell.locator('[data-card-tier-label]')).toHaveText(locale.tier);

    await shell.locator('[data-reveal-meaning]').click();
    await expect(shell.locator('[data-translation-reveal]')).toHaveAttribute('lang', 'vi');
    await expect(shell.locator('[data-translation-reveal]')).toHaveText('quả táo');
  });
}

test('changing the UI locale updates a mounted card while content languages stay fixed', async ({ page, seedCards, signIn }) => {
  await seedCards([card]);
  await signIn(page, '/?view=library');

  const shell = page.locator('.flashcard-shell');
  await expect(shell.locator('[data-card-tier-label]')).toHaveText('New');
  await page.getByRole('button', { name: 'Choose language' }).click();
  await page.getByRole('menuitemradio', { name: 'Tiếng Việt' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
  await expect(shell.locator('[data-card-tier-label]')).toHaveText('Mới');
  await expect(shell.locator('[data-card-headword] h2')).toHaveAttribute('lang', 'ja');
  await expect(shell.locator('[data-card-headword] h2')).toHaveText('りんご');
});
