import { afterEach, describe, expect, it, vi } from 'vitest';
import { readAppViewMode, readWebWordsReturnView } from '../navigation/useAppNavigation';
import { openWebWordsRoute } from './webWordsRoute';

/** The vitest node environment has no real `window`; stub just enough of it for the route to read and rewrite the URL. */
function installBrowser(initialUrl: string) {
  let current = new URL(initialUrl);
  const replaceState = vi.fn((_state: unknown, _title: string, url: string) => {
    current = new URL(url, current.href);
  });
  const pushState = vi.fn((_state: unknown, _title: string, url: string) => {
    current = new URL(url, current.href);
  });
  const fakeWindow = {
    get location() {
      return { pathname: current.pathname, search: current.search, hash: current.hash, href: current.href };
    },
    history: { state: null, pushState, replaceState },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
  vi.stubGlobal('window', fakeWindow);
  vi.stubGlobal('PopStateEvent', class {
    readonly type: string;
    constructor(type: string) { this.type = type; }
  });
  const currentUrl = () => current;
  return Object.assign(currentUrl, { pushState, replaceState });
}

describe('WebWords route', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('opens the web words view and remembers the opener for the back link', () => {
    const browser = installBrowser('https://sonflash.example/?view=today&locale=en#top');

    openWebWordsRoute();

    expect(browser.pushState).toHaveBeenCalledTimes(1);
    expect(readAppViewMode(browser().href)).toBe('web-words');
    expect(readWebWordsReturnView(browser().href)).toBe('today');
    expect(browser().searchParams.get('locale')).toBe('en');
    expect(browser().hash).toBe('#top');
  });

  it('drops a running lesson from the URL so closing returns to the plan, not the lesson', () => {
    const browser = installBrowser('https://sonflash.example/?view=today&lesson=session');

    openWebWordsRoute();

    expect(browser().searchParams.has('lesson')).toBe(false);
    expect(readAppViewMode(browser().href)).toBe('web-words');
  });

  it('returns to Vocabulary when opened from Vocabulary, without an extra parameter', () => {
    const browser = installBrowser('https://sonflash.example/?view=library');

    openWebWordsRoute();

    expect(browser().searchParams.has('from')).toBe(false);
    expect(readWebWordsReturnView(browser().href)).toBe('library');
  });
});
