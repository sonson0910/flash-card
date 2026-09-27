import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CourseContext, type CourseGateValue } from '../courses/CourseGate';
import { OnboardingGate } from './OnboardingGate';
import { OnboardingJourney } from './OnboardingJourney';

i18n.load('en', {});
i18n.activate('en');

const snapshot = (source: 'cloud' | 'absent'): CourseGateValue => ({
  model: {
    status: 'ready', source, pending: false, errorCode: null,
    profile: { activeCourseId: null, courses: [] },
    activeCourse: null,
  },
  actions: {} as CourseGateValue['actions'],
});

const renderGate = (props: { ownerId: string | null; suppress: boolean; hasCards?: boolean }, source: 'cloud' | 'absent' = 'absent') =>
  renderToStaticMarkup(<I18nProvider i18n={i18n}>
    <CourseContext.Provider value={snapshot(source)}><OnboardingGate hasCards={false} {...props} /></CourseContext.Provider>
  </I18nProvider>);

describe('OnboardingGate', () => {
  it('renders nothing without a signed-in owner, even if the profile is absent', () => {
    expect(renderGate({ ownerId: null, suppress: false })).toBe('');
  });

  it('renders nothing when suppressed, even though the profile is absent and onboarding would otherwise be needed', () => {
    expect(renderGate({ ownerId: 'owner-1', suppress: true })).toBe('');
  });

  it('renders nothing once a course profile document already exists, regardless of suppress', () => {
    expect(renderGate({ ownerId: 'owner-1', suppress: false }, 'cloud')).toBe('');
  });

  it('takes the onboarding branch without throwing for a genuinely new, unsuppressed owner', () => {
    expect(() => renderGate({ ownerId: 'owner-1', suppress: false }, 'absent')).not.toThrow();
  });

  it('renders the first journey step with a modal contract and language choices', () => {
    const html = renderToStaticMarkup(<I18nProvider i18n={i18n}>
      <CourseContext.Provider value={snapshot('absent')}><OnboardingJourney ownerId="owner-1" /></CourseContext.Provider>
    </I18nProvider>);

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('Choose your language');
    expect(html).toContain('Tiếng Việt');
    expect(html).toContain('English');
    expect(html).toContain('Continue');
  });
});
