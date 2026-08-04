import { createHash } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import type { CatalogChunkV1, CatalogReleaseManifestV1 } from '../src/features/catalogPipeline/catalogContracts';
import { createLexemeId, createTrackMembershipId } from '../src/features/multilingual/lexemeIdentity';
import type { LexemeV3, TrackMembershipV3 } from '../src/features/multilingual/schemaV3';

const timestamp = '2026-08-04T00:00:00.000Z';

const vocabulary = [
  { lemma: 'learn', translation: 'học', trackId: 'ielts', tier: 'foundation', cefr: 'A1', topic: 'education', skill: 'reading', rank: 1 },
  { lemma: 'analyse', translation: 'phân tích', trackId: 'ielts', tier: 'core', cefr: 'B2', topic: 'education', skill: 'writing', rank: 2 },
  { lemma: 'negotiate', translation: 'đàm phán', trackId: 'toeic', tier: 'core', cefr: 'B1', topic: 'business', skill: 'speaking', rank: 3 },
  { lemma: 'ubiquitous', translation: 'phổ biến khắp nơi', trackId: 'ielts', tier: 'advanced', cefr: 'C2', topic: 'society', skill: 'reading', rank: 4 },
  { lemma: 'welcome', translation: 'chào đón', trackId: 'general', tier: 'foundation', cefr: 'A1', topic: 'everyday', skill: 'listening', rank: 5 },
] as const;

const lexeme = (item: typeof vocabulary[number]): LexemeV3 => {
  const identity = {
    language: 'en', normalizedLemma: item.lemma, partOfSpeech: 'verb', senseKey: 'primary',
  };
  return {
    schemaVersion: 3,
    id: createLexemeId(identity),
    ...identity,
    lemma: item.lemma,
    definitions: [
      { language: 'en', text: `A reviewed definition for ${item.lemma}.` },
      { language: 'vi', text: item.translation },
    ],
    phonetics: [`/${item.lemma}/`],
    examples: [{
      text: `Learners use ${item.lemma} in context.`,
      translations: [{ language: 'vi', text: `Người học dùng ${item.translation} trong ngữ cảnh.` }],
    }],
    collocations: [`${item.lemma} effectively`],
    wordFamily: [],
    media: { audioUrl: null, imageUrl: null },
    compatibility: {
      legacyPartOfSpeech: 'verb', translation: item.translation,
      explanation: `A reviewed definition for ${item.lemma}.`, explanationTranslation: item.translation,
      emoji: '', exampleSentence: `Learners use ${item.lemma} in context.`,
      exampleTranslation: `Người học dùng ${item.translation} trong ngữ cảnh.`,
      synonyms: [], antonyms: [], register: '', commonMistake: '',
    },
    provenance: {
      source: 'Phase 4 deterministic browser fixture', license: 'CC0-1.0',
      reviewer: 'Automated acceptance fixture', editorialStatus: 'published',
    },
    contentVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

const membership = (
  item: typeof vocabulary[number],
  value: LexemeV3,
): TrackMembershipV3 => ({
  schemaVersion: 3,
  id: createTrackMembershipId({ trackId: item.trackId, lexemeId: value.id }),
  lexemeId: value.id,
  trackId: item.trackId,
  tier: item.tier,
  cefrLevel: item.cefr,
  topic: item.topic,
  legacyCategory: item.trackId.toUpperCase(),
  skills: [item.skill],
  rank: item.rank,
  lessonGroup: 'phase-4-acceptance',
  editorialStatus: 'published',
  contentVersion: 1,
});

const catalogFixture = () => {
  const lexemes = vocabulary.map(lexeme);
  const memberships = vocabulary.map((item, index) => membership(item, lexemes[index]));
  const chunk: CatalogChunkV1 = {
    formatVersion: 1,
    releaseId: 'reviewed-release-1',
    ordinal: 0,
    lexemes,
    memberships,
  };
  const chunkBody = JSON.stringify(chunk);
  const byteLength = Buffer.byteLength(chunkBody);
  const chunkPath = 'english-core/reviewed-release-1/chunk-0000.json';
  const manifest: CatalogReleaseManifestV1 = {
    manifestVersion: 1,
    catalogId: 'english-core',
    releaseId: 'reviewed-release-1',
    sequence: 1,
    contentLanguage: 'en',
    supportLanguages: ['vi'],
    createdAt: timestamp,
    previousReleaseId: null,
    counts: { lexemes: lexemes.length, memberships: memberships.length, chunks: 1, encodedBytes: byteLength },
    chunks: [{
      id: 'chunk-0000', ordinal: 0, path: chunkPath,
      sha256: createHash('sha256').update(chunkBody).digest('hex'),
      byteLength, lexemeCount: lexemes.length, membershipCount: memberships.length,
      trackIds: ['general', 'ielts', 'toeic'],
    }],
  };
  return { chunkBody, chunkPath, manifest };
};

const routeReviewedCatalog = async (page: Page) => {
  const fixture = catalogFixture();
  await page.route('**/catalog/english-core/release-manifest.json', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(fixture.manifest),
  }));
  await page.route(`**/${fixture.chunkPath}`, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: fixture.chunkBody,
  }));
};

test('Catalog is lazy, URL-addressable, verified offline and accessible', async ({ page, browserName }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await routeReviewedCatalog(page);
  const requestedScripts: string[] = [];
  page.on('request', request => {
    if (request.resourceType() === 'script') requestedScripts.push(request.url());
  });

  await page.goto('/?view=library&utm_source=phase4#catalog-test');
  await expect(page.getByRole('heading', { name: 'Your library' })).toBeVisible();
  expect(requestedScripts.some(url => /CatalogWorkspace/i.test(url))).toBe(false);

  await page.getByRole('button', { name: 'Paths' }).first().click();
  await expect(page).toHaveURL(/view=catalog.*utm_source=phase4.*#catalog-test/);
  await expect(page.getByRole('heading', { name: 'Language paths' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('#catalog-language')).toBeFocused();
  expect(requestedScripts.some(url => /CatalogWorkspace/i.test(url))).toBe(true);
  await expect(page.getByText('Draft vocabulary is never shown here.')).toBeVisible();
  await expect(page.locator('#catalog-language option[value="ja"]')).toHaveAttribute('disabled', '');

  await page.getByRole('button', { name: /Install English starter catalog/i }).click();
  await expect(page.getByText('Available offline', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'learn' })).toBeVisible();
  await expect(page.getByText('A reviewed definition for learn.')).toBeVisible();
  await expect(page.getByText('học', { exact: true })).toBeVisible();
  await expect(page.getByText('learn effectively')).toBeVisible();
  await expect(page.getByText('CC0-1.0')).toBeVisible();
  await expect(page.getByText('Automated acceptance fixture')).toBeVisible();

  await page.locator('#catalog-cefr').selectOption('A1');
  await page.locator('#catalog-topic').selectOption('education');
  await page.locator('#catalog-pos').selectOption('verb');
  await page.locator('#catalog-skill').selectOption('reading');
  await page.locator('#catalog-term').fill('learn');
  await expect(page).toHaveURL(/cefr=A1/);
  await expect(page).toHaveURL(/topic=education/);
  await expect(page).toHaveURL(/pos=verb/);
  await expect(page).toHaveURL(/skill=reading/);
  await expect(page).toHaveURL(/term=learn/);
  await expect(page.getByRole('heading', { name: 'learn' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'analyse' })).toHaveCount(0);

  await page.goBack();
  await expect(page.locator('#catalog-term')).toHaveValue('');
  await page.context().setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  await expect(page.getByText('Available offline', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'learn' })).toBeVisible();
  await page.context().setOffline(false);
  await page.reload();
  await expect(page.getByText('Available offline', { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 320, height: 800 });
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);

  if (browserName === 'chromium') {
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations.filter(item => item.impact === 'serious' || item.impact === 'critical'))
      .toEqual([]);
  }
});

test('shipped starter catalog exposes separate IELTS, TOEIC and General paths', async ({ page }) => {
  await page.goto('/?view=catalog');
  await page.getByRole('button', { name: /Install English starter catalog/i }).click();

  await expect(page.getByText('Available offline', { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'ability' })).toBeVisible();
  await expect(page.getByText('150 words', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: /TOEIC vocabulary/ }).click();
  await expect(page.getByRole('heading', { name: 'achieve' })).toBeVisible();
  await expect(page.getByText('90 words', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: /^General / }).click();
  await expect(page.getByRole('heading', { name: 'accept' })).toBeVisible();
  await expect(page.getByText('60 words', { exact: true })).toBeVisible();
});
