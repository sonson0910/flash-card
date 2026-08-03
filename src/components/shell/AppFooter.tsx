import type { ShellViewMode } from './shellTypes';

export interface AppFooterProps {
  viewMode: ShellViewMode;
  libraryCountLabel: string;
  isBrowserOnline: boolean;
  cloudReadUnavailable: boolean;
}

export function AppFooter({ viewMode, libraryCountLabel, isBrowserOnline, cloudReadUnavailable }: AppFooterProps) {
  const connected = isBrowserOnline && !cloudReadUnavailable;
  const status = !isBrowserOnline
    ? 'Offline, using cache'
    : cloudReadUnavailable
      ? 'Cloud paused, using cache'
      : 'Online';

  return (
    <footer className={`${viewMode === 'study' ? 'hidden' : 'hidden lg:flex'} h-9 relative px-8 items-center justify-between text-[11px] font-bold text-[var(--sf-text-muted)] flex-shrink-0 z-10 transition-colors`}>
      <div className="flex gap-6 uppercase tracking-wider">
        <span>LIBRARY: {libraryCountLabel}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="uppercase tracking-wider">STATUS:</span>
        <span className={`${connected ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'} uppercase tracking-widest px-2`}>{status}</span>
        <div className={`size-1.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-amber-500'}`} aria-hidden="true" />
      </div>
    </footer>
  );
}
