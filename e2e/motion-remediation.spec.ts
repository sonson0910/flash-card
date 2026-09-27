import { expect, test } from './fixtures/firebase-emulator';

const cards = [
  'resemblance', 'serendipity', 'eloquent', 'resilient',
  'curiosity', 'harmony', 'meticulous', 'insight',
].map((word, index) => ({
  id: `motion-${index}`,
  word,
  normalizedWord: word,
  translation: `nghĩa ${index + 1}`,
  explanation: `A focused explanation for ${word}.`,
  explanationTranslation: `Giải thích tự nhiên cho ${word}.`,
  phonetic: `/${word}/`,
  emoji: '📚',
  category: index % 2 ? 'Conversation' : 'Writing',
  partOfSpeech: 'noun',
  audioUrl: null,
  imageUrl: null,
  createdAt: new Date(2026, 6, 15, 10, index).toISOString(),
  bookmarked: false,
  difficulty: 'unrated',
  customDeck: null,
}));

test.beforeEach(async ({ page, seedCards }) => {
  await page.addInitScript(() => { localStorage.setItem('lingoflash_theme', 'light'); });
  await seedCards(cards);
});

test('motion tokens expose one compact timing language', async ({ page, signIn }) => {
  await signIn(page, '/?view=today');
  const tokens = await page.evaluate(() => {
    const styles = getComputedStyle(document.documentElement);
    return Object.fromEntries([
      '--motion-fast', '--motion-standard', '--motion-emphasis', '--ease-out-expo',
    ].map(token => [token, styles.getPropertyValue(token).trim()]));
  });

  const toMilliseconds = (value: string) => value.endsWith('ms')
    ? Number.parseFloat(value)
    : Number.parseFloat(value) * 1000;
  const normalizeDecimals = (value: string) => value.replace(
    /(^|[\s,(])\.(\d)/g,
    (_match, prefix: string, digit: string) => `${prefix}0.${digit}`,
  );

  expect(toMilliseconds(tokens['--motion-fast'])).toBe(140);
  expect(toMilliseconds(tokens['--motion-standard'])).toBe(200);
  expect(toMilliseconds(tokens['--motion-emphasis'])).toBe(260);
  expect(normalizeDecimals(tokens['--ease-out-expo'])).toBe('cubic-bezier(0.16, 1, 0.3, 1)');
});

// `.ambient-orb`/`.ambient-orb-a/b/c` are orphaned CSS (index.css) with zero
// JSX renders anywhere in src/ and no @keyframes animation of their own —
// the live noise-texture layer is `.app-canvas::before` (index.css:109,
// rendered via the `.app-canvas` root div in AppRuntime.tsx), which shares
// every media query `.ambient-orb` used to share (max-width/hover/pointer,
// data-save-data). `::before` is a pseudo-element, not a real DOM node, so
// it can't go through `page.locator()` — read it with getComputedStyle.
async function ambientLayerStyle(page: import('@playwright/test').Page, property: 'animationName' | 'display') {
  return page.evaluate(prop => {
    const canvas = document.querySelector('.app-canvas');
    if (!canvas) return null;
    return getComputedStyle(canvas, '::before')[prop as 'animationName' | 'display'];
  }, property);
}

test('ambient glow stays static on mobile to avoid continuous blurred animation', async ({ page, signIn }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, '/?view=today');
  await expect.poll(() => ambientLayerStyle(page, 'display')).toBe('none');
});

test('data saver disables ambient motion at desktop sizes', async ({ page, signIn }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'connection', {
      configurable: true,
      value: {
        saveData: true,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      },
    });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, '/?view=today');

  await expect(page.locator('html')).toHaveAttribute('data-save-data', 'true');
  await expect.poll(() => ambientLayerStyle(page, 'display')).toBe('none');
});

test('dialog overlay and content use coordinated entrance animations', async ({ page, signIn }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, '/?view=library');
  await page.getByRole('button', { name: 'Manage library' }).click();
  await page.getByRole('menuitem', { name: 'Clear the entire library' }).click();

  const overlay = page.locator('[data-motion-overlay]');
  const dialog = page.getByRole('alertdialog', { name: 'Clear the entire library?' });
  await expect(overlay).toBeVisible();
  await expect(dialog).toHaveAttribute('data-motion-dialog', 'true');
  await expect(overlay).toHaveCSS('animation-name', /motion-overlay-in/);
  await expect(dialog).toHaveAttribute('data-gsap-entrance', 'result');
});

test('utility hover physics stay restrained while reward remains expressive', async ({ page, signIn }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, '/?view=library');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700);
  // The full <Flashcard> (role="group") only renders inside the "Open card"
  // detail dialog now — LibraryCardGrid.tsx's grid rows are a compact
  // summary with their own "Open card" button (see flashcard-effects.spec.ts
  // and flashcard-locale.spec.ts for the same pattern).
  await page.locator('[data-library-card-row][data-library-card-id="motion-7"]').getByRole('button', { name: 'Open card' }).click();
  const star = page
    .getByRole('group', { name: /insight flashcard/i })
    .getByRole('button', { name: 'Star this word' });
  await expect(star).toBeVisible();
  const hoveredScale = async () => {
    // Keep the locator anchored to one card. Cloud hydration can reorder the
    // grid while a busy WebKit runner is scrolling to the control.
    await star.hover({ force: true });
    return star.evaluate(element => {
      const transform = getComputedStyle(element).transform;
      if (transform === 'none') return 1;
      const matrix = new DOMMatrixReadOnly(transform);
      return Math.hypot(matrix.a, matrix.b);
    });
  };
  await expect.poll(hoveredScale, { timeout: 3_000 }).toBeGreaterThan(1.02);

  expect(await hoveredScale()).toBeLessThanOrEqual(1.07);
});

test('library rows render fully visible without an entrance stagger', async ({ page, signIn }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page, '/?view=library');
  // The row-based library dropped the card entrance stagger, so every seeded
  // row must be on screen at full opacity instead of waiting on an animation.
  const rows = page.locator('[data-library-card-row]');
  await expect(rows).toHaveCount(cards.length);
  await expect(page.locator('[data-library-intro-index]')).toHaveCount(0);
  const opacities = await rows.evaluateAll(elements => elements.map(element => getComputedStyle(element).opacity));
  expect(opacities).toEqual(cards.map(() => '1'));
});
