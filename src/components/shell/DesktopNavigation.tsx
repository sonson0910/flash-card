import type { Ref } from 'react';
import { BarChart3, BookOpen, CloudUpload, Flame, House, Loader2, Map, Moon, Sun } from 'lucide-react';
import { isPracticeView, type ShellViewMode, type SyncIdentityViewModel } from './shellTypes';
import { getShellSyncStatus, type ShellSyncStatusInput } from './shellSyncStatus';

export interface DesktopNavigationProps {
  navigationRef?: Ref<HTMLElement>;
  viewMode: ShellViewMode;
  syncIdentity: SyncIdentityViewModel;
  syncStatus: ShellSyncStatusInput;
  isDeviceSyncVisible: boolean;
  isDeviceSyncing: boolean;
  isDarkMode: boolean;
  libraryCountLabel: string;
  onOpenLanding?: () => void;
  onOpenToday: () => void;
  onOpenLibrary: () => void;
  onOpenCatalog: () => void;
  onOpenProgress: () => void;
  onDeviceSync: () => void | Promise<void>;
  onSignIn: () => void | Promise<void>;
  onSignOut: () => void | Promise<void>;
  onToggleTheme: () => void;
}

export function DesktopNavigation({
  navigationRef,
  viewMode,
  syncIdentity,
  syncStatus,
  isDeviceSyncVisible,
  isDeviceSyncing,
  isDarkMode,
  libraryCountLabel,
  onOpenLanding,
  onOpenToday,
  onOpenLibrary,
  onOpenCatalog,
  onOpenProgress,
  onDeviceSync,
  onSignIn,
  onSignOut,
  onToggleTheme,
}: DesktopNavigationProps) {
  const status = getShellSyncStatus(syncStatus);
  const statusTone = status.healthy
    ? 'text-emerald-700 dark:text-emerald-300'
    : status.kind === 'needs-attention'
      ? 'text-rose-700 dark:text-rose-300'
      : status.kind === 'syncing'
        ? 'text-cyan-700 dark:text-cyan-300'
        : 'text-amber-700 dark:text-amber-300';
  return (
    <nav ref={navigationRef} aria-label="Primary" className={`${isPracticeView(viewMode) ? 'hidden' : 'flex'} app-navigation liquid-glass !overflow-visible mx-3 mt-3 min-h-16 relative rounded-full px-3 md:mx-6 md:px-5 items-center justify-between flex-shrink-0 z-30 border border-slate-200/90 dark:border-white/15 bg-white/80 dark:bg-[var(--sf-surface-glass)] backdrop-blur-2xl transition-colors`}>
      <button
        type="button"
        onClick={onOpenLanding ?? onOpenToday}
        data-gsap-brand
        className="flex items-center gap-2 rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface)] py-1.5 pl-1.5 pr-3 shadow-sm transition-all duration-300 hover:scale-[1.03] hover:bg-[var(--sf-surface-raised)] active:scale-[0.98] cursor-pointer"
        title="SonFlash Home"
      >
        <div className="flex size-8 items-center justify-center overflow-hidden rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] shadow-inner">
          <img src="/brand/sonflash-logo-192.png?v=3e7aaa58" alt="" className="size-8 object-cover" aria-hidden="true" />
        </div>
        <span className="hidden text-xl font-black tracking-[-0.04em] text-[var(--sf-text)] drop-shadow-xs sm:inline pr-1">
          Son<span className="text-[var(--sf-brand-text)]">Flash</span>
        </span>
      </button>

      <div className="liquid-glass hidden lg:flex items-center gap-1.5 rounded-full px-2 py-1.5 border border-slate-200/90 bg-slate-100/90 dark:border-white/15 dark:bg-black/20 backdrop-blur-2xl">
        {onOpenLanding && (
          <button
            type="button"
            onClick={onOpenLanding}
            className={`min-h-11 rounded-full px-4 py-2 text-sm font-semibold transition-all duration-300 flex items-center gap-1.5 cursor-pointer ${
              viewMode === 'landing'
                ? 'bg-[var(--sf-brand)] text-[var(--sf-on-brand)] font-extrabold shadow-md shadow-sky-600/20 scale-[1.02] dark:bg-cyan-400 dark:text-[#071014]'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/70 dark:text-white/80 dark:hover:text-white dark:hover:bg-white/10'
            }`}
            aria-current={viewMode === 'landing' ? 'page' : undefined}
            title="Home"
          >
            <House size={14} aria-hidden="true" />
            <span>Home</span>
          </button>
        )}
        <button
          type="button"
          onClick={onOpenToday}
          className={`min-h-11 rounded-full px-4 py-2 text-sm font-semibold transition-all duration-300 flex items-center gap-1.5 cursor-pointer ${
            viewMode === 'today'
              ? 'bg-[var(--sf-brand)] text-[var(--sf-on-brand)] font-extrabold shadow-md shadow-sky-600/20 scale-[1.02] dark:bg-cyan-400 dark:text-[#071014]'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/70 dark:text-white/80 dark:hover:text-white dark:hover:bg-white/10'
          }`}
          aria-current={viewMode === 'today' ? 'page' : undefined}
        >
          <Flame size={14} aria-hidden="true" />
          <span>Today</span>
        </button>
        <button
          type="button"
          onClick={onOpenCatalog}
          className={`min-h-11 rounded-full px-4 py-2 text-sm font-semibold transition-all duration-300 flex items-center gap-1.5 cursor-pointer ${
            viewMode === 'catalog'
              ? 'bg-[var(--sf-brand)] text-[var(--sf-on-brand)] font-extrabold shadow-md shadow-sky-600/20 scale-[1.02] dark:bg-cyan-400 dark:text-[#071014]'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/70 dark:text-white/80 dark:hover:text-white dark:hover:bg-white/10'
          }`}
          aria-current={viewMode === 'catalog' ? 'page' : undefined}
        >
          <Map size={14} aria-hidden="true" />
          <span>Paths</span>
        </button>
        <button
          type="button"
          onClick={onOpenLibrary}
          className={`min-h-11 rounded-full px-4 py-2 text-sm font-semibold transition-all duration-300 flex items-center gap-1.5 cursor-pointer ${
            viewMode === 'library'
              ? 'bg-[var(--sf-brand)] text-[var(--sf-on-brand)] font-extrabold shadow-md shadow-sky-600/20 scale-[1.02] dark:bg-cyan-400 dark:text-[#071014]'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/70 dark:text-white/80 dark:hover:text-white dark:hover:bg-white/10'
          }`}
          aria-current={viewMode === 'library' ? 'page' : undefined}
        >
          <BookOpen size={14} aria-hidden="true" />
          <span>Vocabulary</span>
        </button>
        <button
          type="button"
          onClick={onOpenProgress}
          className={`min-h-11 rounded-full px-4 py-2 text-sm font-semibold transition-all duration-300 flex items-center gap-1.5 cursor-pointer ${
            viewMode === 'progress'
              ? 'bg-[var(--sf-brand)] text-[var(--sf-on-brand)] font-extrabold shadow-md shadow-sky-600/20 scale-[1.02] dark:bg-cyan-400 dark:text-[#071014]'
              : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/70 dark:text-white/80 dark:hover:text-white dark:hover:bg-white/10'
          }`}
          aria-current={viewMode === 'progress' ? 'page' : undefined}
        >
          <BarChart3 size={14} className="stroke-2" aria-hidden="true" />
          <span>Progress</span>
        </button>
      </div>

      <div data-gsap-header-actions className="flex min-h-11 items-center gap-1.5 sm:gap-2.5">
        <div className="relative flex items-center">
          {syncIdentity.status === 'loading' ? (
            <Loader2 className="animate-spin text-slate-400" size={16} aria-label="Loading cloud sync" />
          ) : syncIdentity.status === 'authenticated' ? (
            <div className="flex items-center gap-2">
              <div className="hidden sm:flex flex-col items-end text-right">
                <span
                  className={`text-[10px] font-black ${statusTone} uppercase tracking-wider leading-none`}
                  role="status"
                  aria-live="polite"
                  aria-atomic="true"
                  aria-busy={status.busy}
                  aria-label={`${status.headerLabel}. ${status.detail}`}
                  title={status.detail}
                >
                  {status.headerLabel}
                </span>
                <span className="text-[11px] font-bold text-slate-800 dark:text-white truncate max-w-[90px]" title={syncIdentity.email || ''}>{syncIdentity.displayName || 'Cloud account'}</span>
              </div>
              {isDeviceSyncVisible && (
                <button type="button" onClick={onDeviceSync} disabled={isDeviceSyncing} className="hidden min-h-9 items-center gap-1.5 rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-slate-700 transition-colors hover:bg-slate-200 hover:text-slate-900 disabled:cursor-wait disabled:opacity-60 sm:flex dark:border-white/15 dark:bg-white/5 dark:text-white/80 dark:hover:bg-white/10 dark:hover:text-white" title="Copy cards to the shared library on this device">
                  {isDeviceSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <CloudUpload className="h-3.5 w-3.5" aria-hidden="true" />}
                  Shared library
                </button>
              )}
              <button type="button" onClick={onSignOut} className="flex items-center justify-center min-w-11 min-h-11 w-11 h-11 rounded-full border border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 hover:bg-rose-500/20 hover:text-rose-700 dark:hover:text-rose-300 transition-all duration-300 hover:scale-105 cursor-pointer shadow-sm overflow-hidden" title="Sign out of cloud sync" aria-label="Sign out of cloud sync">
                {syncIdentity.photoUrl ? (
                  <img src={syncIdentity.photoUrl} alt="Avatar" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                ) : (
                  <span className="font-extrabold text-xs uppercase">{syncIdentity.email?.charAt(0) || 'U'}</span>
                )}
              </button>
            </div>
          ) : syncIdentity.isConfigured ? (
            <button
              type="button"
              onClick={onSignIn}
              disabled={syncIdentity.isSigningIn}
              className="flex min-h-11 items-center gap-1.5 rounded-full bg-[var(--sf-brand)] px-4 py-1.5 text-xs font-extrabold text-[var(--sf-on-brand)] shadow-md shadow-sky-600/25 transition-all duration-300 hover:scale-[1.04] hover:bg-[var(--sf-brand-hover)] hover:text-white dark:hover:bg-cyan-300 dark:hover:text-[#071014] active:scale-[0.98] cursor-pointer disabled:opacity-60 disabled:cursor-wait"
              title="Sign in to sync devices"
            >
              {syncIdentity.isSigningIn ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <CloudUpload className="size-3.5" aria-hidden="true" />}
              <span>{syncIdentity.isSigningIn ? 'Connecting…' : <><span className="sm:hidden">Sync</span><span className="hidden sm:inline">Sign in &amp; sync</span></>}</span>
            </button>
          ) : (
            <div className="flex min-h-11 items-center gap-1.5 rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-[11px] font-bold text-slate-600 dark:border-white/15 dark:bg-white/5 dark:text-white/70" title="Cloud sync is unavailable. Data is saved on this device only.">
              <CloudUpload className="w-3.5 h-3.5" aria-hidden="true" />
              <span>On device</span>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onToggleTheme}
          className="liquid-control flex size-11 shrink-0 items-center justify-center rounded-full border border-slate-200/90 bg-white/90 text-slate-700 shadow-xs transition-all duration-300 hover:scale-105 hover:border-amber-300/70 hover:text-amber-500 dark:border-white/15 dark:bg-white/[0.06] dark:text-amber-300 dark:hover:border-amber-400/50 dark:hover:bg-amber-400/10 active:scale-95 cursor-pointer"
          aria-label={isDarkMode ? 'Use light theme' : 'Use dark theme'}
          title={isDarkMode ? 'Use light theme' : 'Use dark theme'}
        >
          {isDarkMode ? (
            <Sun size={17} aria-hidden="true" />
          ) : (
            <Moon size={17} aria-hidden="true" />
          )}
        </button>

        <div className="hidden h-9 self-center items-center gap-1.5 rounded-full border border-slate-200 bg-slate-100 px-3 text-xs font-bold shadow-xs backdrop-blur-xl xl:flex dark:border-white/15 dark:bg-white/5">
          <div className="size-1.5 bg-[var(--sf-brand)] dark:bg-cyan-400 rounded-full animate-pulse" aria-hidden="true" />
          <span className="text-[11px] font-black text-cyan-800 dark:text-cyan-300 uppercase tracking-wider">{libraryCountLabel}</span>
        </div>
      </div>
    </nav>
  );
}
