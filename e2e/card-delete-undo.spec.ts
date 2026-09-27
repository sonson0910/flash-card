import { expect, test } from './fixtures/firebase-emulator';

const card = {
  // The Functions emulator's createCard callable now backs undo/restore, and
  // it always assigns the deterministic word-identity id (createWordCardId)
  // regardless of the id a caller supplies, so the seeded card must already
  // use that same id or restore will legitimately reject it as an identity
  // mismatch ('unsafe-existing').
  id: 'word-resilient',
  word: 'resilient',
  normalizedWord: 'resilient',
  language: 'en',
  translation: 'kiên cường',
  explanation: 'Able to recover after difficulty.',
  phonetic: '/rɪˈzɪliənt/',
  emoji: '🌱',
  category: 'Personal growth',
  partOfSpeech: 'adjective',
  audioUrl: null,
  imageUrl: null,
  createdAt: '2026-09-01T08:00:00.000Z',
  bookmarked: true,
  difficulty: 'good',
  origin: 'manual',
  customDeck: 'IELTS',
  reviews: 3,
  interval: 8,
  easeFactor: 2.5,
  nextReviewDate: '2026-10-01T08:00:00.000Z',
  reviewHistory: [{ rating: 'good', reviewedAt: '2026-09-23T08:00:00.000Z', elapsedDays: 4, scheduledDays: 8 }],
};

test('deleting and undoing a device card preserves learning data after reload', async ({ page, db, testUser, seedCards, signIn, blockExternalNetwork }) => {
  // Undo calls the createCard Cloud Function; test:e2e:emulator now runs the
  // Functions emulator alongside Firestore/Auth (see firebase.json and
  // scripts/run-e2e-functions-emulator.mjs), so this exercises the real
  // callable instead of skipping it.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedCards([card]);
  await blockExternalNetwork(page);
  await page.addInitScript(() => { localStorage.setItem('lingoflash_theme', 'light'); });
  await signIn(page, '/?view=library&locale=en');
  const flashcard = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'resilient', exact: true }) });
  await expect(flashcard).toBeVisible();
  await flashcard.getByRole('button', { name: 'Delete card' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete card' }).click();
  await expect(flashcard).toHaveCount(0);
  const undo = page.locator('[data-undo-toast]');
  await expect(undo).toContainText('Card deleted.');
  await undo.getByRole('button', { name: /^Undo/ }).click();
  await expect(undo).toHaveCount(0);
  await expect(flashcard).toBeVisible();
  const { id: _cardId, ...expectedFields } = card;
  const cardDoc = db.collection('users').doc(testUser.uid).collection('cards').doc(card.id);
  // Firestore is the single source of truth post-migration; assert the
  // persisted document directly instead of the retired
  // lingoflash_cards_scoped_v1 localStorage mirror.
  await expect.poll(async () => (await cardDoc.get()).exists).toBe(true);
  expect((await cardDoc.get()).data()).toMatchObject(expectedFields);

  await page.reload();
  await expect(flashcard).toBeVisible();
  await expect(undo).toHaveCount(0);
  expect((await cardDoc.get()).exists).toBe(true);
  expect((await cardDoc.get()).data()).toMatchObject(expectedFields);
});

test('clearing the library dismisses an invalidated delete Undo', async ({ page, db, testUser, seedCards, seedCourseProfile, signIn, blockExternalNetwork }) => {
  // A returning learner: clearing the library must not reopen first-run onboarding.
  await seedCourseProfile();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedCards([card]);
  await blockExternalNetwork(page);
  await signIn(page, '/?view=library&locale=en');
  const flashcard = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'resilient', exact: true }) });
  await flashcard.getByRole('button', { name: 'Delete card' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete card' }).click();
  const undo = page.locator('[data-undo-toast]');
  await expect(undo).toBeVisible();
  await undo.hover();
  await page.getByRole('button', { name: 'Manage library' }).click();
  await page.getByRole('menuitem', { name: 'Clear the entire library' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete everything' }).click();
  await expect(undo).toHaveCount(0);
  await expect(flashcard).toHaveCount(0);
  await expect.poll(async () => {
    const snapshot = await db.collection('users').doc(testUser.uid).collection('cards').get();
    return snapshot.docs.map(doc => doc.id);
  }).toEqual([]);
});
