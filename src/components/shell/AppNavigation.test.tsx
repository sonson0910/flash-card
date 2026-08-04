import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { DesktopNavigation } from './DesktopNavigation';
import { MobileNavigation } from './MobileNavigation';

describe('app shell navigation', () => {
  it('renders desktop navigation from a vendor-neutral view model', () => {
    const html = renderToStaticMarkup(
      <DesktopNavigation
        viewMode="library"
        canUseVisibleLibrary
        practiceLibraryCount={8}
        isPracticeMenuOpen={false}
        isStatsOpen={false}
        syncIdentity={{ status: 'authenticated', displayName: 'Learner', email: 'learner@example.com', photoUrl: null }}
        isDeviceSyncVisible
        isDeviceSyncing={false}
        isDarkMode={false}
        canManageLibrary
        isLibraryMutationPending={false}
        libraryCountLabel="8 WORDS"
        onOpenLibrary={vi.fn()}
        onOpenCatalog={vi.fn()}
        onStartStudy={vi.fn()}
        onOpenPractice={vi.fn()}
        onOpenInsights={vi.fn()}
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
    expect(html).toContain('Paths');
    expect(html).not.toMatch(/firebase|firestore/i);
  });

  it('exposes disabled practice and study states in mobile navigation', () => {
    const html = renderToStaticMarkup(
      <MobileNavigation
        viewMode="library"
        canUseVisibleLibrary={false}
        practiceLibraryCount={3}
        isPracticeMenuOpen={false}
        isStatsOpen={false}
        onOpenLibrary={vi.fn()}
        onOpenCatalog={vi.fn()}
        onStartStudy={vi.fn()}
        onOpenPractice={vi.fn()}
        onOpenInsights={vi.fn()}
      />,
    );

    expect(html).toContain('aria-label="Primary"');
    expect(html).toContain('aria-current="page"');
    expect(html.match(/disabled=""/g)).toHaveLength(2);
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('Library');
    expect(html).toContain('Paths');
    expect(html).toContain('Study');
    expect(html).toContain('Practice');
    expect(html).toContain('Insights');
  });
});
