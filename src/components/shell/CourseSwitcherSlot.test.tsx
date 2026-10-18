import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CourseContext, type CourseGateValue } from '../../features/courses/CourseGate';
import { CourseSwitcherSlot } from './CourseSwitcherSlot';

i18n.load('en', {});
i18n.activate('en');

const readyValue = (): CourseGateValue => ({
  model: {
    status: 'ready', source: 'cloud', pending: false, errorCode: null,
    profile: { activeCourseId: 'course-en', courses: [{
      id: 'course-en', targetLanguage: 'en', nativeLanguage: 'vi', status: 'active', goals: [],
      preferences: { pronunciationVariant: null, showRomanization: false, zhScript: null },
      createdAt: '2026-01-01T00:00:00.000Z',
    }] },
    activeCourse: null,
  },
  actions: {} as CourseGateValue['actions'],
});

describe('CourseSwitcherSlot', () => {
  it('never renders for a signed-out visitor, no matter the session state', () => {
    const withoutProvider = renderToStaticMarkup(<I18nProvider i18n={i18n}><CourseSwitcherSlot signedIn={false} /></I18nProvider>);
    const withReadyContext = renderToStaticMarkup(<I18nProvider i18n={i18n}>
      <CourseContext.Provider value={readyValue()}><CourseSwitcherSlot signedIn={false} /></CourseContext.Provider>
    </I18nProvider>);
    expect(withoutProvider).toBe('');
    expect(withReadyContext).toBe('');
  });

  it('renders nothing yet for a signed-in owner before the course session resolves', () => {
    const html = renderToStaticMarkup(<I18nProvider i18n={i18n}><CourseSwitcherSlot signedIn /></I18nProvider>);
    expect(html).toBe('');
  });

  it('mounts its wrapper once the course session is ready, deferring the real control to a lazy chunk', () => {
    const html = renderToStaticMarkup(<I18nProvider i18n={i18n}>
      <CourseContext.Provider value={readyValue()}><CourseSwitcherSlot signedIn /></CourseContext.Provider>
    </I18nProvider>);
    expect(html).toContain('claude-course-switcher-slot');
  });

  it('keeps the control reachable after a course-profile read error', () => {
    const ready = readyValue();
    const html = renderToStaticMarkup(<I18nProvider i18n={i18n}>
      <CourseContext.Provider value={{ ...ready, model: { ...ready.model, status: 'error', errorCode: 'cloud-read-failed' } }}>
        <CourseSwitcherSlot signedIn />
      </CourseContext.Provider>
    </I18nProvider>);
    expect(html).toContain('claude-course-switcher-slot');
  });
});
