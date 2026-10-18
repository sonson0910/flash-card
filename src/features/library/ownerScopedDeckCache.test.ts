import { describe, expect, it } from 'vitest';
import { customDeckCoverKey } from './customDecks';
import { parseOwnerScopedDeckCache, serializeOwnerScopedDeckCache } from './ownerScopedDeckCache';

describe('owner scoped deck cache', () => {
  it('accepts version 1 cache records with no presets', () => {
    expect(parseOwnerScopedDeckCache(JSON.stringify({
      version: 1,
      ownerId: 'owner-a',
      decks: ['Travel'],
    }))).toEqual({ ownerId: 'owner-a', decks: ['Travel'], coverPresets: {} });
  });

  it('writes version 2 and drops presets for inactive decks', () => {
    const key = customDeckCoverKey('Travel');
    const serialized = serializeOwnerScopedDeckCache('owner-a', ['Travel'], {
      [key]: 'moss',
      orphan: 'violet',
    });

    expect(JSON.parse(serialized).version).toBe(2);
    expect(parseOwnerScopedDeckCache(serialized)).toEqual({
      ownerId: 'owner-a', decks: ['Travel'], coverPresets: { [key]: 'moss' },
    });
  });
});
