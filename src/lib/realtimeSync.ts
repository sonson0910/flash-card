export type RealtimeChangeType = 'added' | 'modified' | 'removed';

export function shouldRefreshCountForRealtimeChanges(
  isInitialSnapshot: boolean,
  changeTypes: RealtimeChangeType[],
): boolean {
  if (isInitialSnapshot) return false;
  return changeTypes.some(changeType => changeType === 'added' || changeType === 'removed');
}
