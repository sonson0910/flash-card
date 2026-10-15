import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CourseContext, type CourseGateValue } from '../courses/CourseGate';
import { CourseSettingsSection } from './CourseSettingsSection';

i18n.load('en', {});
i18n.activate('en');

const activeCourse = {
  id: 'course-zh', targetLanguage: 'zh' as const, nativeLanguage: 'vi' as const, status: 'active' as const,
  goals: [{ id: 'goal-hsk', kind: 'hsk', level: 'HSK 4', targetDate: '2026-12-01', status: 'active' as const, createdAt: '2026-01-01T00:00:00.000Z' }],
  preferences: { pronunciationVariant: null, showRomanization: true, zhScript: 'hant' as const },
  createdAt: '2026-01-01T00:00:00.000Z',
};
const archivedCourse = { ...activeCourse, id: 'course-ja', targetLanguage: 'ja' as const, status: 'archived' as const };
const value: CourseGateValue = {
  model: {
    status: 'ready', source: 'cloud', pending: false, errorCode: null,
    profile: { activeCourseId: activeCourse.id, courses: [activeCourse, archivedCourse] }, activeCourse,
  },
  actions: {
    retry: vi.fn(),
    createCourse: vi.fn(), updateCourse: vi.fn(), archiveCourse: vi.fn(), reopenCourse: vi.fn(), switchCourse: vi.fn(),
    addGoal: vi.fn(), updateGoal: vi.fn(), removeGoal: vi.fn(), clearError: vi.fn(),
  } as CourseGateValue['actions'],
};

describe('CourseSettingsSection', () => {
  it('renders active-course target and goal context with reading controls and a reopen action for archived courses', () => {
    const html = renderToStaticMarkup(<I18nProvider i18n={i18n}><CourseContext.Provider value={value}><CourseSettingsSection /></CourseContext.Provider></I18nProvider>);

    expect(html).toContain('App language');
    expect(html).toMatch(/data-settings-active-course[^>]*>.*Active course.*Chinese.*Vietnamese.*HSK.*HSK 4.*2026-12-01/);
    expect(html).toContain('Meaning language');
    expect(html).toMatch(/data-settings-course-language[^>]*>.*App language.*Meaning language/);
    expect(html).toContain('Applies to new cards. Existing card meanings do not change.');
    expect(html).toContain('Daily pace');
    expect(html).toMatch(/data-settings-course-preferences[^>]*>.*Daily pace.*Show romanization/);
    expect(html).toContain('Show romanization');
    expect(html).toContain('role="switch"');
    expect(html).toMatch(/<label[^>]*>.*Show romanization.*role="switch"/);
    expect(html).toContain('Chinese script');
    expect(html).toContain('Simplified');
    expect(html).toContain('Traditional');
    expect(html).toContain('Archived courses');
    expect(html).toContain('Japanese');
  });

  it('keeps app settings and archived-course recovery when no course is active', () => {
    const noActiveCourse: CourseGateValue = {
      ...value,
      model: {
        ...value.model,
        profile: { activeCourseId: null, courses: [archivedCourse] },
        activeCourse: null,
      },
    };
    const html = renderToStaticMarkup(<I18nProvider i18n={i18n}><CourseContext.Provider value={noActiveCourse}><CourseSettingsSection /></CourseContext.Provider></I18nProvider>);

    expect(html).toContain('App language');
    expect(html).not.toContain('data-settings-active-course');
    expect(html).toContain('Archived courses');
    expect(html).toContain('Japanese');
    expect(html).not.toContain('Meaning language');
    expect(html).not.toContain('Daily pace');
    expect(html).not.toContain('Show romanization');
    expect(html).not.toContain('Chinese script');
  });

  it('shows Korean keyboard guidance only for an active Korean course', () => {
    const koreanCourse = { ...activeCourse, id: 'course-ko', targetLanguage: 'ko' as const, goals: [], preferences: { ...activeCourse.preferences, zhScript: null } };
    const koreanValue: CourseGateValue = {
      ...value,
      model: {
        ...value.model,
        profile: { activeCourseId: koreanCourse.id, courses: [koreanCourse] },
        activeCourse: koreanCourse,
      },
    };
    const koreanHtml = renderToStaticMarkup(<I18nProvider i18n={i18n}><CourseContext.Provider value={koreanValue}><CourseSettingsSection /></CourseContext.Provider></I18nProvider>);
    const chineseHtml = renderToStaticMarkup(<I18nProvider i18n={i18n}><CourseContext.Provider value={value}><CourseSettingsSection /></CourseContext.Provider></I18nProvider>);

    expect(koreanHtml).toContain('Korean 2-set (두벌식)');
    expect(koreanHtml).toContain('device keyboard settings');
    expect(koreanHtml).toContain('on-screen keys');
    expect(chineseHtml).not.toContain('Korean 2-set (두벌식)');
  });
});
