import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, type QueryDocumentSnapshot } from 'firebase/firestore';
import { readFile } from 'node:fs/promises';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fetchCardPage } from './src/lib/cardRepository';
import { CLOUD_PAGE_SIZE, type CardQueryState } from './src/lib/cardQuery';
import { ALL_PRACTICE_DECK_SCOPE } from './src/lib/practiceScope';

const PROJECT_ID = 'demo-lingoflash';
const OWNER = 'owner';

const ratings = ['easy', 'good', 'hard', 'unrated'] as const;

/**
 * More than three pages of the learning filter, with several cards sharing one
 * creation instant (a bulk import) so that only the document-id tie-break keeps
 * the page boundary stable.
 */
const seededCards = Array.from({ length: 120 }, (_, index) => {
  const id = `card-${String(index).padStart(3, '0')}`;
  const minute = Math.floor(index / 3);
  return {
    id,
    word: `word ${id}`,
    normalizedWord: `word ${id}`,
    translation: `nghia ${id}`,
    language: index % 10 === 9 ? 'ko' : 'en',
    difficulty: ratings[index % ratings.length],
    createdAt: new Date(Date.UTC(2026, 10, 1, 8, minute)).toISOString(),
    schemaVersion: 2,
    revision: 1,
    libraryEpoch: 0,
  };
});

const learningFilters = (): CardQueryState => ({
  category: null,
  customDeck: ALL_PRACTICE_DECK_SCOPE,
  difficulty: 'learning',
  partOfSpeech: null,
  bookmarkedOnly: false,
  createdDate: null,
  wordPrefix: '',
  targetLanguage: 'en',
});

describe('library paging against the Firestore emulator', () => {
  let testEnvironment: RulesTestEnvironment;

  beforeAll(async () => {
    const rules = await readFile(new URL('./firestore.rules', import.meta.url), 'utf8');
    testEnvironment = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: { rules },
    });
  });

  afterEach(async () => {
    await testEnvironment.clearFirestore();
  });

  afterAll(async () => {
    await testEnvironment?.cleanup();
  });

  it('pages the learning filter to the end without skipping or repeating a card', async () => {
    await testEnvironment.withSecurityRulesDisabled(async context => {
      const trusted = context.firestore();
      for (const card of seededCards) {
        await setDoc(doc(trusted, 'users', OWNER, 'cards', card.id), card);
      }
    });
    const expected = seededCards
      .filter(card => card.language === 'en' && (card.difficulty === 'good' || card.difficulty === 'hard'))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
      .map(card => card.id);
    expect(expected.length).toBeGreaterThan(CLOUD_PAGE_SIZE * 3);

    const owner = testEnvironment.authenticatedContext(OWNER).firestore();
    const seen: string[] = [];
    let cursor: QueryDocumentSnapshot | null = null;
    let pages = 0;
    do {
      const page = await fetchCardPage({
        db: owner as never,
        userId: OWNER,
        filters: learningFilters(),
        cursor,
      });
      expect(page.items.length).toBeLessThanOrEqual(CLOUD_PAGE_SIZE);
      seen.push(...page.items.map(card => card.id));
      cursor = page.hasNext ? page.lastCursor : null;
      pages += 1;
      expect(pages).toBeLessThan(20);
    } while (cursor);

    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toEqual(expected);
    expect(pages).toBeGreaterThan(3);
  });
});
