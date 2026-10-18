import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeWebWordsRoute, isWebWordsRouteActive, openWebWordsRoute } from './webWordsRoute';

/** The vitest node environment has no real `window`; stub just enough of it for the query-param route to read and rewrite the URL. */
function installBrowser(initialUrl: string) {
  let current = new URL(initialUrl);
  const fakeWindow = {
    get location() {
      return { pathname: current.pathname, search: current.search, hash: current.hash, href: current.href };
    },
    history: {
      pushState: (_state: unknown, _title: string, url: string) => {
        current = new URL(url, current.href);
      },
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
  vi.stubGlobal('window', fakeWindow);
  vi.stubGlobal('PopStateEvent', class {
    readonly type: string;
    constructor(type: string) { this.type = type; }
  });
  return () => current;
}

describe('WebWords route', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('is inactive by default', () => {
    installBrowser('https://sonflash.example/');
    expect(isWebWordsRouteActive()).toBe(false);
  });

  it('opens by setting ?webWords=1 without disturbing an existing ?view= param', () => {
    const currentUrl = installBrowser('https://sonflash.example/?view=today');

    openWebWordsRoute();

    expect(isWebWordsRouteActive()).toBe(true);
    expect(currentUrl().searchParams.get('view')).toBe('today');
    expect(currentUrl().searchParams.get('webWords')).toBe('1');
  });

  it('closes by removing webWords while leaving the rest of the URL intact', () => {
    const currentUrl = installBrowser('https://sonflash.example/?view=library&webWords=1');

    closeWebWordsRoute();

    expect(isWebWordsRouteActive()).toBe(false);
    expect(currentUrl().searchParams.get('view')).toBe('library');
    expect(currentUrl().searchParams.has('webWords')).toBe(false);
  });

  it('treats any value other than the literal "1" as inactive', () => {
    installBrowser('https://sonflash.example/?webWords=true');
    expect(isWebWordsRouteActive()).toBe(false);
  });
});
