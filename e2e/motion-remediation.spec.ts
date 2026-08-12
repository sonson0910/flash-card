import { expect, test } from '@playwright/test';

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

test.beforeEach(async ({ page }) => {
  await page.addInitScript(initialCards => {
    localStorage.setItem('lingoflash_cards', JSON.stringify(initialCards));
    localStorage.removeItem('lingoflash_cards_owner');
    localStorage.setItem('lingoflash_theme', 'light');
  }, cards);
});

test('motion tokens expose one compact timing language', async ({ page }) => {
  await page.goto('/');
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

test('ambient motion stays off on mobile and for reduced-motion users', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.ambient-orb').first()).toHaveCSS('display', 'none');

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(page.locator('.ambient-orb').first()).toHaveCSS('animation-name', 'none');
});

test('data saver disables ambient motion at desktop sizes', async ({ page }) => {
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
  await page.goto('/');

  await expect(page.locator('html')).toHaveAttribute('data-save-data', 'true');
  await expect(page.locator('.ambient-orb').first()).toHaveCSS('display', 'none');
});

test('dialog overlay and content use coordinated entrance animations', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?view=library');
  await page.getByRole('button', { name: 'Manage library' }).click();
  await page.getByRole('menuitem', { name: 'Clear the entire library' }).click();

  const overlay = page.locator('[data-motion-overlay]');
  const dialog = page.getByRole('alertdialog', { name: 'Clear the entire library?' });
  await expect(overlay).toBeVisible();
  await expect(dialog).toHaveAttribute('data-motion-dialog', 'true');
  await expect(overlay).toHaveCSS('animation-name', /motion-overlay-in/);
  await expect(dialog).toHaveAttribute('data-gsap-entrance', 'result');
});

test('utility hover physics stay restrained while reward remains expressive', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?view=library');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700);
  const star = page.getByRole('button', { name: 'Star this word' }).first();
  await star.evaluate(element => {
    const root = document.documentElement;
    root.dataset.rewardHoverMaxScale = '1';
    let maximumScale = 1;
    let motionStartedAt: number | null = null;
    const startedAt = performance.now();
    const sampleScale = () => {
      const transform = getComputedStyle(element).transform;
      if (transform !== 'none') {
        const matrix = new DOMMatrixReadOnly(transform);
        maximumScale = Math.max(maximumScale, Math.hypot(matrix.a, matrix.b));
      }
      const now = performance.now();
      if (maximumScale > 1.001 && motionStartedAt === null) motionStartedAt = now;
      const sampledCompleteMotion = motionStartedAt !== null && now - motionStartedAt >= 350;
      if (sampledCompleteMotion || now - startedAt >= 2_000) {
        root.dataset.rewardHoverMaxScale = String(maximumScale);
        return;
      }
      requestAnimationFrame(sampleScale);
    };
    requestAnimationFrame(sampleScale);
  });
  await star.hover();
  await expect.poll(
    () => page.locator('html').getAttribute('data-reward-hover-max-scale').then(Number),
    { timeout: 3_000 },
  ).toBeGreaterThan(1.02);

  const maximumScale = Number(await page.locator('html').getAttribute('data-reward-hover-max-scale'));
  expect(maximumScale).toBeLessThanOrEqual(1.07);
});

test('only the first six library cards are marked for the initial stagger', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?view=library');
  const introducedCards = page.locator('[data-library-intro-index]');

  await expect(introducedCards).toHaveCount(6);
  await expect(introducedCards.nth(0)).toHaveAttribute('data-library-intro-index', '0');
  await expect(introducedCards.nth(5)).toHaveAttribute('data-library-intro-index', '5');
});
