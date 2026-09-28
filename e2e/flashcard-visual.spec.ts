import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './fixtures/firebase-emulator';
import type { Locator, Page } from '@playwright/test';

const cardPhoto = readFileSync('docs/design/sonflash-redesign/canvas/assets/blob/ed058680c239cce56bb63500ca7dd0e4.jpg');
const fixtureAudioUrl = 'https://api.dictionaryapi.dev/media/pronunciations/en/luminous-us.mp3';

const card = {
  id: 'word-luminous',
  word: 'luminous',
  normalizedWord: 'luminous',
  translation: 'phát sáng',
  explanation: 'Giving off light.',
  explanationTranslation: 'Tỏa ra ánh sáng.',
  phonetic: '/ˈluːmɪnəs/',
  emoji: '✨',
  category: 'Science',
  partOfSpeech: 'adjective',
  audioUrl: fixtureAudioUrl,
  imageUrl: 'https://images.pexels.com/photos/123/luminous.jpg',
  createdAt: '2026-09-24T00:00:00.000Z',
  bookmarked: false,
  difficulty: 'unrated',
  origin: 'ai',
  customDeck: null,
  schemaVersion: 2,
  revision: 1,
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

const cardTiers = [
  { name: 'learning', difficulty: 'good', label: 'Bloom' },
  { name: 'mastered', difficulty: 'easy', label: 'Star' },
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

test.beforeEach(async ({ page, seedCards, blockExternalNetwork }) => {
  await blockExternalNetwork(page);
  await page.route(url => url.origin === 'https://images.pexels.com' && url.pathname === '/photos/123/luminous.jpg',
    route => route.fulfill({ body: cardPhoto, contentType: 'image/jpeg' }));
  await seedCards([card]);
});

async function expectCardPhotoReady(shell: Locator) {
  const image = shell.locator('.flashcard-face img');
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
}

for (const theme of themes) {
  for (const viewport of viewports) {
    test(`${theme.family} ${theme.mode} card front and back pass visual acceptance at ${viewport.name}`, async ({ page, signIn }) => {
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
      await expect(shell.locator('[data-card-tier-label]')).toHaveText('Bud');
      await expect(shell.locator('.flashcard-face')).toBeVisible();
      await expectCardPhotoReady(shell);
      await expect(shell).toHaveScreenshot(`flashcard-${theme.family}-${theme.mode}-${viewport.name}-front.png`, {
        animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01,
      });
      await expectNoBlockingViolations(page);

      const moreTools = shell.locator('summary[aria-label="More card tools"]');
      await moreTools.click();
      await expect(shell).toHaveAttribute('data-card-side', 'front');
      await expect(shell.getByRole('button', { name: 'Read aloud' })).toBeVisible();
      await moreTools.click();

      await shell.getByRole('button', { name: /Reveal the Vietnamese meaning of luminous/ }).click();
      await expect(shell).toHaveAttribute('data-card-side', 'back');
      await expect(shell.locator('.flashcard-back')).toBeVisible();
      await expect(shell.getByText('adjective', { exact: true })).toBeVisible();
      await expect(shell.getByText('/ˈluːmɪnəs/', { exact: true })).toBeVisible();
      await expect(shell.getByText('The luminous dial remained visible at night.', { exact: true })).toBeVisible();
      await expect(shell.getByText('Mặt số phát sáng vẫn nhìn thấy được vào ban đêm.', { exact: true })).toBeVisible();
      await expect(shell.getByRole('button', { name: 'Memory hook' })).toBeVisible();
      await expect(shell.getByRole('button', { name: 'Ask AI Tutor' })).toBeVisible();
      await expect(shell).toHaveScreenshot(`flashcard-${theme.family}-${theme.mode}-${viewport.name}-back.png`, {
        animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01,
      });
      await expectNoBlockingViolations(page);
    });
  }
}

for (const tier of cardTiers) {
  for (const theme of themes) {
    for (const viewport of viewports) {
      test(`${theme.family} ${theme.mode} ${tier.name} card front matches Canvas at ${viewport.name}`, async ({ page, seedCards, signIn }) => {
        await seedCards([{ ...card, difficulty: tier.difficulty, nextReviewDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() }]);
        await page.setViewportSize(viewport);
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.addInitScript(({ family, mode }) => {
          localStorage.setItem('sonflash_theme_family', family);
          localStorage.setItem('lingoflash_theme', mode);
        }, theme);
        await signIn(page, '/?view=library&locale=en');
        await page.locator('.library-word-open').click();

        const shell = page.getByRole('group', { name: /luminous flashcard/i });
        await expect(shell).toHaveAttribute('data-card-side', 'front');
        await expect(shell).toHaveAttribute('data-card-tier', tier.name);
        await expect(shell.locator('[data-card-tier-label]')).toHaveText(tier.label);
        await expect(shell.getByText('New card', { exact: true })).toHaveCount(0);
        await expectCardPhotoReady(shell);
        await expect(shell).toHaveScreenshot(`flashcard-${theme.family}-${theme.mode}-${viewport.name}-${tier.name}-front.png`, {
          animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01,
        });
      });
    }
  }
}

const canvasCardStates = ['new-hover-spotlight', 'learning-back', 'mastered-hover', 'starred-back'] as const;

for (const state of canvasCardStates) {
  for (const theme of themes) {
    for (const viewport of viewports) {
      test(`${theme.family} ${theme.mode} ${state} card matches Canvas at ${viewport.name}`, async ({ page, seedCards, signIn }) => {
        const futureReview = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        const stateCard = state === 'learning-back'
          ? { ...card, difficulty: 'good', nextReviewDate: futureReview }
          : state === 'mastered-hover'
            ? { ...card, difficulty: 'easy', nextReviewDate: futureReview }
            : state === 'starred-back'
              ? { ...card, bookmarked: true }
              : card;
        await seedCards([stateCard]);
        await page.setViewportSize(viewport);
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.addInitScript(({ family, mode }) => {
          localStorage.setItem('sonflash_theme_family', family);
          localStorage.setItem('lingoflash_theme', mode);
        }, theme);
        await signIn(page, '/?view=library&locale=en');
        await page.locator('.library-word-open').click();

        const shell = page.getByRole('group', { name: /luminous flashcard/i });
        await expectCardPhotoReady(shell);

        if (state === 'new-hover-spotlight') {
          const spotlight = shell.locator('[data-card-effect="spotlight"]');
          await expect(shell).toHaveAttribute('data-card-tier', 'new');
          await expect(shell).toHaveAttribute('data-card-side', 'front');
          await expect(shell.getByText('New card', { exact: true })).toBeVisible();
          const box = await shell.boundingBox();
          if (!box) throw new Error('Flashcard shell is not measurable');
          await page.mouse.move(box.x + box.width * 0.28, box.y + box.height * 0.3);
          await expect(shell).toHaveAttribute('data-card-hovered', 'true');
          await expect(spotlight).toHaveCSS('opacity', '1');
          await expect.poll(() => spotlight.evaluate(element => element.style.getPropertyValue('--spotlight-x'))).not.toBe('');
          await expect.poll(() => spotlight.evaluate(element => element.style.getPropertyValue('--spotlight-y'))).not.toBe('');
        } else if (state === 'learning-back') {
          await expect(shell).toHaveAttribute('data-card-tier', 'learning');
          await shell.getByRole('button', { name: /Reveal the Vietnamese meaning of luminous/ }).click();
          await expect(shell).toHaveAttribute('data-card-side', 'back');
          await expect(shell.locator('.flashcard-back')).toBeVisible();
        } else if (state === 'mastered-hover') {
          await expect(shell).toHaveAttribute('data-card-tier', 'mastered');
          const box = await shell.boundingBox();
          if (!box) throw new Error('Flashcard shell is not measurable');
          await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.2);
          await expect(shell).toHaveAttribute('data-card-hovered', 'true');
          await expect(shell.locator('[data-card-effect="hover-wings"]')).toHaveAttribute('data-card-effect-tier', 'mastered');
          await expect(shell.locator('[data-card-effect="holo"]')).toHaveCSS('opacity', theme.family === 'crystal' ? '0.55' : '0.35');
          await expect(shell.locator('[data-card-effect="specular"]')).toHaveCSS('opacity', '0.92');
        } else {
          const star = shell.locator('[data-card-effect="star-pop"]');
          await expect(shell).toHaveAttribute('data-card-tier', 'new');
          await expect(star).toHaveAttribute('aria-pressed', 'true');
          await shell.getByRole('button', { name: /Reveal the Vietnamese meaning of luminous/ }).click();
          await expect(shell).toHaveAttribute('data-card-side', 'back');
          await expect(star).toHaveAttribute('aria-pressed', 'true');
          await expect(shell.locator('.flashcard-star-selected')).toBeVisible();
        }

        await expect(shell).toHaveScreenshot(`flashcard-${theme.family}-${theme.mode}-${viewport.name}-${state}.png`, {
          animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01,
        });
      });
    }
  }
}

for (const theme of themes) {
  for (const viewport of viewports) {
    test(`${theme.family} ${theme.mode} Zen card keeps both faces opaque and readable at ${viewport.name}`, async ({ page, signIn }) => {
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
      await expect(shell).toHaveScreenshot(`flashcard-${theme.family}-${theme.mode}-${viewport.name}-zen-front.png`, {
        animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01,
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
      await expect(shell).toHaveScreenshot(`flashcard-${theme.family}-${theme.mode}-${viewport.name}-zen-back.png`, {
        animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01,
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
  await expect(shell).toHaveScreenshot('flashcard-crystal-dark-mobile-reduced-motion-back.png', {
    animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01,
  });
});

for (const theme of themes) {
  for (const viewport of viewports) {
    test(`${theme.family} ${theme.mode} card captures Canvas interaction states at ${viewport.name}`, async ({ page, seedCards, signIn }, testInfo) => {
      const audioBody = Buffer.alloc(44 + 16_000);
      audioBody.write('RIFF', 0);
      audioBody.writeUInt32LE(audioBody.length - 8, 4);
      audioBody.write('WAVEfmt ', 8);
      audioBody.writeUInt32LE(16, 16);
      audioBody.writeUInt16LE(1, 20);
      audioBody.writeUInt16LE(1, 22);
      audioBody.writeUInt32LE(8_000, 24);
      audioBody.writeUInt32LE(16_000, 28);
      audioBody.writeUInt16LE(2, 32);
      audioBody.writeUInt16LE(16, 34);
      audioBody.write('data', 36);
      audioBody.writeUInt32LE(16_000, 40);
      await page.route(fixtureAudioUrl, route => route.fulfill({ body: audioBody, contentType: 'audio/wav' }));
      await seedCards([{
        ...card,
        difficulty: 'good',
        nextReviewDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      }]);
      await page.setViewportSize(viewport);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.addInitScript(({ family, mode }) => {
        localStorage.setItem('sonflash_theme_family', family);
        localStorage.setItem('lingoflash_theme', mode);
        HTMLMediaElement.prototype.play = () => Promise.resolve();
        HTMLMediaElement.prototype.pause = () => undefined;
      }, theme);
      await signIn(page, '/?view=library&locale=en');
      await page.locator('.library-word-open').click();

      const shell = page.getByRole('group', { name: /luminous flashcard/i });
      const captureState = async (name: string) => {
        const screenshot = testInfo.outputPath(name);
        await shell.screenshot({ path: screenshot, animations: 'disabled', caret: 'hide' });
        await testInfo.attach(name, { path: screenshot, contentType: 'image/png' });
        await expect(shell).toHaveScreenshot(name, { animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.01 });
      };
      const face = shell.locator('.flashcard-face');
      const spotlight = shell.locator('[data-card-effect="spotlight"]');
      await expect(shell).toHaveAttribute('data-card-tier', 'learning');
      await expect(face).toBeVisible();
      await expectCardPhotoReady(shell);

      const box = await shell.boundingBox();
      if (!box) throw new Error('Flashcard shell is not measurable');
      await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.2);
      await expect(shell).toHaveAttribute('data-card-hovered', 'true');
      await expect(spotlight).toHaveCSS('opacity', '1');
      await expect.poll(() => spotlight.evaluate(element => element.style.getPropertyValue('--spotlight-x'))).not.toBe('');
      await captureState(`flashcard-${theme.family}-${theme.mode}-${viewport.name}-hover-spotlight.png`);

      const star = shell.locator('[data-card-effect="star-pop"]');
      await expect(star).toHaveAccessibleName('Star this word');
      await star.click();
      await expect(star).toHaveAttribute('aria-pressed', 'true');
      await expect(shell.locator('.flashcard-star-selected')).toBeVisible();
      await captureState(`flashcard-${theme.family}-${theme.mode}-${viewport.name}-starred.png`);

      const blind = shell.getByRole('button', { name: 'Hide image and definition' });
      await blind.click();
      await expect(shell.getByRole('button', { name: 'Reveal image and definition' })).toHaveAttribute('aria-pressed', 'true');
      await expect(shell).toHaveAttribute('data-card-blind', 'true');
      await expect(shell.locator('[data-card-effect="blind-image"]')).toHaveAttribute('aria-hidden', 'true');
      await captureState(`flashcard-${theme.family}-${theme.mode}-${viewport.name}-blind.png`);

      const audio = shell.getByRole('button', { name: 'Play pronunciation' });
      await audio.click();
      await expect(shell).toHaveAttribute('data-card-side', 'front');
      await expect(shell).toHaveAttribute('data-card-tier', 'learning');
      await expect(audio.locator('.wave-bar-1')).toBeVisible();
      await expect(audio.locator('.wave-bar-1')).toHaveCSS('animation-name', 'audio-wave-bounce');
      await captureState(`flashcard-${theme.family}-${theme.mode}-${viewport.name}-learning-front-blind-starred-playing.png`);
      await expectNoBlockingViolations(page);
    });
  }
}
