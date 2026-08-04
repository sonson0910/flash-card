import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SyncHealth } from './SyncHealth';

describe('SyncHealth accessibility contract', () => {
  it('announces sync progress atomically without exposing decorative icons', () => {
    const html = renderToStaticMarkup(
      <SyncHealth isOnline isSyncing pendingCount={2} error={null} />,
    );

    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-atomic="true"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Syncing');
    expect(html).toContain('Syncing 2 changes to your library.');
    expect(html).toContain('aria-hidden="true"');
  });

  it('renders an enabled, clearly labelled retry only for an actionable error', () => {
    const html = renderToStaticMarkup(
      <SyncHealth
        isOnline
        isSyncing={false}
        pendingCount={2}
        error="Cloud sync paused."
        onRetry={vi.fn()}
      />,
    );

    expect(html).toContain('Needs attention');
    expect(html).toMatch(/<button[^>]*type="button"[^>]*aria-label="Retry syncing your library"/);
    expect(html).toContain('Retry');
  });

  it('offers retry without a spinner when online changes are queued but idle', () => {
    const html = renderToStaticMarkup(
      <SyncHealth
        isOnline
        isSyncing={false}
        pendingCount={5}
        error={null}
        onRetry={vi.fn()}
      />,
    );

    expect(html).toContain('Waiting to sync');
    expect(html).toContain('5 changes are safe on this device and waiting to sync.');
    expect(html).toContain('aria-busy="false"');
    expect(html).toContain('Retry');
    expect(html).not.toContain('animate-spin');
  });

  it('does not show a dead retry control when no retry handler is available', () => {
    const html = renderToStaticMarkup(
      <SyncHealth
        isOnline
        isSyncing={false}
        pendingCount={2}
        error="Cloud sync paused."
      />,
    );

    expect(html).not.toContain('<button');
  });
});
