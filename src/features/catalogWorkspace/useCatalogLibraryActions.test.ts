import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('useCatalogLibraryActions', () => {
  it('memoizes a normalized identity index instead of scanning the library for every catalog card', () => {
    const source = readFileSync(fileURLToPath(new URL('./useCatalogLibraryActions.ts', import.meta.url)), 'utf8');

    expect(source).toContain('useMemo');
    expect(source).toContain('createCatalogLibraryIdentityIndex(cards)');
    expect(source).toContain('catalogEntryIsInLibrary(libraryIdentityIndex, entry)');
    expect(source).not.toContain('catalogEntryIsInLibrary(cards, entry)');
  });
});
