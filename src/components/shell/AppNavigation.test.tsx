import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { DesktopNavigation } from './DesktopNavigation';

i18n.load('en', {
  'shell.course.current': 'English ← Tiếng Việt', 'shell.nav.home': 'Home', 'shell.nav.today': 'Today', 'shell.nav.paths': 'Paths', 'shell.nav.vocabulary': 'Vocabulary', 'shell.nav.progress': 'Progress', 'shell.sync.connecting': 'Connecting…', 'shell.sync.sign-in': 'Sign in & sync', 'shell.sync.device': 'On device',
});
i18n.activate('en');
const renderNavigation = (navigation: ReactNode) => renderToStaticMarkup(<I18nProvider i18n={i18n}>{navigation}</I18nProvider>);

describe('app shell navigation', () => {
  it('renders desktop navigation from a vendor-neutral view model', () => {
    const html = renderNavigation(
      <DesktopNavigation
        viewMode="library"
        syncIdentity={{ status: 'authenticated', displayName: 'Learner', email: 'learner@example.com', photoUrl: null }}
        syncStatus={{ isOnline: true, isSyncing: false, pendingCount: 0, error: null, cloudUnavailable: false }}
        isDarkMode={false}
        libraryCountLabel="8 WORDS"
        onOpenToday={vi.fn()}
        onOpenLibrary={vi.fn()}
        onOpenCatalog={vi.fn()}
        onOpenProgress={vi.fn()}
        onSignIn={vi.fn()}
        onSignOut={vi.fn()}
        onToggleTheme={vi.fn()}
      />,
    );

    expect(html).toContain('<nav');
    expect(html).toContain('src="/brand/sonflash-logo-192.png?v=3e7aaa58"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('aria-label="Sign out of cloud sync"');
    expect(html).toContain('aria-label="Switch light and dark mode"');
    expect(html).toContain('aria-label="Manage library"');
    expect(html).not.toContain('Shared library');
    expect(html).not.toContain('Export library to Excel');
    expect(html).not.toContain('Clear the entire library');
    expect(html).toContain('English ← Tiếng Việt');
    expect(html).toContain('Today');
    expect(html).toContain('Paths');
    expect(html).toContain('Vocabulary');
    expect(html).toContain('Progress');
    expect(html).not.toContain('>Study<');
    expect(html).not.toContain('>Practice<');
    expect(html).not.toContain('>Insights<');
    expect(html).not.toMatch(/firebase|firestore/i);
    expect(html).toContain('data-shell-layer="primary"');
    expect(html).toContain('data-shell-active="true"');
    expect(html).toMatch(/<button[^>]*>[^]*?<span>Today<\/span>/);
    expect(html).toMatch(/<button[^>]*>[^]*?<span>Paths<\/span>/);
    expect(html).toMatch(/<button[^>]*>[^]*?<span>Vocabulary<\/span>/);
    expect(html).toMatch(/<button[^>]*>[^]*?<span>Progress<\/span>/);
    expect(html).not.toContain('liquid-glass hidden lg:flex');
    expect(html).toContain('crystal-chamfer');
    expect(html).toContain('flex-wrap');
    expect(html).toContain('max-[479px]:basis-full');
    expect(html).toContain('md:hidden');
  });

  it('does not label an authenticated account as synced while changes are queued', () => {
    const html = renderNavigation(
      <DesktopNavigation
        viewMode="library"
        syncIdentity={{ status: 'authenticated', displayName: 'Learner', email: 'learner@example.com', photoUrl: null }}
        syncStatus={{ isOnline: true, isSyncing: false, pendingCount: 12, error: null, cloudUnavailable: false }}
        isDarkMode={false}
        libraryCountLabel="8 WORDS"
        onOpenToday={vi.fn()}
        onOpenLibrary={vi.fn()}
        onOpenCatalog={vi.fn()}
        onOpenProgress={vi.fn()}
        onSignIn={vi.fn()}
        onSignOut={vi.fn()}
        onToggleTheme={vi.fn()}
      />,
    );

    expect(html).toContain('Waiting to sync');
    expect(html).not.toContain('>Synced<');
  });
});
