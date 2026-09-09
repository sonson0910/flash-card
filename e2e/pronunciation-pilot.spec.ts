import { expect, test } from '@playwright/test';

test('pronunciation video is opt-in, replayable and removable without blocking practice', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).SpeechRecognition = class {
      onstart?: () => void;
      start() { (window as any).__lastRecognition = this; this.onstart?.(); }
      stop() {}
    };
    localStorage.setItem('lingoflash_cards', JSON.stringify(['water', 'work', 'world', 'can'].map((word, index) => ({
      id: `video-${index}`, word, normalizedWord: word, translation: 'test meaning', explanation: 'Test explanation.',
      category: 'Test', phonetic: '', emoji: '', audioUrl: null, imageUrl: null,
      reviews: 1, difficulty: 'hard', nextReviewDate: '2020-01-01T00:00:00.000Z',
      exampleSentence: `Say ${word} again.`,
    }))));
    localStorage.removeItem('lingoflash_cards_owner');
  });
  // Verify integration without depending on third-party availability or transferring video.
  await page.route('https://www.youtube-nocookie.com/**', route => route.fulfill({ contentType: 'text/html', body: '<p>Player fixture</p>' }));
  await page.goto('/?view=today');
  await page.getByRole('button', { name: 'More practice' }).click();
  await page.getByRole('button', { name: /Shadowing Arena/ }).click();
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
  await expect(page.getByText('Target word', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start reading' }).click();
  await page.getByRole('button', { name: 'Next word' }).click();
  await page.evaluate(() => {
    const result = Object.assign([{ transcript: 'stale previous recording', confidence: 1 }], { isFinal: true });
    (window as any).__lastRecognition.onresult({ results: [result] });
  });
  await expect(page.getByText('stale previous recording', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: 'Start reading' }).click();
  await page.evaluate(() => (window as any).__lastRecognition.onerror({ error: 'not-allowed' }));
  await expect(page.getByText('Microphone unavailable.', { exact: false })).toBeVisible();
  await expect(page.getByText('Sentence match:', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Next word' })).toBeEnabled();
});

test('context video uses the reviewed interval, captions and exact speech target', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lingoflash_cards', JSON.stringify([{
      id: 'context-work', word: 'work', normalizedWord: 'work', translation: 'test meaning', explanation: 'Example.',
      category: 'Test', phonetic: '', emoji: '', audioUrl: null, imageUrl: null, reviews: 1,
      difficulty: 'hard', nextReviewDate: '2020-01-01T00:00:00.000Z', exampleSentence: 'A different card sentence.',
    }]));
    localStorage.removeItem('lingoflash_cards_owner');
  });
  await page.route('https://voa-video.voanews.eu/**', async route => {
    const response = await route.fetch({ url: 'http://127.0.0.1:4173/media/listen-mvp/break-the-news.m4a' });
    await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } });
  });
  await page.goto('/?view=today');
  await page.getByRole('button', { name: 'More practice' }).click();
  await page.getByRole('button', { name: /Shadowing Arena/ }).click();
  await expect(page.locator('video')).toHaveCount(0);
  await page.getByRole('button', { name: 'Practice clip sentence' }).click();
  await expect(page.getByText('Clip sentence', { exact: true })).toBeVisible();
  await expect(page.getByText('A different card sentence.')).toHaveCount(0);
  await page.getByRole('button', { name: 'Load context clip' }).click();
  const video = page.locator('video[aria-label="Context video: work"]');
  await page.getByRole('button', { name: 'Replay context clip' }).click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime)).toBeGreaterThanOrEqual(14);
  await expect(video.locator('track')).toHaveAttribute('kind', 'captions');
  await video.evaluate((element: HTMLVideoElement) => { element.playbackRate = 4; });
  await page.getByRole('button', { name: 'Replay context clip' }).click();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.paused && element.currentTime >= 20)).toBe(true);
  await page.getByRole('button', { name: 'Close context clip' }).click();
  await expect(video).toHaveCount(0);
});
