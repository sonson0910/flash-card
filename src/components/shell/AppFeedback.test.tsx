import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AppFeedback } from './AppFeedback';

describe('AppFeedback', () => {
  it('renders feedback as a compact fixed popup stack instead of page-flow banners', () => {
    const html = renderToStaticMarkup(
      <AppFeedback
        authError="Sign-in failed."
        error="Import failed."
        notice="Import complete."
        onDismissAuthError={vi.fn()}
        onDismissError={vi.fn()}
        onDismissNotice={vi.fn()}
      />,
    );

    expect(html.match(/role="alert"/g)).toHaveLength(2);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-atomic="true"');
    expect(html).toContain('aria-label="Dismiss sign-in message"');
    expect(html).toContain('aria-label="Dismiss system message"');
    expect(html).toContain('aria-label="Dismiss success message"');
    expect(html).toContain('Sign-in failed.');
    expect(html).toContain('Import failed.');
    expect(html).toContain('Import complete.');
    expect(html).toContain('data-notification-viewport="true"');
    expect(html).toContain('aria-label="Notifications"');
    expect(html).toContain('fixed');
    expect(html.match(/data-notification-toast="true"/g)).toHaveLength(3);
    expect(html).not.toContain('mx-4 mt-3 sm:mx-8');
  });

  it('shows paused cloud sync as one actionable popup', () => {
    const html = renderToStaticMarkup(
      <AppFeedback
        syncStatus={{
          isOnline: true,
          isSyncing: false,
          pendingCount: 0,
          error: null,
          cloudUnavailable: true,
        }}
        onRetrySync={vi.fn()}
      />,
    );

    expect(html).toContain('Cloud paused');
    expect(html).toContain('Live cloud updates are unavailable.');
    expect(html).toContain('aria-label="Retry syncing your library"');
    expect(html).toContain('aria-label="Dismiss sync status"');
    expect(html).toContain('bottom-[calc(5.5rem+env(safe-area-inset-bottom))]');
    expect(html).toContain('lg:bottom-4');
    expect(html.match(/data-notification-toast="true"/g)).toHaveLength(1);
  });

  it('renders nothing when there is no feedback', () => {
    expect(renderToStaticMarkup(<AppFeedback />)).toBe('');
  });
});
