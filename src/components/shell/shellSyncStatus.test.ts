import { describe, expect, it } from 'vitest';
import { getShellSyncStatus } from './shellSyncStatus';

describe('shell sync status', () => {
  it('treats owner verification as a quiet loading state instead of a cloud error', () => {
    expect(getShellSyncStatus({
      isOnline: true,
      error: null,
      cloudUnavailable: true,
      isCheckingCloud: true,
    })).toMatchObject({
      kind: 'checking',
      headerLabel: 'Checking cloud…',
      footerLabel: 'Checking cloud…',
      healthy: false,
      busy: true,
      canRetry: false,
    });
  });

  it('uses Synced and Online only when no cloud work is outstanding', () => {
    expect(getShellSyncStatus({
      isOnline: true,
      error: null,
      cloudUnavailable: false,
    })).toMatchObject({
      kind: 'synced',
      headerLabel: 'Synced',
      footerLabel: 'Online',
      healthy: true,
    });
  });

  it('does not report Synced while the shown library page is only a cache snapshot', () => {
    const status = getShellSyncStatus({
      isOnline: true,
      error: null,
      cloudUnavailable: false,
      awaitingCloudConfirmation: true,
    });

    expect(status).toMatchObject({ kind: 'awaiting-cloud', healthy: false, busy: true, canRetry: false });
    expect(status.headerLabel).not.toBe('Synced');
    expect(status.detail).not.toBe('All changes are saved.');
  });

  it('still reports offline, paused cloud and errors ahead of an unconfirmed cache page', () => {
    const awaitingCloudConfirmation = true;
    expect(getShellSyncStatus({ isOnline: false, cloudUnavailable: false, awaitingCloudConfirmation }).kind).toBe('offline');
    expect(getShellSyncStatus({ isOnline: true, cloudUnavailable: true, awaitingCloudConfirmation }).kind).toBe('cloud-paused');
    expect(getShellSyncStatus({ isOnline: true, cloudUnavailable: false, error: 'Boom', awaitingCloudConfirmation }).kind).toBe('needs-attention');
  });

  it('keeps the offline indicator visible while the browser is disconnected', () => {
    expect(getShellSyncStatus({
      isOnline: false,
      error: null,
      cloudUnavailable: false,
    })).toMatchObject({
      kind: 'offline',
      headerLabel: 'Offline',
      footerLabel: 'Offline',
      healthy: false,
      busy: false,
      canRetry: false,
    });
  });

  it('gives errors precedence over connectivity labels', () => {
    expect(getShellSyncStatus({
      isOnline: true,
      error: 'Cloud access was denied.',
      cloudUnavailable: true,
      isCheckingCloud: true,
    })).toMatchObject({
      kind: 'needs-attention',
      headerLabel: 'Needs attention',
      footerLabel: 'Needs attention',
      healthy: false,
      canRetry: true,
    });
  });

  it('distinguishes a dead cloud listener from a healthy online connection', () => {
    expect(getShellSyncStatus({
      isOnline: true,
      error: null,
      cloudUnavailable: true,
    })).toMatchObject({
      kind: 'cloud-paused',
      headerLabel: 'Cloud paused',
      footerLabel: 'Cloud paused',
      healthy: false,
      canRetry: true,
    });
  });
});
