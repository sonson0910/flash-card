import { expect, test } from './fixtures/firebase-emulator';
import type { Page } from '@playwright/test';

const card = {
  id: 'mobile-review-card', word: 'resilience', normalizedWord: 'resilience',
  translation: 'khả năng phục hồi', explanation: 'The ability to recover.',
  explanationTranslation: 'Khả năng phục hồi sau khó khăn. '.repeat(80),
  phonetic: '/rɪˈzɪliəns/', emoji: '📚', category: 'Reading',
  audioUrl: null, imageUrl: null, origin: 'ai',
  createdAt: '2026-09-24T00:00:00.000Z', bookmarked: false,
  difficulty: 'unrated', customDeck: null, reviews: 0,
};

type SeedCards = (cards: readonly (typeof card)[]) => Promise<void>;
type SignIn = (page: Page, url: string) => Promise<void>;

async function openReview(page: Page, seedCards: SeedCards, signIn: SignIn, zen = false) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(zen => {
    localStorage.setItem('lingoflash_theme', 'light');
    if (zen) localStorage.setItem('sonflash_zen_glass_mode', 'true');
    else localStorage.removeItem('sonflash_zen_glass_mode');
  }, zen);
  await seedCards([card]);
  await signIn(page, '/?view=library');
  await page.getByRole('button', { name: /Start a review|Review \d+ due/ }).first().click();
}

async function touchPath(page: Page, selector: string, dx: number, dy: number) {
  await page.locator(selector).evaluate((element, { dx, dy }) => {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const send = (type: string, clientX: number, clientY: number, ended = false) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: ended ? [] : [{ clientX, clientY }] });
      element.dispatchEvent(event);
    };
    send('touchstart', x, y);
    send('touchmove', x + dx, y + dy);
    send('touchend', x + dx, y + dy, true);
  }, { dx, dy });
}

for (const viewport of [{ width: 360, height: 740 }, { width: 390, height: 844 }, { width: 740, height: 360 }]) {
  test(`review fits ${viewport.width}×${viewport.height} without horizontal overflow`, async ({ page, seedCards, signIn }) => {
    await page.setViewportSize(viewport);
    await openReview(page, seedCards, signIn);
    const reveal = page.getByRole('button', { name: 'Reveal answer' });
    await expect(reveal).toBeVisible();
    await reveal.click();
    const buttons = page.getByRole('region', { name: 'Rate memory strength' }).getByRole('button');
    await expect(buttons).toHaveCount(4);
    const boxes = await buttons.evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON()));
    for (const box of boxes) {
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    for (let i = 1; i < boxes.length; i++) expect(boxes[i].left - boxes[i - 1].right).toBeGreaterThanOrEqual(8);
    await expect.poll(async () => {
      const rating = await page.locator('[data-study-rating]').boundingBox();
      return Boolean(rating && rating.y >= 0 && rating.y + rating.height <= viewport.height);
    }).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    const content = page.locator('[data-study-card] [data-card-content="revealed"]');
    await expect(content).toBeVisible();
    expect(await content.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
  });
}

test('tap rates a card and reports its pending sync honestly', async ({ page, seedCards, signIn }) => {
  await openReview(page, seedCards, signIn);
  await page.getByRole('button', { name: 'Reveal answer' }).tap();
  await page.getByRole('region', { name: 'Rate memory strength' }).getByRole('button', { name: /Good/ }).tap();
  await expect(page.locator('[data-study-provisional]')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Session Complete!' })).toHaveCount(0);
});

test('vertical card scroll does not rate; horizontal swipe does', async ({ page, seedCards, signIn }) => {
  await openReview(page, seedCards, signIn);
  await page.getByRole('button', { name: 'Reveal answer' }).tap();
  await touchPath(page, '[data-study-card] [data-card-content="revealed"]', -130, -230);
  await expect(page.locator('[data-study-provisional]')).toHaveCount(0);
  await touchPath(page, '[data-study-card]', -150, 5);
  await expect(page.locator('[data-study-provisional]')).toBeVisible();
});

test('long Zen answer scrolls inside the card', async ({ page, seedCards, signIn }) => {
  await page.setViewportSize({ width: 740, height: 360 });
  await openReview(page, seedCards, signIn, true);
  await page.getByRole('button', { name: 'Reveal answer' }).tap();
  const content = page.locator('[data-study-card] [data-card-content="revealed"]');
  await expect(content).toBeVisible();
  const dimensions = await content.evaluate(node => {
    const heading = node.querySelector('h2')?.getBoundingClientRect();
    const container = node.getBoundingClientRect();
    const headingStartsInside = Boolean(heading && heading.top >= container.top);
    node.scrollTop = node.scrollHeight;
    return { scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, scrollTop: node.scrollTop, headingStartsInside };
  });
  expect(dimensions.headingStartsInside).toBe(true);
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
  expect(dimensions.scrollTop).toBeGreaterThan(0);
  await expect(page.getByRole('button', { name: 'Return to English' })).toBeVisible();
});

test('touch drag stays responsive under 4× CPU throttle', async ({ page, browserName, context, seedCards, signIn }) => {
  test.skip(process.env.PILOT_PERF_CHECK !== '1', 'Run this measurement alone with PILOT_PERF_CHECK=1 and --workers=1');
  test.skip(browserName !== 'chromium', 'CPU throttling is available through Chromium DevTools');
  await openReview(page, seedCards, signIn);
  await page.getByRole('button', { name: 'Reveal answer' }).tap();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  try {
    const frames = await page.locator('[data-study-card]').evaluate(element => new Promise<number>(resolve => {
      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const touch = (type: string, clientX: number) => {
        const event = new Event(type, { bubbles: true });
        Object.defineProperty(event, 'touches', { value: [{ clientX, clientY: y }] });
        element.dispatchEvent(event);
      };
      touch('touchstart', x);
      let count = 0;
      let start = 0;
      const frame = (now: number) => {
        if (!start) start = now;
        touch('touchmove', x + (count % 2 ? 55 : 65));
        count++;
        if (now - start < 1_200) requestAnimationFrame(frame);
        else {
          touch('touchend', x);
          resolve(Math.round(count * 1_000 / (now - start)));
        }
      };
      requestAnimationFrame(frame);
    }));
    console.log(`4× CPU touch-drag sample: ${frames} fps`);
    expect(frames).toBeGreaterThanOrEqual(50);
  } finally {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  }
});
