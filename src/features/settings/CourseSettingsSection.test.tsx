import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CourseContext, type CourseGateValue } from '../courses/CourseGate';
import { CourseSettingsSection } from './CourseSettingsSection';

i18n.load('en', {});
i18n.activate('en');

const activeCourse = {
  id: 'course-zh', targetLanguage: 'zh' as const, nativeLanguage: 'vi' as const, status: 'active' as const, goals: [],
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
    createCourse: vi.fn(), updateCourse: vi.fn(), archiveCourse: vi.fn(), reopenCourse: vi.fn(), switchCourse: vi.fn(),
    addGoal: vi.fn(), updateGoal: vi.fn(), removeGoal: vi.fn(), clearError: vi.fn(),
  } as CourseGateValue['actions'],
};

describe('CourseSettingsSection', () => {
  it('renders active-course reading controls and a reopen action for archived courses', () => {
    const html = renderToStaticMarkup(<I18nProvider i18n={i18n}><CourseContext.Provider value={value}><CourseSettingsSection /></CourseContext.Provider></I18nProvider>);

    expect(html).toContain('App language');
    expect(html).toContain('Meaning language');
    expect(html).toContain('Applies to new cards. Existing card meanings do not change.');
    expect(html).toContain('Daily pace');
    expect(html).toContain('Show romanization');
    expect(html).toContain('role="switch"');
    expect(html).toMatch(/<label[^>]*>.*Show romanization.*role="switch"/);
    expect(html).toContain('Chinese script');
    expect(html).toContain('Simplified');
    expect(html).toContain('Traditional');
    expect(html).toContain('Archived courses');
    expect(html).toContain('Japanese');
  });
});
