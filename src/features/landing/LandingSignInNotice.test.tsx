import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LandingSignInNotice } from './LandingSignInNotice';

i18n.load('en', {});
i18n.activate('en');
const render = (props: { busy: boolean; error: string | null }) => renderToStaticMarkup(
  <I18nProvider i18n={i18n}><LandingSignInNotice {...props} /></I18nProvider>,
);

describe('landing sign-in notice', () => {
  it('renders nothing while idle without an error', () => {
    expect(render({ busy: false, error: null })).toBe('');
  });

  it('announces that sign-in is in progress', () => {
    const html = render({ busy: true, error: null });
    expect(html).toContain('role="status"');
    expect(html).toContain('Signing in…');
  });

  it('shows the failure to the learner as an alert', () => {
    const html = render({ busy: false, error: 'The sign-in window was closed.' });
    expect(html).toContain('role="alert"');
    expect(html).toContain('The sign-in window was closed.');
  });
});
