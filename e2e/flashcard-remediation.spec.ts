import { expect, test } from './fixtures/firebase-emulator';
import type { Page, TestInfo } from '@playwright/test';

const longWord = 'counterintelligence';
const longCategory = 'AcademicCategoryWithoutBreaks'.repeat(4);
const longPhonetic = `/${'phoneticwithoutbreaks'.repeat(5)}/`;
const longTranslation = 'nghĩakhôngthểtáchtừ'.repeat(8);
const longVietnameseExplanation = 'giảithíchtiếngviệtkhôngcókhoảngtrắng'.repeat(8);
const richVietnameseExplanation = 'Dưới đây là một số cách dịch sang tiếng Việt tự nhiên, tùy vào ngữ cảnh mà bạn có thể lựa chọn: **Cách dịch thông dụng nhất:** > "Có sự tương đồng về ngoại hình, tính cách hoặc số lượng, nhưng không hoàn toàn giống hệt nhau." **Cách dịch ngắn gọn hơn:** > "Tương tự về diện mạo, đặc điểm hoặc số lượng, nhưng không đồng nhất." **Cách dịch mang tính diễn giải:** > "Giống nhau về vẻ ngoài, tính cách hay định lượng, nhưng không phải là một." **Giải thích từ ngữ:** * *Resemblance in appearance:* Tương đồng về ngoại hình/diện mạo. * *Character:* Tính cách/đặc điểm. * *Quantity:* Số lượng/định lượng. * *Without being identical:* Không giống hệt nhau/không đồng nhất.';

const card = {
  id: 'flashcard-remediation',
  word: longWord,
  normalizedWord: longWord,
  translation: longTranslation,
  explanation: 'A detailed explanation used to exercise the complete flashcard interface.',
  explanationTranslation: longVietnameseExplanation,
  phonetic: longPhonetic,
  emoji: '📚',
  category: longCategory,
  partOfSpeech: 'noun',
  audioUrl: null,
  imageUrl: null,
  createdAt: new Date(2026, 6, 15, 10, 0).toISOString(),
  bookmarked: false,
  difficulty: 'unrated',
  origin: 'ai',
  customDeck: null,
  exampleSentence: 'Counterintelligence protects sensitive information.',
  exampleTranslation: 'Phản gián bảo vệ thông tin nhạy cảm.',
};

const richCard = {
  ...card,
  id: 'rich-formatting-remediation',
  word: 'resemblance',
  normalizedWord: 'resemblance',
  translation: 'sự tương đồng',
  category: 'Writing',
  explanationTranslation: richVietnameseExplanation,
};

test.beforeEach(async ({ page, seedCards, seedCourseProfile }) => {
  await page.addInitScript(() => {
    localStorage.setItem('lingoflash_theme', 'light');
    localStorage.removeItem('sonflash_zen_glass_mode');
  });
  await seedCards([card, richCard]);
  // A fresh emulator test user has no course profile yet, which currently
  // shows the full-screen OnboardingJourney overlay even for signed-in users
  // who already have cards (tracked separately as a product bug in the
  // onboarding lane). Seed a legacy profile so these flashcard-interaction
  // tests exercise the ordinary library shell instead of that overlay.
  await seedCourseProfile();
});

test('study reveal keeps progress visible and scrolls rating controls into view', async ({ page, signIn }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, '/?view=library');

  // LibraryCardGrid.tsx's collection actions render a single "Study now"
  // button (library.grid.study-now); the old "Start a review"/"Review N due"
  // copy no longer exists.
  await page.getByRole('button', { name: 'Study now' }).click();
  await expect(page.locator('[data-study-progress]')).toBeVisible();
  await page.getByRole('button', { name: 'Next card' }).click();
  const heading = page.locator('[data-study-card] h2').first();
  await expect(heading).toHaveText(longWord);
  expect(await heading.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.getByRole('button', { name: 'Reveal answer' }).click();

  const rating = page.locator('[data-study-rating]');
  await expect(rating).toBeVisible();
  await expect.poll(async () => {
    const box = await rating.boundingBox();
    return Boolean(box && box.y >= 0 && box.y + box.height <= 844);
  }).toBe(true);
});

async function captureStudyState(testInfo: TestInfo, page: Page, name: string) {
  const screenshot = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: screenshot, fullPage: true, animations: 'disabled', caret: 'hide' });
  await testInfo.attach(name, { path: screenshot, contentType: 'image/png' });
}

for (const viewport of [
  { name: 'desktop', width: 1440, height: 900, ratingRows: 1 },
  { name: '390px', width: 390, height: 844, ratingRows: 2 },
]) {
  test(`Crystal light StudyView captures prompt and revealed rating states at ${viewport.name}`, async ({ page, signIn, seedCards }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => {
      localStorage.setItem('sonflash_theme_family', 'crystal');
      localStorage.setItem('lingoflash_theme', 'light');
      localStorage.setItem('sonflash_theme_follow_system', 'false');
      localStorage.setItem('sonflash_reduced_motion', 'true');
    });
    await seedCards([{ ...card, word: 'resemblance', normalizedWord: 'resemblance', translation: 'sự tương đồng', category: 'Writing', phonetic: '/rɪˈzɛmbləns/', explanationTranslation: 'Sự giống nhau về hình dáng hoặc tính chất.', exampleSentence: 'These designs bear a resemblance.', exampleTranslation: 'Những thiết kế này có nét tương đồng.' }]);
    await signIn(page, '/?view=library&locale=en');
    await page.getByRole('button', { name: 'Study now' }).click();

    const session = page.locator('[data-study-session]');
    const rating = page.locator('[data-study-rating]');
    const ratingButtons = rating.getByRole('button');
    await expect(session).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reveal answer' })).toBeVisible();
    await expect(rating).toContainText('Reveal the answer before rating');
    await expect(ratingButtons).toHaveCount(4);
    for (const index of [0, 1, 2, 3]) await expect(ratingButtons.nth(index)).toBeDisabled();
    await captureStudyState(testInfo, page, `study-review-crystal-light-${viewport.name}-prompt`);

    await page.getByRole('button', { name: 'Reveal answer' }).click();
    await expect(session.locator('.flashcard-back')).toBeVisible();
    await expect(rating).toContainText('How well did you remember this card?');
    for (const index of [0, 1, 2, 3]) await expect(ratingButtons.nth(index)).toBeEnabled();

    const ratingLayout = await ratingButtons.evaluateAll(buttons => buttons.map(button => {
      const box = button.getBoundingClientRect();
      return { top: Math.round(box.top), width: box.width, height: box.height };
    }));
    expect(new Set(ratingLayout.map(button => button.top)).size).toBe(viewport.ratingRows);
    for (const button of ratingLayout) {
      expect(button.width).toBeGreaterThanOrEqual(44);
      expect(button.height).toBeGreaterThanOrEqual(44);
    }
    await captureStudyState(testInfo, page, `study-review-crystal-light-${viewport.name}-revealed-rating`);
  });
}

test('long vocabulary content wraps without horizontal loss on both faces', async ({ page, signIn }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await signIn(page, '/?view=library');
  // The flashcard only renders inside the "Open card" detail dialog
  // (LibraryCardGrid.tsx's Dialog.Root), not inline in the grid.
  await page.locator(`[data-library-card-id="${card.id}"] .library-word-open`).click();

  const front = page.locator('.flashcard-face').first();
  const wordHeading = front.getByRole('heading', { name: longWord });
  const category = front.getByText(longCategory, { exact: true });
  const phonetic = front.getByText(longPhonetic, { exact: true });

  for (const element of [wordHeading, category, phonetic]) {
    const dimensions = await element.evaluate(node => ({
      clientWidth: node.clientWidth,
      scrollWidth: node.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  }

  await page.getByRole('button', { name: new RegExp(`Reveal the Vietnamese meaning of ${longWord}`) }).click();

  const back = page.locator('.flashcard-back').first();
  const translation = back.getByRole('heading', { name: longTranslation });
  const explanation = back.getByText(longVietnameseExplanation, { exact: true });
  await expect(translation).toHaveAttribute('lang', 'vi');
  await expect(back.locator('[data-rich-vietnamese-explanation]')).toHaveAttribute('lang', 'vi');

  for (const element of [translation, explanation]) {
    const dimensions = await element.evaluate(node => ({
      clientWidth: node.clientWidth,
      scrollWidth: node.scrollWidth,
    }));
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  }
});

test('settled card faces do not keep a 3D transform on their text', async ({ page, signIn }) => {
  await signIn(page, '/?view=library');
  await page.locator(`[data-library-card-id="${card.id}"] .library-word-open`).click();

  const cardShell = page.locator('.flashcard-shell').first();
  const hasPersistent3dTransform = () => cardShell.evaluate(element =>
    [...element.querySelectorAll('*')].some(node => {
      const style = getComputedStyle(node);
      return style.transformStyle === 'preserve-3d' || style.transform.includes('matrix3d');
    }));

  expect(await hasPersistent3dTransform()).toBe(false);
  await page.getByRole('button', { name: new RegExp(`Reveal the Vietnamese meaning of ${longWord}`) }).click();
  await expect(page.locator('.flashcard-back').first()).toBeVisible();
  await expect.poll(hasPersistent3dTransform, { timeout: 2_000 }).toBe(false);
});

test('card change uses a spatial flip while returning to a crisp settled layer', async ({ page, signIn }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await signIn(page, '/?view=library');
  await page.locator(`[data-library-card-id="${card.id}"] .library-word-open`).click();

  const shell = page.locator('.flashcard-shell').first();
  await expect(shell).toHaveAttribute('data-flip-animation', 'spatial');
  await page.getByRole('button', { name: new RegExp(`Reveal the Vietnamese meaning of ${longWord}`) }).click();
  await expect(shell).toHaveAttribute('data-card-side', 'back');
  await expect(page.locator('.flashcard-back').first()).toHaveCSS('transform', 'none', { timeout: 2_000 });
  await expect(page.getByRole('button', { name: new RegExp(`Return to the English side of ${longWord}`) })).toBeFocused();
});

test('Vietnamese explanation renders generated Markdown as editorial content', async ({ page, signIn }) => {
  await signIn(page, '/?view=library');
  await page.locator(`[data-library-card-id="${richCard.id}"] .library-word-open`).click();

  const richFlashcard = page.getByRole('group', { name: /resemblance flashcard/i });
  await richFlashcard.getByRole('button', { name: /Reveal the Vietnamese meaning of resemblance/ }).click();
  const explanation = richFlashcard.locator('[data-rich-vietnamese-explanation]');
  await expect(explanation).toBeVisible();

  await expect(explanation.locator('strong')).toContainText([
    'Cách dịch thông dụng nhất:',
    'Cách dịch ngắn gọn hơn:',
    'Cách dịch mang tính diễn giải:',
    'Giải thích từ ngữ:',
  ]);
  await expect(explanation.locator('blockquote')).toHaveCount(3);
  await expect(explanation.locator('li')).toHaveCount(4);
  const visibleText = await explanation.innerText();
  expect(visibleText).not.toContain('**');
  expect(visibleText).not.toContain('* *');
});

test('reduced-motion users receive an immediate 2D face change', async ({ page, signIn }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signIn(page, '/?view=library');
  await page.locator(`[data-library-card-id="${card.id}"] .library-word-open`).click();

  await page.getByRole('button', { name: new RegExp(`Reveal the Vietnamese meaning of ${longWord}`) }).click();
  const back = page.locator('.flashcard-back').first();
  await expect(back).toBeVisible();
  const settledStyle = await back.evaluate(element => ({
    opacity: getComputedStyle(element).opacity,
    transform: getComputedStyle(element).transform,
    transitionDuration: getComputedStyle(element).transitionDuration,
  }));

  expect(settledStyle.opacity).toBe('1');
  expect(settledStyle.transform).toBe('none');
  expect(parseFloat(settledStyle.transitionDuration)).toBeLessThanOrEqual(0.001);
});

test('AI disclosure stays visible and guest report actions stay hidden in standard and Zen cards', async ({ page, signIn }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signIn(page, '/?view=library');
  await page.locator(`[data-library-card-id="${card.id}"] .library-word-open`).click();
  const flashcardGroup = page.getByRole('group', { name: /counterintelligence flashcard/i });
  await flashcardGroup.getByRole('button', { name: /Reveal the Vietnamese meaning/ }).click();
  await expect(flashcardGroup.locator('[data-ai-disclosure]')).toBeVisible();
  await expect(flashcardGroup.getByRole('button', { name: 'Báo thẻ sai' })).toHaveCount(0);

  await page.evaluate(() => {
    localStorage.setItem('sonflash_zen_glass_mode', 'true');
    window.dispatchEvent(new CustomEvent('sonflash-zen-mode-change', { detail: { enabled: true } }));
  });
  const zenCard = page.getByRole('group', { name: /counterintelligence flashcard/i });
  await expect(zenCard.locator('[data-ai-disclosure]')).toBeVisible();
  await expect(zenCard.getByRole('button', { name: 'Báo thẻ sai' })).toHaveCount(0);
});

test('closing card dialogs restores focus to a surviving control', async ({ page, signIn }) => {
  test.setTimeout(60_000);

  await signIn(page, '/?view=library');

  // Both delete buttons here are the grid row's own controls
  // (LibraryCardGrid.tsx), not the Flashcard component's internal delete
  // button (never mounted for this card, since its detail dialog is never
  // opened) — the grid-level confirm dialog's Cancel button reads "Cancel"
  // (common.cancel), not "Keep card".
  const cardRow = page.locator(`[data-library-card-id="${card.id}"]`);
  const deleteButton = cardRow.getByRole('button', { name: 'Delete card' });
  await deleteButton.click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(deleteButton).toBeFocused();

  await deleteButton.click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete card' }).click();
  await expect(cardRow).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Your library' })).toBeFocused();

  await page.locator(`[data-library-card-id="${richCard.id}"] .library-word-open`).click();
  await page.getByRole('button', { name: /Reveal the Vietnamese meaning of resemblance/ }).click();
  await page.locator('details[data-card-disclosure="learning-tools"] > summary').click();
  const detailsButton = page.getByRole('button', { name: /Learning details/ });
  await detailsButton.click();
  await page.getByRole('button', { name: 'Close learning details' }).click();
  await expect(detailsButton).toBeFocused();
});
