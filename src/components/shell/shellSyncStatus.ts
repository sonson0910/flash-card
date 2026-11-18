export interface ShellSyncStatusInput {
  isOnline: boolean;
  cloudUnavailable: boolean;
  isCheckingCloud?: boolean;
  error?: string | null;
}

export type ShellSyncStatusKind = 'synced' | 'checking' | 'offline' | 'cloud-paused' | 'needs-attention';

export interface ShellSyncStatus {
  kind: ShellSyncStatusKind;
  headerLabel: string;
  footerLabel: string;
  detail: string;
  healthy: boolean;
  busy: boolean;
  canRetry: boolean;
}

export function getShellSyncStatus(input: ShellSyncStatusInput): ShellSyncStatus {
  const errorMessage = input.error?.trim();
  if (errorMessage) {
    return {
      kind: 'needs-attention',
      headerLabel: 'Needs attention',
      footerLabel: 'Needs attention',
      detail: errorMessage,
      healthy: false,
      busy: false,
      canRetry: true,
    };
  }
  if (input.isCheckingCloud) {
    return {
      kind: 'checking',
      headerLabel: 'Checking cloud…',
      footerLabel: 'Checking cloud…',
      detail: 'Verifying your cloud session.',
      healthy: false,
      busy: true,
      canRetry: false,
    };
  }
  if (!input.isOnline) {
    return {
      kind: 'offline',
      headerLabel: 'Offline',
      footerLabel: 'Offline',
      detail: 'You are offline. Reconnect to keep studying.',
      healthy: false,
      busy: false,
      canRetry: false,
    };
  }
  if (input.cloudUnavailable) {
    return {
      kind: 'cloud-paused',
      headerLabel: 'Cloud paused',
      footerLabel: 'Cloud paused',
      detail: 'Live cloud updates are unavailable. Retry when your connection improves.',
      healthy: false,
      busy: false,
      canRetry: true,
    };
  }
  return {
    kind: 'synced',
    headerLabel: 'Synced',
    footerLabel: 'Online',
    detail: 'All changes are saved.',
    healthy: true,
    busy: false,
    canRetry: false,
  };
}
