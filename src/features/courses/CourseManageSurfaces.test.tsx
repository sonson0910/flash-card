import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createRadixDialogPassthroughMock } from '../../testing/radix-dialog-passthrough';
import { CourseSwitcherControl } from '../../components/shell/CourseSwitcherControl';
import { AddCourseDialog } from './AddCourseDialog';
import { CourseContext, type CourseGateValue } from './CourseGate';
import { goalSummaryText } from './CourseVisuals';
import { ManageCoursesDialog } from './ManageCoursesDialog';
import type { Course } from './courseModel';

vi.mock('@radix-ui/react-dialog', () => createRadixDialogPassthroughMock());

i18n.load('en', {});
i18n.activate('en');

const korean: Course = {
  id: 'course-ko', targetLanguage: 'ko', nativeLanguage: 'vi', status: 'active',
  goals: [{ id: 'goal-topik', kind: 'topik', level: 'TOPIK II', targetDate: '2027-04-12', status: 'active', createdAt: '2026-01-01T00:00:00.000Z' }],
  preferences: { pronunciationVariant: null, showRomanization: true, zhScript: null },
  createdAt: '2026-01-01T00:00:00.000Z',
};

const english: Course = {
  ...korean,
  id: 'course-en',
  targetLanguage: 'en',
  goals: [{ id: 'goal-ielts', kind: 'ielts', level: '7.0', targetDate: null, status: 'active', createdAt: '2026-01-01T00:00:00.000Z' }],
  preferences: { pronunciationVariant: null, showRomanization: false, zhScript: null },
};

const archivedJapanese: Course = { ...korean, id: 'course-ja', targetLanguage: 'ja', status: 'archived', goals: [] };

const session = (courses: readonly Course[], activeCourse: Course | null): CourseGateValue => ({
  model: {
    ownerId: 'owner-1', status: 'ready', source: 'cloud', pending: false, errorCode: null,
    profile: { activeCourseId: activeCourse?.id ?? null, courses: [...courses] }, activeCourse,
  },
  actions: {
    retry: vi.fn(),
    createCourse: vi.fn(), updateCourse: vi.fn(), archiveCourse: vi.fn(), reopenCourse: vi.fn(), switchCourse: vi.fn(),
    addGoal: vi.fn(), updateGoal: vi.fn(), removeGoal: vi.fn(), clearError: vi.fn(),
  } as CourseGateValue['actions'],
});

const render = (node: React.ReactNode, value: CourseGateValue) => renderToStaticMarkup(
  <I18nProvider i18n={i18n}><CourseContext.Provider value={value}>{node}</CourseContext.Provider></I18nProvider>,
);

const manage = (props: Partial<React.ComponentProps<typeof ManageCoursesDialog>> = {}) => <ManageCoursesDialog
  open onOpenChange={vi.fn()} dueCounts={{ ko: 24, en: 14 }} switched={null}
  onSwitch={vi.fn()} onAddLanguage={vi.fn()} {...props} />;

describe('course switcher trigger', () => {
  it('names the active course in its own script with the meanings language', () => {
    const html = render(<CourseSwitcherControl />, session([korean, english], korean));

    expect(html).toContain('data-course-language="ko"');
    expect(html).toContain('한국어');
    expect(html).toContain('Korean');
    expect(html).toContain('from <span lang="vi">Tiếng Việt');
    expect(html).toContain('aria-expanded="false"');
  });
});

describe('courses surface', () => {
  it('shows each course with its real goal, level and due count, and nothing invented', () => {
    const html = render(manage(), session([korean, english, archivedJapanese], korean));

    expect(html).toContain('Your <em>languages</em>');
    expect(html).toContain('My languages · 2 active · meanings in Tiếng Việt');
    expect(html).toContain('Course 01');
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    expect(html).toContain('>24<');
    expect(html).toContain('>14<');
    expect(html).toContain('TOPIK II');
    expect(html).toContain('Exam date 2027-04-12');
    expect(html).toContain('Reopen course');
    expect(html.match(/Archive course/g)).toHaveLength(4);
    expect(html).not.toMatch(/streak|bloom|XP/i);
  });

  it('offers the remaining language and the loadout of the active course', () => {
    const html = render(manage(), session([korean, english, archivedJapanese], korean));

    expect(html).toContain('New language');
    expect(html).toContain('aria-label="Add Chinese"');
    expect(html).not.toContain('aria-label="Add Japanese"');
    expect(html).toContain('Extension saves to');
    expect(html).toContain('Romanization on');
    expect(html).toContain('Meanings in');
    expect(html).not.toContain('Start 한국어 lesson');
  });

  it('starts the active course only when a study action is wired', () => {
    const html = render(manage({ onStudy: vi.fn() }), session([korean], korean));

    expect(html).toContain('Start <span lang="ko">한국어</span> lesson');
    expect(html).toContain('24 due');
  });

  it('hides the new-language card once every language has a course', () => {
    const chinese: Course = { ...korean, id: 'course-zh', targetLanguage: 'zh', goals: [] };
    const html = render(manage(), session([korean, english, archivedJapanese, chinese], korean));

    expect(html).not.toContain('New language');
  });

  it('opens the goals of a course without a due count it could not read', () => {
    const html = render(manage({ dueCounts: {} }), session([english], english));

    expect(html).not.toContain('>Due<');
    expect(html).toContain('IELTS');
  });
});

describe('add a language', () => {
  const dialog = (props: Partial<React.ComponentProps<typeof AddCourseDialog>> = {}) => <AddCourseDialog
    open onOpenChange={vi.fn()} courses={[korean, english]} pending={false}
    defaultNativeLanguage="vi" profileNativeLanguage="vi" onCreate={vi.fn()} {...props} />;

  it('lists every language, keeps added ones disabled and selects the first free one', () => {
    const html = render(dialog(), session([korean, english], korean));

    expect(html.match(/class="course-target-card /g)).toHaveLength(4);
    expect(html.match(/data-state="added"/g)).toHaveLength(2);
    expect(html).toMatch(/data-course-language="ja" data-state="selected"/);
    expect(html).toContain('<span lang="ja">こんにちは</span> · JLPT');
    expect(html).toContain('Add <span lang="ja">日本語</span>');
    expect(html).toContain('your native language');
  });

  it('preselects the language picked on the courses surface', () => {
    const html = render(dialog({ initialTarget: 'zh' }), session([korean, english], korean));

    expect(html).toMatch(/data-course-language="zh" data-state="selected"/);
  });

  it('drops the native-language hint when another meanings language is chosen', () => {
    const html = render(dialog({ defaultNativeLanguage: 'en' }), session([korean, english], korean));

    expect(html).not.toContain('your native language');
  });
});

describe('goal summary', () => {
  const t = i18n._.bind(i18n);

  it('joins the goal label and level without repeating the label', () => {
    expect(goalSummaryText(english, english.goals[0], t)).toBe('IELTS 7.0');
    expect(goalSummaryText(korean, korean.goals[0], t)).toBe('TOPIK II');
    expect(goalSummaryText(korean, null, t)).toBeNull();
  });
});
