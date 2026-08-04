import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { getReducedMotionScrollBehavior, motionDurations } from '../../lib/motion';

export type AppViewMode = 'today' | 'library' | 'catalog' | 'progress' | 'study' | 'quiz' | 'story' | 'spelling';

export const APP_VIEW_HEADINGS: Readonly<Record<AppViewMode, string>> = {
  today: 'Today learning plan',
  library: 'Vocabulary library',
  catalog: 'Learning paths',
  progress: 'Learning progress',
  study: 'Study session',
  quiz: 'Vocabulary quiz',
  spelling: 'Spelling practice',
  story: 'Context story',
};

export const readAppViewMode = (location: string): AppViewMode => {
  const url = new URL(location, 'https://sonflash.invalid');
  if (/^\/library\/?$/.test(url.pathname)) return 'library';
  const view = url.searchParams.get('view');
  return view === 'catalog' || view === 'library' || view === 'progress' || view === 'today'
    ? view
    : 'today';
};

export const createAppViewLocation = (
  currentLocation: string,
  viewMode: AppViewMode,
): string => {
  const url = new URL(currentLocation, 'https://sonflash.invalid');
  if (/^\/library\/?$/.test(url.pathname)) url.pathname = '/';
  url.searchParams.delete('lesson');
  if (viewMode === 'catalog' || viewMode === 'library' || viewMode === 'progress') {
    url.searchParams.set('view', viewMode);
  } else url.searchParams.delete('view');
  return `${url.pathname}${url.search}${url.hash}`;
};

export interface AppViewBrowser {
  getCurrentUrl(): string;
  pushState(location: string): void;
  listenPopState(listener: () => void): () => void;
}

const windowViewBrowser: AppViewBrowser = {
  getCurrentUrl: () => globalThis.location?.href ?? '/',
  pushState: location => globalThis.history?.pushState(globalThis.history.state, '', location),
  listenPopState: listener => {
    globalThis.addEventListener?.('popstate', listener);
    return () => globalThis.removeEventListener?.('popstate', listener);
  },
};

type ThemeStorageReader = Pick<Storage, 'getItem'>;
type ThemeStorageWriter = Pick<Storage, 'setItem'>;
type ThemeRoot = { classList: Pick<DOMTokenList, 'add' | 'remove'> };

export interface NavigationScheduler {
  requestAnimationFrame(callback: FrameRequestCallback): unknown;
  cancelAnimationFrame(handle: unknown): void;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

const browserNavigationScheduler: NavigationScheduler = {
  requestAnimationFrame: callback => globalThis.requestAnimationFrame(callback),
  cancelAnimationFrame: handle => globalThis.cancelAnimationFrame(handle as number),
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: handle => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

const browserStorage = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

const browserRoot = (): HTMLElement | null => globalThis.document?.documentElement ?? null;
const browserActiveElement = (): Element | null => globalThis.document?.activeElement ?? null;

export const resolveInitialDarkMode = (storage: ThemeStorageReader | null): boolean => {
  try {
    const saved = storage?.getItem('lingoflash_theme');
    return saved ? saved === 'dark' : true;
  } catch {
    return true;
  }
};

export const applyThemePreference = (
  darkMode: boolean,
  storage: ThemeStorageWriter | null,
  rootElement: ThemeRoot | null,
) => {
  try {
    storage?.setItem('lingoflash_theme', darkMode ? 'dark' : 'light');
  } catch {
    // Theme remains usable in memory when browser storage is unavailable.
  }
  if (darkMode) rootElement?.classList.add('dark');
  else rootElement?.classList.remove('dark');
};

export const focusHeadingWithMotionPreference = (
  heading: Pick<HTMLElement, 'focus' | 'scrollIntoView'> | null,
  prefersReducedMotion: boolean,
): boolean => {
  if (!heading) return false;
  heading.scrollIntoView({
    behavior: getReducedMotionScrollBehavior(prefersReducedMotion),
    block: 'start',
  });
  heading.focus({ preventScroll: true });
  return true;
};

export const scheduleViewHeadingFocus = ({
  getHeading,
  getActiveElement,
  bodyElement,
  practiceOpener,
  scheduler = browserNavigationScheduler,
  settleDelayMs = motionDurations.emphasis * 1000 + 20,
}: {
  getHeading: () => Pick<HTMLElement, 'focus'> | null;
  getActiveElement: () => unknown;
  bodyElement: unknown;
  practiceOpener: unknown;
  scheduler?: NavigationScheduler;
  settleDelayMs?: number;
}): (() => void) => {
  const focusHeading = () => getHeading()?.focus({ preventScroll: true });
  const frame = scheduler.requestAnimationFrame(() => focusHeading());
  const settleTimer = scheduler.setTimeout(() => {
    const activeElement = getActiveElement();
    if (!activeElement || activeElement === bodyElement || activeElement === practiceOpener) {
      focusHeading();
    }
  }, settleDelayMs);

  return () => {
    scheduler.cancelAnimationFrame(frame);
    scheduler.clearTimeout(settleTimer);
  };
};

export function useAppNavigation({
  initialViewMode,
  practiceOpenerRef = null,
  storage: suppliedStorage,
  rootElement: suppliedRoot,
  scheduler = browserNavigationScheduler,
  getActiveElement = browserActiveElement,
  bodyElement = globalThis.document?.body ?? null,
  prefersReducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  viewBrowser = windowViewBrowser,
}: {
  initialViewMode?: AppViewMode;
  practiceOpenerRef?: RefObject<HTMLElement | null> | null;
  storage?: Storage | null;
  rootElement?: HTMLElement | null;
  scheduler?: NavigationScheduler;
  getActiveElement?: () => unknown;
  bodyElement?: unknown;
  prefersReducedMotion?: boolean;
  viewBrowser?: AppViewBrowser;
} = {}) {
  const storage = suppliedStorage === undefined ? browserStorage() : suppliedStorage;
  const rootElement = suppliedRoot === undefined ? browserRoot() : suppliedRoot;
  const [viewMode, setViewModeState] = useState<AppViewMode>(() => (
    initialViewMode ?? readAppViewMode(viewBrowser.getCurrentUrl())
  ));
  const [isDarkMode, setIsDarkMode] = useState(() => resolveInitialDarkMode(storage));
  const viewHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const libraryHeadingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => applyThemePreference(isDarkMode, storage, rootElement), [isDarkMode, rootElement, storage]);

  useEffect(() => viewBrowser.listenPopState(() => {
    setViewModeState(readAppViewMode(viewBrowser.getCurrentUrl()));
  }), [viewBrowser]);

  useEffect(() => scheduleViewHeadingFocus({
    getHeading: () => viewHeadingRef.current,
    getActiveElement,
    bodyElement,
    practiceOpener: practiceOpenerRef?.current ?? null,
    scheduler,
    settleDelayMs: prefersReducedMotion ? 0 : motionDurations.emphasis * 1000 + 20,
  }), [bodyElement, getActiveElement, practiceOpenerRef, prefersReducedMotion, scheduler, viewMode]);

  const toggleTheme = useCallback(() => setIsDarkMode(previous => !previous), []);
  const setViewMode = useCallback((next: AppViewMode) => {
    setViewModeState(next);
    const current = viewBrowser.getCurrentUrl();
    const location = createAppViewLocation(current, next);
    const currentPath = new URL(current, 'https://sonflash.invalid');
    if (location !== `${currentPath.pathname}${currentPath.search}${currentPath.hash}`) {
      viewBrowser.pushState(location);
    }
  }, [viewBrowser]);
  const focusLibraryHeading = useCallback(() => {
    const frame = scheduler.requestAnimationFrame(() => {
      focusHeadingWithMotionPreference(libraryHeadingRef.current, prefersReducedMotion);
    });
    return () => scheduler.cancelAnimationFrame(frame);
  }, [prefersReducedMotion, scheduler]);

  return {
    viewMode,
    setViewMode,
    viewHeading: APP_VIEW_HEADINGS[viewMode],
    viewHeadingRef,
    libraryHeadingRef,
    focusLibraryHeading,
    isDarkMode,
    setIsDarkMode,
    toggleTheme,
  };
}
