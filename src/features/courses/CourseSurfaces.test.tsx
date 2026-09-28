import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CourseSwitcherControl } from '../../components/shell/CourseSwitcherControl';
import { CourseContext, type CourseGateValue } from './CourseGate';
import { CourseGoalsPanel } from './CourseGoalsPanel';
import type { Course } from './courseModel';

i18n.load('en', {});
i18n.activate('en');

const english: Course = {
  id: 'course-en', targetLanguage: 'en', nativeLanguage: 'vi', status: 'active',
  goals: [
    { id: 'goal-active', kind: 'ielts', level: '7.0', targetDate: '2026-12-01', status: 'active', createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'goal-paused', kind: 'toeic', level: null, targetDate: null, status: 'paused', createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 'goal-completed', kind: 'conversation', level: null, targetDate: null, status: 'completed', createdAt: '2026-01-01T00:00:00.000Z' },
  ],
  preferences: { pronunciationVariant: null, showRomanization: false, zhScript: null },
  createdAt: '2026-01-01T00:00:00.000Z',
};

const archivedJapanese: Course = {
  ...english,
  id: 'course-ja',
  targetLanguage: 'ja',
  status: 'archived',
  goals: [],
};

const session = (course: Course = english): CourseGateValue => ({
  model: {
    status: 'ready', source: 'cloud', pending: false, errorCode: null,
    profile: { activeCourseId: course.id, courses: [course] }, activeCourse: course,
  },
  actions: {
    createCourse: vi.fn(), updateCourse: vi.fn(), archiveCourse: vi.fn(), reopenCourse: vi.fn(), switchCourse: vi.fn(),
    addGoal: vi.fn(), updateGoal: vi.fn(), removeGoal: vi.fn(), clearError: vi.fn(),
  } as CourseGateValue['actions'],
});

const render = (node: React.ReactNode, value = session()) => renderToStaticMarkup(
  <I18nProvider i18n={i18n}><CourseContext.Provider value={value}>{node}</CourseContext.Provider></I18nProvider>,
);

describe('course render surfaces', () => {
  it('renders the active course trigger without exposing its closed dialog', () => {
    const html = render(<CourseSwitcherControl />);

    expect(html).toContain('English');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('Your courses');
  });

  it('renders the no-active-course trigger without exposing unavailable course actions', () => {
    const activeSession = session();
    const value: CourseGateValue = {
      ...activeSession,
      model: {
        ...activeSession.model,
        profile: { activeCourseId: null, courses: [english, archivedJapanese] },
        activeCourse: null,
      },
    };
    const html = render(<CourseSwitcherControl />, value);

    expect(html).toContain('Choose a course');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('Your courses');
    expect(html).not.toContain('Archive course');
    expect(html).not.toContain('Reopen course');
  });

  it('renders each goal state with only the actions that remain valid', () => {
    const html = render(<CourseGoalsPanel course={english} onClose={vi.fn()} />);

    expect(html).toContain('IELTS');
    expect(html).toContain('7.0');
    expect(html).toContain('2026-12-01');
    expect(html).toContain('(paused)');
    expect(html).toContain('(completed)');
    expect(html).toContain('Pause goal');
    expect(html).toContain('Resume goal');
    expect(html.match(/Remove goal/g)).toHaveLength(3);
    expect(html.match(/Add goal/g)).toHaveLength(1);
  });
});
