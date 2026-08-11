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

  it('does not persist a new owner beside the previous owner payload when a write fails', () => {
    const values = new Map<string, string>([
      ['lingoflash_cards', JSON.stringify([{ id: 'owner-a-card', word: 'private' }])],
      ['lingoflash_cards_owner', 'owner-a'],
      ['lingoflash_custom_decks', JSON.stringify(['Owner A private deck'])],
      ['lingoflash_custom_decks_owner', 'owner-a'],
    ]);
    let failNextWrite = true;
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (failNextWrite) {
          failNextWrite = false;
          throw new DOMException('Interrupted write', 'QuotaExceededError');
        }
        values.set(key, value);
      },
      removeItem: (key: string) => { values.delete(key); },
    };
    const cache = createBrowserOwnerLibraryCache(storage);

    cache.writeDecks('owner-b', ['Owner B private deck']);
    const reloaded = createBrowserOwnerLibraryCache(storage);

    expect(reloaded.readDecks()).toEqual({
      ownerId: 'owner-a',
      decks: ['Owner A private deck'],
    });
  });

  it('does not persist a new card owner beside the previous owner cards when a write fails', () => {
    const ownerACard = {
      id: 'owner-a-card',
      word: 'private',
      translation: 'riêng tư',
      explanation: '',
      phonetic: '',
      emoji: '🔒',
      category: 'Other',
      audioUrl: null,
      imageUrl: null,
    };
    const ownerBCard = { ...ownerACard, id: 'owner-b-card', word: 'different' };
    const values = new Map<string, string>([
      ['lingoflash_cards', JSON.stringify([ownerACard])],
      ['lingoflash_cards_owner', 'owner-a'],
    ]);
    let failNextWrite = true;
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (failNextWrite) {
          failNextWrite = false;
          throw new DOMException('Interrupted write', 'QuotaExceededError');
        }
        values.set(key, value);
      },
      removeItem: (key: string) => { values.delete(key); },
    };
    const cache = createBrowserOwnerLibraryCache(storage);

    cache.writeCards('owner-b', [ownerBCard]);
    const reloaded = createBrowserOwnerLibraryCache(storage);

    expect(reloaded.readCards()).toMatchObject({
      ownerId: 'owner-a',
      cards: [{ id: 'owner-a-card', word: 'private' }],
    });
  });
});
