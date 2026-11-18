import { expect, test } from './fixtures/firebase-emulator';

const themes = [
  { family: 'classic', mode: 'light' },
  { family: 'classic', mode: 'dark' },
  { family: 'crystal', mode: 'light' },
  { family: 'crystal', mode: 'dark' },
] as const;

const viewports = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
];

for (const theme of themes) for (const viewport of viewports) {
  test(`${theme.family} ${theme.mode} daily canvas keeps its composition and actions at ${viewport.width}px`, async ({ page, seedCards, signIn, blockExternalNetwork }, testInfo) => {
    await blockExternalNetwork(page);
    await seedCards(['analyse', 'benefit', 'context', 'develop', 'evidence', 'focus'].map((word, index) => ({
      id: `canvas-layout-${index}`, word, normalizedWord: word,
      translation: `nghĩa ${index + 1}`, explanation: `Meaning of ${word}.`,
      emoji: '📚', category: 'IELTS', cefrLevel: index < 3 ? 'A2' : 'B2',
      createdAt: `2026-08-01T10:0${index}:00.000Z`, difficulty: 'unrated',
      language: 'en', source: { url: `https://example.com/${word}`, title: word, capturedAt: '2026-08-01T10:00:00.000Z' },
    })));
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(({ family, mode }) => {
      localStorage.setItem('sonflash_theme_family', family);
      localStorage.setItem('lingoflash_theme', mode);
      localStorage.setItem('sonflash_theme_follow_system', 'false');
      localStorage.setItem('sonflash_lumi_enabled', 'true');
    }, theme);
    await signIn(page, '/?view=today&locale=en');
    const start = page.locator('[data-primary-learning-action]');
    await expect(start).toBeEnabled();
    await expect(page.locator('.today-stage-rail > li')).toHaveCount(4);
    await expect(page.locator('.today-ready-web-words > aside')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    const stages = await page.locator('.today-stage-rail > li').evaluateAll(elements => elements.map(element => {
      const box = element.getBoundingClientRect();
      return { x: box.x, y: box.y };
    }));
    expect(Math.max(...stages.map(stage => stage.y)) - Math.min(...stages.map(stage => stage.y))).toBeLessThanOrEqual(1);
    expect(stages[3].x).toBeGreaterThan(stages[0].x);
    if (theme.family === 'crystal') {
      const lumi = page.locator('[data-today-lumi] img');
      await expect(lumi).toBeVisible();
      await expect.poll(() => lumi.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      expect(await lumi.evaluate(image => getComputedStyle(image).objectFit)).toBe('contain');
    }
    if (viewport.width < 640) {
      const action = await start.boundingBox();
      const dock = await page.locator('.claude-mobile-nav').boundingBox();
      expect(action && dock && action.y + action.height <= dock.y).toBe(true);
    }
    await page.screenshot({ path: testInfo.outputPath('today.png'), fullPage: true, animations: 'disabled' });

    await page.goto('/?view=today&lesson=placement&locale=en');
    await page.getByRole('button', { name: 'Start placement check' }).click();
    const progress = page.getByRole('progressbar', { name: 'Placement progress' });
    await expect(progress).toHaveAttribute('aria-valuenow', '1');
    await expect(page.locator('.placement-header')).toContainText('Placement check');
    expect(await page.locator('.placement-question-card').evaluate(element => ({ background: getComputedStyle(element).backgroundColor, clip: getComputedStyle(element).clipPath, shadow: getComputedStyle(element).boxShadow }))).toEqual({ background: 'rgba(0, 0, 0, 0)', clip: 'none', shadow: 'none' });
    expect(await page.locator('.placement-header').evaluate(element => element.getBoundingClientRect().height)).toBeLessThan(160);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page.locator('.placement-submit')).toBeDisabled();
    await page.locator('.placement-choice').first().click();
    await expect(page.locator('.placement-choice').first()).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.placement-submit')).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath('placement.png'), fullPage: true, animations: 'disabled' });
    await page.locator('.placement-submit').click();
    await expect(progress).toHaveAttribute('aria-valuenow', '2');
    await page.getByRole('button', { name: 'Exit placement check' }).click();
    await expect(start).toBeVisible();
  });
}

for (const family of ['classic', 'crystal'] as const) {
  test(`${family} Vietnamese daily and placement copy fits a narrow phone`, async ({ page, seedCards, signIn, blockExternalNetwork }, testInfo) => {
    await blockExternalNetwork(page);
    await seedCards(['analyse', 'benefit', 'context', 'develop', 'evidence', 'focus'].map((word, index) => ({
      id: `vietnamese-layout-${index}`, word, normalizedWord: word,
      translation: `nghĩa riêng ${index + 1}`, explanation: `Meaning of ${word}.`,
      emoji: '📚', category: 'IELTS', cefrLevel: 'A2', difficulty: 'unrated',
      createdAt: '2026-08-01T10:00:00.000Z', language: 'en',
    })));
    await page.setViewportSize({ width: 375, height: 812 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(family => {
      localStorage.setItem('sonflash_theme_family', family);
      localStorage.setItem('lingoflash_theme', 'light');
      localStorage.setItem('sonflash_theme_follow_system', 'false');
    }, family);
    await signIn(page, '/?view=today&locale=vi');
    await expect(page.locator('[data-primary-learning-action]')).toBeEnabled();
    await expect(page.locator('.today-stage-rail > li')).toHaveCount(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath('today-vi.png'), fullPage: true, animations: 'disabled' });
    await page.goto('/?view=today&lesson=placement&locale=vi');
    await page.getByRole('button', { name: 'Bắt đầu kiểm tra xếp trình độ' }).click();
    await expect(page.getByRole('heading', { name: 'Tìm trình độ khởi đầu của bạn.' })).toBeVisible();
    await expect(page.getByRole('progressbar', { name: 'Tiến độ kiểm tra đầu vào' })).toHaveAttribute('aria-valuenow', '1');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({ path: testInfo.outputPath('placement-vi.png'), fullPage: true, animations: 'disabled' });
  });
}
