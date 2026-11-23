import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = relativePath => fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8');

describe('documentation states the rules the code enforces', () => {
  it('describes the library session without a local mirror or offline write queue', () => {
    const context = read('CONTEXT.md');
    for (const removed of ['queued writes', 'queued offline mutations', 'local mirror', 'Vite dev-server']) {
      expect(context.toLowerCase()).not.toContain(removed.toLowerCase());
    }
    expect(context).toContain('Firestore');
  });

  it('names the legacy library migration confirmations and job the operator enforces', () => {
    const operator = read('functions/src/legacyLibraryMigrationOperator.ts');
    const spec = read('docs/specs/legacy-library-admin-migration.md');
    const confirmations = [...operator.matchAll(/confirmation !== '([A-Z_0-9]+_QUERY_V\d+)'/g)].map(match => match[1]);
    expect(confirmations.length).toBe(2);
    for (const confirmation of confirmations) expect(spec).toContain(confirmation);
    const jobId = operator.match(/const JOB_ID = '([^']+)'/)?.[1];
    expect(jobId).toBeTruthy();
    expect(spec).toContain(jobId);
    expect(spec).not.toMatch(/QUERY_V(?!3)\d+/);
  });

  it('tells editors to supply the approval digest, not the source digest, to the protected build', () => {
    const notes = read('catalog/english-paths-draft/editorial-notes.md');
    expect(notes).toMatch(/CATALOG_APPROVED_DIGEST/);
    expect(notes).toMatch(/approvalDigest/);
  });

  it('records that unmigrated legacy shared decks are no longer readable by id', () => {
    const adr = read('docs/architecture/adr-006-transactional-card-identity-and-private-share-ownership.md');
    expect(adr).not.toContain('tightly shaped legacy format');
    expect(adr).toMatch(/only schema 2/i);
  });
});
