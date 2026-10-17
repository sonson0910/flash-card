import { expect, test } from './fixtures/firebase-emulator';

const dayAgo = (now: number, days: number) => new Date(now - days * 86_400_000).toISOString().slice(0, 10);
const chartDate = (day: string) => new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' })
  .format(new Date(`${day}T12:00:00`));

test('verified XP and rewards refresh on two signed-in devices without navigation or owner leakage', async ({
  page, browser, db, adminAuth, testUser, seedCourseProfile, signIn, blockExternalNetwork,
}) => {
  test.setTimeout(60_000);
  const profile = (ownerId: string, document: 'stats' | 'xp_history' | 'rewards') =>
    db.doc(`users/${ownerId}/profile/${document}`);
  const now = Date.now();
  const initialDay = dayAgo(now, 3);
  const refreshedDay = dayAgo(now, 2);
  const switchedOwnerDay = dayAgo(now, 1);
  await seedCourseProfile();

  const initial = db.batch();
  initial.set(profile(testUser.uid, 'stats'), { verifiedXp: 99, verifiedStreak: 2, rewardTimeZone: 'UTC' });
  initial.set(profile(testUser.uid, 'xp_history'), { verifiedByDayV1: { [initialDay]: 99 } });
  initial.set(profile(testUser.uid, 'rewards'), { ownedFrameIds: [], ownedTitleIds: [], equippedFrameId: null });
  await initial.commit();

  const secondOwnerId = `${testUser.uid}-switched-owner`;
  let peerContext: Awaited<ReturnType<typeof browser.newContext>> | null = null;
  let secondOwnerCreated = false;
  try {
    await adminAuth.createUser({ uid: secondOwnerId });
    secondOwnerCreated = true;
    peerContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' });
    const peerPage = await peerContext.newPage();
    await blockExternalNetwork(page);
    await blockExternalNetwork(peerPage);
    await Promise.all([
      signIn(page, '/?view=progress&locale=en'),
      signIn(peerPage, '/?view=progress&locale=en'),
    ]);

    const firstOwnerLevel = page.getByLabel('Level 1, 99 XP');
    const peerFirstOwnerLevel = peerPage.getByLabel('Level 1, 99 XP');
    await expect(firstOwnerLevel).toBeVisible();
    await expect(peerFirstOwnerLevel).toBeVisible();
    await expect(page.locator('[data-native-chart="xp"] [data-xp-hit-area] title')).toHaveText(`${chartDate(initialDay)}: 99 XP`);
    await expect(peerPage.locator('[data-native-chart="xp"] [data-xp-hit-area] title')).toHaveText(`${chartDate(initialDay)}: 99 XP`);

    const deviceAUrl = page.url();
    const peerUrl = peerPage.url();
    let deviceANavigations = 0;
    let peerNavigations = 0;
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) deviceANavigations += 1; });
    peerPage.on('framenavigated', frame => { if (frame === peerPage.mainFrame()) peerNavigations += 1; });

    // This is the emulator-admin equivalent of the protected review callable
    // committing its verified result; neither browser writes these documents.
    const reviewed = db.batch();
    reviewed.set(profile(testUser.uid, 'stats'), { verifiedXp: 100, verifiedStreak: 3, rewardTimeZone: 'UTC' });
    reviewed.set(profile(testUser.uid, 'xp_history'), { verifiedByDayV1: { [refreshedDay]: 100 } });
    reviewed.set(profile(testUser.uid, 'rewards'), {
      ownedFrameIds: ['crimson-wing'], ownedTitleIds: ['word-collector'], equippedFrameId: 'crimson-wing',
    });
    await reviewed.commit();

    await expect(page.getByLabel('Level 2, 100 XP')).toBeVisible();
    await expect(peerPage.getByLabel('Level 2, 100 XP')).toBeVisible();
    await expect(page.locator('[data-native-chart="xp"] [data-xp-hit-area] title')).toHaveText(`${chartDate(refreshedDay)}: 100 XP`);
    await expect(peerPage.locator('[data-native-chart="xp"] [data-xp-hit-area] title')).toHaveText(`${chartDate(refreshedDay)}: 100 XP`);
    await expect(page.locator('[data-equipped-frame="crimson-wing"]')).toBeVisible();
    await expect(peerPage.locator('[data-equipped-frame="crimson-wing"]')).toBeVisible();
    expect(page.url()).toBe(deviceAUrl);
    expect(peerPage.url()).toBe(peerUrl);
    expect(deviceANavigations).toBe(0);
    expect(peerNavigations).toBe(0);

    const switched = db.batch();
    switched.set(profile(secondOwnerId, 'stats'), { verifiedXp: 4, verifiedStreak: 1, rewardTimeZone: 'UTC' });
    switched.set(profile(secondOwnerId, 'xp_history'), { verifiedByDayV1: { [switchedOwnerDay]: 4 } });
    switched.set(profile(secondOwnerId, 'rewards'), { ownedFrameIds: [], ownedTitleIds: [], equippedFrameId: null });
    switched.set(db.doc(`users/${secondOwnerId}/profile/courses`), { courses: [], activeCourseId: null });
    await switched.commit();
    const secondOwnerToken = await adminAuth.createCustomToken(secondOwnerId);
    await page.evaluate(async token => {
      await window.__SONFLASH_TEST__!.signInWithCustomToken(token);
    }, secondOwnerToken);
    await page.waitForFunction(uid => window.__SONFLASH_TEST__?.getCurrentUid?.() === uid, secondOwnerId);

    await expect(page.getByLabel('Level 1, 4 XP')).toBeVisible();
    await expect(page.locator('[data-native-chart="xp"] [data-xp-hit-area] title')).toHaveText(`${chartDate(switchedOwnerDay)}: 4 XP`);
    await expect(page.getByLabel('Level 2, 100 XP')).toHaveCount(0);
    await expect(page.locator('[data-equipped-frame="crimson-wing"]')).toHaveCount(0);
    await expect(peerPage.getByLabel('Level 2, 100 XP')).toBeVisible();
    await expect(peerPage.locator('[data-native-chart="xp"] [data-xp-hit-area] title')).toHaveText(`${chartDate(refreshedDay)}: 100 XP`);
    await expect(peerPage.locator('[data-equipped-frame="crimson-wing"]')).toBeVisible();
    expect(await peerPage.evaluate(() => window.__SONFLASH_TEST__?.getCurrentUid?.())).toBe(testUser.uid);
  } finally {
    try {
      await peerContext?.close();
    } finally {
      try {
        await Promise.all([
          db.recursiveDelete(db.doc(`users/${testUser.uid}`)),
          db.recursiveDelete(db.doc(`users/${secondOwnerId}`)),
        ]);
      } finally {
        if (secondOwnerCreated) await adminAuth.deleteUser(secondOwnerId);
      }
    }
  }
});

test('active course and reading preference stay in sync across two signed-in devices', async ({
  page, browser, db, testUser, signIn, blockExternalNetwork,
}) => {
  test.setTimeout(60_000);
  let peerContext: Awaited<ReturnType<typeof browser.newContext>> | null = null;
  try {
    await db.doc(`users/${testUser.uid}/profile/courses`).set({
      activeCourseId: 'course-en',
      courses: [
        {
          id: 'course-en', targetLanguage: 'en', nativeLanguage: 'vi', status: 'active', goals: [],
          preferences: { pronunciationVariant: null, showRomanization: false, zhScript: null },
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'course-ko', targetLanguage: 'ko', nativeLanguage: 'vi', status: 'active', goals: [],
          preferences: { pronunciationVariant: null, showRomanization: false, zhScript: null },
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    peerContext = await browser.newContext({ baseURL: 'http://127.0.0.1:4173' });
    const peerPage = await peerContext.newPage();
    await blockExternalNetwork(page);
    await blockExternalNetwork(peerPage);
    await Promise.all([
      signIn(page, '/?view=settings&locale=en'),
      signIn(peerPage, '/?view=settings&locale=en'),
    ]);

    const activeCourse = (target: typeof page) => target.locator('[data-settings-active-course]');
    await expect(activeCourse(page)).toContainText('English ← Vietnamese');
    await expect(activeCourse(peerPage)).toContainText('English ← Vietnamese');
    await page.locator('.claude-course-switcher-trigger').click();
    await page.getByRole('dialog', { name: 'Courses' })
      .getByRole('button', { name: /Korean.*Vietnamese/ }).click();
    await expect(activeCourse(page)).toContainText('Korean ← Vietnamese');
    await expect(activeCourse(peerPage)).toContainText('Korean ← Vietnamese');

    const peerRomanization = peerPage.getByRole('switch', { name: 'Show romanization' });
    await peerRomanization.click();
    await expect(peerRomanization).toBeChecked();
    await expect(page.getByRole('switch', { name: 'Show romanization' })).toBeChecked();
    const saved = (await db.doc(`users/${testUser.uid}/profile/courses`).get()).data();
    expect(saved?.courses?.find((course: { id: string }) => course.id === 'course-ko')?.preferences?.showRomanization).toBe(true);
  } finally {
    try {
      await peerContext?.close();
    } finally {
      await db.recursiveDelete(db.doc(`users/${testUser.uid}`));
    }
  }
});
