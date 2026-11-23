import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@lingui/react';
import { i18n } from '@lingui/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const theme = vi.hoisted(() => ({ family: 'classic' as 'classic' | 'crystal' }));
vi.mock('../theme/ThemeProvider', () => ({ useTheme: () => ({ family: theme.family }) }));
vi.mock('../../lib/firebase', () => ({ app: null, db: null, getSonFlashFunctions: vi.fn() }));

const { ProfileCompletionGate } = await import('./ProfileCompletionGate');

const render = (screen: 'required' | 'restricted' | 'error') => renderToStaticMarkup(
  <I18nProvider i18n={i18n}>
    <ProfileCompletionGate screen={screen} submit={vi.fn()} retry={vi.fn()} returnLabel="Vocabulary library" onSignOut={vi.fn()} />
  </I18nProvider>,
);

beforeEach(() => {
  i18n.load('en', {});
  i18n.activate('en');
  theme.family = 'classic';
});

describe('ProfileCompletionGate', () => {
  it('labels every field and offers the app locales and course native languages', () => {
    const html = render('required');
    for (const field of ['birth-year', 'locale', 'native', 'consent']) {
      expect(html).toMatch(new RegExp(`<label[^>]*for="[^"]*-${field}"`));
    }
    expect(html).toContain('autoComplete="bday-year"');
    expect(html).toContain('inputMode="numeric"');
    expect(html).toMatch(/<option value="en" lang="en"[^>]*>English<\/option>/);
    expect(html).toMatch(/<option value="vi" lang="vi"[^>]*>Tiếng Việt<\/option>/);
    expect(html).toMatch(/<option value="vi"[^>]*>Vietnamese<\/option>/);
    expect(html).toMatch(/<option value="en"[^>]*>English<\/option>/);
  });

  it('links the terms and the privacy policy in the 18+ consent and ties the hint to the checkbox', () => {
    const html = render('required');
    expect(html).toContain('I am 18 or older and I agree to the');
    expect(html).toContain('href="/terms.html"');
    expect(html).toContain('href="/privacy.html"');
    const hintId = html.match(/aria-describedby="([^"]+-consent-hint)"/)?.[1];
    expect(hintId).toBeTruthy();
    expect(html).toContain(`id="${hintId}"`);
    expect(html).toContain('Required before continuing.');
  });

  it('shows the real return location in the outcomes panel', () => {
    const html = render('required');
    expect(html).toContain('Return location preserved · Vocabulary library');
    expect(html).toContain('Return location · Vocabulary library');
    expect(html).toContain('Save and continue');
    expect(html).not.toMatch(/Focused desktop|COMPLETE|Step 3 of 3/);
  });

  it('offers the account data dialog beside the help link while the profile step holds the account', () => {
    const accountDataButton = /<button type="button" class="profile-gate__link profile-gate__link-button" aria-haspopup="dialog">Account data<\/button>\s*<a class="profile-gate__link" href="[^"]+">Need help\?<\/a>/;
    expect(render('required')).toMatch(accountDataButton);
    expect(render('restricted')).toMatch(accountDataButton);
    expect(render('error')).not.toContain('Account data');
  });

  it('offers only the way back to sign-in, besides the account data, on the restricted screen', () => {
    const html = render('restricted');
    expect(html).toContain('We cannot create this account yet.');
    expect(html).toContain('Return to sign in');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('Birth year</label>');
    expect(html).not.toContain('Return location preserved');
  });

  it('uses the Crystal copy in the Crystal family', () => {
    theme.family = 'crystal';
    expect(render('required')).toContain('Make it yours');
    expect(render('required')).toContain('Return anchor · Vocabulary library');
    expect(render('restricted')).toContain('Account creation paused');
  });

  it('offers a retry and sign-out when the account could not be checked', () => {
    const html = render('error');
    expect(html).toContain('We could not check your account.');
    expect(html).toContain('Try again');
    expect(html).toContain('Sign out');
    expect(html).not.toContain('<form');
  });
});
