import AxeBuilder from '@axe-core/playwright';
import type { Page, Route, TestInfo } from '@playwright/test';
import type { Firestore } from 'firebase-admin/firestore';
import { expect, test } from './fixtures/firebase-emulator';

// Every AI answer here is hand-written: the word callable is answered in the browser with the
// server-sent-event body a streaming callable returns, so no request reaches a model.

type WordRequest = { action: string; operationId?: string; input: unknown };

const wordInfo = {
  translation: 'kiên cường, mau phục hồi',
  explanation: 'Able to recover quickly after something difficult.',
  explanationTranslation: 'Có thể nhanh chóng hồi phục sau khó khăn.',
  phonetic: '/rɪˈzɪliənt/',
  emoji: '🌱',
  category: 'Personal growth',
  partOfSpeech: 'adjective',
  cefrLevel: 'B2',
  exampleSentence: 'Small businesses proved surprisingly resilient during the downturn.',
  exampleTranslation: 'Các doanh nghiệp nhỏ tỏ ra kiên cường bất ngờ trong thời kỳ suy thoái.',
  collocations: [],
  synonyms: [],
  antonyms: [],
};

type StreamField = keyof typeof wordInfo;

/** The fields of the board's moment: headword, pronunciation and meaning ready, the example arriving. */
const FIELDS_BEFORE_EXAMPLE_TRANSLATION: readonly StreamField[] = [
  'phonetic', 'partOfSpeech', 'cefrLevel', 'translation', 'explanation', 'explanationTranslation', 'exampleSentence',
];
const FIELDS_BEFORE_EXAMPLES: readonly StreamField[] = [
  'phonetic', 'partOfSpeech', 'cefrLevel', 'translation', 'explanation',
];
const ALL_FIELDS: readonly StreamField[] = [...FIELDS_BEFORE_EXAMPLE_TRANSLATION, 'exampleTranslation'];

const sse = (events: readonly object[]) => events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('');

const progress = (operationId: string, fields: readonly StreamField[]) => [
  { message: { operationId, stage: 'reserving' } },
  { message: { operationId, stage: 'drafting' } },
  ...fields.map(field => ({ message: { operationId, stage: 'field', field, value: wordInfo[field] } })),
];

/** A stream that delivered some fields and then stays open without a result, as a slow model does. */
const openStream = (operationId: string, fields: readonly StreamField[]) => sse(progress(operationId, fields));

const failedStream = (operationId: string, fields: readonly StreamField[]) => sse([
  ...progress(operationId, fields),
  { error: { status: 'INTERNAL', message: 'The AI answer ended before the card was complete.' } },
]);

const completeStream = (operationId: string) => sse([
  ...progress(operationId, ALL_FIELDS),
  { message: { operationId, stage: 'done', result: wordInfo } },
  { result: { result: wordInfo } },
]);

const corsHeaders = (route: Route): Record<string, string> => {
  const origin = route.request().headers().origin;
  return origin ? { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' } : {};
};

const fulfillStream = (route: Route, body: string) => route.fulfill({
  status: 200,
  headers: { 'content-type': 'text/event-stream', ...corsHeaders(route) },
  body,
});

/** Answers the word callable with `answer(n)` for the n-th word request and records each request. */
async function routeWordRequests(page: Page, answer: (index: number, operationId: string) => string) {
  const requests: WordRequest[] = [];
  await page.route('**/generateVocabulary', async route => {
    const request = route.request();
    if (request.method() !== 'POST') return route.continue();
    const payload = request.postDataJSON().data as WordRequest;
    if (payload.action !== 'word') return route.continue();
    requests.push(payload);
    return fulfillStream(route, answer(requests.length - 1, payload.operationId ?? ''));
  });
  return requests;
}

/** The stop callable reports that part of the card had reached the learner, so the request counts. */
async function routeCountedCancel(page: Page) {
  const cancels: Array<{ operationId: string }> = [];
  await page.route('**/cancelCardGeneration', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    cancels.push(route.request().postDataJSON().data);
    return route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json', ...corsHeaders(route) },
      body: JSON.stringify({ result: { cancelled: true, counted: true } }),
    });
  });
  return cancels;
}

const ieltsCard = {
  id: 'stream-ielts-card', word: 'persevere', normalizedWord: 'persevere', translation: 'kiên trì',
  explanation: 'Keep going despite difficulty.', phonetic: '', emoji: '🧗', category: 'Personal growth',
  audioUrl: null, imageUrl: null, createdAt: '2026-09-01T08:00:00.000Z', origin: 'manual', customDeck: 'IELTS',
};

/** The deck list lives in the owner's deck profile, not on the cards. */
async function seedIeltsDeck(db: Firestore, ownerId: string) {
  await db.doc(`users/${ownerId}/profile/custom_decks`).set({ decks: ['IELTS'] });
}

async function openCreator(page: Page, word = 'resilient') {
  await page.locator('[data-library-create-action]').click();
  const creator = page.getByRole('dialog', { name: 'Add a word' });
  await creator.getByRole('textbox', { name: 'Word or phrase' }).fill(word);
  await creator.getByRole('combobox', { name: 'Save to' }).selectOption('IELTS');
  return creator;
}

// The Firebase SDK errors its message stream as soon as it parses the error
// line, and erroring a ReadableStream discards the messages still queued.
// page.route delivers the whole body in one read, so the fields sent before
// the failure never reach the dialog. A buffering proxy does the same in
// production. This stays fixme until the client reads the stream lines
// itself instead of through callable.stream.
test.fixme('a first AI card streams field by field, stops part-way, and Try again repeats the same request', async ({ page, db, testUser, seedCards, seedCourseProfile, signIn, blockExternalNetwork }) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedCourseProfile({ targetLanguage: 'en', nativeLanguage: 'vi' });
  await seedCards([ieltsCard]);
  await seedIeltsDeck(db, testUser.uid);
  await blockExternalNetwork(page);
  const requests = await routeWordRequests(page, (index, operationId) => index === 0
    ? failedStream(operationId, FIELDS_BEFORE_EXAMPLES)
    : completeStream(operationId));
  await signIn(page, '/?view=library&locale=en');

  const creator = await openCreator(page);
  await creator.getByRole('button', { name: 'Generate preview' }).click();

  // The stream broke after the meaning: the card stays, marked unchecked, and cannot be saved.
  await expect(creator.getByText('Generation stopped before the card was finished. The details shown were not checked.')).toBeVisible({ timeout: 20_000 });
  await expect(creator.getByText('Not checked')).toBeVisible();
  await expect(creator.getByRole('textbox', { name: 'Meaning' })).toHaveValue(wordInfo.translation);
  await expect(creator.getByRole('textbox', { name: 'Example sentence' })).toHaveValue('');
  const steps = creator.getByRole('list', { name: 'Progress' });
  await expect(steps.getByRole('listitem').filter({ hasText: 'Meaning' })).toContainText('done');
  await expect(steps.getByRole('listitem').filter({ hasText: 'Example sentence' })).toContainText('stopped');
  await expect(creator.getByRole('progressbar', { name: 'Progress' })).toHaveAttribute('aria-valuenow', '3');
  await expect(creator.getByRole('button', { name: 'Save card' })).toHaveCount(0);
  const tryAgain = creator.getByRole('button', { name: 'Try again' });
  await expect(tryAgain).toBeFocused();

  // A learner edit to an arrived field survives the retry.
  await creator.getByRole('textbox', { name: 'Meaning' }).fill('kiên cường');
  await tryAgain.click();
  await expect(creator.getByText('Ready after saving')).toBeVisible({ timeout: 20_000 });
  expect(requests).toHaveLength(2);
  expect(requests[1].operationId).toBe(requests[0].operationId);
  await expect(creator.getByRole('textbox', { name: 'Meaning' })).toHaveValue('kiên cường');
  await expect(creator.getByRole('textbox', { name: 'Example sentence' })).toHaveValue(wordInfo.exampleSentence);
  await expect(creator.getByRole('status').filter({ hasText: 'Card ready. Review it, then save.' })).toHaveCount(1);

  await creator.getByRole('button', { name: 'Save card' }).click();
  await expect(creator).toHaveCount(0);
  const saved = () => db.collection(`users/${testUser.uid}/cards`).where('word', '==', 'resilient').get();
  await expect.poll(async () => (await saved()).size).toBe(1);
  const card = (await saved()).docs[0];
  expect(card.get('translation')).toBe('kiên cường');
  expect(card.get('exampleSentence')).toBe(wordInfo.exampleSentence);
  expect(card.get('customDeck')).toBe('IELTS');
});

test('Cancel stops a running AI card, says the request still counts, and keeps what arrived', async ({ page, db, testUser, seedCards, seedCourseProfile, signIn, blockExternalNetwork }) => {
  test.setTimeout(90_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedCourseProfile({ targetLanguage: 'en', nativeLanguage: 'vi' });
  await seedCards([ieltsCard]);
  await seedIeltsDeck(db, testUser.uid);
  await blockExternalNetwork(page);
  const requests = await routeWordRequests(page, (index, operationId) => index === 0
    ? openStream(operationId, FIELDS_BEFORE_EXAMPLE_TRANSLATION)
    : completeStream(operationId));
  const cancels = await routeCountedCancel(page);
  await signIn(page, '/?view=library&locale=en');

  const creator = await openCreator(page);
  await creator.getByRole('button', { name: 'Generate preview' }).click();

  await expect(creator.getByText('AI is writing your card')).toBeVisible({ timeout: 20_000 });
  await expect(creator.getByRole('progressbar', { name: 'Progress' })).toHaveAttribute('aria-valuenow', '3');
  const steps = creator.getByRole('list', { name: 'Progress' });
  await expect(steps.locator('[aria-current="step"]')).toContainText('Example sentence');
  await expect(creator.getByRole('textbox', { name: 'Example sentence' })).toHaveValue(wordInfo.exampleSentence);
  // A field still being written is a placeholder, not an empty input.
  await expect(creator.getByRole('textbox', { name: 'Example translation' })).toHaveCount(0);
  await expect(creator.getByRole('button', { name: 'Save card' })).toBeDisabled();
  const cancel = creator.getByRole('button', { name: 'Cancel' });
  await expect(cancel).toBeFocused();
  const axe = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(axe.violations.filter(item => ['serious', 'critical'].includes(item.impact ?? ''))).toEqual([]);

  await cancel.click();
  await expect(creator.getByText('Stopped. Part of the card had already arrived, so this request still counts.')).toBeVisible();
  expect(cancels).toEqual([expect.objectContaining({ operationId: requests[0].operationId })]);
  await expect(creator.getByRole('textbox', { name: 'Example sentence' })).toHaveValue(wordInfo.exampleSentence);
  await expect(creator.getByRole('button', { name: 'Try again' })).toBeFocused();

  // Finishing by hand starts from what had arrived.
  await creator.getByRole('button', { name: 'Add manually' }).click();
  await expect(creator.getByText('MANUAL DETAILS')).toBeVisible();
  await expect(creator.getByRole('textbox', { name: 'Meaning' })).toHaveValue(wordInfo.translation);
});

test('generating while offline explains why and offers the manual path without a request', async ({ page, context, seedCourseProfile, signIn, blockExternalNetwork }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await seedCourseProfile({ targetLanguage: 'en', nativeLanguage: 'vi' });
  await blockExternalNetwork(page);
  const requests = await routeWordRequests(page, (_index, operationId) => completeStream(operationId));
  await signIn(page, '/?view=library&locale=en');

  await page.locator('[data-library-create-action]').click();
  const creator = page.getByRole('dialog', { name: 'Add a word' });
  await creator.getByRole('textbox', { name: 'Word or phrase' }).fill('resilient');
  await context.setOffline(true);
  await creator.getByRole('button', { name: 'Generate preview' }).click();
  const alert = creator.getByRole('alert');
  await expect(alert).toContainText('You’re offline. Reconnect to generate a card, or add it manually.');
  await context.setOffline(false);
  expect(requests).toHaveLength(0);
  await alert.getByRole('button', { name: 'Add manually' }).click();
  await expect(creator.getByText('MANUAL DETAILS')).toBeVisible();
});

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

async function captureDialog(page: Page, testInfo: TestInfo, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${name} has horizontal overflow`).toBe(true);
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, animations: 'disabled', caret: 'hide' });
  await testInfo.attach(name, { path, contentType: 'image/png' });
  await expect.soft(page).toHaveScreenshot(`${name}.png`, { animations: 'disabled', caret: 'hide' });
}

for (const theme of themes) {
  test(`${theme.family} ${theme.mode} AI card streaming and stopped layouts`, async ({ page, db, testUser, seedCards, seedCourseProfile, signIn, blockExternalNetwork }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize(viewports[0]);
    await page.emulateMedia({ colorScheme: theme.mode, reducedMotion: 'reduce' });
    await page.addInitScript(({ family, mode }) => {
      localStorage.setItem('sonflash_theme_family', family);
      localStorage.setItem('lingoflash_theme', mode);
      localStorage.setItem('sonflash_theme_follow_system', 'false');
      localStorage.setItem('sonflash_reduced_motion', 'true');
    }, theme);
    await seedCourseProfile({ targetLanguage: 'en', nativeLanguage: 'vi' });
    await seedCards([ieltsCard]);
    await seedIeltsDeck(db, testUser.uid);
    await blockExternalNetwork(page);
    await routeWordRequests(page, (_index, operationId) => openStream(operationId, FIELDS_BEFORE_EXAMPLE_TRANSLATION));
    await routeCountedCancel(page);
    await signIn(page, '/?view=library&locale=en');
    await expect(page.locator('html')).toHaveAttribute('data-theme-family', theme.family);

    const creator = await openCreator(page);
    await creator.getByRole('button', { name: 'Generate preview' }).click();
    await expect(creator.getByRole('progressbar', { name: 'Progress' })).toHaveAttribute('aria-valuenow', '3', { timeout: 20_000 });
    await page.mouse.move(0, 0);
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await captureDialog(page, testInfo, `create-card-streaming-${theme.family}-${theme.mode}-${viewport.name}`);
    }

    await page.setViewportSize(viewports[0]);
    await creator.getByRole('button', { name: 'Cancel' }).click();
    await expect(creator.getByRole('button', { name: 'Try again' })).toBeFocused();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await captureDialog(page, testInfo, `create-card-stopped-${theme.family}-${theme.mode}-${viewport.name}`);
    }
  });
}
