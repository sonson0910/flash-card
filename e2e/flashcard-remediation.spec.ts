import { expect, test } from '@playwright/test';

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

test.beforeEach(async ({ page }) => {
  await page.addInitScript(storedCards => {
    localStorage.setItem('lingoflash_cards', JSON.stringify(storedCards));
    localStorage.removeItem('lingoflash_cards_owner');
    localStorage.setItem('lingoflash_theme', 'light');
  }, [card, richCard]);
});

test('study reveal keeps progress visible and scrolls rating controls into view', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?view=library');

  await page.getByRole('button', { name: /Start a review|Review \d+ due/ }).first().click();
  await expect(page.locator('[data-study-progress]')).toBeVisible();
  await page.getByRole('button', { name: 'Reveal answer' }).click();

  const rating = page.locator('[data-study-rating]');
  await expect(rating).toBeVisible();
  await expect.poll(async () => {
    const box = await rating.boundingBox();
    return Boolean(box && box.y >= 0 && box.y + box.height <= 844);
  }).toBe(true);
});

test('long vocabulary content wraps without horizontal loss on both faces', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/?view=library');

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

test('settled card faces do not keep a 3D transform on their text', async ({ page }) => {
  await page.goto('/?view=library');

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

test('card change uses a spatial flip while returning to a crisp settled layer', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/?view=library');

  const card = page.locator('.flashcard-shell').first();
  await expect(card).toHaveAttribute('data-flip-animation', 'spatial');
  await page.getByRole('button', { name: new RegExp(`Reveal the Vietnamese meaning of ${longWord}`) }).click();
  await expect(card).toHaveAttribute('data-card-side', 'back');
  await expect(page.locator('.flashcard-back').first()).toHaveCSS('transform', 'none', { timeout: 2_000 });
  await expect(page.getByRole('button', { name: new RegExp(`Return to the English side of ${longWord}`) })).toBeFocused();
});

test('Vietnamese explanation renders generated Markdown as editorial content', async ({ page }) => {
  await page.goto('/?view=library');

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

test('reduced-motion users receive an immediate 2D face change', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/?view=library');

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

test('closing card dialogs restores focus to a surviving control', async ({ page }) => {
  await page.goto('/?view=library');

  const deleteButton = page.getByRole('button', { name: 'Delete card' }).first();
  await deleteButton.click();
  await page.getByRole('button', { name: 'Keep card' }).click();
  await expect(deleteButton).toBeFocused();

  await deleteButton.click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete card' }).click();
  await expect(page.getByRole('group', { name: new RegExp(`${longWord} flashcard`, 'i') })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Your library' })).toBeFocused();

  await page.getByRole('button', { name: /Reveal the Vietnamese meaning of resemblance/ }).click();
  await page.locator('details[data-card-disclosure="learning-tools"] > summary').click();
  const detailsButton = page.getByRole('button', { name: /Learning details/ });
  await detailsButton.click();
  await page.getByRole('button', { name: 'Close learning details' }).click();
  await expect(detailsButton).toBeFocused();
});
