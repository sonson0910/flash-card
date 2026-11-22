import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { getReducedMotionScrollBehavior, motionDurations } from '../../lib/motionTimings';
import { getEffectiveReducedMotion } from '../../lib/motionPreference';
import { useTheme } from '../theme/ThemeProvider';
import { ENABLED_UI_LOCALES } from '../../i18n/locales';
import { DEFAULT_SETTINGS_SECTION, readSettingsSection, type SettingsSectionId } from '../settings/settings-sections';

export { applyLegacyThemePreference as applyThemePreference, resolveInitialDarkMode } from '../theme/themePreference';
export { APP_VIEW_HEADINGS } from './app-view-headings';

/**
 * Every view the app runtime can show. The routed ones (`ROUTED_VIEW`) are
 * written to `?view=` and survive reload and browser back/forward.
 *
 * Adding a workspace view (for example a Files page): add it to this union and
 * to `ROUTED_VIEW`, give it a heading in `APP_VIEW_HEADINGS`, render it in
 * `src/app/AppViewStage.tsx`, decide which shell tab it highlights in
 * `shellNavigationView` (`src/components/shell/shellTypes.ts`), and exclude it
 * from `shouldShowViewHeading` when the view renders its own `<h1>`.
 */
export type AppViewMode = 'landing' | 'today' | 'library' | 'catalog' | 'progress' | 'settings' | 'web-words' | 'files' | 'courses' | 'study' | 'quiz' | 'story' | 'spelling' | 'language-drill' | 'match' | 'shadowing';
const ROUTED_VIEW = /^(landing|today|catalog|library|progress|settings|web-words|files|courses)$/;
/** Older links opened web words as `?webWords=1` on top of another view; they still open it. */
const LEGACY_WEB_WORDS_PARAM = 'webWords';
/** The view a sub-view returns to (`?view=web-words&from=today`). */
const RETURN_VIEW_PARAM = 'from';
const SETTINGS_SECTION_PARAM = 'section';
/** The course whose goals the courses page opens on (`?view=courses&goals=<course id>`). */
const COURSE_GOALS_PARAM = 'goals';
const COURSE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const isLocaleLandingPath = (pathname: string): boolean => {
  const lower = pathname.replace(/\/$/, '').toLowerCase();
  return !lower || ENABLED_UI_LOCALES.some(locale => locale !== 'en' && lower === `/${locale.toLowerCase()}`);
};

export const readAppViewMode = (location: string): AppViewMode => {
  const url = new URL(location, 'https://sonflash.invalid');
  if (/^\/library\/?$/.test(url.pathname)) return 'library';
  if (/^\/landing\/?$/.test(url.pathname)) return 'landing';
  if (url.searchParams.get(LEGACY_WEB_WORDS_PARAM) === '1') return 'web-words';
  const view = url.searchParams.get('view');
  if (view) return ROUTED_VIEW.test(view) ? view as AppViewMode : 'today';
  return isLocaleLandingPath(url.pathname) && !url.searchParams.get('lesson') ? 'landing' : 'today';
};

export type WebWordsReturnView = 'today' | 'library' | 'catalog' | 'progress' | 'settings';
const isWebWordsReturnView = (value: string | null): value is WebWordsReturnView => (
  value === 'today' || value === 'library' || value === 'catalog' || value === 'progress' || value === 'settings'
);

/**
 * Web words is a sub-view of Vocabulary: without a known opener its back link
 * leads to Vocabulary, as on the board; opened from another view, it returns there.
 */
export const readWebWordsReturnView = (location: string): WebWordsReturnView => {
  const url = new URL(location, 'https://sonflash.invalid');
  const legacy = url.searchParams.get(LEGACY_WEB_WORDS_PARAM) === '1';
  const opener = url.searchParams.get(legacy ? 'view' : RETURN_VIEW_PARAM);
  return isWebWordsReturnView(opener) ? opener : 'library';
};

export const readSettingsSectionParam = (location: string): SettingsSectionId => (
  readSettingsSection(new URL(location, 'https://sonflash.invalid').searchParams.get(SETTINGS_SECTION_PARAM))
);

/** The course id a courses link opens the goals of; null without one or for a malformed id. */
export const readCourseGoalsParam = (location: string): string | null => {
  const url = new URL(location, 'https://sonflash.invalid');
  const courseId = url.searchParams.get('view') === 'courses' ? url.searchParams.get(COURSE_GOALS_PARAM) : null;
  return courseId && COURSE_ID_PATTERN.test(courseId) ? courseId : null;
};

export interface AppViewTarget {
  /** For `web-words`: the view its back link returns to. */
  readonly returnView?: AppViewMode;
  /** For `settings`: the section to open. */
  readonly settingsSection?: SettingsSectionId;
  /** For `courses`: the course whose goals to open. */
  readonly goalsCourseId?: string;
}

export const createAppViewLocation = (
  currentLocation: string,
  viewMode: AppViewMode,
  target: AppViewTarget = {},
): string => {
  const url = new URL(currentLocation, 'https://sonflash.invalid');
  if (/^\/library\/?$/.test(url.pathname)) url.pathname = '/';
  url.searchParams.delete('lesson');
  url.searchParams.delete(LEGACY_WEB_WORDS_PARAM);
  url.searchParams.delete(RETURN_VIEW_PARAM);
  url.searchParams.delete(SETTINGS_SECTION_PARAM);
  url.searchParams.delete(COURSE_GOALS_PARAM);
  if (viewMode === 'landing') url.searchParams.delete('view');
  else url.searchParams.set('view', ROUTED_VIEW.test(viewMode) ? viewMode : 'today');
  if (viewMode === 'web-words' && target.returnView && target.returnView !== 'library' && isWebWordsReturnView(target.returnView)) {
    url.searchParams.set(RETURN_VIEW_PARAM, target.returnView);
  }
  if (viewMode === 'settings' && target.settingsSection && target.settingsSection !== DEFAULT_SETTINGS_SECTION) {
    url.searchParams.set(SETTINGS_SECTION_PARAM, target.settingsSection);
  }
  if (viewMode === 'courses' && target.goalsCourseId && COURSE_ID_PATTERN.test(target.goalsCourseId)) {
    url.searchParams.set(COURSE_GOALS_PARAM, target.goalsCourseId);
  }
  return `${url.pathname}${url.search}${url.hash}`;
};

export interface AppViewBrowser {
  getCurrentUrl(): string;
  pushState(location: string): void;
  /** Rewrites the current history entry, so Back skips what it showed. */
  replaceState(location: string): void;
  listenPopState(listener: () => void): () => void;
}

const windowViewBrowser: AppViewBrowser = {
  getCurrentUrl: () => globalThis.location?.href ?? '/',
  pushState: location => globalThis.history?.pushState(globalThis.history.state, '', location),
  replaceState: location => globalThis.history?.replaceState(globalThis.history.state, '', location),
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
  const [settingsSection, setSettingsSectionState] = useState<SettingsSectionId>(() => readSettingsSectionParam(viewBrowser.getCurrentUrl()));
  const [webWordsReturnView, setWebWordsReturnView] = useState<WebWordsReturnView>(() => readWebWordsReturnView(viewBrowser.getCurrentUrl()));
  const [goalsCourseId, setGoalsCourseId] = useState<string | null>(() => readCourseGoalsParam(viewBrowser.getCurrentUrl()));
  const viewHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const previousViewModeRef = useRef(viewMode);
  const currentViewModeRef = useRef(viewMode);
  const currentSettingsSectionRef = useRef(settingsSection);
  const pendingViewFocusIntentRef = useRef(false);
  currentViewModeRef.current = viewMode;
  currentSettingsSectionRef.current = settingsSection;

  useEffect(() => viewBrowser.listenPopState(() => {
    const location = viewBrowser.getCurrentUrl();
    const next = readAppViewMode(location);
    const nextSection = readSettingsSectionParam(location);
    pendingViewFocusIntentRef.current = next !== currentViewModeRef.current;
    // Back and forward between settings sections move focus to the section heading, like a view change.
    const sectionChanged = next === 'settings' && currentViewModeRef.current === 'settings' && nextSection !== currentSettingsSectionRef.current;
    if (pendingViewFocusIntentRef.current || sectionChanged) setViewFocusIntent(intent => intent + 1);
    setSettingsSectionState(nextSection);
    setWebWordsReturnView(readWebWordsReturnView(location));
    setGoalsCourseId(readCourseGoalsParam(location));
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

  const navigate = useCallback((next: AppViewMode, target: AppViewTarget, inPlace = false) => {
    pendingViewFocusIntentRef.current = next !== currentViewModeRef.current;
    if (pendingViewFocusIntentRef.current) setViewFocusIntent(intent => intent + 1);
    const current = viewBrowser.getCurrentUrl();
    const location = createAppViewLocation(current, next, target);
    setSettingsSectionState(readSettingsSectionParam(location));
    setWebWordsReturnView(readWebWordsReturnView(location));
    setGoalsCourseId(readCourseGoalsParam(location));
    setViewModeState(next);
    const currentPath = new URL(current, 'https://sonflash.invalid');
    if (location !== `${currentPath.pathname}${currentPath.search}${currentPath.hash}`) {
      viewBrowser[inPlace ? 'replaceState' : 'pushState'](location);
    }
  }, [viewBrowser]);

  const setViewMode = useCallback((next: AppViewMode) => {
    navigate(next, next === 'web-words' ? { returnView: currentViewModeRef.current } : {});
  }, [navigate]);

  /** Opens settings on one section; every shell entry point links here. */
  const openSettings = useCallback((section: SettingsSectionId = DEFAULT_SETTINGS_SECTION) => {
    navigate('settings', { settingsSection: section });
  }, [navigate]);

  /**
   * Opens the courses page on one course's goals, where its band and latest score are edited, or on
   * its course list for `null`. The page's own goals panel opens and closes `inPlace`: the address
   * follows the panel without a new history entry, so Back still leaves the page.
   */
  const openCourseGoals = useCallback((courseId: string | null, inPlace?: boolean) => {
    navigate('courses', courseId ? { goalsCourseId: courseId } : {}, inPlace);
  }, [navigate]);

  return {
    viewMode,
    setViewMode,
    openSettings,
    openCourseGoals,
    settingsSection,
    goalsCourseId,
    webWordsReturnView,
    viewHeadingRef,
    viewFocusIntent,
    isDarkMode,
  };
}
