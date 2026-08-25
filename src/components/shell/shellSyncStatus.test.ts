import { describe, expect, it } from 'vitest';
import { getShellSyncStatus } from './shellSyncStatus';

describe('shell sync status', () => {
  it('treats owner verification as a quiet loading state instead of a cloud error', () => {
    const initializingStatus = {
      isOnline: true,
      isSyncing: false,
      pendingCount: 0,
      error: null,
      cloudUnavailable: true,
      isCheckingCloud: true,
    };

    expect(getShellSyncStatus(initializingStatus)).toMatchObject({
      kind: 'checking',
      headerLabel: 'Checking cloud…',
      footerLabel: 'Checking cloud…',
      healthy: false,
      busy: true,
      canRetry: false,
    });
  });

  it('uses Synced and Online only when no local or cloud work is outstanding', () => {
    expect(getShellSyncStatus({
      isOnline: true,
      isSyncing: false,
      pendingCount: 0,
      error: null,
      cloudUnavailable: false,
    })).toMatchObject({
      kind: 'synced',
      headerLabel: 'Synced',
      footerLabel: 'Online',
      healthy: true,
    });
  });

  it('shows queued local changes instead of claiming the account is synced', () => {
    expect(getShellSyncStatus({
      isOnline: true,
      isSyncing: false,
      pendingCount: 12,
      error: null,
      cloudUnavailable: false,
    })).toMatchObject({
      kind: 'queued',
      headerLabel: 'Waiting to sync',
      footerLabel: 'Waiting to sync',
      healthy: false,
    });
  });

  it('gives sync errors precedence over connectivity labels', () => {
    expect(getShellSyncStatus({
      isOnline: true,
      isSyncing: false,
      pendingCount: 2,
      error: 'Cloud access was denied.',
      cloudUnavailable: true,
      isCheckingCloud: true,
    })).toMatchObject({
      kind: 'needs-attention',
      headerLabel: 'Needs attention',
      footerLabel: 'Needs attention',
      healthy: false,
    });
  });

  it('distinguishes a dead cloud listener from a healthy online connection', () => {
    expect(getShellSyncStatus({
      isOnline: true,
      isSyncing: false,
      pendingCount: 0,
      error: null,
      cloudUnavailable: true,
    })).toMatchObject({
      kind: 'cloud-paused',
      headerLabel: 'Cloud paused',
      footerLabel: 'Cloud paused, using cache',
      healthy: false,
    });
  });
});
