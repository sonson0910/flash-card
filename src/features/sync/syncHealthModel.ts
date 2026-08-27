import { firestoreDailyReadLimitMessage } from '../../lib/cloudError';

export type SyncHealthKind =
  | 'saved'
  | 'saving-offline'
  | 'queued'
  | 'syncing'
  | 'needs-attention';

export interface SyncHealthInput {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  error?: string | null;
}

export interface SyncHealthState {
  kind: SyncHealthKind;
  label: 'Saved' | 'Saving offline' | 'Waiting to sync' | 'Syncing' | 'Needs attention';
  message: string;
  busy: boolean;
  canRetry: boolean;
}

export interface CloudSyncEpoch {
  readonly userId: string;
  readonly value: number;
}

export function canAttemptCloudSync(backoffActive: boolean, manualRetry: boolean): boolean {
  return manualRetry || !backoffActive;
}

export function resolveSyncEpoch(
  ownerUserId: string,
  renderedEpoch: CloudSyncEpoch | null,
  verifiedEpoch?: CloudSyncEpoch | null,
): number | null {
  if (verifiedEpoch?.userId === ownerUserId) return verifiedEpoch.value;
  if (renderedEpoch?.userId === ownerUserId) return renderedEpoch.value;
  return null;
}

const changeLabel = (count: number) => `${count} ${count === 1 ? 'change' : 'changes'}`;

export function countPendingSyncOperations(
  operations: readonly { ownerUserId?: string }[],
  activeUserId: string,
): number {
  return operations.filter(operation => operation.ownerUserId === activeUserId).length;
}

export function getSyncErrorMessage(error: unknown): string {
  if (error instanceof Error && error.name === 'PendingOperationStoreBlockedError') {
    return 'Another SonFlash tab is blocking local sync storage. Close other SonFlash tabs, then retry syncing. Your changes remain safe on this device.';
  }
  const rawCode = error && typeof error === 'object' && 'code' in error
    ? String((error as { code?: unknown }).code ?? '').toLowerCase()
    : '';
  const isAppCheckError = /^(appcheck|app-check)\//.test(rawCode);
  const code = rawCode.replace(/^(firestore|functions|appcheck|app-check)\//, '');
  if (code === 'permission-denied') {
    return 'Firebase access rules need administrator attention. Your changes are safe on this device; ask the app administrator to update access before trying again.';
  }
  if (code === 'unauthenticated') {
    return 'Your cloud sign-in is no longer current. Your changes are safe on this device; sign in again to resume syncing.';
  }
  if (isAppCheckError && ['initial-throttle', 'fetch-status-error'].includes(code)) {
    return 'The secure cloud check could not reach Firebase. Your changes are safe on this device and will retry automatically.';
  }
  if ([
    'unavailable',
    'deadline-exceeded',
    'network-request-failed',
    'initial-throttle',
    'fetch-status-error',
  ].includes(code)) {
    return 'Cloud is temporarily unreachable. Your changes are safe on this device and will retry automatically.';
  }
  if (code === 'resource-exhausted') {
    return firestoreDailyReadLimitMessage;
  }
  if (code === 'failed-precondition') {
    return 'This app and its cloud configuration are out of sync. Your changes are safe; update the cloud configuration, then retry.';
  }
  if (error instanceof TypeError || (error instanceof Error && error.name === 'OperationTimeoutError')) {
    return 'Cloud is temporarily unreachable. Your changes are safe on this device and will retry automatically.';
  }
  return 'Sync is temporarily unavailable. Your changes are still safe on this device.';
}

export function isSyncErrorRetryable(message: string | null | undefined): boolean {
  const normalized = message?.trim().toLowerCase() ?? '';
  if (!normalized) return false;
  return ![
    'cloud sync is not configured',
    'access rules need administrator attention',
    'sign-in is no longer current',
    'cloud configuration are out of sync',
    'app check or access rules need administrator attention',
  ].some(blocker => normalized.includes(blocker));
}

export function getSyncHealth({
  isOnline,
  isSyncing,
  pendingCount,
  error,
}: SyncHealthInput): SyncHealthState {
  const safePendingCount = Math.max(0, Math.floor(pendingCount));
  const errorMessage = error?.trim();

  if (errorMessage) {
    return {
      kind: 'needs-attention',
      label: 'Needs attention',
      message: errorMessage,
      busy: false,
      canRetry: isSyncErrorRetryable(errorMessage),
    };
  }

  if (!isOnline && safePendingCount > 0) {
    return {
      kind: 'saving-offline',
      label: 'Saving offline',
      message: `${changeLabel(safePendingCount)} are safe on this device and will sync when you reconnect.`,
      busy: false,
      canRetry: false,
    };
  }

  if (isSyncing) {
    return {
      kind: 'syncing',
      label: 'Syncing',
      message: safePendingCount > 0
        ? `Syncing ${changeLabel(safePendingCount)} to your library.`
        : 'Checking your library for changes.',
      busy: true,
      canRetry: false,
    };
  }

  if (safePendingCount > 0) {
    return {
      kind: 'queued',
      label: 'Waiting to sync',
      message: `${changeLabel(safePendingCount)} ${safePendingCount === 1 ? 'is' : 'are'} safe on this device and waiting to sync.`,
      busy: false,
      canRetry: true,
    };
  }

  return {
    kind: 'saved',
    label: 'Saved',
    message: isOnline
      ? 'All changes are saved.'
      : 'Your library is available offline.',
    busy: false,
    canRetry: false,
  };
}
