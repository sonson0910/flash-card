import { beforeEach, describe, expect, it, vi } from 'vitest';

const hookRuntime = vi.hoisted(() => ({
  stateCursor: 0,
  refCursor: 0,
  states: [] as unknown[],
  refs: [] as Array<{ current: unknown }>,
  effects: [] as Array<() => unknown>,
}));

vi.mock('react', () => ({
  useCallback: <T extends (...args: never[]) => unknown>(callback: T) => callback,
  // Effects are collected, not run; a test that needs one (the popstate listener) runs it itself.
  useEffect: (effect: () => unknown) => { hookRuntime.effects.push(effect); },
  useRef: <T,>(initial: T) => {
    const index = hookRuntime.refCursor++;
    if (!(index in hookRuntime.refs)) hookRuntime.refs[index] = { current: initial };
    return hookRuntime.refs[index] as { current: T };
  },
  useState: <T,>(initial: T | (() => T)) => {
    const index = hookRuntime.stateCursor++;
    if (!(index in hookRuntime.states)) {
      hookRuntime.states[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
    }
    const setState = (next: T | ((previous: T) => T)) => {
      const previous = hookRuntime.states[index] as T;
      hookRuntime.states[index] = typeof next === 'function'
        ? (next as (value: T) => T)(previous)
        : next;
    };
    return [hookRuntime.states[index] as T, setState] as const;
  },
}));
vi.mock('../theme/ThemeProvider', () => ({
  useTheme: () => ({ mode: 'dark', setMode: vi.fn() }),
}));

import {
  APP_VIEW_HEADINGS,
  applyThemePreference,
  createAppViewLocation,
  focusHeadingWithMotionPreference,
  readAppViewMode,
  readCourseGoalsParam,
  readSettingsSectionParam,
  readWebWordsReturnView,
  resolveInitialDarkMode,
  scheduleViewHeadingFocus,
  useAppNavigation,
} from './useAppNavigation';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

describe('useAppNavigation', () => {
  beforeEach(() => {
    hookRuntime.stateCursor = 0;
    hookRuntime.refCursor = 0;
    hookRuntime.states = [];
    hookRuntime.refs = [];
    hookRuntime.effects = [];
    vi.clearAllMocks();
  });

  const render = (options?: Parameters<typeof useAppNavigation>[0]) => {
    hookRuntime.stateCursor = 0;
    hookRuntime.refCursor = 0;
    hookRuntime.effects = [];
    return useAppNavigation(options);
  };

  it('keeps every view mode paired with its accessible heading', () => {
    expect(Object.fromEntries(Object.entries(APP_VIEW_HEADINGS).map(([view, heading]) => [view, heading.message]))).toEqual({
      landing: 'SonFlash — Smart Vocabulary Learning',
      today: 'Today learning plan',
      library: 'Vocabulary library',
      catalog: 'Learning paths',
      progress: 'Learning progress',
      settings: 'Settings and appearance',
      'web-words': 'Words saved from the web',
      files: 'My files',
      courses: 'Your courses',
      study: 'Study session',
      quiz: 'Vocabulary quiz',
      spelling: 'Spelling practice',
      'language-drill': 'Language drill',
      story: 'Context story',
      match: 'Word match',
      shadowing: 'Shadowing practice',
    });
    expect(new Set(Object.values(APP_VIEW_HEADINGS).map(heading => heading.id)).size).toBe(16);

    const navigation = render();
    expect(navigation.viewMode).toBe('landing');
    expect(APP_VIEW_HEADINGS[navigation.viewMode].message).toBe('SonFlash — Smart Vocabulary Learning');
    navigation.setViewMode('story');
    expect(APP_VIEW_HEADINGS[render().viewMode].message).toBe('Context story');
  });

  it('routes locale landing paths and keeps their prefix through app navigation', () => {
    expect(readAppViewMode('/')).toBe('landing');
    expect(readAppViewMode('/vi/')).toBe('landing');
    expect(readAppViewMode('/?lesson=session')).toBe('today');
    expect(readAppViewMode('/vi/?view=today')).toBe('today');
    expect(readAppViewMode('?utm_source=phase4&view=catalog')).toBe('catalog');
    expect(readAppViewMode('?view=progress')).toBe('progress');
    expect(readAppViewMode('?view=settings')).toBe('settings');
    expect(readAppViewMode('?view=library')).toBe('library');
    expect(readAppViewMode('/library?share=deck-1')).toBe('library');
    expect(readAppViewMode('?view=unknown')).toBe('today');
    expect(createAppViewLocation(
      '/?utm_source=phase4&category=IELTS#library',
      'catalog',
    )).toBe('/?utm_source=phase4&category=IELTS&view=catalog#library');
    expect(createAppViewLocation(
      '/?utm_source=phase4&view=catalog#paths',
      'library',
    )).toBe('/?utm_source=phase4&view=library#paths');
    expect(createAppViewLocation(
      '/vi/?utm_source=phase5#words',
      'today',
    )).toBe('/vi/?utm_source=phase5&view=today#words');
    expect(createAppViewLocation(
      '/?lesson=recognition&utm_source=phase5#lesson',
      'catalog',
    )).toBe('/?utm_source=phase5&view=catalog#lesson');
    expect(createAppViewLocation('/?utm_source=appearance#options', 'settings'))
      .toBe('/?utm_source=appearance&view=settings#options');
    expect(createAppViewLocation('/vi/?utm_source=landing#hero', 'landing'))
      .toBe('/vi/?utm_source=landing#hero');
  });

  it('routes web words as a sub-view that remembers its opener', () => {
    expect(readAppViewMode('/?view=web-words')).toBe('web-words');
    expect(readWebWordsReturnView('/?view=web-words')).toBe('library');
    expect(readWebWordsReturnView('/?view=web-words&from=progress')).toBe('progress');
    expect(readWebWordsReturnView('/?view=web-words&from=study')).toBe('library');
    // Older links layered webWords=1 on the view that opened it.
    expect(readAppViewMode('/?view=today&lesson=session&webWords=1')).toBe('web-words');
    expect(readWebWordsReturnView('/?view=today&lesson=session&webWords=1')).toBe('today');
    expect(createAppViewLocation('/?view=today&lesson=session&locale=en#top', 'web-words', { returnView: 'today' }))
      .toBe('/?view=web-words&locale=en&from=today#top');
    expect(createAppViewLocation('/?view=library', 'web-words', { returnView: 'library' })).toBe('/?view=web-words');
    expect(createAppViewLocation('/?view=web-words&from=today&webWords=1', 'today')).toBe('/?view=today');
  });

  it('keeps the settings section in the URL and drops it for other views', () => {
    expect(readSettingsSectionParam('/?view=settings&section=reminders')).toBe('reminders');
    expect(readSettingsSectionParam('/?view=settings&section=unknown')).toBe('appearance');
    expect(readSettingsSectionParam('/?view=settings')).toBe('appearance');
    expect(createAppViewLocation('/?view=today', 'settings', { settingsSection: 'language' })).toBe('/?view=settings&section=language');
    expect(createAppViewLocation('/?view=settings&section=language', 'settings', { settingsSection: 'appearance' })).toBe('/?view=settings');
    expect(createAppViewLocation('/?view=settings&section=reminders', 'progress')).toBe('/?view=progress');

    const navigation = render();
    navigation.openSettings('reminders');
    const opened = render();
    expect(opened.viewMode).toBe('settings');
    expect(opened.settingsSection).toBe('reminders');
  });

  it('routes My files as its own view and keeps the storage settings section linkable', () => {
    expect(readAppViewMode('/?view=files')).toBe('files');
    expect(readAppViewMode('/vi/?view=files&locale=vi')).toBe('files');
    expect(readSettingsSectionParam('/?view=settings&section=files')).toBe('files');
    expect(createAppViewLocation('/?view=settings&section=files&locale=en', 'files')).toBe('/?view=files&locale=en');
    expect(createAppViewLocation('/?view=files', 'settings', { settingsSection: 'files' })).toBe('/?view=settings&section=files');
  });

  it('opens My files from the storage settings section and walks back and forward through the browser', () => {
    const history = ['/?view=settings&section=files'];
    let index = 0;
    let popState: (() => void) | null = null;
    const viewBrowser = {
      getCurrentUrl: () => `https://sonflash.invalid${history[index]}`,
      pushState: vi.fn((location: string) => { history.splice(index + 1, Infinity, location); index += 1; }),
      replaceState: vi.fn((location: string) => { history[index] = location; }),
      listenPopState: (listener: () => void) => { popState = listener; return () => { popState = null; }; },
    };
    const moveInHistory = (step: number) => { index += step; popState?.(); };

    const settings = render({ viewBrowser });
    expect(settings.viewMode).toBe('settings');
    expect(settings.settingsSection).toBe('files');
    hookRuntime.effects[0]();

    settings.setViewMode('files');
    expect(viewBrowser.pushState).toHaveBeenLastCalledWith('/?view=files');
    const files = render({ viewBrowser });
    expect(files.viewMode).toBe('files');
    expect(files.viewFocusIntent).toBe(1);

    moveInHistory(-1);
    const back = render({ viewBrowser });
    expect(back.viewMode).toBe('settings');
    expect(back.settingsSection).toBe('files');
    expect(back.viewFocusIntent).toBe(2);

    moveInHistory(1);
    expect(render({ viewBrowser }).viewMode).toBe('files');
    expect(viewBrowser.pushState).toHaveBeenCalledTimes(1);
  });

  it('routes the courses page with an optional course goals link and drops it for other views', () => {
    expect(readAppViewMode('/?view=courses')).toBe('courses');
    expect(readAppViewMode('/vi/?view=courses&locale=vi')).toBe('courses');
    expect(createAppViewLocation('/?view=today&lesson=session&locale=en', 'courses')).toBe('/?view=courses&locale=en');
    expect(createAppViewLocation('/?view=today', 'courses', { goalsCourseId: 'course-en' })).toBe('/?view=courses&goals=course-en');
    expect(createAppViewLocation('/?view=courses&goals=course-en', 'today')).toBe('/?view=today');
    expect(createAppViewLocation('/?view=today', 'courses', { goalsCourseId: '../x' })).toBe('/?view=courses');
    expect(readCourseGoalsParam('/?view=courses&goals=course-en')).toBe('course-en');
    expect(readCourseGoalsParam('/?view=courses&goals=a%2Fb')).toBeNull();
    expect(readCourseGoalsParam('/?view=today&goals=course-en')).toBeNull();
    expect(readCourseGoalsParam('/?view=courses')).toBeNull();
  });

  it('opens the courses page, deep links a course\'s goals and walks back and forward through the browser', () => {
    const history = ['/?view=courses'];
    let index = 0;
    let popState: (() => void) | null = null;
    const viewBrowser = {
      getCurrentUrl: () => `https://sonflash.invalid${history[index]}`,
      pushState: vi.fn((location: string) => { history.splice(index + 1, Infinity, location); index += 1; }),
      replaceState: vi.fn((location: string) => { history[index] = location; }),
      listenPopState: (listener: () => void) => { popState = listener; return () => { popState = null; }; },
    };
    const moveInHistory = (step: number) => { index += step; popState?.(); };

    const deepLink = render({ viewBrowser });
    expect(deepLink.viewMode).toBe('courses');
    expect(deepLink.goalsCourseId).toBeNull();
    hookRuntime.effects[0]();

    deepLink.setViewMode('today');
    expect(viewBrowser.pushState).toHaveBeenLastCalledWith('/?view=today');
    const today = render({ viewBrowser });
    expect(today.viewMode).toBe('today');
    expect(today.viewFocusIntent).toBe(1);

    today.openCourseGoals('course-en');
    expect(viewBrowser.pushState).toHaveBeenLastCalledWith('/?view=courses&goals=course-en');
    const goals = render({ viewBrowser });
    expect(goals.viewMode).toBe('courses');
    expect(goals.goalsCourseId).toBe('course-en');
    expect(goals.viewFocusIntent).toBe(2);

    moveInHistory(-1);
    const back = render({ viewBrowser });
    expect(back.viewMode).toBe('today');
    expect(back.goalsCourseId).toBeNull();
    expect(back.viewFocusIntent).toBe(3);

    moveInHistory(-1);
    const first = render({ viewBrowser });
    expect(first.viewMode).toBe('courses');
    expect(first.goalsCourseId).toBeNull();

    moveInHistory(2);
    const forward = render({ viewBrowser });
    expect(forward.viewMode).toBe('courses');
    expect(forward.goalsCourseId).toBe('course-en');
    expect(viewBrowser.pushState).toHaveBeenCalledTimes(2);

    // The page's own goals panel rewrites the entry it is on: closing drops the course from the
    // address, opening names it, and neither adds a step or moves focus to the heading.
    forward.openCourseGoals(null, true);
    expect(viewBrowser.replaceState).toHaveBeenLastCalledWith('/?view=courses');
    const list = render({ viewBrowser });
    expect(list.goalsCourseId).toBeNull();
    list.openCourseGoals('course-ko', true);
    expect(viewBrowser.replaceState).toHaveBeenLastCalledWith('/?view=courses&goals=course-ko');
    const reopened = render({ viewBrowser });
    expect(reopened.goalsCourseId).toBe('course-ko');
    expect(reopened.viewFocusIntent).toBe(forward.viewFocusIntent);
    expect(viewBrowser.pushState).toHaveBeenCalledTimes(2);
    expect(history).toEqual(['/?view=courses', '/?view=today', '/?view=courses&goals=course-ko']);
  });

  it('defaults to dark mode and safely reads an explicit stored preference', () => {
    expect(resolveInitialDarkMode(null)).toBe(true);
    expect(resolveInitialDarkMode({ getItem: () => 'light' })).toBe(false);
    expect(resolveInitialDarkMode({ getItem: () => 'dark' })).toBe(true);
    expect(resolveInitialDarkMode({ getItem: () => { throw new Error('denied'); } })).toBe(true);
  });

  it('persists theme and synchronizes the root dark class', () => {
    const storage = { setItem: vi.fn() };
    const classList = { add: vi.fn(), remove: vi.fn() };

    applyThemePreference(false, storage, { classList });
    expect(storage.setItem).toHaveBeenCalledWith('lingoflash_theme', 'light');
    expect(classList.remove).toHaveBeenCalledWith('dark');

    applyThemePreference(true, storage, { classList });
    expect(storage.setItem).toHaveBeenLastCalledWith('lingoflash_theme', 'dark');
    expect(classList.add).toHaveBeenCalledWith('dark');
  });

  it.each([
    [false, 'smooth'],
    [true, 'auto'],
  ] as const)('focuses and scrolls a heading with reduced motion=%s using %s', (reduced, behavior) => {
    const heading = { scrollIntoView: vi.fn(), focus: vi.fn() };

    focusHeadingWithMotionPreference(heading, reduced);

    expect(heading.scrollIntoView).toHaveBeenCalledWith({ behavior, block: 'start' });
    expect(heading.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('focuses a changed view immediately and only retries while focus remains at the navigation origin', () => {
    const callbacks: Array<() => void> = [];
    const scheduler = {
      requestAnimationFrame: vi.fn((callback: () => void) => { callbacks.push(callback); return 11; }),
      cancelAnimationFrame: vi.fn(),
      setTimeout: vi.fn((callback: () => void) => { callbacks.push(callback); return 22; }),
      clearTimeout: vi.fn(),
    };
    const heading = { focus: vi.fn() };
    const body = {};
    const opener = {};
    let activeElement: unknown = body;
    const cleanup = scheduleViewHeadingFocus({
      getHeading: () => heading,
      getActiveElement: () => activeElement,
      bodyElement: body,
      practiceOpener: opener,
      scheduler,
    });

    callbacks[0]();
    expect(heading.focus).toHaveBeenCalledTimes(1);
    activeElement = opener;
    callbacks[1]();
    expect(heading.focus).toHaveBeenCalledTimes(2);

    cleanup();
    expect(scheduler.cancelAnimationFrame).toHaveBeenCalledWith(11);
    expect(scheduler.clearTimeout).toHaveBeenCalledWith(22);

    const navigationOpener = { role: 'button' };
    activeElement = navigationOpener;
    scheduleViewHeadingFocus({
      getHeading: () => heading,
      getActiveElement: () => activeElement,
      bodyElement: body,
      practiceOpener: opener,
      scheduler,
    });
    callbacks[2]();
    activeElement = { role: 'another-button' };
    callbacks[3]();
    expect(heading.focus).toHaveBeenCalledTimes(3);
  });

  it('keeps view-heading focus behind an explicit navigation intent', () => {
    const navigationSource = readFileSync(fileURLToPath(new URL('./useAppNavigation.ts', import.meta.url)), 'utf8');
    const todaySource = readFileSync(fileURLToPath(new URL('../dailyLearning/TodayScreen.tsx', import.meta.url)), 'utf8');
    const progressSource = readFileSync(fileURLToPath(new URL('../dailyLearning/ProgressScreen.tsx', import.meta.url)), 'utf8');
    const workspaceSource = readFileSync(fileURLToPath(new URL('../dailyLearning/DailyLearningWorkspace.tsx', import.meta.url)), 'utf8');

    expect(navigationSource).toContain('pendingViewFocusIntentRef');
    expect(todaySource).not.toMatch(/heading\?\.focus|focusAfterDocumentLoad/);
    expect(progressSource).not.toContain('heading?.focus');
    expect(workspaceSource).not.toMatch(/\[headingRef, lesson\?\.index, lesson\?\.phase, placementIndex, pool\.ownerId, pool\.status, routeLesson\]/);
  });
});
