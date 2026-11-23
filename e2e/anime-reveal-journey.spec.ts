import { expect, test } from './fixtures/firebase-emulator';
import type { Firestore } from 'firebase-admin/firestore';
import type { Page } from '@playwright/test';

test.use({ timezoneId: 'UTC' });

const yesterdayUtc = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

const reviewCard = {
  id: 'word-reward',
  word: 'reward',
  normalizedWord: 'reward',
  translation: 'phần thưởng',
  explanation: 'Something received after an achievement.',
  phonetic: '',
  emoji: '🏆',
  category: 'Study',
  audioUrl: null,
  imageUrl: null,
  createdAt: '2026-09-01T00:00:00.000Z',
  difficulty: 'unrated',
  schemaVersion: 2,
  revision: 1,
};

async function seedThresholdReview(
  db: Firestore,
  uid: string,
) {
  await db.collection('users').doc(uid).collection('profile').doc('stats').set({
    rewardTimeZone: 'UTC',
    verifiedXp: 14_399,
    verifiedStreak: 29,
    lastVerifiedStudyDay: yesterdayUtc(),
  });
}

async function triggerThresholdReview(page: Page) {
  await page.getByRole('button', { name: 'Study now' }).click();
  const introduction = page.getByRole('region', { name: 'Meet this word' });
  await expect(introduction).toBeVisible();
  await introduction.getByRole('button', { name: 'I’ve reviewed it — start recall' }).click();
  await page.getByRole('button', { name: 'Reveal answer' }).click();
  const easy = page.getByRole('region', { name: 'Rate memory strength' }).getByRole('button', { name: /Easy/ });
  await easy.click();
  await expect(page.locator('.anime-reveal')).toHaveAttribute('data-event', 'tierup', { timeout: 15_000 });
}

async function expectFocusInsideRecap(page: Page) {
  const recap = page.getByRole('dialog', { name: 'Session complete' });
  await expect(recap).toBeVisible();
  await expect.poll(() => recap.evaluate(element => element.contains(document.activeElement))).toBe(true);
}

test('authoritative review queues tier, streak, then level rewards and a dismissed receipt stays closed', async ({
  page, db, testUser, seedCards, signIn, blockExternalNetwork,
}) => {
  await blockExternalNetwork(page);
  await seedCards([reviewCard]);
  await seedThresholdReview(db, testUser.uid);
  await signIn(page, '/?view=library');

  await triggerThresholdReview(page);
  await expect(page.locator('.anime-reveal__tier-card')).toContainText('New → Mastered');
  const profile = db.collection('users').doc(testUser.uid).collection('profile');
  // The 30-day milestone grants its XP, and freezes now live in the verified streak record.
  expect((await profile.doc('stats').get()).data()).toMatchObject({
    verifiedXp: 14_501, verifiedStreak: 30, streakV1: { freezes: 2 },
  });
  const rewards = (await profile.doc('rewards').get()).data();
  expect(rewards).not.toHaveProperty('streakFreezes');
  expect(rewards).toMatchObject({
    hintTokens: 1,
    ownedFrameIds: ['crimson-wing'],
    ownedTitleIds: ['word-collector'],
  });
  await page.getByRole('button', { name: 'Continue learning' }).click();
  await expect(page.locator('.anime-reveal')).toHaveAttribute('data-event', 'streak');
  await page.getByRole('button', { name: 'Keep going' }).click();
  await expect(page.locator('.anime-reveal')).toHaveAttribute('data-event', 'levelup');
  await expect(page.locator('.anime-reveal__level-art')).toHaveText('LV13');
  await expect(page.getByRole('dialog', { name: 'Level up: level 12 to 13' })).toBeVisible();
  await page.getByRole('button', { name: 'Later' }).click();
  await expect(page.locator('.anime-reveal')).toHaveCount(0);
  await expectFocusInsideRecap(page);

  await page.reload();
  await expect(page.locator('.anime-reveal')).toHaveCount(0);
});

test('level reward retries the real equip callable after an ownership error and focuses the recap on success', async ({
  page, db, testUser, seedCards, signIn, blockExternalNetwork,
}) => {
  await blockExternalNetwork(page);
  await seedCards([{ ...reviewCard, id: 'word-equip', word: 'equip', normalizedWord: 'equip' }]);
  await seedThresholdReview(db, testUser.uid);
  await signIn(page, '/?view=library');

  await triggerThresholdReview(page);
  await page.getByRole('button', { name: 'Continue learning' }).click();
  await expect(page.locator('.anime-reveal')).toHaveAttribute('data-event', 'streak');
  await page.getByRole('button', { name: 'Keep going' }).click();
  await expect(page.locator('.anime-reveal')).toHaveAttribute('data-event', 'levelup');

  const rewards = db.collection('users').doc(testUser.uid).collection('profile').doc('rewards');
  await rewards.delete();
  await page.getByRole('button', { name: 'Use frame' }).click();
  // On WebKit in the test runner the refused equip call takes longer than the default five seconds to come back.
  await expect(page.getByRole('alert')).toHaveText('Could not use this reward. Try again.', { timeout: 20_000 });

  await rewards.set({ ownedFrameIds: ['crimson-wing'] });
  await page.getByRole('button', { name: 'Use frame' }).click();
  await expect(page.locator('.anime-reveal')).toHaveCount(0);
  await expectFocusInsideRecap(page);
  const equipped = await rewards.get();
  expect(equipped.exists).toBe(true);
  expect(equipped.data()).toMatchObject({ equippedFrameId: 'crimson-wing' });
});

test('closing and escaping a queued ceremony focus the session recap', async ({
  page, db, testUser, seedCards, signIn, blockExternalNetwork,
}) => {
  await blockExternalNetwork(page);
  await seedCards([{ ...reviewCard, id: 'word-close', word: 'close', normalizedWord: 'close' }]);
  await seedThresholdReview(db, testUser.uid);
  await signIn(page, '/?view=library');

  await triggerThresholdReview(page);
  await page.getByRole('button', { name: 'Close reward' }).click();
  await expect(page.locator('.anime-reveal')).toHaveAttribute('data-event', 'streak');
  await page.keyboard.press('Escape');
  await expect(page.locator('.anime-reveal')).toHaveAttribute('data-event', 'levelup');
  await page.getByRole('button', { name: 'Later' }).click();
  await expectFocusInsideRecap(page);
});
