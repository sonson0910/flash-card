import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures/firebase-emulator';

const reviewedGeneralUnit = [
  { id: 'lexeme-5b22656e222c22686f6d65222c226e6f756e222c227072696d617279225d-b6704e5ff3a59f9cc4cde10e', word: 'home' },
  { id: 'lexeme-5b22656e222c2266616d696c79222c226e6f756e222c227072696d617279225d-8be5b9ffefae815b606306f2', word: 'family' },
  { id: 'lexeme-5b22656e222c22667269656e6473686970222c226e6f756e222c227072696d617279225d-7f81b4284123811b162feeae', word: 'friendship' },
  { id: 'lexeme-5b22656e222c226c616e6775616765222c226e6f756e222c227072696d617279225d-633a874f2b7644938eccfefb', word: 'language' },
  { id: 'lexeme-5b22656e222c22696e666f726d6174696f6e222c226e6f756e222c227072696d617279225d-39a7e34537d07fe1b1ddce54', word: 'information' },
  { id: 'lexeme-5b22656e222c226d657373616765222c226e6f756e222c227072696d617279225d-688ded5efdcd3a5d7bf25b0f', word: 'message' },
  { id: 'lexeme-5b22656e222c2273746f7279222c226e6f756e222c227072696d617279225d-ee4f28f9336893c7eabd44d8', word: 'story' },
] as const;

test('reviewed catalog availability follows a live interface-language change', async ({ page, seedCourseProfile, signIn }) => {
  // A fresh emulator user with zero cards and no course-profile doc would
  // otherwise show OnboardingGate's full-screen journey overlay on top of
  // this view (suppress = knownLibraryTotal > 0, which is false here); the
  // overlay then intercepts the "Choose language" click below. Seeding an
  // empty course profile (no active-language change needed, this spec never
  // seeds cards) suppresses onboarding without altering the default 'en'
  // library language scope.
  await seedCourseProfile();
  await signIn(page, '/?view=catalog');
  await expect(page.getByRole('heading', { name: 'Catalog unavailable' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check for reviewed catalog' })).toBeVisible();

  await page.getByRole('button', { name: 'Choose language' }).click();
  await page.getByRole('menuitemradio', { name: 'Tiếng Việt' }).click();

  await expect(page.locator('html')).toHaveAttribute('lang', 'vi');
  await expect(page.getByRole('heading', { name: 'Danh mục không khả dụng' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Kiểm tra danh mục đã duyệt' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Catalog unavailable' })).toHaveCount(0);
});

test('Paths lazily installs the approved release and remains accessible offline', async ({ page, browserName, seedCourseProfile, signIn }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const requestedScripts: string[] = [];
  const requestedCatalogAssets: string[] = [];
  page.on('request', request => {
    if (request.resourceType() === 'script') requestedScripts.push(request.url());
    if (/\/catalog\/.*\.(?:json|ndjson)(?:\?|$)/i.test(request.url())) {
      requestedCatalogAssets.push(request.url());
    }
  });

  // Guest/anonymous browsing was removed from the app shell (unauthenticated
  // visitors now bounce to the landing page), so this test signs in first;
  // the lazy-load, URL-addressability, and accessibility guarantees it checks
  // apply equally to an authenticated session with no installed catalog.
  await seedCourseProfile();
  await signIn(page, '/?view=library&utm_source=phase4#catalog-test');
  // A fresh emulator test user has zero cards, so LibraryCardGrid's "Your
  // library" heading never mounts (LibraryScreen.tsx only renders it once
  // !showFirstUsePanel); app-view-headings.ts's page-level h1 is present
  // either way and is what this test actually needs as a readiness signal.
  await expect(page.getByRole('heading', { name: 'Vocabulary library', level: 1 })).toBeVisible();
  expect(requestedScripts.some(url => /CatalogWorkspace/i.test(url))).toBe(false);

  await page.getByRole('button', { name: 'Paths' }).first().click();
  await expect(page).toHaveURL(/view=catalog.*utm_source=phase4.*#catalog-test/);
  await expect(page.getByRole('heading', { name: 'Paths' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'My vocabulary' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Reviewed catalog', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#catalog-language')).toBeFocused();
  expect(requestedScripts.some(url => /CatalogWorkspace/i.test(url))).toBe(true);

  await expect(page.getByRole('heading', { name: 'Catalog unavailable' })).toBeVisible();
  await expect(page.locator('#catalog-language')).toBeVisible();
  expect(requestedCatalogAssets).toEqual([]);

  await page.getByRole('button', { name: 'Check for reviewed catalog' }).click();
  await expect(page.getByText('Reviewed catalog r-261124da6107eb25204587aa is ready on this device.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Choose a unit' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Catalog units' }).locator('li')).toHaveCount(15);
  await expect(page.getByRole('heading', { name: 'Vocabulary explorer' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add to library' }).first()).toBeVisible();
  expect(requestedCatalogAssets.filter(url => url.endsWith('.json'))).toHaveLength(4);

  const search = page.getByRole('searchbox', { name: 'Search vocabulary' });
  await search.fill('analysis');
  await expect(page).toHaveURL(/term=analysis/);
  await page.getByRole('button', { name: 'My vocabulary' }).click();
  await expect(page).toHaveURL(/catalog=personal/);
  await expect(page).not.toHaveURL(/term=/);
  await expect(page.getByRole('heading', { name: 'Personal learning mode' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Choose a unit' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reviewed catalog', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose a unit' })).toBeVisible();
  await expect(search).toHaveValue('');
  await search.fill('evidence');
  await page.getByRole('button', { name: 'My vocabulary' }).click();
  await page.waitForTimeout(350);
  await expect(page).not.toHaveURL(/term=/);
  await page.getByRole('button', { name: 'Reviewed catalog', exact: true }).click();
  await expect(search).toHaveValue('');
  expect(requestedCatalogAssets.filter(url => url.endsWith('.json'))).toHaveLength(4);

  await page.context().setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  await expect(page.getByRole('heading', { name: 'Choose a unit' })).toBeVisible();
  await page.context().setOffline(false);

  await page.setViewportSize({ width: 320, height: 800 });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  if (browserName === 'chromium') {
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations.filter(item => item.impact === 'serious' || item.impact === 'critical'))
      .toEqual([]);
  }
});

test('a reviewed Paths unit is persisted and opened as the exact Study deck', async ({
  page, db, testUser, seedCourseProfile, signIn, blockExternalNetwork,
}) => {
  await blockExternalNetwork(page);
  await seedCourseProfile();
  await signIn(page, '/?view=catalog&locale=en');
  await page.getByRole('button', { name: 'Check for reviewed catalog' }).click();
  await expect(page.getByText('Reviewed catalog r-261124da6107eb25204587aa is ready on this device.')).toBeVisible();

  await page.getByRole('button', { name: /^General English/ }).click();
  await page.getByRole('button', { name: /Unit 1 · People and Personal Stories/ }).click();
  await expect(page.getByRole('heading', { name: 'Preview: People and Personal Stories' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue with this unit' }).click();
  await expect(page.getByText('Any missing unit words will be added to your Library before study.')).toBeVisible();
  await page.getByRole('button', { name: 'Add missing words and study' }).click();

  const study = page.locator('[data-study-session]');
  await expect(study).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Study session', level: 1 })).toBeVisible();
  await expect(study.getByRole('progressbar', { name: 'Study progress' })).toHaveAttribute('aria-valuemax', String(reviewedGeneralUnit.length));
  for (const [index, card] of reviewedGeneralUnit.entries()) {
    await expect(study.getByRole('heading', { name: card.word, exact: true })).toBeVisible();
    await expect(study.getByRole('textbox', { name: 'Your answer' })).toHaveAttribute('id', `recall-answer-${card.id}`);
    if (index < reviewedGeneralUnit.length - 1) {
      await study.getByRole('button', { name: 'Next card' }).click();
    }
  }

  await expect.poll(async () => {
    const snapshot = await db.collection('users').doc(testUser.uid).collection('cards').get();
    return snapshot.docs
      .map(document => ({ id: document.id, lexemeId: document.get('lexemeId'), word: document.get('word') }))
      .sort((left, right) => left.word.localeCompare(right.word));
  }).toEqual(reviewedGeneralUnit
    .map(card => ({ id: card.id, lexemeId: card.id, word: card.word }))
    .sort((left, right) => left.word.localeCompare(right.word)));
});

test('a direct Catalog URL never invents reviewed vocabulary or an installable release', async ({ page, signIn }) => {
  await signIn(page, '/?view=catalog&lang=ja');

  await expect(page).toHaveURL(/view=catalog/);
  await expect(page.getByRole('heading', { name: 'Paths' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Catalog unavailable' })).toBeVisible();
  await expect(page.getByText('Draft vocabulary is never shown here.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'My vocabulary' })).toBeVisible();
  await expect(page.getByRole('button', { name: /check for reviewed catalog|install/i })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'IELTS, TOEIC or everyday English' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Vocabulary explorer' })).toHaveCount(0);
});

test('personal paths follow the active course language even from a stale direct URL', async ({ page, seedCourseProfile, signIn }) => {
  await seedCourseProfile({ targetLanguage: 'ko' });
  await signIn(page, '/?view=catalog&catalog=personal&lang=en');
  await expect(page).toHaveURL(/catalog=personal.*lang=ko/);
  await expect(page.getByRole('heading', { name: 'Personal learning mode' })).toBeVisible();
  await page.getByRole('button', { name: 'Reviewed catalog', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Catalog unavailable' })).toBeVisible();
  await page.getByRole('button', { name: 'My vocabulary' }).click();
  await expect(page).toHaveURL(/catalog=personal.*lang=ko/);
  await expect(page.getByRole('heading', { name: 'Personal learning mode' })).toBeVisible();
});
