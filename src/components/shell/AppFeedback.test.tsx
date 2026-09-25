import { renderToStaticMarkup } from 'react-dom/server';
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { describe, expect, it, vi } from 'vitest';
import { AppFeedback } from './AppFeedback';

const renderFeedback = (feedback: React.ReactNode) => {
  i18n.load('en', {});
  i18n.activate('en');
  return renderToStaticMarkup(<I18nProvider i18n={i18n}>{feedback}</I18nProvider>);
};

describe('AppFeedback', () => {
  it('renders feedback as a compact fixed popup stack instead of page-flow banners', () => {
    const html = renderFeedback(
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
    expect(html).toContain('class="notification-toast');
    expect(html).toContain('data-tone="danger"');
    expect(html).toContain('data-tone="warning"');
    expect(html).toContain('data-tone="success"');
    expect(html.match(/data-notification-toast="true"/g)).toHaveLength(3);
    expect(html).not.toContain('mx-4 mt-3 sm:mx-8');
  });

  it('shows paused cloud sync as one actionable popup', () => {
    const html = renderFeedback(
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

  it('keeps an undo child in the same bottom-right stack after notifications', () => {
    const html = renderFeedback(<AppFeedback><span data-undo-toast="true">Undo item</span></AppFeedback>);

    expect(html).toContain('class="app-feedback-stack');
    expect(html).toContain('bottom-[calc(5.5rem+env(safe-area-inset-bottom))]');
    expect(html).toContain('lg:bottom-4');
    expect(html.indexOf('data-undo-toast="true"')).toBeGreaterThan(html.indexOf('data-notification-viewport="true"'));
  });

  it('keeps observed session loss persistent and offers the real sign-in callback', () => {
    const html = renderFeedback(<AppFeedback sessionLost onRetryAuth={vi.fn()} />);

    expect(html).toContain('Session ended');
    expect(html).toContain('Sign in again to restore cloud sync.');
    expect(html).toContain('aria-label="Sign in again"');
    expect(html).not.toContain('Dismiss sign-in message');
    expect(html).toContain('role="alert"');
  });

  it('shows the actual auth retry busy state without clearing session recovery', () => {
    const html = renderFeedback(<AppFeedback sessionLost isRetryingAuth onRetryAuth={vi.fn()} />);

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('aria-label="Connecting…"');
    expect(html).toContain('Connecting…');
    expect(html).toContain('disabled=""');
    expect(html).toContain('Session ended');
  });

  it('keeps initial cloud verification out of the notification stack', () => {
    const html = renderFeedback(
      <AppFeedback
        syncStatus={{
          isOnline: true,
          isSyncing: false,
          isCheckingCloud: true,
          pendingCount: 0,
          error: null,
          cloudUnavailable: true,
        }}
      />,
    );

    expect(html).toBe('');
  });

  it('renders nothing when there is no feedback', () => {
    expect(renderFeedback(<AppFeedback />)).toBe('');
  });
});
