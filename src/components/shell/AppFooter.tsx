import type { ShellViewMode } from './shellTypes';
import { getShellSyncStatus, type ShellSyncStatusInput } from './shellSyncStatus';

export interface AppFooterProps {
  viewMode: ShellViewMode;
  libraryCountLabel: string;
  syncStatus: ShellSyncStatusInput;
}

export function AppFooter({ viewMode, libraryCountLabel, syncStatus }: AppFooterProps) {
  const status = getShellSyncStatus(syncStatus);
  const statusTone = status.healthy
    ? 'text-emerald-600 dark:text-emerald-400'
    : status.kind === 'needs-attention'
      ? 'text-rose-600 dark:text-rose-400'
      : status.kind === 'syncing'
        ? 'text-cyan-700 dark:text-cyan-300'
        : 'text-amber-600 dark:text-amber-400';
  const dotTone = status.healthy
    ? 'bg-emerald-500'
    : status.kind === 'needs-attention'
      ? 'bg-rose-500'
      : status.kind === 'syncing'
        ? 'bg-cyan-500'
        : 'bg-amber-500';

  return (
    <footer className={`${viewMode === 'study' ? 'hidden' : 'hidden lg:flex'} h-9 relative px-8 items-center justify-between text-[11px] font-bold text-[var(--sf-text-muted)] flex-shrink-0 z-10 transition-colors`}>
      <div className="flex gap-6 uppercase tracking-wider">
        <span>LIBRARY: {libraryCountLabel}</span>
      </div>
      <div
        className="flex items-center gap-2"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-busy={status.busy}
        aria-label={`${status.footerLabel}. ${status.detail}`}
        title={status.detail}
      >
        <span className="uppercase tracking-wider">STATUS:</span>
        <span className={`${statusTone} uppercase tracking-widest px-2`}>{status.footerLabel}</span>
        <div className={`size-1.5 rounded-full ${dotTone}`} aria-hidden="true" />
      </div>
    </footer>
  );
}
