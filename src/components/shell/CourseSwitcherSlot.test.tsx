import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CourseSwitcherSlot } from './CourseSwitcherSlot';

i18n.load('en', { 'shell.course.current': 'English ← Tiếng Việt' });
i18n.activate('en');

describe('CourseSwitcherSlot', () => {
  it('renders only supplied course UI for an authenticated account', () => {
    const signedIn = renderToStaticMarkup(<I18nProvider i18n={i18n}><CourseSwitcherSlot signedIn /></I18nProvider>);
    const signedOut = renderToStaticMarkup(<I18nProvider i18n={i18n}><CourseSwitcherSlot signedIn={false} /></I18nProvider>);
    const realCourseUi = renderToStaticMarkup(<I18nProvider i18n={i18n}><CourseSwitcherSlot signedIn><button type="button">Spanish → English</button></CourseSwitcherSlot></I18nProvider>);
    expect(signedIn).toBe('');
    expect(signedOut).toBe('');
    expect(realCourseUi).toContain('claude-course-switcher-slot');
    expect(realCourseUi).toContain('Spanish → English');
    expect(realCourseUi).not.toContain('English ← Tiếng Việt');
  });
});
