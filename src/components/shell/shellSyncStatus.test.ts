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
