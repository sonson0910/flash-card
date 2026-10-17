import { expect, test } from './fixtures/firebase-emulator';

const vietnamDay = (instant: Date) => {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
};

test('reminder settings state the unavailable delivery channels for a signed-in learner', async ({ page, seedCourseProfile, signIn, blockExternalNetwork }) => {
  await seedCourseProfile();
  await blockExternalNetwork(page);
  await signIn(page, '/?view=settings&locale=en');

  const reminders = page.getByRole('region', { name: 'Study reminders' });
  await expect(reminders.getByLabel('Send at')).toBeVisible();
  await expect(reminders.getByRole('switch', { name: /Browser push/ })).toBeDisabled();
  await expect(reminders.getByText(/Push needs a supported browser and configured web push key\.|Browser notifications are blocked\. Allow them in your browser settings to turn on push\./)).toBeVisible();
  await expect(reminders.getByRole('switch', { name: /Sunday email recap/ })).toBeDisabled();
  await expect(reminders.getByText('Weekly email delivery is not available yet. You can turn off an existing recap, but new recaps cannot be enabled.')).toBeVisible();
  await expect(reminders.getByText('The browser extension badge shows due cards separately; it is read only.')).toBeVisible();
});

test('a signed-in owner can return from the AI creator and sees the tutor allowance limit before Gemini', async ({ page, db, testUser, seedCards, seedCourseProfile, signIn, blockExternalNetwork }) => {
  await seedCourseProfile();
  await seedCards([{
    id: 'focus-card', word: 'focus', translation: 'tập trung', language: 'en', translationLanguage: 'vi',
    createdAt: '2026-09-24T00:00:00.000Z', difficulty: 'good', revision: 1,
  }]);
  // Seed both sides of a local-day boundary at the maximum allowed quota.
  // The callable checks this owner-scoped state before model access.
  const now = Date.now();
  for (const offset of [-1, 0, 1]) {
    const day = vietnamDay(new Date(now + offset * 86_400_000));
    await db.collection('users').doc(testUser.uid).collection('ai_daily').doc(day).set({
      day, nonCardActions: 10_000,
    });
  }
  await blockExternalNetwork(page);
  await signIn(page, '/?view=library&locale=en');

  const createCard = page.locator('[data-library-create-action]');
  await createCard.click();
  const creator = page.getByRole('dialog', { name: 'Add a word' });
  await expect(creator.getByRole('textbox', { name: 'Word or phrase' })).toBeFocused();
  await creator.getByRole('textbox', { name: 'Word or phrase' }).fill('focus');
  await expect(creator.getByRole('button', { name: 'Generate preview' })).toBeEnabled();
  await creator.getByRole('button', { name: 'Close' }).click();
  await expect(creator).toBeHidden();
  await expect(createCard).toBeFocused();

  const openCard = page.getByRole('button', { name: 'Open card' });
  await openCard.click();
  const card = page.getByRole('group', { name: /focus flashcard/i });
  await card.getByRole('button', { name: /reveal.*meaning/i }).click();
  const askTutor = card.getByRole('button', { name: 'Ask AI Tutor' });
  await askTutor.click();
  const tutor = page.getByRole('dialog', { name: /AI Tutor.*focus/i });
  await tutor.getByRole('button', { name: /3 Work examples/ }).click();
  await expect(tutor.getByText('AI Tutor limit reached. Try again when your daily allowance resets.')).toBeVisible({ timeout: 15_000 });
  await tutor.getByRole('button', { name: 'Close AI tutor' }).click();
  await expect(tutor).toBeHidden();
  await expect(askTutor).toBeFocused();

  await page.locator('.library-card-detail-close').click();
  await expect(openCard).toBeFocused();
});
