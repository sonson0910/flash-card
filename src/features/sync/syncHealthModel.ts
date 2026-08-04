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

const changeLabel = (count: number) => `${count} ${count === 1 ? 'change' : 'changes'}`;

export function countPendingSyncOperations(
  operations: readonly { ownerUserId?: string }[],
  activeUserId: string,
): number {
  return operations.filter(operation => operation.ownerUserId === activeUserId).length;
}

export function getSyncErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  return 'Sync is temporarily unavailable. Your changes are still safe on this device.';
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
      canRetry: true,
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
