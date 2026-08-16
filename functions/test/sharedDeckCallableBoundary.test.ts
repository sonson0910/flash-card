import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string) => fs.readFileSync(
  new URL(`../src/${relativePath}`, import.meta.url),
  'utf8',
);

describe('shared-deck callable boundary', () => {
  it('consumes runtime-source admission before parsing or reading Firestore', () => {
    const source = readSource('index.ts');
    const block = source.slice(
      source.indexOf('export const loadSharedDeck'),
      source.indexOf('export const revokeSharedDeck'),
    );
    const admission = block.indexOf('sharedDeckLoadAdmission.consume(request.rawRequest.ip)');
    const parse = block.indexOf('parseRevokeSharedDeckRequest(request.data)');
    const firestoreRead = block.indexOf('loadPublicSharedDeck(');

    expect(admission).toBeGreaterThan(-1);
    expect(admission).toBeLessThan(parse);
    expect(parse).toBeLessThan(firestoreRead);
    expect(block).toContain("'resource-exhausted'");
    expect(block).toContain('retryAfterSeconds');
    expect(block).not.toContain('x-forwarded-for');
  });

  it('uses the structured logger instead of raw Functions console output', () => {
    const callableSource = readSource('index.ts');
    const operatorSource = readSource('legacyLibraryMigrationOperator.ts');

    expect(callableSource).not.toMatch(/console\.(?:warn|error)/);
    expect(operatorSource).not.toMatch(/console\.(?:warn|error)/);
    expect(callableSource).toContain("event: 'legacy-library-migration'");
    expect(operatorSource).toContain("event: 'legacy-library-operator'");
  });
});
