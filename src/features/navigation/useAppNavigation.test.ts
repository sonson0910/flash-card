import { beforeEach, describe, expect, it, vi } from 'vitest';

const hookRuntime = vi.hoisted(() => ({
  stateCursor: 0,
  refCursor: 0,
  states: [] as unknown[],
  refs: [] as Array<{ current: unknown }>,
}));

vi.mock('react', () => ({
  useCallback: <T extends (...args: never[]) => unknown>(callback: T) => callback,
  useEffect: () => undefined,
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

import {
  APP_VIEW_HEADINGS,
  applyThemePreference,
  createAppViewLocation,
  focusHeadingWithMotionPreference,
  readAppViewMode,
  resolveInitialDarkMode,
  scheduleViewHeadingFocus,
  useAppNavigation,
} from './useAppNavigation';

describe('useAppNavigation', () => {
  beforeEach(() => {
    hookRuntime.stateCursor = 0;
    hookRuntime.refCursor = 0;
    hookRuntime.states = [];
    hookRuntime.refs = [];
    vi.clearAllMocks();
  });

  const render = () => {
    hookRuntime.stateCursor = 0;
    hookRuntime.refCursor = 0;
    return useAppNavigation({ storage: null, rootElement: null });
  };

  it('keeps every view mode paired with its accessible heading', () => {
    expect(APP_VIEW_HEADINGS).toEqual({
      today: 'Today learning plan',
      library: 'Vocabulary library',
      catalog: 'Learning paths',
      progress: 'Learning progress',
      study: 'Study session',
      quiz: 'Vocabulary quiz',
      spelling: 'Spelling practice',
      story: 'Context story',
    });

    const navigation = render();
    expect(navigation.viewMode).toBe('today');
    expect(navigation.viewHeading).toBe('Today learning plan');
    navigation.setViewMode('story');
    expect(render().viewHeading).toBe('Context story');
  });

  it('deep-links the catalog view while preserving unrelated URL state', () => {
    expect(readAppViewMode('?utm_source=phase4&view=catalog')).toBe('catalog');
    expect(readAppViewMode('?view=progress')).toBe('progress');
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
      '/library?utm_source=phase5#words',
      'today',
    )).toBe('/?utm_source=phase5#words');
    expect(createAppViewLocation(
      '/?lesson=recognition&utm_source=phase5#lesson',
      'catalog',
    )).toBe('/?utm_source=phase5&view=catalog#lesson');
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

  it('focuses a changed view immediately and only retries when focus remained on body or the practice opener', () => {
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

    activeElement = { role: 'button' };
    scheduleViewHeadingFocus({
      getHeading: () => heading,
      getActiveElement: () => activeElement,
      bodyElement: body,
      practiceOpener: opener,
      scheduler,
    });
    callbacks[2]();
    callbacks[3]();
    expect(heading.focus).toHaveBeenCalledTimes(3);
  });
});
