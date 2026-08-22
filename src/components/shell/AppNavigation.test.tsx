import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DesktopNavigation } from './DesktopNavigation';
import { MobileNavigation } from './MobileNavigation';

describe('app shell navigation', () => {
  it('renders desktop navigation from a vendor-neutral view model', () => {
    const html = renderToStaticMarkup(
      <DesktopNavigation
        viewMode="library"
        syncIdentity={{ status: 'authenticated', displayName: 'Learner', email: 'learner@example.com', photoUrl: null }}
        syncStatus={{ isOnline: true, isSyncing: false, pendingCount: 0, error: null, cloudUnavailable: false }}
        isDeviceSyncVisible
        isDeviceSyncing={false}
        isDarkMode={false}
        libraryCountLabel="8 WORDS"
        onOpenToday={vi.fn()}
        onOpenLibrary={vi.fn()}
        onOpenCatalog={vi.fn()}
        onOpenProgress={vi.fn()}
        onDeviceSync={vi.fn()}
        onSignIn={vi.fn()}
        onSignOut={vi.fn()}
        onToggleTheme={vi.fn()}
      />,
    );

    expect(html).toContain('<nav');
    expect(html).toContain('src="/brand/sonflash-logo-192.png?v=3e7aaa58"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('aria-label="Sign out of cloud sync"');
    expect(html).toContain('aria-label="Use dark theme"');
    expect(html).toContain('Shared library');
    expect(html).not.toContain('Export library to Excel');
    expect(html).not.toContain('Clear the entire library');
    expect(html).toContain('Learner');
    expect(html).toContain('Today');
    expect(html).toContain('Paths');
    expect(html).toContain('Vocabulary');
    expect(html).toContain('Progress');
    expect(html).not.toContain('>Study<');
    expect(html).not.toContain('>Practice<');
    expect(html).not.toContain('>Insights<');
    expect(html).not.toMatch(/firebase|firestore/i);
    expect(html).toContain('bg-[var(--sf-surface)]');
    expect(html).toContain('self-center');
  });

  it('does not label an authenticated account as synced while changes are queued', () => {
    const html = renderToStaticMarkup(
      <DesktopNavigation
        viewMode="library"
        syncIdentity={{ status: 'authenticated', displayName: 'Learner', email: 'learner@example.com', photoUrl: null }}
        syncStatus={{ isOnline: true, isSyncing: false, pendingCount: 12, error: null, cloudUnavailable: false }}
        isDeviceSyncVisible={false}
        isDeviceSyncing={false}
        isDarkMode={false}
        libraryCountLabel="8 WORDS"
        onOpenToday={vi.fn()}
        onOpenLibrary={vi.fn()}
        onOpenCatalog={vi.fn()}
        onOpenProgress={vi.fn()}
        onDeviceSync={vi.fn()}
        onSignIn={vi.fn()}
        onSignOut={vi.fn()}
        onToggleTheme={vi.fn()}
      />,
    );

    expect(html).toContain('Waiting to sync');
    expect(html).not.toContain('>Synced<');
  });

  it('exposes disabled practice and study states in mobile navigation', () => {
    const html = renderToStaticMarkup(
      <MobileNavigation
        viewMode="library"
        onOpenToday={vi.fn()}
        onOpenLibrary={vi.fn()}
        onOpenCatalog={vi.fn()}
        onOpenProgress={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="Primary"');
    expect(html).toContain('aria-current="page"');
    expect(html).not.toContain('disabled=""');
    expect(html).toContain('Today');
    expect(html).toContain('Paths');
    expect(html).toContain('Vocabulary');
    expect(html).toContain('Progress');
  });
});
