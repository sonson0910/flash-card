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
        isDeviceSyncVisible
        isDeviceSyncing={false}
        isDarkMode={false}
        canManageLibrary
        isLibraryMutationPending={false}
        libraryCountLabel="8 WORDS"
        onOpenToday={vi.fn()}
        onOpenLibrary={vi.fn()}
        onOpenCatalog={vi.fn()}
        onOpenProgress={vi.fn()}
        onDeviceSync={vi.fn()}
        onSignIn={vi.fn()}
        onSignOut={vi.fn()}
        onToggleTheme={vi.fn()}
        onExportLibrary={vi.fn()}
        onClearLibrary={vi.fn()}
      />,
    );

    expect(html).toContain('<nav');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('aria-label="Sign out of cloud sync"');
    expect(html).toContain('aria-label="Use dark theme"');
    expect(html).toContain('aria-label="Export library to Excel"');
    expect(html).toContain('aria-label="Clear the entire library"');
    expect(html).toContain('Learner');
    expect(html).toContain('Today');
    expect(html).toContain('Paths');
    expect(html).toContain('Vocabulary');
    expect(html).toContain('Progress');
    expect(html).not.toContain('>Study<');
    expect(html).not.toContain('>Practice<');
    expect(html).not.toContain('>Insights<');
    expect(html).not.toMatch(/firebase|firestore/i);
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
