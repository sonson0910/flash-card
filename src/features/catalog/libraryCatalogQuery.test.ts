import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  EQUALITY_FILTER_KEYS,
  applyEqualityFilterIntent,
  createLibraryLocation,
  normalizeLibraryQuery,
  readLibraryQuery,
  type LibraryCatalogQuery,
} from './libraryCatalogQuery';

type EqualityFilterKey = typeof EQUALITY_FILTER_KEYS[number];

const FIRESTORE_FIELD_BY_EQUALITY_FILTER: Record<EqualityFilterKey, string> = {
  category: 'category',
  deck: 'customDeck',
  difficulty: 'difficulty',
  partOfSpeech: 'partOfSpeech',
  starred: 'bookmarked',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

interface FirestoreIndexField {
  fieldPath: string;
  order: string;
}

interface FirestoreIndexDefinition {
  collectionGroup: string;
  queryScope: string;
  fields: FirestoreIndexField[];
}

function cardEqualityCompositeIndexes(): FirestoreIndexDefinition[] {
  const manifest = JSON.parse(readFileSync(
    fileURLToPath(new URL('../../../firestore.indexes.json', import.meta.url)),
    'utf8',
  )) as unknown;
  if (!isRecord(manifest) || !Array.isArray(manifest.indexes)) {
    throw new Error('Firestore index manifest must contain an indexes array.');
  }

  return manifest.indexes.flatMap(index => {
    if (!isRecord(index) || !Array.isArray(index.fields)) return [];
    const fields = index.fields.flatMap(field => {
      if (!isRecord(field) || typeof field.fieldPath !== 'string' || typeof field.order !== 'string') {
        return [];
      }
      return [{ fieldPath: field.fieldPath, order: field.order }];
    });
    if (fields.length !== index.fields.length) return [];
    if (typeof index.collectionGroup !== 'string' || typeof index.queryScope !== 'string') return [];
    return [{ collectionGroup: index.collectionGroup, queryScope: index.queryScope, fields }];
  });
}

function activeEqualityFilters(query: LibraryCatalogQuery): EqualityFilterKey[] {
  return EQUALITY_FILTER_KEYS.filter(filter => {
    if (filter === 'category') return query.category !== 'All';
    if (filter === 'deck') return query.deck !== 'All';
    if (filter === 'difficulty') return query.difficulty !== 'All';
    if (filter === 'partOfSpeech') return query.partOfSpeech !== 'All';
    return query.starred;
  });
}

describe('libraryCatalogQuery', () => {
  it('bounds and normalizes untrusted URL query values', () => {
    const query = readLibraryQuery(`?q=${'x'.repeat(300)}&difficulty=unknown&page=-4&starred=1`);

    expect(query.search).toHaveLength(256);
    expect(query.difficulty).toBe('All');
    expect(query.page).toBe(1);
    expect(query.starred).toBe(true);
  });

  it('keeps search and due mutually compatible with other filters', () => {
    const current: LibraryCatalogQuery = {
      search: 'hello',
      category: 'Travel',
      deck: 'Deck A',
      difficulty: 'hard',
      partOfSpeech: 'noun',
      starred: true,
      date: 'Aug 3, 2026',
      page: 4,
    };

    expect(normalizeLibraryQuery(current)).toEqual({
      search: 'hello',
      category: 'All',
      deck: 'All',
      difficulty: 'All',
      partOfSpeech: 'All',
      starred: false,
      date: 'All',
      page: 4,
    });

    expect(normalizeLibraryQuery({ ...current, search: '', difficulty: 'due' })).toEqual({
      search: '',
      category: 'All',
      deck: 'All',
      difficulty: 'due',
      partOfSpeech: 'All',
      starred: false,
      date: 'All',
      page: 4,
    });
  });

  it('preserves the active equality filter for date-only changes and clears', () => {
    const base: LibraryCatalogQuery = {
      search: '', category: 'All', deck: 'All', difficulty: 'All', partOfSpeech: 'All',
      starred: false, date: '2026-08-14', page: 1,
    };
    const filterIntents: ReadonlyArray<Partial<LibraryCatalogQuery>> = [
      { category: 'Travel' },
      { deck: 'Week 1' },
      { difficulty: 'hard' },
      { partOfSpeech: 'noun' },
      { starred: true },
    ];

    for (const filter of filterIntents) {
      const query = { ...base, ...filter };

      expect(applyEqualityFilterIntent(query, { date: '2026-08-15' })).toEqual({
        ...query,
        date: '2026-08-15',
      });
      expect(applyEqualityFilterIntent(query, { date: 'All' })).toEqual({
        ...query,
        date: 'All',
      });
    }
  });

  it('normalizes every cloud equality combination to the declared Firestore index contract', () => {
    const indexedFields = cardEqualityCompositeIndexes();
    for (const date of ['All', '2026-08-14']) {
      for (let mask = 0; mask < 2 ** EQUALITY_FILTER_KEYS.length; mask += 1) {
        const requestedFilters = EQUALITY_FILTER_KEYS.filter((_, index) => (mask & (1 << index)) !== 0);
        const requested: LibraryCatalogQuery = {
          search: '',
          category: requestedFilters.includes('category') ? 'Travel' : 'All',
          deck: requestedFilters.includes('deck') ? 'Week 1' : 'All',
          difficulty: requestedFilters.includes('difficulty') ? 'easy' : 'All',
          partOfSpeech: requestedFilters.includes('partOfSpeech') ? 'noun' : 'All',
          starred: requestedFilters.includes('starred'),
          date,
          page: 1,
        };
        const normalized = normalizeLibraryQuery(requested);
        const activeFilters = activeEqualityFilters(normalized);
        const expectedFilter = requestedFilters[0] ?? null;

        expect(activeFilters).toEqual(expectedFilter ? [expectedFilter] : []);
        if (expectedFilter) {
          expect(indexedFields).toContainEqual({
            collectionGroup: 'cards',
            queryScope: 'COLLECTION',
            fields: [
              { fieldPath: FIRESTORE_FIELD_BY_EQUALITY_FILTER[expectedFilter], order: 'ASCENDING' },
              { fieldPath: 'createdAt', order: 'DESCENDING' },
              { fieldPath: '__name__', order: 'DESCENDING' },
            ],
          });
        }
      }
    }
  });

  it('normalizes multi-filter URL restores using equality priority without a date filter', () => {
    const restored = normalizeLibraryQuery(readLibraryQuery(
      '?category=Travel&deck=Week1&difficulty=easy&pos=noun&starred=1',
    ));

    expect(restored).toMatchObject({
      category: 'Travel',
      deck: 'All',
      difficulty: 'All',
      partOfSpeech: 'All',
      starred: false,
      date: 'All',
    });
  });

  it('treats invalid external dates as no date filter', () => {
    for (const date of [
      'not-a-date', '2026-02', '2026-02-30', '2026-04-31', '2026-02-30T00:00:00',
      'Feb 30, 2026', 'Aug 03, 2026',
    ]) {
      const query = readLibraryQuery(`?date=${date}&category=Travel&deck=Week1`);

      expect(normalizeLibraryQuery(query)).toMatchObject({
        category: 'Travel',
        deck: 'All',
        date: 'All',
      });
    }

    expect(normalizeLibraryQuery({
      search: '', category: 'All', deck: 'All', difficulty: 'All', partOfSpeech: 'All',
      starred: false, date: 'Today', page: 1,
    }).date).toBe('Today');
    expect(normalizeLibraryQuery({
      search: '', category: 'All', deck: 'All', difficulty: 'All', partOfSpeech: 'All',
      starred: false, date: 'Aug 3, 2026', page: 1,
    }).date).toBe('Aug 3, 2026');
  });

  it('serializes library state without dropping unrelated params or the hash', () => {
    const location = createLibraryLocation(
      '/app?campaign=summer&q=old#library',
      {
        search: 'new word',
        category: 'All',
        deck: 'IELTS',
        difficulty: 'All',
        partOfSpeech: 'All',
        starred: true,
        date: 'All',
        page: 2,
      },
    );

    expect(location).toBe('/app?campaign=summer&q=new+word&deck=IELTS&starred=1&page=2#library');
  });
});
