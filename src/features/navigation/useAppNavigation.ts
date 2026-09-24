import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { getReducedMotionScrollBehavior, motionDurations } from '../../lib/motion';
import { getEffectiveReducedMotion } from '../../lib/motionPreference';
import { useTheme } from '../theme/ThemeProvider';
import { ENABLED_UI_LOCALES } from '../../i18n/locales';
import { APP_VIEW_HEADINGS } from './app-view-headings';

export { applyLegacyThemePreference as applyThemePreference, resolveInitialDarkMode } from '../theme/themePreference';
export { APP_VIEW_HEADINGS } from './app-view-headings';

export type AppViewMode = 'landing' | 'today' | 'library' | 'catalog' | 'progress' | 'settings' | 'study' | 'quiz' | 'story' | 'spelling' | 'match' | 'shadowing';
const ROUTED_VIEW = /^(landing|today|catalog|library|progress|settings)$/;
const isLocaleLandingPath = (pathname: string): boolean => pathname === '/'
  || ENABLED_UI_LOCALES.filter(locale => locale !== 'en').some(locale => pathname.toLowerCase() === `/${locale.toLowerCase()}/` || pathname.toLowerCase() === `/${locale.toLowerCase()}`);

export const readAppViewMode = (location: string): AppViewMode => {
  const url = new URL(location, 'https://sonflash.invalid');
  if (/^\/library\/?$/.test(url.pathname)) return 'library';
  if (/^\/landing\/?$/.test(url.pathname)) return 'landing';
  const view = url.searchParams.get('view');
  if (view) return ROUTED_VIEW.test(view) ? view as AppViewMode : 'today';
  return isLocaleLandingPath(url.pathname) ? 'landing' : 'today';
};

export const createAppViewLocation = (
  currentLocation: string,
  viewMode: AppViewMode,
): string => {
  const url = new URL(currentLocation, 'https://sonflash.invalid');
  if (/^\/library\/?$/.test(url.pathname)) url.pathname = '/';
  url.searchParams.delete('lesson');
  if (viewMode === 'landing') url.searchParams.delete('view');
  else url.searchParams.set('view', ROUTED_VIEW.test(viewMode) ? viewMode : 'today');
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

const browserActiveElement = (): Element | null => globalThis.document?.activeElement ?? null;

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
  const navigationOpener = getActiveElement();
  const focusHeading = () => getHeading()?.focus({ preventScroll: true });
  const frame = scheduler.requestAnimationFrame(() => focusHeading());
  const settleTimer = scheduler.setTimeout(() => {
    const activeElement = getActiveElement();
    if (
      !activeElement
      || activeElement === bodyElement
      || activeElement === practiceOpener
      || activeElement === navigationOpener
    ) {
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
  scheduler = browserNavigationScheduler,
  getActiveElement = browserActiveElement,
  bodyElement = globalThis.document?.body ?? null,
  prefersReducedMotion = getEffectiveReducedMotion(),
  viewBrowser = windowViewBrowser,
}: {
  initialViewMode?: AppViewMode;
  practiceOpenerRef?: RefObject<HTMLElement | null> | null;
  scheduler?: NavigationScheduler;
  getActiveElement?: () => unknown;
  bodyElement?: unknown;
  prefersReducedMotion?: boolean;
  viewBrowser?: AppViewBrowser;
} = {}) {
  const { mode } = useTheme();
  const isDarkMode = mode === 'dark';
  const [viewMode, setViewModeState] = useState<AppViewMode>(() => (
    initialViewMode ?? readAppViewMode(viewBrowser.getCurrentUrl())
  ));
  const [viewFocusIntent, setViewFocusIntent] = useState(0);
  const viewHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const libraryHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const previousViewModeRef = useRef(viewMode);
  const currentViewModeRef = useRef(viewMode);
  const pendingViewFocusIntentRef = useRef(false);
  currentViewModeRef.current = viewMode;

  useEffect(() => viewBrowser.listenPopState(() => {
    const next = readAppViewMode(viewBrowser.getCurrentUrl());
    pendingViewFocusIntentRef.current = next !== currentViewModeRef.current;
    if (pendingViewFocusIntentRef.current) setViewFocusIntent(intent => intent + 1);
    setViewModeState(next);
  }), [viewBrowser]);

  useEffect(() => {
    if (previousViewModeRef.current === viewMode) return;
    previousViewModeRef.current = viewMode;
    if (!pendingViewFocusIntentRef.current) return;
    pendingViewFocusIntentRef.current = false;
    return scheduleViewHeadingFocus({
      getHeading: () => viewHeadingRef.current,
      getActiveElement,
      bodyElement,
      practiceOpener: practiceOpenerRef?.current ?? null,
      scheduler,
      settleDelayMs: prefersReducedMotion ? 0 : motionDurations.emphasis * 1000 + 20,
    });
  }, [bodyElement, getActiveElement, practiceOpenerRef, prefersReducedMotion, scheduler, viewMode]);

  const setViewMode = useCallback((next: AppViewMode) => {
    pendingViewFocusIntentRef.current = next !== currentViewModeRef.current;
    if (pendingViewFocusIntentRef.current) setViewFocusIntent(intent => intent + 1);
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
    viewHeading: APP_VIEW_HEADINGS[viewMode].message,
    viewHeadingRef,
    viewFocusIntent,
    libraryHeadingRef,
    focusLibraryHeading,
    isDarkMode,
  };
}
