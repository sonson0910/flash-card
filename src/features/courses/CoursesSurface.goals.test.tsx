import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Course } from './courseModel';

const hooks = vi.hoisted(() => ({ cursor: 0, states: [] as unknown[] }));

vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useState: <T,>(initial: T | (() => T)) => {
      const index = hooks.cursor++;
      if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? (initial as () => T)() : initial;
      return [hooks.states[index] as T, (value: T) => { hooks.states[index] = value; }] as const;
    },
  };
});

vi.mock('@lingui/react', () => ({
  Trans: ({ message }: { message: string }) => message,
  useLingui: () => ({ _: (value: { message?: string } | string) => typeof value === 'string' ? value : value.message ?? '' }),
}));

const course = (id: string, targetLanguage: Course['targetLanguage']): Course => ({
  id, targetLanguage, nativeLanguage: 'vi', status: 'active', goals: [], createdAt: '2026-01-01T00:00:00.000Z',
  preferences: { pronunciationVariant: null, showRomanization: false, zhScript: null },
});
const english = course('course-en', 'en');
const korean = course('course-ko', 'ko');

vi.mock('./CourseGate', () => ({
  useCourseSession: () => ({
    model: { ownerId: 'owner-1', status: 'ready', pending: false, errorCode: null, profile: { activeCourseId: 'course-en', courses: [english, korean] }, activeCourse: english },
  }),
}));
vi.mock('../theme/ThemeProvider', () => ({ useTheme: () => ({ family: 'classic' }) }));
vi.mock('./useCourseCardCounts', async importOriginal => ({
  ...(await importOriginal<typeof import('./useCourseCardCounts')>()),
  useCourseCardCounts: () => ({}),
}));

import { CourseGoalsPanel } from './CourseGoalsPanel';
import { CoursesSurface, type CoursesSurfaceProps } from './CoursesSurface';

type Tree = { type?: unknown; props?: Record<string, unknown> };

const walk = (node: unknown, visit: (element: Tree) => void): void => {
  if (Array.isArray(node)) { node.forEach(child => walk(child, visit)); return; }
  if (!node || typeof node !== 'object') return;
  const element = node as Tree;
  visit(element);
  walk(element.props?.children, visit);
};

const render = (props: Partial<CoursesSurfaceProps> = {}) => {
  hooks.cursor = 0;
  const tree = CoursesSurface({ dueCounts: {}, switched: null, onSwitch: vi.fn(), onAddLanguage: vi.fn(), ...props });
  let panel: Tree | null = null;
  const cards: Tree[] = [];
  walk(tree, element => {
    if (element.type === CourseGoalsPanel) panel = element;
    if (typeof element.props?.onManageGoals === 'function') cards.push(element);
  });
  return {
    openGoalsOf: (panel as Tree | null)?.props?.course as Course | undefined,
    closeGoals: () => ((panel as Tree | null)?.props?.onClose as () => void)(),
    manageGoals: (courseId: string) => (cards.find(card => (card.props?.course as Course).id === courseId)?.props?.onManageGoals as () => void)(),
  };
};

describe('courses surface goals', () => {
  beforeEach(() => { hooks.states = []; });

  it('keeps the open goals itself when no caller owns them', () => {
    expect(render({ goalsCourseId: 'course-ko' }).openGoalsOf).toBe(korean);

    render().closeGoals();
    expect(render().openGoalsOf).toBeUndefined();

    render().manageGoals('course-en');
    expect(render().openGoalsOf).toBe(english);
  });

  it('shows the goals its caller names and reports open and close instead of keeping them', () => {
    const onGoalsCourseChange = vi.fn();

    render({ goalsCourseId: null, onGoalsCourseChange }).manageGoals('course-en');
    expect(onGoalsCourseChange).toHaveBeenLastCalledWith('course-en');
    // Nothing opens until the caller names the course, as its address then does.
    expect(render({ goalsCourseId: null, onGoalsCourseChange }).openGoalsOf).toBeUndefined();

    const open = render({ goalsCourseId: 'course-en', onGoalsCourseChange });
    expect(open.openGoalsOf).toBe(english);
    open.closeGoals();
    expect(onGoalsCourseChange).toHaveBeenLastCalledWith(null);
    // The caller dropping the course, as Back in the browser does, returns to the course list.
    expect(render({ goalsCourseId: null, onGoalsCourseChange }).openGoalsOf).toBeUndefined();
  });

  it('shows the course list for a course the profile does not have', () => {
    expect(render({ goalsCourseId: 'course-gone', onGoalsCourseChange: vi.fn() }).openGoalsOf).toBeUndefined();
  });
});
