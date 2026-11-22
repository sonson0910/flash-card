import { expect, test } from './fixtures/firebase-emulator';

test('partial Study summary distinguishes skipping from saved reviews', async ({ page, seedCards, seedCourseProfile, signIn, blockExternalNetwork, db, testUser }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await blockExternalNetwork(page);
  await seedCourseProfile();
  await seedCards(['water', 'work'].map(word => ({
      id: `word-${word}`, schemaVersion: 2, revision: 1, createdAt: '2026-09-01T00:00:00.000Z', word, normalizedWord: word, translation: word, explanation: 'Example.',
      category: 'Test', phonetic: '', emoji: '', audioUrl: null, imageUrl: null,
      reviews: 1, difficulty: 'hard', nextReviewDate: '2020-01-01T00:00:00.000Z',
    })));
  await signIn(page, '/?view=library&locale=en');
  await page.getByRole('button', { name: 'Study now' }).click();
  await expect(page.getByRole('progressbar', { name: 'Study progress' })).toHaveAttribute('aria-valuenow', '0');
  await page.getByRole('button', { name: 'Next card', exact: true }).click();
  await page.getByRole('button', { name: 'Summary', exact: true }).click();
  const summary = page.getByRole('dialog', { name: 'Session summary' });
  await expect(summary).toContainText('Skipped: 1');
  await expect(summary).toContainText('Not started: 1');
  await expect(summary).toContainText('0 / 2');
  expect((await db.collection('users').doc(testUser.uid).collection('cards').get()).docs.every(card => card.data().reviews === 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect.poll(() => summary.locator('[data-session-recap]').evaluate(element => getComputedStyle(element).opacity)).toBe('1');
  await testInfo.attach('partial-recap-mobile', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
  await summary.getByRole('button', { name: 'Close recap', exact: true }).last().click();
  await expect(summary).toHaveCount(0);
});

const shellThemes = [
  { family: 'classic', mode: 'light' }, { family: 'classic', mode: 'dark' },
  { family: 'crystal', mode: 'light' }, { family: 'crystal', mode: 'dark' },
] as const;
const shellViewports = [{ name: 'desktop', width: 1440, height: 900 }, { name: 'mobile', width: 390, height: 844 }] as const;

for (const theme of shellThemes) for (const viewport of shellViewports) {
  test(`${theme.family} ${theme.mode} review runs in its own shell at ${viewport.name}`, async ({ page, seedCards, seedCourseProfile, signIn, blockExternalNetwork }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.addInitScript(({ family, mode }) => {
      localStorage.setItem('sonflash_theme_family', family);
      localStorage.setItem('lingoflash_theme', mode);
      localStorage.setItem('sonflash_theme_follow_system', 'false');
    }, theme);
    await blockExternalNetwork(page);
    await seedCourseProfile();
    await seedCards(['water', 'work'].map(word => ({
      id: `word-${word}`, schemaVersion: 2, revision: 1, createdAt: '2026-09-01T00:00:00.000Z', word, normalizedWord: word, translation: word, explanation: 'Example.',
      category: 'Test', phonetic: '', emoji: '', audioUrl: null, imageUrl: null,
      reviews: 1, difficulty: 'hard', nextReviewDate: '2020-01-01T00:00:00.000Z',
    })));
    await signIn(page, '/?view=library&locale=en');
    await expect(page.locator('.claude-topbar')).toBeVisible();
    await page.getByRole('button', { name: 'Study now' }).click();

    const session = page.locator('[data-study-session]');
    await expect(session).toHaveAttribute('data-study-state', 'prompt');
    await expect(page.locator('.claude-topbar')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Close study mode' })).toBeVisible();
    await expect(page.locator('[data-study-count]')).toContainText('0 / 2');
    await expect(page.getByRole('progressbar', { name: 'Study progress' })).toHaveAttribute('aria-valuenow', '0');
    const hint = page.locator('[data-study-hint]');
    if (viewport.name === 'desktop') await expect(hint).toHaveText('Say it out loud first, then reveal Space');
    else await expect(hint).toBeHidden();
    const close = await page.getByRole('button', { name: 'Close study mode' }).boundingBox();
    expect(close && close.width >= 44 && close.height >= 44, 'close button is a 44px target').toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow').toBe(true);
    const name = `study-shell-${theme.family}-${theme.mode}-${viewport.name}`;
    const promptShot = testInfo.outputPath(`${name}-prompt.png`);
    await page.screenshot({ path: promptShot });
    await testInfo.attach(`${name}-prompt`, { path: promptShot, contentType: 'image/png' });

    await session.focus();
    await page.keyboard.press('Space');
    await expect(session).toHaveAttribute('data-study-state', 'revealed');
    await expect(hint).toHaveCount(0);
    const answerShot = testInfo.outputPath(`${name}-answer.png`);
    await page.screenshot({ path: answerShot });
    await testInfo.attach(`${name}-answer`, { path: answerShot, contentType: 'image/png' });

    await page.getByRole('button', { name: 'Close study mode' }).click();
    await expect(session).toHaveCount(0);
    await expect(page.locator('.claude-topbar')).toBeVisible();
  });
}
