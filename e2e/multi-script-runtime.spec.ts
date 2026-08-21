import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

const focusNextControl = (page: import('@playwright/test').Page) => page.keyboard.press(
  test.info().project.name === 'webkit' ? 'Alt+Tab' : 'Tab',
);

const rtlCards = [
  ['تحليل', 'ניתוח', 'يقدم التقرير تحليلاً مفصلاً', 'הדוח מציג ניתוח מפורט'],
  ['دليل', 'ראיה', 'يوضح الدليل الفكرة بوضوح', 'הראיה מסבירה את הרעיון'],
  ['سياق', 'הקשר', 'يساعد السياق على فهم المعنى', 'ההקשר עוזר להבין משמעות'],
  ['معرفة', 'ידע', 'تنمو المعرفة مع الممارسة', 'ידע גדל יחד עם תרגול'],
  ['لغة', 'שפה', 'تفتح اللغة أبواباً جديدة', 'שפה פותחת דלתות חדשות'],
  ['تركيز', 'מיקוד', 'يحسن التركيز جودة التعلم', 'מיקוד משפר את הלמידה'],
  ['فرضية', 'השערה', 'تختبر الدراسة فرضية واضحة', 'המחקר בודק השערה ברורה'],
  ['تطوير', 'פיתוח', 'يدعم التطوير تقدماً مستمراً', 'פיתוח תומך בהתקדמות רציפה'],
  ['فائدة', 'תועלת', 'تظهر الفائدة بعد التدريب', 'התועלת מופיעה אחרי תרגול'],
  ['تحديد', 'זיהוי', 'يساعد التحديد على حل المشكلة', 'זיהוי עוזר לפתור בעיה'],
  ['تبرير', 'הצדקה', 'يحتاج القرار إلى تبرير', 'החלטה צריכה הצדקה'],
  ['تعلم', 'למידה', 'يستمر التعلم طوال الحياة', 'למידה נמשכת לאורך החיים'],
].map(([word, translation, exampleSentence, exampleTranslation], index) => ({
  id: `phase10-rtl-${index}`,
  word,
  normalizedWord: word,
  translation,
  explanation: '',
  phonetic: '',
  emoji: '📚',
  category: 'General',
  audioUrl: null,
  imageUrl: null,
  createdAt: new Date(2026, 7, 21, 10, index).toISOString(),
  difficulty: 'unrated',
  cefrLevel: index < 4 ? 'A2' : index < 8 ? 'B2' : 'C1',
  exampleSentence,
  exampleTranslation,
}));

test.beforeEach(async ({ page }) => {
  await page.addInitScript(cards => {
    localStorage.setItem('lingoflash_cards', JSON.stringify(cards));
    localStorage.removeItem('lingoflash_cards_owner');
    localStorage.setItem('lingoflash_theme', 'dark');
  }, rtlCards);
});

test('Arabic text and sentence answers keep RTL content inside an LTR lesson shell', async ({ page }) => {
  await page.goto('/?lesson=spelling');
  const textAnswer = page.locator('#daily-lesson-answer');
  await expect(textAnswer).toBeVisible();
  await expect(textAnswer).toHaveAttribute('lang', 'ar');
  await expect(textAnswer).toHaveAttribute('dir', 'rtl');
  await expect(textAnswer).toHaveCSS('text-align', 'start');
  await expect(page.locator('[data-session-shell="lesson"]')).not.toHaveAttribute('dir', 'rtl');

  await textAnswer.fill('تحليل');
  await textAnswer.focus();
  await focusNextControl(page);
  await expect(page.getByRole('button', { name: 'Submit answer' })).toBeFocused();

  await page.goto('/?lesson=sentence-building');
  const tokens = page.getByRole('group', { name: 'Build the sentence' }).getByRole('button');
  await expect(tokens.first()).toHaveAttribute('lang', 'ar');
  await expect(tokens.first()).toHaveAttribute('dir', 'rtl');
  await expect(tokens.first()).toHaveCSS('text-align', 'start');
  await tokens.first().click();
  const selectedSentence = page.locator('[data-script-content="lesson-sentence"]');
  await expect(selectedSentence).toHaveAttribute('lang', 'ar');
  await expect(selectedSentence).toHaveAttribute('dir', 'rtl');

  await tokens.first().focus();
  await focusNextControl(page);
  await expect(tokens.nth(1)).toBeFocused();
});

test('Arabic prompt and Hebrew choices remain RTL without reversing placement controls', async ({ page }) => {
  await page.goto('/?lesson=placement');
  await page.getByRole('button', { name: 'Start placement check' }).click();

  const prompt = page.locator('[data-script-content="placement"]');
  await expect(prompt).toHaveAttribute('lang', 'ar');
  await expect(prompt).toHaveAttribute('dir', 'rtl');
  const options = page.getByRole('group', { name: 'Choose one answer' }).getByRole('button');
  await expect(options.first()).toHaveAttribute('lang', 'he');
  await expect(options.first()).toHaveAttribute('dir', 'rtl');
  await expect(options.first()).toHaveCSS('text-align', 'start');
  await expect(page.locator('[data-session-shell="placement"]')).not.toHaveAttribute('dir', 'rtl');

  await options.first().focus();
  await focusNextControl(page);
  await expect(options.nth(1)).toBeFocused();
});

test('the production Catalog card publishes RTL metadata in a browser fixture', async ({ page }) => {
  const markup = execFileSync(process.execPath, [
    resolve('node_modules/vite-node/vite-node.mjs'),
    resolve('e2e/fixtures/render-multi-script-catalog.tsx'),
  ], { encoding: 'utf8' });
  await page.goto('/');
  // Replace the document for this static server-rendered fixture. Mutating React's live
  // root races its renderer in WebKit, while waiting for the unrelated fixture `load`
  // event can hang its page lifecycle. The assertions below establish actual readiness.
  await page.evaluate(html => {
    const fixture = document.createElement('div');
    fixture.dataset.e2eCatalogFixture = 'true';
    fixture.innerHTML = html;
    document.body.append(fixture);
  }, markup);

  const word = page.locator('[data-script-content="catalog-word"]');
  await expect(word).toContainText('تحليل');
  await expect(word).toHaveAttribute('lang', 'ar-EG');
  await expect(word).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('region', { name: 'Meaning' }).locator('p').first()).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('section[aria-labelledby="catalog-heading"]')).not.toHaveAttribute('dir', 'rtl');

  const search = page.locator('#catalog-term');
  await search.focus();
  await focusNextControl(page);
  await expect(page.locator('#catalog-cefr')).toBeFocused();
});
