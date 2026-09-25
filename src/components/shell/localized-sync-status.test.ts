import { i18n } from '@lingui/core';
import { describe, expect, it } from 'vitest';
import { getShellSyncStatus } from './shellSyncStatus';
import { localizeShellSyncStatus } from './localized-sync-status';

const inputFor = (error: string) => ({
  isOnline: true,
  isSyncing: false,
  pendingCount: 2,
  error,
  cloudUnavailable: true,
});

describe('localizeShellSyncStatus', () => {
  it('localizes known sync failure messages while keeping unknown detail intact', () => {
    i18n.load('vi', {
      'shell.sync.needs-attention': 'Cần chú ý',
      'shell.sync.error.storage-blocked': 'Bản dịch storage blocked',
    });
    i18n.activate('vi');
    const translate = i18n._.bind(i18n);

    const knownInput = inputFor('Another SonFlash tab is blocking local sync storage. Close other SonFlash tabs, then retry syncing. Your changes remain safe on this device.');
    const known = localizeShellSyncStatus(getShellSyncStatus(knownInput), knownInput, translate);
    const unknownInput = inputFor('Unclassified service response: try the account administrator.');
    const unknown = localizeShellSyncStatus(getShellSyncStatus(unknownInput), unknownInput, translate);

    expect(known.headerLabel).toBe('Cần chú ý');
    expect(known.detail).toBe('Bản dịch storage blocked');
    expect(unknown.detail).toBe('Unclassified service response: try the account administrator.');
  });

  it.each([
    ['Cloud access was denied. Please check access.', 'shell.sync.error.access-denied'],
    ['Cloud is temporarily unreachable. Retry later.', 'shell.sync.error.unavailable'],
    ["Firebase's daily read limit has been reached. Changes stay safe.", 'shell.sync.error.quota'],
    ['This app and its cloud configuration are out of sync.', 'shell.sync.error.configuration'],
    ['Sync is temporarily unavailable. Try later.', 'shell.sync.error.generic'],
  ])('maps known error family %s to its catalog message', (error, id) => {
    i18n.load('en', {
      'shell.sync.needs-attention': 'Needs attention',
      [id]: 'Localized sync error copy',
    });
    i18n.activate('en');
    const translate = i18n._.bind(i18n);
    const input = inputFor(error);
    const localized = localizeShellSyncStatus(getShellSyncStatus(input), input, translate);

    expect(localized.detail).not.toBe(error);
    expect(localized.detail).toBe('Localized sync error copy');
  });
});
