import { expect, test } from './fixtures/firebase-emulator';

test('pronunciation video is opt-in, replayable and removable without blocking practice', async ({ page, seedCards, seedCourseProfile, signIn, blockExternalNetwork }) => {
  await page.addInitScript(() => {
    (window as any).SpeechRecognition = class {
      onstart?: () => void;
      start() { (window as any).__lastRecognition = this; this.onstart?.(); }
      stop() {}
    };
  });
  await blockExternalNetwork(page);
  await seedCourseProfile();
  await seedCards(['water', 'work', 'world', 'can'].map(word => ({
      id: `word-${word}`, schemaVersion: 2, revision: 1, createdAt: '2026-09-01T00:00:00.000Z', word, normalizedWord: word, translation: 'test meaning', explanation: 'Test explanation.',
      category: 'Test', phonetic: '', emoji: '', audioUrl: null, imageUrl: null,
      reviews: 1, difficulty: 'hard', nextReviewDate: '2020-01-01T00:00:00.000Z',
      exampleSentence: `Say ${word} again.`,
    })));
  // Verify integration without depending on third-party availability or transferring video.
  await page.route('https://www.youtube-nocookie.com/**', route => route.fulfill({ contentType: 'text/html', body: '<p>Player fixture</p>' }));
  await signIn(page, '/?view=today&locale=en');
  await page.getByRole('button', { name: 'More practice' }).click();
  await page.getByRole('button', { name: /^Shadowing / }).click();
  await expect(page.getByRole('button', { name: 'Load pronunciation video' })).toBeVisible();
  await expect(page.locator('iframe[title^="Pronunciation lesson:"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Load pronunciation video' }).click();
  const player = page.locator('iframe[title^="Pronunciation lesson:"]');
  await expect(player).toHaveAttribute('src', /autoplay=0/);
  await expect(player).toHaveAttribute('src', /end=\d+/);
  await expect(page.getByRole('link', { name: 'Open on YouTube' })).toBeVisible();
  await page.getByRole('button', { name: 'Replay lesson' }).click();
  await expect(player).toHaveCount(1);
  await page.getByRole('button', { name: 'Close video', exact: true }).click();
  await expect(player).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start reading' })).toBeEnabled();
  await page.getByRole('button', { name: 'Practice target word', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Practice target word', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { level: 2, name: /^(water|work|world|can)$/, exact: true })).toHaveText(/^(water|work|world|can)$/);
  await page.getByRole('button', { name: 'Start reading' }).click();
  await page.getByRole('button', { name: 'Next word' }).click();
  await page.evaluate(() => {
    const result = Object.assign([{ transcript: 'stale previous recording', confidence: 1 }], { isFinal: true });
    (window as any).__lastRecognition.onresult({ results: [result] });
  });
  await expect(page.getByText('stale previous recording', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: 'Start reading' }).click();
  await page.evaluate(() => (window as any).__lastRecognition.onerror({ error: 'not-allowed' }));
  await expect(page.getByText('Speech recognition error: not-allowed', { exact: true })).toBeVisible();
  await expect(page.getByText('Sentence match:', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Next word' })).toBeEnabled();
});

test('context video uses the reviewed interval, captions and exact speech target', async ({ page, seedCards, seedCourseProfile, signIn, blockExternalNetwork }) => {
  await blockExternalNetwork(page);
  await seedCourseProfile();
  await seedCards([{
      id: 'word-work', schemaVersion: 2, revision: 1, createdAt: '2026-09-01T00:00:00.000Z', word: 'work', normalizedWord: 'work', translation: 'test meaning', explanation: 'Example.',
      category: 'Test', phonetic: '', emoji: '', audioUrl: null, imageUrl: null, reviews: 1,
      difficulty: 'hard', nextReviewDate: '2020-01-01T00:00:00.000Z', exampleSentence: 'A different card sentence.',
    }]);
  await page.route('https://voa-video.voanews.eu/**', async route => {
    // Firefox includes the external Host header; forwarding it makes Vite reject the fixture with 403.
    const response = await route.fetch({
      url: 'http://127.0.0.1:4173/media/listen-mvp/break-the-news.m4a',
      headers: { ...route.request().headers(), host: '127.0.0.1:4173' },
    });
    expect(response.ok()).toBe(true);
    await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } });
  });
  await signIn(page, '/?view=today&locale=en');
  await page.getByRole('button', { name: 'More practice' }).click();
  await page.getByRole('button', { name: /^Shadowing / }).click();
  await expect(page.locator('video')).toHaveCount(0);
  await page.getByRole('button', { name: 'Practice clip sentence' }).click();
  await expect(page.getByRole('button', { name: 'Practice clip sentence' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { level: 2, name: 'So, are you all ready for our big work trip to Brazil?', exact: true })).toHaveText('So, are you all ready for our big work trip to Brazil?');
  await expect(page.getByText('A different card sentence.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Load context clip' }).click();
  const video = page.locator('video[aria-label="Context video: work"]');
  // Headless Linux has no audio output device; keep real decoding/playback without opening an audio sink.
  await video.evaluate((element: HTMLVideoElement) => { element.muted = true; });
  await page.getByRole('button', { name: 'Replay context clip' }).click();
  await expect(video).toHaveAttribute('src', /#t=15\.6,21\.6$/);
  // A seek alone sets currentTime; wait for actual playback before replaying.
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThan(15.6);
  await expect(video.locator('track')).toHaveAttribute('kind', 'captions');
  await video.evaluate((element: HTMLVideoElement) => { element.playbackRate = 4; });
  await page.getByRole('button', { name: 'Replay context clip' }).click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused && element.currentTime >= 21.6)).toBe(true);
  await page.getByRole('button', { name: 'Close context clip' }).click();
  await expect(video).toHaveCount(0);
});
