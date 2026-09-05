import { expect, test, type Page } from '@playwright/test';
import { startOfflineReleaseFixture, type OfflineReleaseFixture } from './offline-release-fixture';

const card = {
  id: 'release-journey',
  word: 'reliable',
  normalizedWord: 'reliable',
  translation: 'đáng tin cậy',
  explanation: 'Consistently dependable.',
  phonetic: '',
  emoji: '🧭',
  category: 'Character',
  audioUrl: null,
  imageUrl: null,
  createdAt: '2026-07-20T03:00:00.000Z',
  bookmarked: false,
  difficulty: 'unrated',
  customDeck: null,
};

const pendingReview = JSON.stringify([{
  type: 'patch',
  operation: 'review',
  opId: 'pending-review-owner-a',
  cardId: card.id,
  fields: { difficulty: 'good', reviews: 1 },
  ownerUserId: 'owner-a',
}]);

const seedReleaseState = async (page: Page) => {
  await page.addInitScript(({ initialCard, initialPending }) => {
    localStorage.setItem('lingoflash_cards', JSON.stringify([initialCard]));
    localStorage.removeItem('lingoflash_cards_owner');
    localStorage.removeItem('lingoflash_cards_scoped_v1');
    localStorage.setItem('lingoflash_pending_writes_owner-a', initialPending);
    localStorage.removeItem('lingoflash_pending_writes_owner-b');
  }, { initialCard: card, initialPending: pendingReview });
};

const closeFixture = async (fixture: OfflineReleaseFixture | undefined) => {
  if (fixture) await fixture.close();
};

const shellState = async (page: Page) => page.evaluate(async () => {
  const names = await caches.keys();
  const unrelated = await caches.open('sonflash-learner-cache-v1');
  const media = await caches.open('sonflash-media-cache-v1');
  return {
    shells: names.filter(name => name.startsWith('sonflash-app-shell-v1-')),
    learner: Boolean(await unrelated.match('/keep')),
    media: Boolean(await media.match('/keep')),
  };
});

const shellPrefix = 'sonflash-app-shell-v1-';

const waitForWaitingWorker = async (page: Page) => {
  await expect.poll(() => page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration('/');
    return Boolean(registration?.waiting);
  }), { timeout: 30_000 }).toBe(true);
};

const updateWorker = async (page: Page) => {
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration('/');
    if (!registration) throw new Error('Expected a registered offline worker.');
    await registration.update();
  });
  await waitForWaitingWorker(page);
};

const activeShellFingerprint = async (page: Page) => page.evaluate(async (prefix) => {
  const names = (await caches.keys()).filter(name => name.startsWith(prefix));
  const marker = new Request(`${location.origin}/__sonflash_app_shell_active__`);
  for (const name of names) {
    const response = await (await caches.open(name)).match(marker);
    if (response && (await response.text()) === name) return name.slice(prefix.length);
  }
  return null;
}, shellPrefix);

test('a waiting release does not reload an active study tab, then close/reopen activates it and rollback redownloads', async ({ page }) => {
  const fixture = await startOfflineReleaseFixture();
  let tabB: Page | undefined;
  let reopened: Page | undefined;
  let rollback: Page | undefined;
  try {
    await seedReleaseState(page);
    await page.goto(`${fixture.origin}/?view=library`);
    await expect(page.getByRole('heading', { name: 'Your library' })).toBeVisible();
    await page.getByRole('button', { name: 'Prepare offline', exact: true }).click();
    await expect(page.getByText('Available offline.', { exact: true })).toBeVisible();
    await page.reload();
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

    await page.evaluate(async () => {
      const learner = await caches.open('sonflash-learner-cache-v1');
      const media = await caches.open('sonflash-media-cache-v1');
      await learner.put('/keep', new Response('learner-data'));
      await media.put('/keep', new Response('media-data'));
    });
    const releaseA = fixture.releaseFingerprint('A');
    const releaseB = fixture.releaseFingerprint('B');
    await expect.poll(() => activeShellFingerprint(page)).toBe(releaseA);

    await page.getByRole('button', { name: 'Today', exact: true }).first().click();
    const startLesson = page.getByRole('button', { name: /Learn:/ }).first();
    await expect(startLesson).toBeVisible();
    await startLesson.click();
    await expect(page.getByRole('heading', { name: 'Lesson', exact: true })).toBeVisible();

    tabB = await page.context().newPage();
    await tabB.goto(`${fixture.origin}/?view=library`);
    await expect(tabB.getByRole('heading', { name: 'Your library' })).toBeVisible();
    let activeStudyLoads = 0;
    page.on('load', () => { activeStudyLoads += 1; });

    fixture.setRelease('B');
    await updateWorker(tabB);
    await expect(tabB.getByRole('button', { name: 'Update available', exact: true })).toBeVisible();
    await expect(tabB.getByText('Update available. Reopen SonFlash after your study session.', { exact: true })).toBeVisible();
    expect(activeStudyLoads).toBe(0);
    await expect(page.getByRole('heading', { name: 'Lesson', exact: true })).toBeVisible();

    const waitingState = await shellState(tabB);
    expect(waitingState.shells).toHaveLength(2);
    expect(waitingState.shells).toContain(`${shellPrefix}${releaseA}`);
    expect(waitingState.shells).toContain(`${shellPrefix}${releaseB}`);

    await page.close();
    await tabB.close();
    tabB = undefined;

    reopened = await page.context().newPage();
    await reopened.goto(`${fixture.origin}/?view=library`);
    await expect(reopened.getByRole('heading', { name: 'Your library' })).toBeVisible();
    await expect(reopened.getByText('reliable', { exact: true }).first()).toBeVisible();
    await expect.poll(() => activeShellFingerprint(reopened!)).toBe(releaseB);
    const activatedState = await shellState(reopened);
    expect(activatedState.shells).toEqual([`${shellPrefix}${releaseB}`]);
    expect(activatedState.learner).toBe(true);
    expect(activatedState.media).toBe(true);
    expect(await reopened.evaluate(() => localStorage.getItem('lingoflash_pending_writes_owner-a'))).toBe(pendingReview);
    expect(await reopened.evaluate(() => localStorage.getItem('lingoflash_pending_writes_owner-b'))).toBeNull();

    const assetRequestsBeforeRollback = fixture.assetRequestCount();
    fixture.setRelease('A');
    rollback = await reopened.context().newPage();
    await rollback.goto(`${fixture.origin}/?view=library`);
    await updateWorker(rollback);
    await expect.poll(() => activeShellFingerprint(rollback!)).toBe(releaseB);
    const rollbackWaitingState = await shellState(rollback);
    expect(rollbackWaitingState.shells).toHaveLength(2);
    expect(rollbackWaitingState.shells).toContain(`${shellPrefix}${releaseB}`);
    expect(rollbackWaitingState.shells).toContain(`${shellPrefix}${releaseA}`);

    await reopened.close();
    await rollback.close();
    reopened = undefined;
    rollback = undefined;
    const afterRollback = await page.context().newPage();
    try {
      await afterRollback.goto(`${fixture.origin}/?view=library`);
      await expect(afterRollback.getByRole('heading', { name: 'Your library' })).toBeVisible();
      await expect.poll(() => activeShellFingerprint(afterRollback)).toBe(releaseA);
      const finalState = await shellState(afterRollback);
      expect(finalState.shells).toEqual([`${shellPrefix}${releaseA}`]);
      expect(finalState.learner).toBe(true);
      expect(finalState.media).toBe(true);
      expect(await afterRollback.evaluate(() => localStorage.getItem('lingoflash_pending_writes_owner-a'))).toBe(pendingReview);
      expect(await afterRollback.evaluate(() => localStorage.getItem('lingoflash_pending_writes_owner-b'))).toBeNull();
    } finally {
      await afterRollback.close();
    }
    expect(fixture.assetRequestCount()).toBeGreaterThan(assetRequestsBeforeRollback);
  } finally {
    await tabB?.close();
    await reopened?.close();
    await rollback?.close();
    await closeFixture(fixture);
  }
});
