import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CourseSwitcherSlot } from './CourseSwitcherSlot';

i18n.load('en', { 'shell.course.current': 'English ← Tiếng Việt' });
i18n.activate('en');

describe('CourseSwitcherSlot', () => {
  it('keeps a signed-in course chip available below 480px and omits it when signed out', () => {
    const signedIn = renderToStaticMarkup(<I18nProvider i18n={i18n}><CourseSwitcherSlot signedIn /></I18nProvider>);
    const signedOut = renderToStaticMarkup(<I18nProvider i18n={i18n}><CourseSwitcherSlot signedIn={false} /></I18nProvider>);
    expect(signedIn).toContain('max-[479px]:flex');
    expect(signedIn).toContain('max-[479px]:basis-full');
    expect(signedIn).toContain('English ← Tiếng Việt');
    expect(signedOut).toBe('');
  });
});
