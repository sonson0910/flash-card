import { describe, expect, it } from 'vitest';
import { gamificationStorageKeys } from '../gamification/gamificationStorage';
import { ownerScopedCardCacheKey, serializeOwnerScopedCardCache } from '../library/ownerScopedCardCache';
import { removeOwnerLocalKeys } from './accountDataService';

describe('account deletion local cleanup', () => {
  it('removes only the deleted owner cache and leaves another owner and anonymous XP alone', () => {
    const values = new Map<string, string>([
      ...Object.values(gamificationStorageKeys('owner-a')).map(key => [key, 'private'] as const),
      [gamificationStorageKeys('owner-b').snapshot, 'keep'],
      [gamificationStorageKeys(null).snapshot, 'anonymous'],
      ['lingoflash_cloud_page_owner-a', 'private'],
      ['lingoflash_cloud_page_owner-b', 'keep'],
      ['lingoflash_no_image_v1_owner-a_card', 'private'],
      ['lingoflash_no_image_v1_owner-b_card', 'keep'],
      [ownerScopedCardCacheKey, serializeOwnerScopedCardCache('owner-a', [{ id: 'private' }])],
    ]);
    const session = new Map([['lingoflash_word_draft', 'private'], ['lingoflash_word_operation', 'private']]);
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      removeItem: (key: string) => { values.delete(key); },
      get length() { return values.size; },
      key: (index: number) => [...values.keys()][index] ?? null,
    };
    removeOwnerLocalKeys(storage, { removeItem: key => { session.delete(key); } }, 'owner-a');
    for (const key of Object.values(gamificationStorageKeys('owner-a'))) expect(values.has(key)).toBe(false);
    expect(values.has(ownerScopedCardCacheKey)).toBe(false);
    expect(values.has('lingoflash_no_image_v1_owner-a_card')).toBe(false);
    expect(values.get('lingoflash_cloud_page_owner-b')).toBe('keep');
    expect(values.get(gamificationStorageKeys(null).snapshot)).toBe('anonymous');
    expect(session.size).toBe(0);
  });
});
