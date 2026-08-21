import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Firestore legacy migration paging', () => {
  it('uses a cursor-limited card query and aggregate counts instead of materializing a library', () => {
    const source = readFileSync(new URL('../src/legacyLibraryMigrationFirestore.ts', import.meta.url), 'utf8');

    expect(source).toContain('.orderBy(FieldPath.documentId())');
    expect(source).toContain('.limit(pageSize + 1)');
    expect(source).toContain('.count().get()');
    expect(source).toContain("Object.prototype.hasOwnProperty.call(options, 'cursor')");
    expect(source).not.toContain('cardsRef(database, ownerId).get()');
  });
});
