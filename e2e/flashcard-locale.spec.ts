import { type Page } from '@playwright/test';
import { expect, test, type GuestCard, type SeedCourseProfileOptions } from './fixtures/firebase-emulator';

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
  { query: 'en', document: 'en', tier: 'Bud' },
  { query: 'vi', document: 'vi', tier: 'Nụ' },
  { query: 'pseudo', document: 'en-XA', tier: /\[Bud/ },
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
  await expect(shell.locator('[data-card-tier-label]')).toHaveText('Bud');
  const other = await context.newPage();
  await other.goto('/?view=landing');
  await other.evaluate(() => localStorage.setItem('sonflash_ui_locale', 'vi'));
  await other.close();
  await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
  await expect(shell.locator('[data-card-tier-label]')).toHaveText('Nụ');
  await expect(shell.locator('[data-card-headword] h2')).toHaveAttribute('lang', 'ja');
  await expect(shell.locator('[data-card-headword] h2')).toHaveText('りんご');
});

const readingCards = [
  { language: 'ko', word: '결심', translation: 'quyết tâm', explanation: 'A firm decision.', category: 'TOPIK I', phonetic: '', reading: 'gyeolsim', label: 'Romanization' },
  { language: 'ja', word: '日本', translation: 'Nhật Bản', explanation: 'The country of Japan.', category: 'JLPT N5', phonetic: 'にっぽん', reading: 'にっぽん', label: 'Reading' },
  { language: 'zh', word: '汉语', translation: 'tiếng Hán', explanation: 'The Chinese language.', category: 'HSK 1', phonetic: 'hàn yǔ', reading: 'hàn', label: 'Pinyin' },
] as const;

const readingThemes = [
  { family: 'classic', mode: 'light' },
  { family: 'classic', mode: 'dark' },
  { family: 'crystal', mode: 'light' },
  { family: 'crystal', mode: 'dark' },
] as const;

const readingViewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

async function seedAndOpenReadingCard(
  page: Page,
  readingCard: typeof readingCards[number],
  seedCards: (cards: readonly GuestCard[]) => Promise<void>,
  seedCourseProfile: (profile?: SeedCourseProfileOptions) => Promise<void>,
  signIn: (page: Page, path: string) => Promise<void>,
  locale = 'en',
) {
  await seedCourseProfile({ targetLanguage: readingCard.language });
  await seedCards([{
    ...card,
    id: `flashcard-reading-${readingCard.language}`,
    word: readingCard.word,
    normalizedWord: readingCard.word,
    translation: readingCard.translation,
    explanation: readingCard.explanation,
    category: readingCard.category,
    language: readingCard.language,
    phonetic: readingCard.phonetic,
  }]);
  await signIn(page, `/?view=library&locale=${locale}`);
  await page.locator('.library-word-open').click();
  return page.locator('.flashcard-shell');
}

for (const readingCard of readingCards) for (const theme of readingThemes) for (const viewport of readingViewports) {
  test(`${readingCard.language} reading is visible and toggleable in ${theme.family} ${theme.mode} ${viewport.name}`, async ({ page, seedCards, seedCourseProfile, signIn, blockExternalNetwork }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: theme.mode, reducedMotion: 'reduce' });
    await page.addInitScript(({ family, mode }) => {
      localStorage.setItem('sonflash_theme_family', family);
      localStorage.setItem('lingoflash_theme', mode);
      localStorage.setItem('sonflash_theme_follow_system', 'false');
      localStorage.setItem('sonflash_reduced_motion', 'true');
    }, theme);
    await blockExternalNetwork(page);
    const shell = await seedAndOpenReadingCard(page, readingCard, seedCards, seedCourseProfile, signIn);
    const toggle = shell.getByRole('button', { name: new RegExp(`Toggle ${readingCard.label}`) });
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(shell.getByText(readingCard.reading, { exact: false })).toBeVisible();
    const target = await toggle.boundingBox();
    expect(target, 'reading toggle must have a measurable target').not.toBeNull();
    expect(target!.width, 'reading toggle width').toBeGreaterThanOrEqual(44);
    expect(target!.height, 'reading toggle height').toBeGreaterThanOrEqual(44);
    const screenshot = testInfo.outputPath(`flashcard-reading-${readingCard.language}-${theme.family}-${theme.mode}-${viewport.name}.png`);
    await shell.screenshot({ path: screenshot, animations: 'disabled', caret: 'hide' });
    await testInfo.attach('CJK card reading', { path: screenshot, contentType: 'image/png' });
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(shell.getByText(readingCard.reading, { exact: false })).toHaveCount(0);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });
}

for (const locale of [
  { query: 'en', document: 'en' },
  { query: 'vi', document: 'vi' },
  { query: 'pseudo', document: 'en-XA' },
] as const) {
  test(`CJK readings stay visible at 360px with ${locale.query} UI`, async ({ page, seedCards, seedCourseProfile, signIn, blockExternalNetwork }, testInfo) => {
    const readingCard = readingCards[0];
    await page.setViewportSize({ width: 360, height: 844 });
    await blockExternalNetwork(page);
    const shell = await seedAndOpenReadingCard(page, readingCard, seedCards, seedCourseProfile, signIn, locale.query);
    await expect(page.locator('html')).toHaveAttribute('lang', locale.document);
    const toggle = shell.locator('[data-reading-toggle]');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(shell.getByText(readingCard.reading, { exact: false })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), '360px card must not overflow horizontally').toBe(true);
    const screenshot = testInfo.outputPath(`flashcard-reading-ko-${locale.query}-360px.png`);
    await shell.screenshot({ path: screenshot, animations: 'disabled', caret: 'hide' });
    await testInfo.attach('CJK card reading 360px locale', { path: screenshot, contentType: 'image/png' });
  });
}
