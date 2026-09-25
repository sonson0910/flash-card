import { renderToStaticMarkup } from 'react-dom/server';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { describe, expect, it, vi } from 'vitest';
import { getIdentityInitials, getIdentityLabel, LibraryManagementMenu, shouldShowSyncNow } from './LibraryManagementMenu';

describe('LibraryManagementMenu', () => {
  it('groups maintenance actions behind a compact accessible trigger', () => {
    i18n.load('en', {});
    i18n.activate('en');
    const html = renderToStaticMarkup(<I18nProvider i18n={i18n}><LibraryManagementMenu
      isExporting={false}
      isLibraryMutationPending={false}
      onExportLibrary={vi.fn()}
      onClearLibrary={vi.fn()}
      syncIdentity={{ status: 'signed-out', isConfigured: false, isSigningIn: false }}
      syncStatus={{ kind: 'synced', headerLabel: 'Synced', footerLabel: 'Online', detail: 'All changes are saved.', healthy: true, busy: false, canRetry: false }}
      libraryCountLabel="8 WORDS"
    /></I18nProvider>);

    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-label="Manage library"');
    expect(html).toContain('title="Manage library"');
    expect(html).toContain('account-menu-trigger');
    expect(html).not.toContain('>Manage library</button>');
    expect(html).not.toContain('Export library to Excel');
    expect(html).not.toContain('Clear the entire library');
    expect(html).toContain('focus-visible:');
    expect(html).not.toMatch(/\bhidden\b.*\bxl:/);
  });

  it('uses only the supplied account identity and does not invent a signed-out identity', () => {
    expect(getIdentityInitials({ status: 'authenticated', displayName: 'Kai Bui', email: 'kai@example.com', photoUrl: null })).toBe('KB');
    expect(getIdentityInitials({ status: 'authenticated', displayName: null, email: 'kai@example.com', photoUrl: null })).toBe('K');
    expect(getIdentityInitials({ status: 'signed-out', isConfigured: false, isSigningIn: false })).toBeNull();
    expect(getIdentityLabel({ status: 'authenticated', displayName: null, email: 'kai@example.com', photoUrl: null }, 'Account', 'Connecting…')).toBe('kai@example.com');
    expect(getIdentityLabel({ status: 'loading' }, 'Account', 'Connecting…')).toBe('Connecting…');
    expect(getIdentityLabel({ status: 'signed-out', isConfigured: false, isSigningIn: false }, 'Account', 'Connecting…')).toBe('Account');
  });

  it('offers Sync now only for an authenticated session with a permitted retry callback', () => {
    const authenticated = { status: 'authenticated' as const, displayName: 'Learner', email: 'learner@example.com', photoUrl: null };
    const signedOut = { status: 'signed-out' as const, isConfigured: true, isSigningIn: false };
    expect(shouldShowSyncNow(authenticated, false, true, true)).toBe(true);
    expect(shouldShowSyncNow(authenticated, false, false, true)).toBe(false);
    expect(shouldShowSyncNow(authenticated, false, true, false)).toBe(false);
    expect(shouldShowSyncNow(authenticated, true, true, true)).toBe(false);
    expect(shouldShowSyncNow(signedOut, false, true, true)).toBe(false);
  });
});
