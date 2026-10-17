import { i18n } from '@lingui/core';
import { describe, expect, it } from 'vitest';
import { getShellSyncStatus } from './shellSyncStatus';
import { localizeShellSyncStatus } from './localized-sync-status';

describe('localizeShellSyncStatus', () => {
  it('localizes the header and footer labels for each status kind', () => {
    i18n.load('vi', {
      'shell.sync.synced': 'Đã đồng bộ',
      'shell.sync.online': 'Trực tuyến',
      'shell.sync.saved-detail': 'Mọi thay đổi đã được lưu.',
    });
    i18n.activate('vi');
    const translate = i18n._.bind(i18n);

    const status = localizeShellSyncStatus(getShellSyncStatus({
      isOnline: true,
      error: null,
      cloudUnavailable: false,
    }), translate);

    expect(status).toMatchObject({
      kind: 'synced',
      headerLabel: 'Đã đồng bộ',
      footerLabel: 'Trực tuyến',
      detail: 'Mọi thay đổi đã được lưu.',
    });
  });

  it('passes an unrecognized error message through untouched while still localizing the label', () => {
    i18n.load('en', { 'shell.sync.needs-attention': 'Needs attention' });
    i18n.activate('en');
    const translate = i18n._.bind(i18n);

    const status = localizeShellSyncStatus(getShellSyncStatus({
      isOnline: true,
      error: 'Unclassified service response: try the account administrator.',
      cloudUnavailable: true,
    }), translate);

    expect(status.headerLabel).toBe('Needs attention');
    expect(status.detail).toBe('Unclassified service response: try the account administrator.');
  });

  it('localizes the offline and cloud-paused kinds', () => {
    i18n.load('en', {
      'shell.sync.offline': 'Offline',
      'shell.sync.offline-detail': 'You are offline. Reconnect to keep studying.',
      'shell.sync.paused': 'Cloud paused',
      'shell.sync.paused-detail': 'Live cloud updates are unavailable. Retry when your connection improves.',
    });
    i18n.activate('en');
    const translate = i18n._.bind(i18n);

    const offline = localizeShellSyncStatus(getShellSyncStatus({
      isOnline: false,
      error: null,
      cloudUnavailable: false,
    }), translate);
    expect(offline).toMatchObject({ kind: 'offline', headerLabel: 'Offline' });

    const cloudPaused = localizeShellSyncStatus(getShellSyncStatus({
      isOnline: true,
      error: null,
      cloudUnavailable: true,
    }), translate);
    expect(cloudPaused).toMatchObject({ kind: 'cloud-paused', headerLabel: 'Cloud paused' });
  });
});
