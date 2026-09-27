import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures/firebase-emulator';
import type { Locator, Page } from '@playwright/test';

const cardPhoto = readFileSync('docs/design/sonflash-redesign/canvas/assets/blob/ed058680c239cce56bb63500ca7dd0e4.jpg');

const card = {
  id: 'flashcard-visual-acceptance',
  word: 'luminous',
  normalizedWord: 'luminous',
  translation: 'phát sáng',
  explanation: 'Giving off light.',
  explanationTranslation: 'Tỏa ra ánh sáng.',
  phonetic: '/ˈluːmɪnəs/',
  emoji: '✨',
  category: 'Science',
  partOfSpeech: 'adjective',
  audioUrl: null,
  imageUrl: 'https://images.pexels.com/photos/123/luminous.jpg',
  createdAt: '2026-09-24T00:00:00.000Z',
  bookmarked: false,
  difficulty: 'unrated',
  origin: 'ai',
  customDeck: null,
  exampleSentence: 'The luminous dial remained visible at night.',
  exampleTranslation: 'Mặt số phát sáng vẫn nhìn thấy được vào ban đêm.',
};

const themes = [
  { family: 'classic', mode: 'light' },
  { family: 'classic', mode: 'dark' },
  { family: 'crystal', mode: 'light' },
  { family: 'crystal', mode: 'dark' },
] as const;

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

async function expectNoBlockingViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .include('.flashcard-shell')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const blocking = results.violations
    .filter(violation => violation.impact === 'serious' || violation.impact === 'critical')
    .map(violation => ({
      id: violation.id,
      impact: violation.impact,
      nodes: violation.nodes.map(node => ({ target: node.target, failureSummary: node.failureSummary })),
    }));

  expect.soft(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  expect.soft(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

async function expectReadableZenGlass(panel: Locator) {
  await expect.poll(async () => Number.parseFloat(await panel.evaluate(element => getComputedStyle(element).opacity))).toBe(1);
  const styles = await panel.evaluate(element => {
    const computed = getComputedStyle(element);
    return {
      backgroundColor: computed.backgroundColor,
      color: computed.color,
      opacity: computed.opacity,
    };
  });
  const background = styles.backgroundColor.match(/[\d.]+/g)?.map(Number) ?? [];
  const foreground = styles.color.match(/[\d.]+/g)?.map(Number) ?? [];

  expect(styles.opacity).toBe('1');
  expect(background.length, styles.backgroundColor).toBeGreaterThanOrEqual(3);
  expect(background.slice(0, 3).every(channel => channel <= 40), styles.backgroundColor).toBe(true);
  expect(background[3] ?? 1, styles.backgroundColor).toBeGreaterThanOrEqual(0.9);
  expect(foreground.length, styles.color).toBeGreaterThanOrEqual(3);
  expect(foreground.slice(0, 3).every(channel => channel >= 240), styles.color).toBe(true);
}

async function expectNoMetadataControlOverlap(shell: Locator, metadata: Locator[]) {
  const controls = await shell.locator('button').evaluateAll(buttons => buttons
    .filter(button => !button.closest('.flashcard-panel'))
    .filter(button => {
      const style = getComputedStyle(button);
      return style.display !== 'none' && style.visibility !== 'hidden' && Number.parseFloat(style.opacity) > 0.01;
    })
    .map(button => ({
      name: button.getAttribute('aria-label') || button.getAttribute('title') || button.textContent?.trim() || 'unnamed control',
      rect: (() => {
        const { x, y, width, height } = button.getBoundingClientRect();
        return { x, y, width, height };
      })(),
    })));

  for (const element of metadata) {
    const metadataBox = await element.boundingBox();
    expect(metadataBox).not.toBeNull();
    const overlaps = controls.filter(({ rect }) => metadataBox
      && metadataBox.x < rect.x + rect.width
      && metadataBox.x + metadataBox.width > rect.x
      && metadataBox.y < rect.y + rect.height
      && metadataBox.y + metadataBox.height > rect.y);
    expect(overlaps.map(({ name }) => name)).toEqual([]);
  }
}

test.beforeEach(async ({ page, seedCards }) => {
  await page.route(card.imageUrl, route => route.fulfill({ body: cardPhoto, contentType: 'image/jpeg' }));
  await seedCards([card]);
});

for (const theme of themes) {
  for (const viewport of viewports) {
    test(`${theme.family} ${theme.mode} card front and back pass visual acceptance at ${viewport.name}`, async ({ page, signIn }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.addInitScript(({ family, mode }) => {
        localStorage.setItem('sonflash_theme_family', family);
        localStorage.setItem('lingoflash_theme', mode);
      }, theme);
      await signIn(page, '/?view=library&locale=en');
      // The full <Flashcard> (role="group") only renders inside the "Open
      // card" detail dialog now — LibraryCardGrid.tsx's grid rows are a
      // compact summary with their own "Open card" button (see
      // flashcard-locale.spec.ts for the same pattern).
      await page.locator('.library-word-open').click();

      const root = page.locator('html');
      const shell = page.getByRole('group', { name: /luminous flashcard/i });
      await expect(root).toHaveAttribute('data-theme-family', theme.family);
      if (theme.mode === 'dark') await expect(root).toHaveClass(/\bdark\b/);
      else await expect(root).not.toHaveClass(/\bdark\b/);

      await expect(shell).toHaveAttribute('data-card-side', 'front');
      await expect(shell.locator('.flashcard-face')).toBeVisible();
      const frontScreenshot = testInfo.outputPath(`${theme.family}-${theme.mode}-${viewport.name}-front.png`);
      await shell.screenshot({ path: frontScreenshot });
      await testInfo.attach(`${theme.family}-${theme.mode}-${viewport.name}-front`, {
        path: frontScreenshot,
        contentType: 'image/png',
      });
      await expectNoBlockingViolations(page);

      await shell.getByRole('button', { name: /Reveal the Vietnamese meaning of luminous/ }).click();
      await expect(shell).toHaveAttribute('data-card-side', 'back');
      await expect(shell.locator('.flashcard-back')).toBeVisible();
      const backScreenshot = testInfo.outputPath(`${theme.family}-${theme.mode}-${viewport.name}-back.png`);
      await shell.screenshot({ path: backScreenshot });
      await testInfo.attach(`${theme.family}-${theme.mode}-${viewport.name}-back`, {
        path: backScreenshot,
        contentType: 'image/png',
      });
      await expectNoBlockingViolations(page);
    });
  }
}

for (const theme of themes) {
  for (const viewport of viewports) {
    test(`${theme.family} ${theme.mode} Zen card keeps both faces opaque and readable at ${viewport.name}`, async ({ page, signIn }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.addInitScript(({ family, mode }) => {
        localStorage.setItem('sonflash_theme_family', family);
        localStorage.setItem('lingoflash_theme', mode);
        localStorage.setItem('sonflash_zen_glass_mode', 'true');
      }, theme);
      await signIn(page, '/?view=library&locale=en');
      // See the first loop above: the full flashcard only renders inside
      // the detail dialog.
      await page.locator('.library-word-open').click();

      const root = page.locator('html');
      const shell = page.getByRole('group', { name: /luminous flashcard/i });
      const front = shell.locator('.flashcard-face.zen-glass-slab');
      await expect(root).toHaveAttribute('data-theme-family', theme.family);
      if (theme.mode === 'dark') await expect(root).toHaveClass(/\bdark\b/);
      else await expect(root).not.toHaveClass(/\bdark\b/);

      await expect(front).toBeVisible();
      await expectReadableZenGlass(front);
      await expectNoMetadataControlOverlap(shell, [front.locator('[data-card-tier-label]')]);
      const frontScreenshot = testInfo.outputPath(`${theme.family}-${theme.mode}-${viewport.name}-zen-front.png`);
      await shell.screenshot({ path: frontScreenshot });
      await testInfo.attach(`${theme.family}-${theme.mode}-${viewport.name}-zen-front`, {
        path: frontScreenshot,
        contentType: 'image/png',
      });
      await expectNoBlockingViolations(page);

      await shell.getByRole('button', { name: 'Reveal meaning' }).click();
      const back = shell.locator('.flashcard-back.zen-glass-slab');
      await expect(shell).toHaveAttribute('data-card-side', 'back');
      await expect(back).toBeVisible();
      await expectReadableZenGlass(back);
      await expectNoMetadataControlOverlap(shell, [
        back.getByText('Vietnamese', { exact: true }),
        back.locator('[data-card-tier-label]'),
      ]);
      const backScreenshot = testInfo.outputPath(`${theme.family}-${theme.mode}-${viewport.name}-zen-back.png`);
      await shell.screenshot({ path: backScreenshot });
      await testInfo.attach(`${theme.family}-${theme.mode}-${viewport.name}-zen-back`, {
        path: backScreenshot,
        contentType: 'image/png',
      });
      await expectNoBlockingViolations(page);
    });
  }
}

test('reduced motion changes the card face without spatial animation', async ({ page, signIn }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    localStorage.setItem('sonflash_theme_family', 'crystal');
    localStorage.setItem('lingoflash_theme', 'dark');
  });
  await signIn(page, '/?view=library&locale=en');
  // See the first loop above: the full flashcard only renders inside the
  // detail dialog.
  await page.locator('.library-word-open').click();

  const shell = page.getByRole('group', { name: /luminous flashcard/i });
  await expect(shell).toHaveAttribute('data-flip-animation', 'reduced');
  await shell.getByRole('button', { name: /Reveal the Vietnamese meaning of luminous/ }).click();
  await expect(shell).toHaveAttribute('data-card-side', 'back');
  await expect(shell.locator('.flashcard-back')).toHaveCSS('transform', 'none');
  const transitionDuration = await shell.locator('.flashcard-back').evaluate(element => parseFloat(getComputedStyle(element).transitionDuration));
  expect(transitionDuration).toBeLessThanOrEqual(0.001);
});
