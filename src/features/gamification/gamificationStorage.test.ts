import { describe, expect, it } from 'vitest';
import {
  gamificationStorageKeys,
  readGamificationSnapshot,
  writeGamificationSnapshot,
} from './gamificationStorage';

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe('UID-scoped gamification storage', () => {
  it('uses separate keys for anonymous sessions and each account', () => {
    expect(gamificationStorageKeys(null).xp).not.toBe(gamificationStorageKeys('user-a').xp);
    expect(gamificationStorageKeys('user-a').xp).not.toBe(gamificationStorageKeys('user-b').xp);
  });

  it('does not expose one account snapshot to another account', () => {
    const storage = new MemoryStorage();
    writeGamificationSnapshot(storage, 'user-a', {
      streak: 4,
      xp: 850,
      lastActive: 'Mon Jul 13 2026',
      history: { 'Jul 13, 2026': 850 },
    });

    expect(readGamificationSnapshot(storage, 'user-b')).toEqual({
      streak: 0,
      xp: 0,
      lastActive: null,
      history: {},
    });
  });

  it('ignores legacy global keys because their owner cannot be proven', () => {
    const storage = new MemoryStorage();
    storage.setItem('lingoflash_xp', '999');
    storage.setItem('lingoflash_xp_history', JSON.stringify({ 'Jul 12, 2026': 999 }));

    expect(readGamificationSnapshot(storage, 'new-user').xp).toBe(0);
    expect(readGamificationSnapshot(storage, 'new-user').history).toEqual({});
  });

  it('degrades to an empty in-memory snapshot when storage reads are denied', () => {
    const deniedStorage = {
      getItem: () => { throw new DOMException('Access denied', 'SecurityError'); },
      setItem: () => { throw new DOMException('Access denied', 'SecurityError'); },
    };

    expect(readGamificationSnapshot(deniedStorage, 'user-a')).toEqual({
      streak: 0,
      xp: 0,
      lastActive: null,
      history: {},
    });
  });

  it('keeps the in-memory session usable when storage is full', () => {
    const fullStorage = {
      getItem: () => null,
      setItem: () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); },
    };

    expect(() => writeGamificationSnapshot(fullStorage, 'user-a', {
      streak: 2,
      xp: 120,
      lastActive: 'Tue Aug 04 2026',
      history: { 'Aug 4, 2026': 120 },
    })).not.toThrow();
  });
});
