import { expect, test } from './fixtures/firebase-emulator';

const reviewCard = {
  id: 'word-journey',
  word: 'journey',
  normalizedWord: 'journey',
  translation: 'hành trình',
  explanation: 'A trip from one place to another.',
  phonetic: '',
  emoji: '🧭',
  category: 'Travel',
  audioUrl: null,
  imageUrl: null,
  createdAt: '2026-09-01T08:00:00.000Z',
  nextReviewDate: '2026-09-01T08:00:00.000Z',
  difficulty: 'unrated',
  reviews: 0,
  schemaVersion: 2,
  revision: 1,
};

test('a signed-in learner completes the core course, library, review, recap, and sign-out journey', async ({
  page, db, testUser, seedCards, seedCourseProfile, signIn, blockExternalNetwork,
}) => {
  test.setTimeout(120_000);
  await page.clock.setFixedTime(new Date('2026-09-24T12:00:00.000Z'));
  await seedCourseProfile({ targetLanguage: 'en', nativeLanguage: 'vi' });
  await seedCards([reviewCard]);
  await Promise.all([
    db.doc(`users/${testUser.uid}/profile/stats`).set({ verifiedXp: 547, verifiedStreak: 2, rewardTimeZone: 'UTC' }),
    db.doc(`users/${testUser.uid}/profile/xp_history`).set({ verifiedByDayV1: { '2026-09-12': 327, '2026-09-18': 148, '2026-09-23': 72 } }),
  ]);
  await blockExternalNetwork(page);
  await signIn(page, '/?view=library&locale=en');

  await expect(page.locator('.claude-course-switcher-trigger')).toHaveText(/English/);
  await page.locator('[data-library-create-action]').click();
  const creator = page.getByRole('dialog', { name: 'Add a word' });
  await creator.getByRole('button', { name: 'Add manually' }).click();
  await creator.getByRole('textbox', { name: 'Word or phrase' }).fill('persist');
  await creator.getByRole('textbox', { name: 'Meaning' }).fill('lưu lại');
  await creator.getByRole('button', { name: 'Save card' }).click();
  await expect(creator).toHaveCount(0);

  const createdCard = () => db.collection(`users/${testUser.uid}/cards`).where('word', '==', 'persist').get();
  await expect.poll(async () => (await createdCard()).size).toBe(1);
  await signIn(page, '/?view=library&locale=en');
  const createdRow = page.locator('[data-library-card-row]').filter({ hasText: 'persist' });
  await expect(createdRow).toHaveCount(1, { timeout: 20_000 });
  await createdRow.getByRole('button', { name: 'Edit card' }).click();
  const editor = page.getByRole('dialog', { name: 'Edit card' });
  await editor.getByRole('textbox', { name: 'Translation', exact: true }).fill('duy trì');
  await editor.getByRole('button', { name: 'Save changes' }).click();
  await expect(editor).toHaveCount(0);
  await expect.poll(async () => (await createdCard()).docs[0]?.get('translation')).toBe('duy trì');

  await signIn(page, '/?view=library&locale=en');
  await expect(createdRow).toContainText('duy trì', { timeout: 20_000 });
  await page.getByRole('button', { name: 'Study now' }).click();
  const recallSelector = page.locator('[data-study-recall-mode] select');
  await expect(recallSelector).toBeVisible({ timeout: 14_000 });
  await recallSelector.selectOption('target-to-native');
  const studyCard = page.locator('[data-study-card]');
  await expect(studyCard).toBeVisible();
  const introduction = page.getByRole('region', { name: 'Meet this word' });
  await expect(introduction).toBeVisible();
  await introduction.getByRole('button', { name: 'I’ve reviewed it — start recall' }).click();
  await expect(introduction).toBeHidden();
  await expect(studyCard.getByRole('heading').first()).toBeVisible();
  const journeyHeading = studyCard.getByRole('heading', { name: 'journey', exact: true });
  if (await journeyHeading.count() === 0) {
    await page.getByRole('button', { name: 'Next card' }).click();
    await expect(introduction).toBeVisible();
    await introduction.getByRole('button', { name: 'I’ve reviewed it — start recall' }).click();
    await expect(introduction).toBeHidden();
  }
  await expect(journeyHeading).toBeVisible();
  await page.getByRole('button', { name: 'Reveal answer' }).click();
  await expect(page.locator('[data-study-rating]')).toBeVisible();
  await page.getByRole('button', { name: /Good/i }).last().click();
  await expect.poll(async () => Number((await db.doc(`users/${testUser.uid}/cards/${reviewCard.id}`).get()).get('reviews') ?? 0)).toBeGreaterThan(0);

  await page.goBack();
  await expect(page.getByRole('heading', { level: 1, name: 'Vocabulary library' })).toBeVisible();
  await expect(createdRow).toContainText('duy trì');

  await page.getByRole('button', { name: 'Progress', exact: true }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Progress' })).toBeVisible();
  await page.getByRole('button', { name: /view weekly recap/i }).click();
  const recap = page.getByRole('dialog', { name: 'Your weekly recap' });
  await expect(recap).toBeVisible();
  await expect(recap.locator('.weekly-recap-card__range').first()).toHaveText('Sep 18 – Sep 24');
  await expect(recap.getByText('220', { exact: true })).toBeVisible();
  await expect(recap.getByText('2026-09-18 · 148 XP')).toBeVisible();
  await recap.getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Vocabulary', exact: true }).first().click();
  await expect(page.getByRole('heading', { level: 1, name: 'Vocabulary library' })).toBeVisible();
  await expect(createdRow).toContainText('duy trì');
  await page.getByRole('button', { name: 'Manage library' }).click();
  await page.getByRole('menuitem', { name: 'Sign out of cloud sync' }).click();
  await expect(page.locator('.landing-canvas')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(createdRow).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__SONFLASH_TEST__?.getCurrentUid?.() ?? null)).toBeNull();
});
