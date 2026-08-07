import { describe, expect, it } from 'vitest';
import { createBrowserOwnerLibraryCache } from './useOwnerLibrarySession';

describe('browser owner library cache', () => {
  it('treats denied browser storage as an empty recoverable cache', () => {
    const storage = {
      getItem: () => { throw new DOMException('Access denied', 'SecurityError'); },
      setItem: () => { throw new DOMException('Access denied', 'SecurityError'); },
      removeItem: () => { throw new DOMException('Access denied', 'SecurityError'); },
    };
    const cache = createBrowserOwnerLibraryCache(storage);

    expect(cache.readCards()).toEqual({ ownerId: null, cards: [] });
    expect(cache.readDecks()).toEqual({ ownerId: null, decks: [] });
    expect(cache.hasCompletedLegacyMigration('owner-a')).toBe(false);
  });

  it('does not throw when browser storage is full during a cache write', () => {
    const storage = {
      getItem: () => null,
      setItem: () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); },
      removeItem: () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); },
    };
    const cache = createBrowserOwnerLibraryCache(storage);

    expect(() => cache.writeCards('owner-a', [])).not.toThrow();
    expect(() => cache.writeDecks('owner-a', ['IELTS'])).not.toThrow();
    expect(cache.readCards().ownerId).toBe('owner-a');
    expect(cache.readDecks()).toEqual({ ownerId: 'owner-a', decks: ['IELTS'] });
    expect(() => cache.discardCards()).not.toThrow();
    expect(() => cache.discardDecks()).not.toThrow();
    expect(() => cache.markLegacyMigrationComplete('owner-a')).not.toThrow();
    expect(cache.hasCompletedLegacyMigration('owner-a')).toBe(true);
  });

  it('keeps successful writes in session memory if storage becomes denied later', () => {
    const values = new Map<string, string>();
    let denied = false;
    const storage = {
      getItem: (key: string) => {
        if (denied) throw new DOMException('Access denied', 'SecurityError');
        return values.get(key) ?? null;
      },
      setItem: (key: string, value: string) => {
        if (denied) throw new DOMException('Access denied', 'SecurityError');
        values.set(key, value);
      },
      removeItem: (key: string) => { values.delete(key); },
    };
    const cache = createBrowserOwnerLibraryCache(storage);

    cache.writeDecks('owner-a', ['IELTS']);
    denied = true;

    expect(cache.readDecks()).toEqual({ ownerId: 'owner-a', decks: ['IELTS'] });
  });
});
