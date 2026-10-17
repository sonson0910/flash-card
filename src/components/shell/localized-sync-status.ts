import type { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { ShellSyncStatus } from './shellSyncStatus';

type Translate = typeof i18n._;

export function localizeShellSyncStatus(
  status: ShellSyncStatus,
  translate: Translate,
): ShellSyncStatus {
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
      footerLabel: translate(msg({ id: 'shell.sync.offline', message: 'Offline' })),
      detail: translate(msg({ id: 'shell.sync.offline-detail', message: 'You are offline. Reconnect to keep studying.' })),
    };
    case 'cloud-paused': return {
      ...status,
      headerLabel: translate(msg({ id: 'shell.sync.paused', message: 'Cloud paused' })),
      footerLabel: translate(msg({ id: 'shell.sync.paused', message: 'Cloud paused' })),
      detail: translate(msg({ id: 'shell.sync.paused-detail', message: 'Live cloud updates are unavailable. Retry when your connection improves.' })),
    };
    case 'needs-attention': return {
      ...status,
      headerLabel: translate(msg({ id: 'shell.sync.needs-attention', message: 'Needs attention' })),
      footerLabel: translate(msg({ id: 'shell.sync.needs-attention', message: 'Needs attention' })),
      detail: status.detail,
    };
  }
}
