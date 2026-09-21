import { readFileSync } from 'node:fs';
import { Timestamp } from 'firebase-admin/firestore';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LEGACY_SHARED_DECK_OPERATION_COMPATIBILITY_END } from '../src/inputValidation.js';

describe('shared deck callable rollout', () => {
  afterEach(() => vi.restoreAllMocks());
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

  it('rejects a generated-format V2 ID when its timestamp was changed', async () => {
    const { createSharedDeckV2 } = await import('../src/index.js');
    const operationCreatedAt = '2026-09-21T00:00:00.000Z';
    await expect(createSharedDeckV2.run({
      auth: { uid: 'owner-1' },
      data: {
        expectedOwnerId: 'owner-1',
        opId: `share-v2:${Date.parse(operationCreatedAt)}:550e8400-e29b-41d4-a716-446655440000`,
        operationCreatedAt: '2026-09-21T00:00:01.000Z',
        category: 'Basics', cards: [{ word: 'hello', translation: 'xin chào' }],
      },
    } as never)).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects a legacy operation after the compatibility cutoff', async () => {
    vi.spyOn(Timestamp, 'now').mockReturnValue(Timestamp.fromDate(new Date('2027-01-01T00:00:00.000Z')));
    const { createSharedDeck } = await import('../src/index.js');
    await expect(createSharedDeck.run({
      auth: { uid: 'owner-1' },
      data: {
        opId: 'legacy-operation', operationCreatedAt: '2026-12-31T23:59:59.999Z',
        category: 'Basics', cards: [{ word: 'hello', translation: 'xin chào' }],
      },
    } as never)).rejects.toMatchObject({ code: 'failed-precondition' });
  });

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
    expect(LEGACY_SHARED_DECK_OPERATION_COMPATIBILITY_END).toBe('2026-12-31T23:59:59.999Z');
    expect(source).toContain('Shared-deck operation ID and time are required.');
    expect(source).toContain('strictSharedDeckOperationMatches(input)');
    expect(source).toContain('parseCreateSharedDeckRequest(request.data)');
    expect(source).toContain('Legacy shared-deck creation compatibility has expired.');
  });
});
