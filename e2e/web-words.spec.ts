import { expect, test } from './fixtures/firebase-emulator';

/**
 * The WebWords page is mounted in `src/app/AppRuntime.tsx` via the lazy
 * `WebWordsRouteHost` (backed by `useWebWordsRoute()`'s `?webWords=1` query
 * param, `src/features/webWords/webWordsRoute.ts`), so `?webWords=1` renders
 * the workspace below normally.
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

    const strip = page.getByText(/word.*saved from the web/i);
    await expect(strip).toBeVisible();

    await page.getByRole('button', { name: 'Review web words' }).click();
    await expect(page).toHaveURL(/webWords=1/);
    const workspace = page.getByRole('region', { name: 'Web words' });
    await expect(workspace).toBeVisible();

    const group = workspace.getByText('A piece worth reading');
    await expect(group).toBeVisible();
    await workspace.getByRole('checkbox', { name: /ephemeral/i }).check();
    await workspace.getByRole('button', { name: 'Add to today' }).click();

    await expect(workspace.getByText(/these words will appear once you start today's session/i)).toBeVisible();
    await workspace.getByRole('button', { name: 'Close web words' }).first().click();
    await expect(workspace).toBeHidden();

    await page.getByRole('button', { name: "Start today's session" }).click();
    await expect(page.getByText('ephemeral')).toBeVisible();
    // The word appears exactly once — adding it from WebWords never creates a second card.
    await expect(page.getByText('ephemeral', { exact: true })).toHaveCount(1);
  });

  test('puts a newly added word at the front of an already-started session\'s new stage, never duplicating it', async ({
    page, seedCards, signIn, blockExternalNetwork, testUser,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await seedCards([
      webCard({
        id: 'word-lucid', word: 'lucid', translation: 'sáng suốt', createdAt: '2026-09-26T09:00:00.000Z',
        source: { url: 'https://example.com/reading/piece-two', title: 'Another piece', capturedAt: '2026-09-26T09:00:00.000Z' },
      }),
    ]);
    await blockExternalNetwork(page);
    await page.addInitScript(() => { localStorage.setItem('lingoflash_theme', 'light'); });
    await signIn(page, '/?view=today&locale=en');

    // Simulate a session already in progress at the 'new' stage, matching the shape
    // `dailySessionStages.ts` writes and `SessionBridge.tsx` reads.
    await page.evaluate(({ sessionKey, ownerId }) => {
      sessionStorage.setItem(sessionKey, JSON.stringify({
        ownerId, targetLanguage: '', stage: 'new',
        reviewLogicalIds: [], freshLogicalIds: ['already-fresh'], matchCardIds: [], matchSkipReason: null,
        stats: { goodCount: 0, againCount: 0, weakCardIds: [], matchXp: 0 },
        startedAt: new Date().toISOString(),
      }));
    }, { sessionKey: `sonflash:daily-session:${testUser.uid}`, ownerId: testUser.uid });

    await page.getByRole('button', { name: 'Review web words' }).click();
    const workspace = page.getByRole('region', { name: 'Web words' });
    await workspace.getByRole('checkbox', { name: /lucid/i }).check();
    await workspace.getByRole('button', { name: 'Add to today' }).click();
    await expect(workspace.getByText("Added to today's new words.")).toBeVisible();

    const pointer = await readSessionPointer(page, testUser.uid);
    expect(pointer?.freshLogicalIds).toHaveLength(2);
    expect(pointer?.freshLogicalIds[0]).not.toBe('already-fresh');
    expect(pointer?.freshLogicalIds[1]).toBe('already-fresh');

    // Adding the same word again must not duplicate its entry in the pointer.
    await workspace.getByRole('checkbox', { name: /lucid/i }).check();
    await workspace.getByRole('button', { name: 'Add to today' }).click();
    const pointerAfterRepeat = await readSessionPointer(page, testUser.uid);
    expect(pointerAfterRepeat?.freshLogicalIds).toHaveLength(2);
    await page.keyboard.press('Escape');
    await expect(workspace).toBeHidden();
  });
});
