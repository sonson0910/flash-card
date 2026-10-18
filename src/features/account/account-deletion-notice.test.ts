import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  consumeAccountDeletionCacheNotice,
  consumeAccountDeletionStartedNotice,
  markAccountDeletionCacheNotice,
  markAccountDeletionStartedNotice,
} from './account-deletion-notice';

describe('account deletion notices', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps both warnings in the URL when session storage fails, then removes only the warning flags', () => {
    const location = { href: 'https://sonflash.app/?view=library#return' };
    const replaceState = vi.fn((_state: unknown, _title: string, url: URL) => {
      location.href = url.href;
    });
    vi.stubGlobal('sessionStorage', {
      setItem: () => { throw new Error('storage blocked'); },
      getItem: () => { throw new Error('storage blocked'); },
    });
    vi.stubGlobal('location', location);
    vi.stubGlobal('history', { state: null, replaceState });

    expect(markAccountDeletionStartedNotice()).toBe(true);
    expect(markAccountDeletionCacheNotice()).toBe(true);
    expect(location.href).toContain('sfDeleteStarted=1');
    expect(location.href).toContain('sfDeleteCache=1');

    expect(consumeAccountDeletionStartedNotice()).toBe(true);
    expect(consumeAccountDeletionCacheNotice()).toBe(true);
    expect(consumeAccountDeletionStartedNotice()).toBe(false);
    expect(consumeAccountDeletionCacheNotice()).toBe(false);
    expect(location.href).toBe('https://sonflash.app/?view=library#return');
  });

  it('reports when neither storage nor URL history can retain a warning', () => {
    vi.stubGlobal('sessionStorage', { setItem: () => { throw new Error('storage blocked'); } });
    vi.stubGlobal('location', { href: 'https://sonflash.app/' });
    vi.stubGlobal('history', { state: null, replaceState: () => { throw new Error('history blocked'); } });

    expect(markAccountDeletionCacheNotice()).toBe(false);
  });
});
