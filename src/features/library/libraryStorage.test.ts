import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isCloudBackoffActive,
  readLocalJson,
  removeLocalValue,
  writeLocalValue,
} from './libraryStorage';

describe('library browser storage safeguards', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('returns the fallback when denied storage also rejects cleanup', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new DOMException('Access denied', 'SecurityError'); },
      setItem: () => { throw new DOMException('Access denied', 'SecurityError'); },
      removeItem: () => { throw new DOMException('Access denied', 'SecurityError'); },
    });

    expect(readLocalJson('lingoflash_cards', [{ id: 'fallback' }])).toEqual([{ id: 'fallback' }]);
    expect(isCloudBackoffActive('owner-a')).toBe(false);
  });

  it('recovers from invalid JSON even when removing it is denied', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => '{invalid',
      setItem: () => undefined,
      removeItem: () => { throw new DOMException('Access denied', 'SecurityError'); },
    });

    expect(readLocalJson('lingoflash_cards', [])).toEqual([]);
  });

  it('lets route state continue when writes are denied or storage is full', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => { throw new DOMException('Quota exceeded', 'QuotaExceededError'); },
      removeItem: () => { throw new DOMException('Access denied', 'SecurityError'); },
    });

    expect(writeLocalValue('lingoflash_cards', '[]')).toBe(false);
    expect(removeLocalValue('lingoflash_cards')).toBe(false);
  });
});
