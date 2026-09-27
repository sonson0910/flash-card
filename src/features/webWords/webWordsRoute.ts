import { useCallback, useEffect, useState } from 'react';

/**
 * WebWords is intentionally NOT a value in the `AppViewMode` union
 * (`src/features/navigation/useAppNavigation.ts`, controller-owned): joining
 * that union would also require touching its `ROUTED_VIEW` regex and the
 * `APP_VIEW_HEADINGS` record for type exhaustiveness. Instead the page opens
 * through its own independent `?webWords=1` query parameter, layered on top
 * of whatever `?view=` is already in the URL (so returning to Today/Library
 * from the browser back button keeps working exactly as before). This keeps
 * every file that owns `AppViewMode` untouched.
 */
const WEB_WORDS_PARAM = 'webWords';

const readIsActive = (): boolean => {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get(WEB_WORDS_PARAM) === '1';
};

const pushWebWordsParam = (active: boolean): void => {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (active) url.searchParams.set(WEB_WORDS_PARAM, '1');
  else url.searchParams.delete(WEB_WORDS_PARAM);
  window.history.pushState(null, '', `${url.pathname}?${url.searchParams.toString()}${url.hash}`);
  window.dispatchEvent(new PopStateEvent('popstate'));
};

/** Opens the WebWords page from anywhere (e.g. the Today strip's CTA) without importing the page itself. */
export function openWebWordsRoute(): void {
  pushWebWordsParam(true);
}

/** Closes the WebWords page back to whatever `?view=` was already in the URL. */
export function closeWebWordsRoute(): void {
  pushWebWordsParam(false);
}

export function isWebWordsRouteActive(): boolean {
  return readIsActive();
}

export interface WebWordsRoute {
  readonly isOpen: boolean;
  readonly open: () => void;
  readonly close: () => void;
}

/** Tracks the `?webWords=1` query param across browser navigation (back/forward, pushState from elsewhere). */
export function useWebWordsRoute(): WebWordsRoute {
  const [isOpen, setIsOpen] = useState(readIsActive);

  useEffect(() => {
    const onPopState = () => setIsOpen(readIsActive());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const open = useCallback(() => {
    openWebWordsRoute();
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    closeWebWordsRoute();
    setIsOpen(false);
  }, []);

  return { isOpen, open, close };
}
