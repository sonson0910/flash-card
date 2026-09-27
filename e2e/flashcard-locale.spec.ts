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
  test(`card languages and tier label render with ${locale.query} UI locale`, async ({ page, seedCards, seedCourseProfile, signIn }) => {
    // The card's content language is 'ja', but Library/Today/practice queries
    // are scoped to the active course's target language (default 'en' when
    // no course profile exists — see useAppLibraryRuntime's `targetLanguage`).
    // Without this, the 'ja' card is filtered out of every query, so
    // knownLibraryTotal stays 0 and OnboardingGate's overlay also intercepts
    // the page. Seeding an active 'ja' course fixes both at once.
    await seedCourseProfile({ targetLanguage: 'ja' });
    await seedCards([card]);
    await signIn(page, `/?view=library&locale=${locale.query}`);
    // The flashcard renders inside the "Open card" detail dialog
    // (LibraryCardGrid.tsx's Dialog.Root/detailCard state), not inline in
    // the library grid. Matched by class, not the localized button name,
    // since this loop covers three different UI locales.
    await page.locator('.library-word-open').click();

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

test('changing the UI locale updates a mounted card while content languages stay fixed', async ({ page, context, seedCards, seedCourseProfile, signIn }) => {
  // See the loop above: the 'ja' card needs an active 'ja' course or the
  // default 'en' library scope filters it out entirely.
  await seedCourseProfile({ targetLanguage: 'ja' });
  await seedCards([card]);
  await signIn(page, '/?view=library');
  // Open the card detail dialog first: Radix's Dialog.Root renders it modal
  // (LibraryCardGrid.tsx), which aria-hides and traps focus on everything
  // outside — including the shell's own "Choose language" trigger. Changing
  // the UI locale with that card still mounted therefore has to come from
  // outside this page, exactly like a second signed-in tab would: write the
  // same locale-storage key another tab writes (I18nProvider.tsx's `storage`
  // listener; see i18n-foundation.spec.ts's cross-tab test) from a second,
  // same-origin page so this page's own `storage` event fires.
  await page.locator('.library-word-open').click();

  const shell = page.locator('.flashcard-shell');
  await expect(shell.locator('[data-card-tier-label]')).toHaveText('New');
  const other = await context.newPage();
  await other.goto('/?view=landing');
  await other.evaluate(() => localStorage.setItem('sonflash_ui_locale', 'vi'));
  await other.close();
  await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
  await expect(shell.locator('[data-card-tier-label]')).toHaveText('Mới');
  await expect(shell.locator('[data-card-headword] h2')).toHaveAttribute('lang', 'ja');
  await expect(shell.locator('[data-card-headword] h2')).toHaveText('りんご');
});
