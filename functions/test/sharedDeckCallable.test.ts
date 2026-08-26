import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('shared deck callable rollout', () => {
  it.each([undefined, 'owner-2'])(
    'denies a V2 request for a missing or mismatched expected owner: %s',
    async expectedOwnerId => {
      const { createSharedDeckV2 } = await import('../src/index.js');

      await expect(createSharedDeckV2.run({
        auth: { uid: 'owner-1' },
        data: {
          expectedOwnerId,
          category: 'Basics',
          cards: [{ word: 'hello', translation: 'xin chào' }],
        },
      } as never)).rejects.toMatchObject({ code: 'permission-denied' });
    },
  );

  it('keeps the legacy callable and authorizes V2 before quota or persistence', () => {
    const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    const legacyStart = source.indexOf('export const createSharedDeck =');
    const v2Start = source.indexOf('export const createSharedDeckV2 =');
    const v2End = source.indexOf('export const revokeSharedDeck =');
    const v2Handler = source.slice(v2Start, v2End);

    expect(legacyStart).toBeGreaterThan(-1);
    expect(v2Start).toBeGreaterThan(legacyStart);
    expect(v2Handler.indexOf('sharedDeckRequestOwnerMatches')).toBeGreaterThan(-1);
    expect(v2Handler.indexOf('sharedDeckRequestOwnerMatches'))
      .toBeLessThan(v2Handler.indexOf('createSharedDeckForOwner'));
  });
});
