import { getSyncHealth, type SyncHealthInput } from '../../features/sync/syncHealthModel';

export interface ShellSyncStatusInput extends SyncHealthInput {
  cloudUnavailable: boolean;
}

export type ShellSyncStatusKind =
  | 'synced'
  | 'offline'
  | 'cloud-paused'
  | Exclude<ReturnType<typeof getSyncHealth>['kind'], 'saved'>;

export interface ShellSyncStatus {
  kind: ShellSyncStatusKind;
  headerLabel: string;
  footerLabel: string;
  detail: string;
  healthy: boolean;
  busy: boolean;
}

export function getShellSyncStatus(input: ShellSyncStatusInput): ShellSyncStatus {
  const health = getSyncHealth(input);
  if (health.kind !== 'saved') {
    return {
      kind: health.kind,
      headerLabel: health.label,
      footerLabel: health.label,
      detail: health.message,
      healthy: false,
      busy: health.busy,
    };
  }
  if (!input.isOnline) {
    return {
      kind: 'offline',
      headerLabel: 'Offline',
      footerLabel: 'Offline, using cache',
      detail: health.message,
      healthy: false,
      busy: false,
    };
  }
  if (input.cloudUnavailable) {
    return {
      kind: 'cloud-paused',
      headerLabel: 'Cloud paused',
      footerLabel: 'Cloud paused, using cache',
      detail: 'Live cloud updates are unavailable. Showing the last successful local copy.',
      healthy: false,
      busy: false,
    };
  }
  return {
    kind: 'synced',
    headerLabel: 'Synced',
    footerLabel: 'Online',
    detail: health.message,
    healthy: true,
    busy: false,
  };
}
