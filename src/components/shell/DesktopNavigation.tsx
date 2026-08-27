import type { Ref } from 'react';
import { BarChart3, BookOpen, CloudUpload, Flame, House, Loader2, Map, Moon, Sun } from 'lucide-react';
import { isPracticeView, type ShellViewMode, type SyncIdentityViewModel } from './shellTypes';
import { getShellSyncStatus, type ShellSyncStatusInput } from './shellSyncStatus';
import { LibraryManagementMenu } from './LibraryManagementMenu';

export interface DesktopNavigationProps {
  navigationRef?: Ref<HTMLElement>;
  viewMode: ShellViewMode;
  syncIdentity: SyncIdentityViewModel;
  syncStatus: ShellSyncStatusInput;
  isDarkMode: boolean;
  isExporting?: boolean;
  isLibraryMutationPending?: boolean;
  libraryCountLabel: string;
  onOpenLanding?: () => void;
  onOpenToday: () => void;
  onOpenLibrary: () => void;
  onOpenCatalog: () => void;
  onOpenProgress: () => void;
  onSignIn: () => void | Promise<void>;
  onSignOut: () => void | Promise<void>;
  onToggleTheme: () => void;
  onExportLibrary?: () => void | Promise<void>;
  onClearLibrary?: (focusReturnTarget: HTMLButtonElement) => void;
}

export function DesktopNavigation({
  navigationRef,
  viewMode,
  syncIdentity,
  syncStatus,
  isDarkMode,
  isExporting,
  isLibraryMutationPending,
  libraryCountLabel,
  onOpenLanding,
  onOpenToday,
  onOpenLibrary,
  onOpenCatalog,
  onOpenProgress,
  onSignIn,
  onSignOut,
  onToggleTheme,
  onExportLibrary,
  onClearLibrary,
}: DesktopNavigationProps) {
  const navigationItemClass = (active: boolean) => `app-shell-nav__item flex min-h-11 items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors duration-200 cursor-pointer ${
    active
      ? 'text-[var(--sf-text)]'
      : 'text-[var(--sf-text-muted)]'
  }`;
  const status = getShellSyncStatus(syncStatus);
  const statusTone = status.healthy
    ? 'text-emerald-700 dark:text-emerald-300'
    : status.kind === 'needs-attention'
      ? 'text-rose-700 dark:text-rose-300'
      : status.busy
        ? 'text-cyan-700 dark:text-cyan-300'
        : 'text-amber-700 dark:text-amber-300';
  return (
    <nav ref={navigationRef} aria-label="Primary" data-shell-layer="primary" data-shell-grammar="cold-mineral" data-shell-identity="memory-atelier" className={`${isPracticeView(viewMode) ? 'hidden' : 'flex'} app-navigation app-shell-nav !overflow-visible mx-3 mt-3 min-h-16 relative px-3 md:mx-6 md:px-5 items-center justify-between flex-shrink-0 z-30 transition-colors`}>
      <button
        type="button"
        onClick={onOpenLanding ?? onOpenToday}
        data-gsap-brand
        className="app-shell-brand flex items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3 transition-transform duration-200 hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
        title="SonFlash Home"
      >
        <div className="flex size-8 items-center justify-center overflow-hidden rounded-full border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] shadow-inner">
          <img src="/brand/sonflash-logo-192.png?v=3e7aaa58" alt="" className="size-8 object-cover" aria-hidden="true" />
        </div>
        <span className="hidden text-xl font-black tracking-[-0.04em] text-[var(--sf-text)] drop-shadow-xs sm:inline pr-1">
          Son<span className="text-[var(--sf-brand-text)]">Flash</span>
        </span>
      </button>

      <div className="app-shell-links hidden items-center gap-1 lg:flex">
        {onOpenLanding && (
          <button
            type="button"
            onClick={onOpenLanding}
            data-shell-active={viewMode === 'landing' ? 'true' : undefined}
            className={navigationItemClass(viewMode === 'landing')}
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
          data-shell-active={viewMode === 'today' ? 'true' : undefined}
          className={navigationItemClass(viewMode === 'today')}
          aria-current={viewMode === 'today' ? 'page' : undefined}
          >
            <Flame size={14} aria-hidden="true" />
            <span>Today</span>
        </button>
        <button
          type="button"
          onClick={onOpenCatalog}
          data-shell-active={viewMode === 'catalog' ? 'true' : undefined}
          className={navigationItemClass(viewMode === 'catalog')}
          aria-current={viewMode === 'catalog' ? 'page' : undefined}
          >
            <Map size={14} aria-hidden="true" />
            <span>Paths</span>
        </button>
        <button
          type="button"
          onClick={onOpenLibrary}
          data-shell-active={viewMode === 'library' ? 'true' : undefined}
          className={navigationItemClass(viewMode === 'library')}
          aria-current={viewMode === 'library' ? 'page' : undefined}
          >
            <BookOpen size={14} aria-hidden="true" />
            <span>Vocabulary</span>
        </button>
        <button
          type="button"
          onClick={onOpenProgress}
          data-shell-active={viewMode === 'progress' ? 'true' : undefined}
          className={navigationItemClass(viewMode === 'progress')}
          aria-current={viewMode === 'progress' ? 'page' : undefined}
          >
            <BarChart3 size={14} className="stroke-2" aria-hidden="true" />
            <span>Progress</span>
        </button>
      </div>

      <div data-gsap-header-actions className="app-shell-utilities flex min-h-11 items-center gap-1.5 sm:gap-2.5">
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

        <LibraryManagementMenu
          isExporting={isExporting}
          isLibraryMutationPending={isLibraryMutationPending}
          onExportLibrary={onExportLibrary}
          onClearLibrary={onClearLibrary}
        />

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
