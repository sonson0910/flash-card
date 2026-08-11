import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isCloudBackoffActive,
  readLocalJson,
  removeLocalValue,
  waitForInitialMedia,
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

  it('uses media that arrives inside the initial card window', async () => {
    vi.useFakeTimers();
    const media = Promise.resolve({
      audioUrl: 'https://media.example/word.mp3',
      imageUrl: 'https://images.pexels.com/word.jpeg',
    });

    try {
      await expect(waitForInitialMedia(media, 50)).resolves.toEqual({
        audioUrl: 'https://media.example/word.mp3',
        imageUrl: 'https://images.pexels.com/word.jpeg',
      });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops waiting when initial media exceeds the publication window', async () => {
    vi.useFakeTimers();
    const media = new Promise<{ audioUrl: string | null; imageUrl: string | null }>(() => undefined);

    try {
      const result = waitForInitialMedia(media, 50);
      await vi.advanceTimersByTimeAsync(50);
      await expect(result).resolves.toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats initial media failure as optional and clears the publication timer', async () => {
    vi.useFakeTimers();

    try {
      await expect(waitForInitialMedia(Promise.reject(new Error('media unavailable')), 50))
        .resolves.toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
