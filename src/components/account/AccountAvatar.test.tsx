import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AccountAvatar, getIdentityInitials } from './AccountAvatar';

const authenticated = (fields: { displayName?: string | null; email?: string | null; photoUrl?: string | null }) => ({
  status: 'authenticated' as const, displayName: null, email: null, photoUrl: null, ...fields,
});

describe('AccountAvatar', () => {
  it('shows the Google photo without sending a referrer, with the caller class', () => {
    const html = renderToStaticMarkup(<AccountAvatar identity={authenticated({ displayName: 'Kai Bui', photoUrl: 'https://lh3.googleusercontent.com/a/kai' })} imageClassName="ach-profile-photo" />);
    // React may also hoist a preload hint for the image; the image itself is what the screen draws.
    expect(html).toContain('<img src="https://lh3.googleusercontent.com/a/kai" alt="" referrerPolicy="no-referrer" class="ach-profile-photo"/>');
  });

  it('falls back to the initials of the name, then of the email, then to an icon', () => {
    expect(renderToStaticMarkup(<AccountAvatar identity={authenticated({ displayName: '  Kai  Bui Minh ' })} />)).toBe('<span aria-hidden="true">KB</span>');
    expect(renderToStaticMarkup(<AccountAvatar identity={authenticated({ email: 'kai@example.com' })} />)).toBe('<span aria-hidden="true">K</span>');
    const icon = renderToStaticMarkup(<AccountAvatar identity={authenticated({ displayName: '   ' })} />);
    expect(icon).toContain('<svg');
    expect(icon).toContain('aria-hidden="true"');
    expect(icon).not.toContain('animate-spin');
  });

  it('shows a spinner while the session loads or a sign-in is running, and an icon when signed out', () => {
    expect(renderToStaticMarkup(<AccountAvatar identity={{ status: 'loading' }} compact />)).toContain('animate-spin motion-reduce:animate-none');
    expect(renderToStaticMarkup(<AccountAvatar identity={{ status: 'signed-out', isConfigured: true, isSigningIn: true }} />)).toContain('animate-spin');
    expect(renderToStaticMarkup(<AccountAvatar identity={{ status: 'signed-out', isConfigured: true, isSigningIn: false }} />)).not.toContain('animate-spin');
  });

  it('never invents initials for a signed-out or loading session', () => {
    expect(getIdentityInitials({ status: 'signed-out', isConfigured: false, isSigningIn: false })).toBeNull();
    expect(getIdentityInitials({ status: 'loading' })).toBeNull();
    expect(getIdentityInitials(authenticated({}))).toBeNull();
  });
});
