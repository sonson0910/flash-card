import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Course } from './courseModel';
import type { CourseGateValue } from './CourseGate';

const hooks = vi.hoisted(() => ({ cursor: 0, states: [] as unknown[], effects: [] as Array<() => unknown> }));
const session = vi.hoisted(() => ({ current: null as unknown }));
const dueCounts = vi.hoisted(() => vi.fn((..._args: unknown[]) => ({ en: 14 })));

vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)) => {
      const index = hooks.cursor++;
      if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
      return [hooks.states[index] as T, (value: T | ((current: T) => T)) => {
        const current = hooks.states[index] as T;
        hooks.states[index] = typeof value === 'function' ? (value as (current: T) => T)(current) : value;
      }] as const;
    },
    useEffect: (effect: () => unknown) => { hooks.effects.push(effect); },
  };
});
vi.mock('../../i18n/I18nProvider', () => ({ useUiLocale: () => 'en' }));
vi.mock('../profileCompletion/AccountProfileContext', () => ({ useAccountProfileNativeLanguage: () => null }));
vi.mock('./CourseGate', () => ({ useCourseSession: () => session.current }));
vi.mock('./useCourseDueCounts', () => ({ useCourseDueCounts: dueCounts }));
vi.mock('./CoursesSurface', () => ({ CoursesSurface: () => null }));
vi.mock('./AddCourseDialog', () => ({ AddCourseDialog: () => null, defaultCourseNativeLanguage: () => 'vi' }));

import { CoursesPage, type CoursesPageProps } from './CoursesPage';
import { CoursesSurface } from './CoursesSurface';
import { AddCourseDialog } from './AddCourseDialog';

type Tree = { type?: unknown; props?: Record<string, unknown> };

const find = (node: unknown, type: unknown): Tree => {
  const element = node as Tree;
  if (element?.type === type) return element;
  const children = element?.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child && typeof child === 'object') {
      const found = find(child, type);
      if (found) return found;
    }
  }
  return undefined as unknown as Tree;
};

const english: Course = {
  id: 'course-en', targetLanguage: 'en', nativeLanguage: 'vi', status: 'active', goals: [],
  preferences: { pronunciationVariant: null, showRomanization: false, zhScript: null },
  createdAt: '2026-01-01T00:00:00.000Z',
};
const korean: Course = { ...english, id: 'course-ko', targetLanguage: 'ko' };
const archivedJapanese: Course = { ...english, id: 'course-ja', targetLanguage: 'ja', status: 'archived' };

const switchCourse = vi.fn(async (_id: string) => ({ ok: true }));
const createCourse = vi.fn(async (_input: unknown) => ({ ok: true }));

const readySession = (status: 'ready' | 'loading' = 'ready'): CourseGateValue => ({
  model: {
    ownerId: 'owner-1', status, source: 'cloud', pending: false, errorCode: null,
    profile: { activeCourseId: english.id, courses: [english, korean, archivedJapanese] }, activeCourse: english,
  },
  actions: { switchCourse, createCourse } as unknown as CourseGateValue['actions'],
} as CourseGateValue);

const render = (props: Partial<CoursesPageProps> = {}) => {
  hooks.cursor = 0;
  hooks.effects = [];
  return CoursesPage({ onStudy: vi.fn(), ...props });
};

describe('courses page', () => {
  beforeEach(() => {
    hooks.states = [];
    session.current = readySession();
    vi.clearAllMocks();
  });

  it('renders nothing until the course profile is ready', () => {
    session.current = readySession('loading');
    expect(render()).toBeNull();
    expect(dueCounts).toHaveBeenLastCalledWith('owner-1', [], false, undefined);
  });

  it('reads the due count of each open course and hands the surface its page title and study action', () => {
    const onStudy = vi.fn();
    const surface = find(render({ onStudy, goalsCourseId: 'course-en' }), CoursesSurface);

    expect(dueCounts).toHaveBeenLastCalledWith('owner-1', ['en', 'ko'], true, undefined);
    expect(surface.props).toMatchObject({ dueCounts: { en: 14 }, switched: null, onStudy, goalsCourseId: 'course-en' });
    const title = (surface.props?.renderTitle as (title: string) => Tree)('Your languages');
    expect(title.type).toBe('h1');
    expect(title.props).toMatchObject({ tabIndex: -1, className: 'course-manage__title', children: 'Your languages' });
  });

  it('moves focus to its heading after a navigation, once the heading exists', () => {
    const focus = vi.fn();
    const headingRef = { current: { focus } as unknown as HTMLHeadingElement };
    render({ headingRef, focusIntent: 0 });
    hooks.effects.forEach(effect => effect());
    expect(focus).not.toHaveBeenCalled();

    render({ headingRef, focusIntent: 1 });
    hooks.effects.forEach(effect => effect());
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it('announces a switch only after the course session made it', async () => {
    const surface = find(render(), CoursesSurface);
    (surface.props?.onSwitch as (course: Course) => void)(korean);
    await vi.waitFor(() => expect(switchCourse).toHaveBeenCalledWith('course-ko'));
    await vi.waitFor(() => expect(find(render(), CoursesSurface).props?.switched).toEqual({ from: 'en', to: 'ko' }));

    switchCourse.mockResolvedValueOnce({ ok: false });
    (find(render(), CoursesSurface).props?.onSwitch as (course: Course) => void)(english);
    await vi.waitFor(() => expect(switchCourse).toHaveBeenCalledTimes(2));
    expect(find(render(), CoursesSurface).props?.switched).toBeNull();
  });

  it('opens the add dialog on the language picked on the page and creates the course through the session', async () => {
    expect(find(render(), AddCourseDialog).props).toMatchObject({ open: false, initialTarget: null, defaultNativeLanguage: 'vi' });

    (find(render(), CoursesSurface).props?.onAddLanguage as (language?: string) => void)('zh');
    const dialog = find(render(), AddCourseDialog);
    expect(dialog.props).toMatchObject({ open: true, initialTarget: 'zh', courses: [english, korean, archivedJapanese], pending: false });

    const input = { targetLanguage: 'zh', nativeLanguage: 'vi' };
    await expect((dialog.props?.onCreate as (value: unknown) => Promise<boolean>)(input)).resolves.toBe(true);
    expect(createCourse).toHaveBeenCalledWith(input);

    (dialog.props?.onOpenChange as (open: boolean) => void)(false);
    expect(find(render(), AddCourseDialog).props?.open).toBe(false);
  });
});
