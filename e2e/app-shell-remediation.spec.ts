import { expect, test } from './fixtures/firebase-emulator';

const emptyStateTestTitle = 'Today and Progress empty states expose concrete next actions without initial autofocus';
const emptyExtractorTestTitle = 'empty Library Scan a text restores focus after close';
const maximumShareTestTitle = 'a recipient accepts a shared deck at the 100-card limit';
const meaningLanguageMismatchShareTestTitle = 'a shared Korean-Vietnamese deck stays retryable when the recipient course uses English meanings';

const cards = [
  'serendipity', 'resilient', 'curious', 'flourish', 'meticulous', 'eloquent',
  'adaptable', 'insightful', 'persistent', 'vibrant', 'concise', 'diligent',
].map((word, index) => ({
  // Matches targetAwareCardId/stableCardId's `word-<normalizedWord>` id
  // scheme (functions/src/cardPersistence.ts) that a real createCard call
  // would assign for a plain English word. Review submission re-derives this
  // canonical id server-side and rejects a mismatch as identity-conflict, so
  // an arbitrary seeded id (e.g. the previous `shell-${index}`) breaks any
  // test that reviews a seeded card.
  id: `word-${word}`,
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
  // Current-protocol shape (matches what createCard actually writes) so
  // in-place mutations like toggleBookmark take the normal patch path
  // instead of the legacy identity-repair path, whose security rule
  // requires a card with no `normalizedWord` at all.
  schemaVersion: 2,
  revision: 1,
}));

const maximumShareCards = [
  ...cards,
  ...Array.from({ length: 100 - cards.length }, (_, index) => {
    const word = `batchword${String(index + cards.length + 1).padStart(3, '0')}`;
    return {
      ...cards[0],
      id: `word-${word}`,
      word,
      normalizedWord: word,
      translation: `translation ${index + cards.length + 1}`,
      explanation: `Explanation for ${word}.`,
    };
  }),
];

const koreanVietnameseShareCards = [{
  ...cards[0]!,
  id: 'word-ko-0f2a01b02bdd4a7ae7fcfbe6',
  word: '사과',
  normalizedWord: '사과',
  translation: 'quả táo',
  explanation: 'Một loại trái cây.',
  language: 'ko',
  translationLanguage: 'vi',
}];

test.beforeEach(async ({ page, seedCards, blockExternalNetwork }, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem('lingoflash_theme', 'dark');
  });
  await blockExternalNetwork(page);
  // Empty-library tests intentionally start from zero cards; every fresh
  // emulator test user already has none, so they skip seeding.
  if (testInfo.title !== emptyStateTestTitle && testInfo.title !== emptyExtractorTestTitle) {
    await seedCards(testInfo.title === maximumShareTestTitle
      ? maximumShareCards
      : testInfo.title === meaningLanguageMismatchShareTestTitle
        ? koreanVietnameseShareCards
        : cards);
  }
});

test('library exposes one canonical heading and a keyboard-operable skip link', async ({ page, signIn, browserName }) => {
  await signIn(page, '/?view=library');

  const skipLink = page.getByRole('link', { name: 'Skip to content' });
  const main = page.locator('main#learning-workspace');
  await expect(page.locator('nav.app-navigation')).toBeVisible({ timeout: 15_000 });
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
  await expect(page.getByRole('heading', { level: 2, name: 'Vocabulary' })).toBeVisible();
  // `main` is a scrollable region that stays a normal tab stop (tabindex=0)
  // so keyboard users can scroll it directly, rather than a programmatic-only
  // (-1) focus target; the skip link still moves focus there on activation.
  await expect(main).toHaveAttribute('tabindex', '0');

  await page.keyboard.press('Enter');
  await expect(main).toBeFocused();
});

test('shell settles when WebKit animation signals and the timer fallback both stall', async ({ page, signIn }) => {
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

  await signIn(page, '/?view=library');

  await expect(page.locator('nav.app-navigation')).toHaveAttribute('data-motion-state', 'ready');
});

test('tablet shell keeps every visible header control in bounds and nav targets at least 44px tall', async ({ page, signIn }) => {
  let signedIn = false;
  for (const width of [768, 800, 920, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    if (signedIn) await page.goto('/?view=today');
    else { await signIn(page, '/?view=today'); signedIn = true; }
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

for (const family of ['classic', 'crystal']) for (const mode of ['light', 'dark'] as const) {
  test(`${family} ${mode} empty course chooser keeps its mobile arrow and accessible name`, async ({ page, seedCourseProfile, signIn }) => {
    await page.addInitScript(({ family, mode }) => {
      localStorage.setItem('sonflash_theme_family', family);
      localStorage.setItem('lingoflash_theme', mode);
      localStorage.setItem('sonflash_theme_follow_system', 'false');
    }, { family, mode });
    await page.emulateMedia({ colorScheme: mode, reducedMotion: 'reduce' });
    await seedCourseProfile();
    await signIn(page, '/?view=library&locale=en');
    for (const locale of ['en', 'vi']) {
      await page.goto(`/?view=library&locale=${locale}`);
      const trigger = page.getByRole('button', { name: locale === 'en' ? 'Choose a course' : 'Chọn khóa học', exact: true });
      await expect(trigger).toBeVisible();
      for (const width of [390, 360]) {
        await page.setViewportSize({ width, height: 844 });
        await expect.poll(() => trigger.evaluate(button => {
          const bounds = button.getBoundingClientRect();
          const arrow = button.querySelector('svg')!.getBoundingClientRect();
          return bounds.width >= 44 && bounds.height >= 44
            && bounds.left >= 0 && bounds.right <= window.innerWidth
            && button.scrollWidth <= button.clientWidth
            && arrow.left >= bounds.left && arrow.right <= bounds.right;
        }), { message: `${locale} course chooser and arrow fit a 44px mobile target at ${width}px` }).toBe(true);
        await trigger.click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(trigger).toBeFocused();
      }
    }
  });
}

test('mobile library settings menu stays in bounds and restores trigger focus', async ({ page, signIn }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, '/?view=library');

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

test('bookmarking a card preserves the current library page', async ({ page, signIn }) => {
  await signIn(page, '/?view=library&page=2');
  await expect(page.getByText('Page 2 / 2')).toBeVisible();

  // The bookmark toggle keeps a static "Bookmark card" accessible name and
  // reflects its state via the filled/outline star icon plus the card's
  // "Starred" badge, rather than swapping to a "Remove star" label.
  const starredBadges = page.getByRole('img', { name: 'Starred' });
  const before = await starredBadges.count();
  await page.getByRole('button', { name: 'Bookmark card' }).first().click();
  await expect(starredBadges).toHaveCount(before - 1);

  await expect(page.getByText('Page 2 / 2')).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get('page')).toBe('2');
});

test('Today practice choices reflow in short portrait and landscape viewports', async ({ page, signIn }) => {
  let signedIn = false;
  for (const viewport of [{ width: 320, height: 480 }, { width: 667, height: 320 }]) {
    await page.setViewportSize(viewport);
    if (signedIn) await page.goto('/?view=today');
    else { await signIn(page, '/?view=today'); signedIn = true; }
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

test('the destructive library dialog restores focus to its stable opener', async ({ page, signIn }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, '/?view=library');

  const manage = page.getByRole('button', { name: 'Manage library' });
  await manage.click();
  const clear = page.getByRole('menuitem', { name: 'Clear the entire library' });
  await clear.click();
  await page.getByRole('button', { name: 'Keep library' }).click();
  await expect(manage).toBeFocused();
});

test('learning insights open from the library menu and lead to Progress', async ({ page, signIn }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, '/?view=library');

  const manage = page.getByRole('button', { name: 'Manage library' });
  await manage.click();
  await page.getByRole('menuitem', { name: 'Learning insights' }).click();
  const insights = page.getByRole('dialog', { name: 'Learning insights' });
  await expect(insights).toBeVisible();
  await insights.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(insights).toBeHidden();
  await expect(manage).toBeFocused();

  await manage.click();
  await page.getByRole('menuitem', { name: 'Learning insights' }).click();
  await page.getByRole('dialog', { name: 'Learning insights' }).getByRole('button', { name: 'Open full Progress →' }).click();
  await expect(page.getByRole('dialog', { name: 'Learning insights' })).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Progress' })).toBeVisible();
});

test('a deck can be created, reloaded, and deleted from Library', async ({ page, signIn }) => {
  await signIn(page, '/?view=library');
  await page.locator('summary').filter({ hasText: 'More library tools' }).click();

  const opener = page.getByRole('button', { name: 'New deck' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'New deck' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('textbox', { name: 'Deck name' }).fill('Weekend words');
  await dialog.getByRole('button', { name: 'Create deck' }).click();
  await expect(dialog.getByText('Deck created.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(opener).toBeFocused();
  await expect(page.getByRole('button', { name: 'Weekend words', exact: true })).toBeVisible();

  await page.reload();
  await page.locator('summary').filter({ hasText: 'More library tools' }).click();
  await expect(page.getByRole('button', { name: 'Weekend words', exact: true })).toBeVisible();

  const deleteDeck = page.getByRole('button', { name: 'Delete Weekend words deck' });
  await deleteDeck.click();
  const confirmation = page.getByRole('alertdialog', { name: 'Delete “Weekend words” deck?' });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Keep deck' }).click();
  await expect(page.getByRole('button', { name: 'Weekend words', exact: true })).toBeVisible();

  await deleteDeck.click();
  await confirmation.getByRole('button', { name: 'Delete deck' }).click();
  await expect(confirmation).toBeHidden();
  await expect(page.getByRole('button', { name: 'Weekend words', exact: true })).toHaveCount(0);
  await page.reload();
  await page.locator('summary').filter({ hasText: 'More library tools' }).click();
  await expect(page.getByRole('button', { name: 'Weekend words', exact: true })).toHaveCount(0);
});

test('a structured CSV imports a card from Library and persists after reload', async ({ page, signIn }) => {
  await signIn(page, '/?view=library');
  await expect(page.getByRole('status').filter({ hasText: 'Synced' })).toBeVisible();
  await page.locator('summary').filter({ hasText: 'More library tools' }).click();

  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import cards from Excel or CSV' }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: 'new-vocabulary.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('Word,Translation\nluminous,phát sáng\n'),
  });

  const dialog = page.getByRole('dialog', { name: 'Import from spreadsheet' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('Import complete')).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole('button', { name: 'Done' }).click();

  await page.reload();
  await page.getByRole('searchbox', { name: /Search words/ }).fill('luminous');
  await expect(page.getByRole('heading', { name: 'luminous' })).toBeVisible();
});

test('Library Scan Text opens its production dialog and clears the draft on close', async ({ page, signIn }) => {
  await signIn(page, '/?view=library');
  await page.locator('summary').filter({ hasText: 'More library tools' }).click();

  const opener = page.getByRole('button', { name: 'Scan Text' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Scan text' });
  await expect(dialog).toBeVisible();
  const input = dialog.getByRole('textbox', { name: 'Text to scan' });
  const extract = dialog.getByRole('button', { name: 'Extract vocabulary' });
  await expect(extract).toBeDisabled();
  await input.fill('A luminous idea can change a room.');
  await expect(extract).toBeEnabled();

  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
  await opener.click();
  await expect(page.getByRole('dialog', { name: 'Scan text' }).getByRole('textbox', { name: 'Text to scan' })).toBeEmpty();
});

test(emptyExtractorTestTitle, async ({ page, seedCourseProfile, signIn }) => {
  await seedCourseProfile();
  await signIn(page, '/?view=library');
  await expect(page.getByRole('status').filter({ hasText: 'Synced' })).toBeVisible();
  const opener = page.getByRole('button', { name: 'Scan a text' });
  await expect(opener).toBeVisible();
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Scan text' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

test('Library Share creates and revokes a real deck link', async ({ page, signIn }) => {
  await signIn(page, '/?view=library');
  await expect(page.getByRole('status').filter({ hasText: 'Synced' })).toBeVisible();
  await page.getByRole('button', { name: 'Share', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: /Share “All library cards”/ });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByRole('textbox', { name: 'Vocabulary deck share link' })).toHaveValue(/\?share=[A-Za-z0-9_-]+/);
  await expect(dialog.getByRole('button', { name: 'Revoke link' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Revoke link' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('The shared deck link has been revoked.')).toBeVisible();
});

for (const [title, sharedCards] of [
  ['a recipient accepts a shared deck batch into a separate Library', cards],
  [maximumShareTestTitle, maximumShareCards],
] as const) {
  test(title, async ({
    page, signIn, adminAuth, db, testUser, browser, blockExternalNetwork,
  }) => {
    const acceptanceTimeout = sharedCards.length === 100 ? 850_000 : 90_000;
    test.setTimeout(acceptanceTimeout + 30_000);
    await signIn(page, '/?view=library');
    await expect(page.getByRole('status').filter({ hasText: 'Synced' })).toBeVisible();
    await page.getByRole('button', { name: 'Share', exact: true }).click();
    const outgoing = page.getByRole('dialog', { name: /Share “All library cards”/ });
    const linkInput = outgoing.getByRole('textbox', { name: 'Vocabulary deck share link' });
    await expect(linkInput).toHaveValue(/\?share=[A-Za-z0-9_-]+/);
    const shareId = new URL(await linkInput.inputValue()).searchParams.get('share');
    expect(shareId).toBeTruthy();

    const recipientId = `${testUser.uid}-recipient`;
    await adminAuth.createUser({ uid: recipientId });
    const token = await adminAuth.createCustomToken(recipientId);
    await db.collection('users').doc(recipientId).collection('profile').doc('courses').set({
      courses: [], activeCourseId: null,
    });
    const recipientContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' });
    try {
      const recipientPage = await recipientContext.newPage();
      await blockExternalNetwork(recipientPage);
      await recipientPage.goto('/?view=today');
      await recipientPage.waitForFunction(() => Boolean(window.__SONFLASH_TEST__?.signInWithCustomToken));
      await recipientPage.evaluate(async customToken => {
        await window.__SONFLASH_TEST__!.signInWithCustomToken(customToken);
      }, token);
      await recipientPage.goto(`/?view=library&share=${shareId}`);

      const incoming = recipientPage.getByRole('dialog');
      await expect(incoming).toBeVisible();
      const addCards = incoming.getByRole('button', { name: `Add ${sharedCards.length} cards` });
      await expect(addCards).toBeVisible();
      await addCards.click();
      const outcome = await Promise.race([
        incoming.waitFor({ state: 'hidden', timeout: acceptanceTimeout }).then(() => 'accepted' as const),
        incoming.getByRole('alert').waitFor({ state: 'visible', timeout: acceptanceTimeout }).then(() => 'failed' as const),
      ]);
      if (outcome === 'failed') {
        const message = await incoming.getByRole('alert').innerText();
        const persisted = (await db.collection('users').doc(recipientId).collection('cards').get()).size;
        throw new Error(`Shared deck saved ${persisted}/${sharedCards.length} cards: ${message}`);
      }
      await expect(recipientPage).not.toHaveURL(/share=/);
      await expect.poll(async () => (
        await db.collection('users').doc(recipientId).collection('cards').get()
      ).size).toBe(sharedCards.length);
      await recipientPage.reload();
      const search = recipientPage.getByRole('searchbox', { name: /Search words/ });
      await search.fill(sharedCards[0]!.word);
      await expect(recipientPage.getByRole('heading', { name: sharedCards[0]!.word })).toBeVisible();
      await search.fill(sharedCards.at(-1)!.word);
      await expect(recipientPage.getByRole('heading', { name: sharedCards.at(-1)!.word })).toBeVisible();
    } finally {
      await recipientContext.close();
    }
  });
}

test(meaningLanguageMismatchShareTestTitle, async ({
  page, signIn, adminAuth, db, testUser, browser, blockExternalNetwork,
}) => {
  test.setTimeout(60_000);
  await db.collection('users').doc(testUser.uid).collection('profile').doc('courses').set({
    activeCourseId: 'course-ko',
    courses: [{
      id: 'course-ko', targetLanguage: 'ko', nativeLanguage: 'vi', status: 'active', goals: [],
      preferences: { pronunciationVariant: null, showRomanization: false, zhScript: null },
      createdAt: '2026-01-01T00:00:00.000Z',
    }],
  });
  await signIn(page, '/?view=library');
  await expect(page.getByRole('status').filter({ hasText: 'Synced' })).toBeVisible();
  const sharedDeckResponse = page.waitForResponse(response =>
    response.url().endsWith('/createSharedDeckV2') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const response = await sharedDeckResponse;
  await response.finished();
  expect(response.status()).toBe(200);
  const shareLink = page.getByRole('textbox', { name: 'Vocabulary deck share link' });
  await expect(shareLink).toHaveValue(/\?share=[A-Za-z0-9_-]+/);
  const shareId = new URL(await shareLink.inputValue())
    .searchParams.get('share');
  expect(shareId).toBeTruthy();

  const recipientId = `${testUser.uid}-meaning-language-recipient`;
  await adminAuth.createUser({ uid: recipientId });
  const token = await adminAuth.createCustomToken(recipientId);
  await db.collection('users').doc(recipientId).collection('profile').doc('courses').set({
    activeCourseId: 'course-ko',
    courses: [{
      id: 'course-ko', targetLanguage: 'ko', nativeLanguage: 'en', status: 'active', goals: [],
      preferences: { pronunciationVariant: null, showRomanization: false, zhScript: null },
      createdAt: '2026-01-01T00:00:00.000Z',
    }],
  });

  const recipientContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' });
  try {
    const recipientPage = await recipientContext.newPage();
    await blockExternalNetwork(recipientPage);
    await recipientPage.goto('/?view=today');
    await recipientPage.waitForFunction(() => Boolean(window.__SONFLASH_TEST__?.signInWithCustomToken));
    await recipientPage.evaluate(async customToken => {
      await window.__SONFLASH_TEST__!.signInWithCustomToken(customToken);
    }, token);
    await recipientPage.goto(`/?view=library&share=${shareId}`);

    const incoming = recipientPage.getByRole('dialog');
    await expect(incoming).toBeVisible();
    await expect(incoming.getByText('Korean → Vietnamese')).toBeVisible();
    const addCards = incoming.getByRole('button', { name: `Add ${koreanVietnameseShareCards.length} cards` });
    await addCards.click();
    await expect(incoming.getByRole('alert')).toHaveText("This shared deck uses a different meaning language from your existing course. Change the course's Meaning language in Settings, then try again.");
    await expect(recipientPage).toHaveURL(new RegExp(`share=${shareId}`));
    await expect.poll(async () => (
      await db.collection('users').doc(recipientId).collection('cards').get()
    ).size).toBe(0);

    const settingsPage = await recipientContext.newPage();
    await blockExternalNetwork(settingsPage);
    await settingsPage.goto('/?view=settings');
    const meaningLanguage = settingsPage.locator('[data-settings-course-language] select').nth(1);
    await expect(meaningLanguage).toHaveValue('en');
    await meaningLanguage.selectOption('vi');
    await expect.poll(async () => (
      (await db.collection('users').doc(recipientId).collection('profile').doc('courses').get())
        .data()?.courses?.[0]?.nativeLanguage
    )).toBe('vi');
    await settingsPage.close();

    await expect.poll(async () => {
      if (await incoming.isHidden()) return true;
      if (await addCards.isVisible()) await addCards.click();
      return incoming.isHidden();
    }, { timeout: 15_000, intervals: [250, 500, 1000] }).toBe(true);
    await expect(recipientPage).not.toHaveURL(/share=/);
    await expect.poll(async () => (
      await db.collection('users').doc(recipientId).collection('cards').get()
    ).size).toBe(koreanVietnameseShareCards.length);
  } finally {
    await recipientContext.close();
  }
});

test('Today and Progress empty states expose concrete next actions without initial autofocus', async ({ page, seedCourseProfile, signIn }) => {
  // An existing course profile keeps first-run onboarding out of the empty states under test.
  await seedCourseProfile();
  await signIn(page, '/?view=today');
  await expect.poll(() => page.evaluate(() => document.activeElement === document.body)).toBe(true);
  await expect(page.getByRole('button', { name: 'Add vocabulary', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Explore learning paths' })).toBeVisible();

  await page.getByRole('button', { name: 'Progress' }).last().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Progress', exact: true })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Add vocabulary' })).toBeVisible();
});

test('library query state deep-links and responds to browser history without dropping unrelated params', async ({ page, signIn }) => {
  await signIn(page, '/?view=library&utm_source=audit&category=Test%20deck&deck=IELTS&difficulty=hard&pos=noun&starred=1&date=Today&page=2');

  await expect(page.getByRole('heading', { name: 'Test deck' })).toBeVisible();

  // The advanced filter controls live inside the collapsible "More library
  // tools" <details>/<summary> disclosure, which starts closed; open it
  // before asserting on the deep-linked filter values it renders.
  await page.locator('summary').filter({ hasText: 'More library tools' }).click();

  await expect(page.getByRole('combobox', { name: 'Filter by part of speech' })).toHaveValue('noun');
  await expect(page.getByRole('combobox', { name: 'Filter by memory status' })).toHaveValue('hard');
  // Signed-in sessions render a native date picker (the cloud date filter)
  // instead of the label-based <select> used for anonymous/local sessions,
  // seeded with today's date since the deep-linked label is "Today".
  const now = new Date();
  const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  await expect(page.locator('input[type="date"][aria-label="Filter cloud cards by date created"]')).toHaveValue(todayIso);
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

test('mobile library presents the card grid before tools and the filter shortcut reaches tools', async ({ page, signIn }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, '/?view=library');

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

  // The trigger is a native <summary> element; Chromium exposes it with
  // accessible role "generic" rather than "button", so match on the element
  // itself instead of an ARIA role.
  await page.locator('summary').filter({ hasText: 'More library tools' }).click();
  await expect(tools).toBeInViewport();
});

test('study shortcuts require modifiers for single-character commands and views expose a focused heading', async ({ page, signIn, seedCards, db, testUser }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  // "Study now" only starts a session when at least one card is due or
  // unrated ("new") per fetchPracticeCards' Firestore queries; every shared
  // fixture card above is seeded with difficulty: 'hard' and no
  // nextReviewDate, so none qualify. Seed one unrated card here.
  await seedCards([{
    id: 'word-tenacious',
    word: 'tenacious',
    normalizedWord: 'tenacious',
    translation: 'translation tenacious',
    explanation: 'Explanation for tenacious.',
    phonetic: '',
    emoji: '',
    category: 'Test deck',
    partOfSpeech: 'noun',
    audioUrl: null,
    imageUrl: null,
    createdAt: new Date().toISOString(),
    bookmarked: false,
    difficulty: 'unrated',
    customDeck: 'IELTS',
    schemaVersion: 2,
    revision: 1,
  }]);
  await signIn(page, '/?view=library');

  // The library's study-launch action is currently labeled "Study now"
  // (previously "Start a review"/"Review N due").
  await page.getByRole('button', { name: 'Study now' }).click();
  const studyHeading = page.getByRole('heading', { level: 1, name: 'Study session' });
  await expect(studyHeading).toBeFocused();
  const introduction = page.getByRole('region', { name: 'Meet this word' });
  await expect(introduction).toBeVisible();
  await introduction.getByRole('button', { name: 'I’ve reviewed it — start recall' }).click();
  await expect(page.locator('[data-study-session]')).toBeFocused();
  await expect(page.getByRole('button', { name: 'Reveal answer' })).toBeVisible();
  const reviewedCard = db.doc(`users/${testUser.uid}/cards/word-tenacious`);
  const before = (await reviewedCard.get()).data()!;

  await page.keyboard.press('Space');
  await expect(page.getByText('How well did you remember this card?')).toBeVisible();
  await page.keyboard.press('1');
  await expect(page.getByText('How well did you remember this card?')).toBeVisible();
  expect((await reviewedCard.get()).data()).toEqual(before);
  const ratingResponse = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/reviewCardV2'));
  await page.keyboard.press('Alt+1');
  expect((await ratingResponse).status()).toBe(200);
  await expect.poll(async () => (await reviewedCard.get()).data()?.revision).toBe(before.revision + 1);
  const saved = (await reviewedCard.get()).data()!;
  expect(saved.reviews).toBe(1);
  expect(saved.reviewHistory).toHaveLength(1);
  expect(saved.reviewHistory[0].rating).toBe('again');
  const recap = page.getByRole('dialog', { name: 'Session complete' });
  await expect(recap).toBeVisible();
  await recap.getByRole('button', { name: 'Close recap', exact: true }).click();

  await page.getByRole('button', { name: 'Close study mode' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Vocabulary library' })).toBeFocused();

});
