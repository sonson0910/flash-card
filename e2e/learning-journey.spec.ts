import { expect, test } from './fixtures/firebase-emulator';

const cards = [
  'analyse', 'benefit', 'context', 'develop', 'evidence', 'focus',
  'generate', 'hypothesis', 'identify', 'justify', 'knowledge', 'language',
].map((word, index) => ({
  id: `word-${word}`, schemaVersion: 2, revision: 1,
  word,
  normalizedWord: word,
  translation: `nghĩa ${index + 1}`,
  explanation: `Reviewed explanation for ${word}.`,
  phonetic: '',
  emoji: '📚',
  category: 'Learning journey',
  audioUrl: null,
  imageUrl: null,
  createdAt: new Date(2026, 8, 6, 10, index).toISOString(),
  bookmarked: false,
  difficulty: 'unrated',
  customDeck: null,
}));

test.beforeEach(async ({ page, seedCards, seedCourseProfile, blockExternalNetwork, signIn }) => {
  await blockExternalNetwork(page);
  await seedCourseProfile();
  await seedCards(cards);
  await signIn(page, '/?view=today&locale=en');
});

test('exposes the published listening pilot in the built learner journey', async ({ page }) => {

  await expect(page.getByRole('heading', { level: 1, name: 'Today', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Learn → Immerse → Communicate' })).toBeVisible();
  const listening = page.getByRole('button', { name: 'Immerse: start listening practice' });
  await expect(listening).toBeVisible();
  await expect(listening).toBeEnabled();
  await listening.click();

  await expect(page).toHaveURL(/lesson=listening/);
  await expect(page.getByRole('heading', { level: 1, name: 'Immerse · Listen' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'break the news' })).toBeVisible();
  await expect(page.locator('audio[aria-label="Listen to break the news"]')).toHaveAttribute(
    'src',
    /media\/listen-mvp\/break-the-news\.m4a$/,
  );
  await expect(page.locator('[aria-label="Source and attribution"]')).toContainText('Voice of America Learning English');
  await expect(page.getByText('A listening lesson is not available yet.', { exact: true })).toHaveCount(0);
});

test('downloads the published listening pack and reuses cached audio offline', async ({ page }) => {

  await page.getByRole('button', { name: 'Immerse: start listening practice' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'break the news' })).toBeVisible();
  const supportsOfflineQuota = await page.evaluate(() => (
    typeof navigator.storage?.estimate === 'function'
  ));
  if (!supportsOfflineQuota) {
    await page.getByRole('button', { name: 'Download audio' }).click();
    await expect(page.locator('#published-listen-offline-status')).toHaveText(
      'Offline audio is unavailable in this browser.',
      { timeout: 15_000 },
    );
    await expect(page.getByRole('button', { name: 'Offline audio unavailable' })).toBeDisabled();
    return;
  }
  const manifestResponse = page.waitForResponse(response => (
    response.url().endsWith('/media/listen-mvp/offline-pack.json')
    && response.request().method() === 'GET'
    && response.status() === 200
  ));
  await page.getByRole('button', { name: 'Download audio' }).click();
  await manifestResponse;
  await expect(page.locator('#published-listen-offline-status')).toHaveText('Reviewed audio is available offline.');
  await expect(page.getByRole('button', { name: 'Audio available offline' })).toBeDisabled();

  await page.context().setOffline(true);
  await expect(page.locator('audio[aria-label="Listen to break the news"]')).toHaveAttribute('src', /^blob:/);
});

test('integrated listening save-to-conversation happy path uses the published pilot', async ({ page }) => {

  await page.getByRole('button', { name: 'Immerse: start listening practice' }).click();
  await expect(page.getByRole('heading', { level: 2, name: 'break the news' })).toBeVisible();
  await page.getByRole('button', { name: 'Tell someone bad or upsetting news' }).click();
  await expect(page.getByText('Correct — nice listening.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save phrase' })).toBeVisible();
  await page.getByRole('button', { name: 'Save phrase' }).click();
  await expect(page.getByRole('button', { name: 'Practise this phrase' })).toBeVisible();
});
