import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { DesktopNavigation } from './DesktopNavigation';

const themeState = vi.hoisted(() => ({ family: 'classic' as 'classic' | 'crystal' }));

vi.mock('../../features/theme/ThemeProvider', () => ({
  useTheme: () => ({ family: themeState.family, mode: 'dark', setFamily: vi.fn(), setMode: vi.fn() }),
}));

i18n.load('en', {
  'shell.course.current': 'English ← Tiếng Việt', 'shell.nav.home': 'Home', 'shell.nav.today': 'Today', 'shell.nav.paths': 'Paths', 'shell.nav.vocabulary': 'Vocabulary', 'shell.nav.progress': 'Progress', 'shell.sync.connecting': 'Connecting…', 'shell.sync.sign-in': 'Sign in & sync', 'shell.sync.device': 'On this device',
});
i18n.activate('en');
const renderNavigation = (navigation: ReactNode) => renderToStaticMarkup(<I18nProvider i18n={i18n}>{navigation}</I18nProvider>);

describe('app shell navigation', () => {
  it('uses the Paths label for the Crystal catalog item', () => {
    themeState.family = 'crystal';
    const onOpenCatalog = vi.fn();
    const html = renderNavigation(
      <DesktopNavigation
        viewMode="library"
        syncIdentity={{ status: 'signed-out', isConfigured: false, isSigningIn: false }}
        syncStatus={{ isOnline: true, error: null, cloudUnavailable: false }}
        isDarkMode
        libraryCountLabel="0 WORDS"
        onOpenToday={vi.fn()}
        onOpenLibrary={vi.fn()}
        onOpenCatalog={onOpenCatalog}
        onOpenProgress={vi.fn()}
        onSignIn={vi.fn()}
        onSignOut={vi.fn()}
      />,
    );
    themeState.family = 'classic';

    expect(html).toContain('Paths');
    expect(html).not.toContain('Goals');
    expect(html).not.toContain('shell.nav.goals');
  });

  it('renders desktop navigation from a vendor-neutral view model', () => {
    const html = renderNavigation(
      <DesktopNavigation
        viewMode="library"
        syncIdentity={{ status: 'authenticated', displayName: 'Learner', email: 'learner@example.com', photoUrl: null }}
        syncStatus={{ isOnline: true, error: null, cloudUnavailable: false }}
        isDarkMode={false}
        libraryCountLabel="8 WORDS"
        streak={5}
        level={4}
        xp={860}
        onOpenToday={vi.fn()}
        onOpenLibrary={vi.fn()}
        onOpenCatalog={vi.fn()}
        onOpenProgress={vi.fn()}
        onSignIn={vi.fn()}
        onSignOut={vi.fn()}
      />,
    );

    expect(html).toContain('<nav');
    expect(html).toContain('claude-brand-star');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('aria-label="Manage library"');
    expect(html).toContain('aria-label="Switch light and dark mode"');
    expect(html).toContain('aria-label="Choose theme"');
    expect(html).toContain('aria-label="Manage library"');
    expect(html).not.toContain('Shared library');
    expect(html).not.toContain('Export library to Excel');
    expect(html).not.toContain('Clear the entire library');
    expect(html).toContain('Today');
    expect(html).toContain('Paths');
    expect(html).toContain('Vocabulary');
    expect(html).toContain('Progress');
    expect(html).not.toContain('>Study<');
    expect(html).not.toContain('>Practice<');
    expect(html).not.toContain('>Insights<');
    expect(html).not.toContain('English ← Tiếng Việt');
    expect(html).not.toMatch(/firebase|firestore/i);
    expect(html).toContain('data-shell-layer="primary"');
    expect(html).toContain('data-shell-active="true"');
    expect(html).toContain('claude-nav-item');
    expect(html).toContain('claude-streak');
    expect(html).toContain('claude-level');
    expect(html).not.toContain('liquid-glass hidden lg:flex');
  });

  it('does not label an authenticated account as synced while the cloud listener is paused', () => {
    const html = renderNavigation(
      <DesktopNavigation
        viewMode="library"
        syncIdentity={{ status: 'authenticated', displayName: 'Learner', email: 'learner@example.com', photoUrl: null }}
        syncStatus={{ isOnline: true, error: null, cloudUnavailable: true }}
        isDarkMode={false}
        libraryCountLabel="8 WORDS"
        onOpenToday={vi.fn()}
        onOpenLibrary={vi.fn()}
        onOpenCatalog={vi.fn()}
        onOpenProgress={vi.fn()}
        onSignIn={vi.fn()}
        onSignOut={vi.fn()}
      />,
    );

    expect(html).toContain('Cloud paused');
    expect(html).not.toContain('>Synced<');
    expect(html).not.toContain('claude-streak');
    expect(html).not.toContain('claude-level');
  });

  it('announces local sync state for signed-out users instead of claiming cloud sync', () => {
    const html = renderNavigation(
      <DesktopNavigation
        viewMode="library"
        syncIdentity={{ status: 'signed-out', isConfigured: false, isSigningIn: false }}
        syncStatus={{ isOnline: true, error: null, cloudUnavailable: false }}
        isDarkMode={false}
        libraryCountLabel="8 WORDS"
        onOpenToday={vi.fn()}
        onOpenLibrary={vi.fn()}
        onOpenCatalog={vi.fn()}
        onOpenProgress={vi.fn()}
        onSignIn={vi.fn()}
        onSignOut={vi.fn()}
      />,
    );

    expect(html).toContain('On this device');
    expect(html).not.toContain('>Synced<');
    expect(html).not.toContain('>SF<');
  });

  it('keeps session recovery visible and does not announce the cached account as synced', () => {
    const html = renderNavigation(
      <DesktopNavigation
        viewMode="library"
        syncIdentity={{ status: 'authenticated', displayName: 'Learner', email: 'learner@example.com', photoUrl: null }}
        syncStatus={{ isOnline: true, error: null, cloudUnavailable: false }}
        isDarkMode={false}
        libraryCountLabel="8 WORDS"
        sessionLost
        onOpenToday={vi.fn()}
        onOpenLibrary={vi.fn()}
        onOpenCatalog={vi.fn()}
        onOpenProgress={vi.fn()}
        onSignIn={vi.fn()}
        onSignOut={vi.fn()}
      />,
    );

    expect(html).toContain('Session ended');
    expect(html).not.toContain('>Synced<');
  });
});
