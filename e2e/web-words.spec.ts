import { expect, test } from './fixtures/firebase-emulator';

/**
 * Web words is a routed app view (`?view=web-words`) rendered by
 * `src/app/AppViewStage.tsx`. It is a sub-view of Vocabulary: the shell
 * highlights Vocabulary while it is open, and its back link returns to the
 * view that opened it (Vocabulary when opened from a link).
 */

const webCard = (overrides: Record<string, unknown>) => ({
  id: overrides.id as string,
  word: overrides.word as string,
  normalizedWord: (overrides.word as string).toLowerCase(),
  translation: overrides.translation as string,
  language: 'en',
  explanation: 'Seeded for the WebWords e2e spec.',
  phonetic: '',
  emoji: '📝',
  category: 'Other',
  partOfSpeech: 'noun',
  audioUrl: null,
  imageUrl: null,
  createdAt: (overrides.createdAt as string) ?? '2026-09-20T08:00:00.000Z',
  reviews: 0,
  ...overrides,
});

const readSessionPointer = (page: import('@playwright/test').Page, uid: string) =>
  page.evaluate(sessionKey => {
    const raw = sessionStorage.getItem(sessionKey);
    return raw ? (JSON.parse(raw) as { freshLogicalIds: string[]; stage: string }) : null;
  }, `sonflash:daily-session:${uid}`);

test.describe('WebWords page', () => {
  test('Today preview follows the active course when the learner switches language', async ({
    page, db, testUser, seedCards, signIn, blockExternalNetwork,
  }, testInfo) => {
    await db.collection('users').doc(testUser.uid).collection('profile').doc('courses').set({
      activeCourseId: 'course-en',
      courses: ['en', 'ko'].map(targetLanguage => ({
        id: `course-${targetLanguage}`, targetLanguage, nativeLanguage: 'vi', status: 'active', goals: [],
        preferences: { pronunciationVariant: null, showRomanization: false, zhScript: null },
        createdAt: '2026-09-24T00:00:00.000Z',
      })),
    });
    await seedCards([
      webCard({ id: 'web-en-one', word: 'luminous', translation: 'phát sáng', source: { url: 'https://example.com/en-one', title: 'English one', capturedAt: '2026-09-26T09:00:00.000Z' } }),
      webCard({ id: 'web-en-two', word: 'serene', translation: 'thanh bình', source: { url: 'https://example.com/en-two', title: 'English two', capturedAt: '2026-09-25T09:00:00.000Z' } }),
      webCard({ id: 'web-ko-one', word: '결심', translation: 'quyết tâm', language: 'ko', source: { url: 'https://example.com/ko-one', title: 'Korean one', capturedAt: '2026-09-24T09:00:00.000Z' } }),
    ]);
    await blockExternalNetwork(page);
    await signIn(page, '/?view=today&locale=en');
    const englishStrip = page.locator('[data-today-words]');
    await expect(englishStrip).toContainText('2 saved words');
    await expect(englishStrip).toContainText('luminous');
    const englishImage = testInfo.outputPath('today-web-words-english.png');
    await englishStrip.screenshot({ path: englishImage, animations: 'disabled' });
    await testInfo.attach('English WebWords preview', { path: englishImage, contentType: 'image/png' });

    await page.locator('.claude-course-switcher-trigger').click();
    await page.getByRole('dialog', { name: 'Courses' }).getByRole('button', { name: /Korean.*Vietnamese/ }).click();
    await expect(page.locator('.claude-course-switcher-trigger')).toHaveText(/Korean/);
    const koreanStrip = page.locator('[data-today-words]');
    await expect(koreanStrip).toContainText('1 saved word');
    await expect(koreanStrip).toContainText('결심');
    await expect(koreanStrip).not.toContainText('luminous');
    const koreanImage = testInfo.outputPath('today-web-words-korean.png');
    await koreanStrip.screenshot({ path: koreanImage, animations: 'disabled' });
    await testInfo.attach('Korean WebWords preview', { path: koreanImage, contentType: 'image/png' });

    // A stale match completion from the English course must not intercept Start in Korean.
    await page.evaluate(ownerId => {
      sessionStorage.setItem(`sonflash:daily-session:${ownerId}`, JSON.stringify({
        ownerId, targetLanguage: 'en', translationLanguage: 'vi', stage: 'match',
        reviewLogicalIds: [], freshLogicalIds: [], matchCardIds: [], matchSkipReason: null,
        matchCompletionPending: true,
        stats: { goodCount: 0, againCount: 0, weakCardIds: [], matchXp: 0 },
        startedAt: new Date().toISOString(),
      }));
    }, testUser.uid);
    await page.getByRole('button', { name: "Start today's session" }).click();
    await expect(page).toHaveURL(/[?&]lesson=session(?:&|$)/);
    await expect.poll(() => page.evaluate(ownerId => {
      const raw = sessionStorage.getItem(`sonflash:daily-session:${ownerId}`);
      return raw ? (JSON.parse(raw) as { targetLanguage: string }).targetLanguage : null;
    }, testUser.uid)).toBe('ko');
  });

  test('groups a saved web word by its article and adds it to a not-yet-started session\'s new stage', async ({
    page, seedCards, signIn, blockExternalNetwork,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await seedCards([
      webCard({
        id: 'word-ephemeral', word: 'ephemeral', translation: 'thoáng qua', createdAt: '2026-09-26T09:00:00.000Z',
        source: { url: 'https://example.com/reading/piece-one', title: 'A piece worth reading', capturedAt: '2026-09-26T09:00:00.000Z' },
      }),
      webCard({
        id: 'word-plain', word: 'plain', translation: 'đơn giản', createdAt: '2026-09-10T09:00:00.000Z',
      }),
      // exerciseEngine.ts's getEligibleExerciseModes only makes 'recognition'
      // eligible once the pool has 4 distinct translations (the card's own
      // plus 3 distractors) — otherwise buildExercise falls back to
      // 'active-recall', whose prompt is the translation, not the word, so
      // "ephemeral" would never render as visible text below. These two
      // fillers exist only to reach that threshold.
      webCard({
        id: 'word-gentle', word: 'gentle', translation: 'dịu dàng', createdAt: '2026-09-09T09:00:00.000Z',
      }),
      webCard({
        id: 'word-brave', word: 'brave', translation: 'can đảm', createdAt: '2026-09-08T09:00:00.000Z',
      }),
    ]);
    await blockExternalNetwork(page);
    await page.addInitScript(() => { localStorage.setItem('lingoflash_theme', 'light'); });
    await signIn(page, '/?view=today&locale=en');

    const strip = page.locator('[data-today-words]');
    await expect(strip).toContainText(/saved words? ·/);

    await strip.getByRole('button', { name: 'See all with their sentences' }).click();
    await expect(page).toHaveURL(/[?&]view=web-words(?:&|$)/);
    await expect(page).toHaveURL(/[?&]from=today(?:&|$)/);
    const workspace = page.getByRole('region', { name: 'Web words' });
    await expect(workspace).toBeVisible();
    await expect(page.locator('nav.app-navigation [aria-current="page"]')).toHaveText('Vocabulary');

    const group = workspace.getByText('A piece worth reading');
    await expect(group).toBeVisible();
    await workspace.getByRole('checkbox', { name: /ephemeral/i }).check();
    await workspace.getByRole('button', { name: 'Add to today' }).click();

    await expect(workspace.getByText(/are queued and get priority in your next new-word session/i)).toBeVisible();
    await workspace.getByRole('button', { name: 'Close web words' }).first().click();
    await expect(workspace).toBeHidden();
    await expect(page).toHaveURL(/[?&]view=today(?:&|$)/);

    // Browser back reopens web words, and forward returns to Today.
    await page.goBack();
    await expect(workspace).toBeVisible();
    await page.goForward();
    await expect(workspace).toBeHidden();

    await page.getByRole('button', { name: "Start today's session" }).click();
    await expect(page.getByText('ephemeral')).toBeVisible();
    // The word appears exactly once — adding it from WebWords never creates a second card.
    await expect(page.getByText('ephemeral', { exact: true })).toHaveCount(1);
  });

  test('admits a selected web word beyond the old fifteen-card cutoff and resumes it', async ({
    page, seedCards, signIn, blockExternalNetwork, testUser,
  }) => {
    const older = Array.from({ length: 15 }, (_, index) => webCard({
      id: `older-${index}`, word: `older-${index}`, translation: `meaning-${index}`,
      createdAt: `2026-09-${String(index + 1).padStart(2, '0')}T09:00:00.000Z`,
    }));
    await seedCards([...older, webCard({
      id: 'selected-latest', word: 'selected-latest', translation: 'selected meaning',
      createdAt: '2026-09-26T09:00:00.000Z',
      source: { url: 'https://example.com/last', title: 'Latest article', capturedAt: '2026-09-26T09:00:00.000Z' },
    })]);
    await blockExternalNetwork(page);
    await signIn(page, '/?view=today&locale=en');

    await page.locator('[data-today-words]').getByRole('button', { name: 'See all with their sentences' }).click();
    const workspace = page.getByRole('region', { name: 'Web words' });
    await workspace.getByRole('checkbox', { name: /selected-latest/i }).check();
    await workspace.getByRole('button', { name: 'Add to today' }).click();
    await workspace.getByRole('button', { name: 'Close web words' }).first().click();

    await page.getByRole('button', { name: "Start today's session" }).click();
    await expect(page.getByText('selected-latest', { exact: true })).toBeVisible();
    const expectedFreshLogicalIds = ['selected-latest', 'older-0', 'older-1', 'older-2', 'older-3'];
    await expect.poll(() => readSessionPointer(page, testUser.uid).then(pointer => pointer?.freshLogicalIds))
      .toEqual(expectedFreshLogicalIds);

    await page.reload();
    await expect(page.getByText('selected-latest', { exact: true })).toBeVisible();
    await expect.poll(() => readSessionPointer(page, testUser.uid).then(pointer => pointer?.freshLogicalIds))
      .toEqual(expectedFreshLogicalIds);
  });

  test('queues a word added during a started session without touching it, never duplicating it, and leads the next session with it', async ({
    page, seedCards, signIn, blockExternalNetwork, testUser,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await seedCards([
      webCard({
        id: 'word-already-fresh', word: 'already-fresh', translation: 'đã sẵn sàng', createdAt: '2026-09-25T09:00:00.000Z',
      }),
      webCard({
        id: 'word-lucid', word: 'lucid', translation: 'sáng suốt', createdAt: '2026-09-26T09:00:00.000Z',
        source: { url: 'https://example.com/reading/piece-two', title: 'Another piece', capturedAt: '2026-09-26T09:00:00.000Z' },
      }),
    ]);
    await blockExternalNetwork(page);
    await page.addInitScript(() => { localStorage.setItem('lingoflash_theme', 'light'); });
    await signIn(page, '/?view=today&locale=en');

    // Simulate a session already in progress at the 'new' stage, matching the shape
    // `dailySessionStages.ts` writes and `DailyLearningWorkspace.tsx` resumes.
    await page.evaluate(({ sessionKey, ownerId }) => {
      sessionStorage.setItem(sessionKey, JSON.stringify({
        ownerId, targetLanguage: 'en', translationLanguage: 'vi', stage: 'new',
        reviewLogicalIds: [], freshLogicalIds: ['already-fresh'], matchCardIds: [], matchSkipReason: null,
        stats: { goodCount: 0, againCount: 0, weakCardIds: [], matchXp: 0 },
        startedAt: new Date().toISOString(),
      }));
    }, { sessionKey: `sonflash:daily-session:${testUser.uid}`, ownerId: testUser.uid });
    // Older links layered `webWords=1` on another view; they now open the web words view in its
    // place, so the session is not mounted while the learner picks words.
    await page.goto('/?view=today&lesson=session&webWords=1&locale=en');
    const workspace = page.getByRole('region', { name: 'Web words' });
    await expect(workspace.getByRole('heading', { level: 1, name: 'Words you met on the web' })).toBeVisible();
    await workspace.getByRole('checkbox', { name: /lucid/i }).check();
    await workspace.getByRole('button', { name: 'Add to today' }).click();
    await expect(workspace.getByText(/are queued and get priority in your next new-word session/i)).toBeVisible();

    const pendingKey = `sonflash:pending-fresh-priority:${testUser.uid}:en:vi`;
    const readPending = () => page.evaluate(key => JSON.parse(sessionStorage.getItem(key) ?? '[]') as string[], pendingKey);
    expect((await readSessionPointer(page, testUser.uid))?.freshLogicalIds).toEqual(['already-fresh']);
    expect(await readPending()).toEqual(['lucid']);

    // Adding the same word again must not duplicate its queue entry.
    await workspace.getByRole('checkbox', { name: /lucid/i }).check();
    await workspace.getByRole('button', { name: 'Add to today' }).click();
    expect(await readPending()).toEqual(['lucid']);
    await page.keyboard.press('Escape');
    await expect(workspace).toBeHidden();
    await expect(page).toHaveURL(/[?&]view=today(?:&|$)/);
    await expect(page).not.toHaveURL(/webWords=|lesson=/);

    // The next session leads its new-word stage with the queued word, once.
    await page.getByRole('button', { name: "Start today's session" }).click();
    await expect.poll(() => readSessionPointer(page, testUser.uid).then(pointer => pointer?.freshLogicalIds))
      .toEqual(['lucid', 'already-fresh']);
  });

  test('opens from a link as a sub-view of Vocabulary', async ({ page, seedCards, signIn, blockExternalNetwork }) => {
    await seedCards([webCard({
      id: 'linked-word', word: 'linked', translation: 'được liên kết',
      source: { url: 'https://example.com/linked', title: 'Linked article', capturedAt: '2026-09-26T09:00:00.000Z' },
    })]);
    await blockExternalNetwork(page);
    await signIn(page, '/?view=web-words&locale=en');

    const workspace = page.getByRole('region', { name: 'Web words' });
    await expect(workspace.getByText('Linked article')).toBeVisible();
    const back = workspace.getByRole('button', { name: /Vocabulary/ });
    await expect(back).toBeVisible();
    await back.click();
    await expect(workspace).toBeHidden();
    await expect(page).toHaveURL(/[?&]view=library(?:&|$)/);
  });
});
