import { describe, expect, it } from 'vitest';
import {
  createLibraryLocation,
  normalizeLibraryQuery,
  readLibraryQuery,
  type LibraryCatalogQuery,
} from './libraryCatalogQuery';

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
