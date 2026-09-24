import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { ShellSyncStatus, ShellSyncStatusInput } from './shellSyncStatus';

type Translate = typeof i18n._;

export function localizeShellSyncStatus(
  status: ShellSyncStatus,
  input: ShellSyncStatusInput,
  translate: Translate,
): ShellSyncStatus {
  const count = Math.max(0, Math.floor(input.pendingCount));
  switch (status.kind) {
    case 'synced': return {
      ...status,
      headerLabel: translate(msg({ id: 'shell.sync.synced', message: 'Synced' })),
      footerLabel: translate(msg({ id: 'shell.sync.online', message: 'Online' })),
      detail: translate(msg({ id: 'shell.sync.saved-detail', message: 'All changes are saved.' })),
    };
    case 'checking': return {
      ...status,
      headerLabel: translate(msg({ id: 'shell.sync.checking', message: 'Checking cloud…' })),
      footerLabel: translate(msg({ id: 'shell.sync.checking', message: 'Checking cloud…' })),
      detail: translate(msg({ id: 'shell.sync.checking-detail', message: 'Verifying your cloud session.' })),
    };
    case 'offline': return {
      ...status,
      headerLabel: translate(msg({ id: 'shell.sync.offline', message: 'Offline' })),
      footerLabel: translate(msg({ id: 'shell.sync.offline-cache', message: 'Offline, using cache' })),
      detail: translate(msg({ id: 'shell.sync.offline-detail', message: 'Your library is available offline.' })),
    };
    case 'cloud-paused': return {
      ...status,
      headerLabel: translate(msg({ id: 'shell.sync.paused', message: 'Cloud paused' })),
      footerLabel: translate(msg({ id: 'shell.sync.paused-cache', message: 'Cloud paused, using cache' })),
      detail: translate(msg({ id: 'shell.sync.paused-detail', message: 'Live cloud updates are unavailable. Showing the last successful local copy.' })),
    };
    case 'saving-offline': return {
      ...status,
      headerLabel: translate(msg({ id: 'shell.sync.saving-offline', message: 'Saving offline' })),
      footerLabel: translate(msg({ id: 'shell.sync.saving-offline', message: 'Saving offline' })),
      detail: count === 1
        ? translate(msg({ id: 'shell.sync.saving-offline-one', message: '1 change is safe on this device and will sync when you reconnect.' }))
        : translate({ ...msg({ id: 'shell.sync.saving-offline-many', message: '{count} changes are safe on this device and will sync when you reconnect.' }), values: { count } }),
    };
    case 'queued': return {
      ...status,
      headerLabel: translate(msg({ id: 'shell.sync.queued', message: 'Waiting to sync' })),
      footerLabel: translate(msg({ id: 'shell.sync.queued', message: 'Waiting to sync' })),
      detail: count === 1
        ? translate(msg({ id: 'shell.sync.queued-one', message: '1 change is safe on this device and waiting to sync.' }))
        : translate({ ...msg({ id: 'shell.sync.queued-many', message: '{count} changes are safe on this device and waiting to sync.' }), values: { count } }),
    };
    case 'syncing': return {
      ...status,
      headerLabel: translate(msg({ id: 'shell.sync.syncing', message: 'Syncing' })),
      footerLabel: translate(msg({ id: 'shell.sync.syncing', message: 'Syncing' })),
      detail: count > 0
        ? translate({ ...msg({ id: 'shell.sync.syncing-count', message: 'Syncing {count} changes to your library.' }), values: { count } })
        : translate(msg({ id: 'shell.sync.syncing-check', message: 'Checking your library for changes.' })),
    };
    case 'needs-attention': return {
      ...status,
      headerLabel: translate(msg({ id: 'shell.sync.needs-attention', message: 'Needs attention' })),
      footerLabel: translate(msg({ id: 'shell.sync.needs-attention', message: 'Needs attention' })),
    };
  }
}
