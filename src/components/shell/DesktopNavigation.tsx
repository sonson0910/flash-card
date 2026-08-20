import type { Ref } from 'react';
import { BarChart3, BookOpen, CloudUpload, Flame, House, Loader2, Map, Moon, Sun, Volume2, VolumeX } from 'lucide-react';
import { useSoundSettings } from '../../lib/interactionSounds';
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
  const { isSoundEnabled: soundActive, toggleSound } = useSoundSettings();
  const status = getShellSyncStatus(syncStatus);
  const statusTone = status.healthy
    ? 'text-emerald-700 dark:text-emerald-300'
    : status.kind === 'needs-attention'
      ? 'text-rose-700 dark:text-rose-300'
      : status.kind === 'syncing'
        ? 'text-cyan-700 dark:text-cyan-300'
        : 'text-amber-700 dark:text-amber-300';
  return (
    <nav ref={navigationRef} aria-label="Primary" className={`${isPracticeView(viewMode) ? 'hidden' : 'flex'} app-navigation liquid-glass mx-3 mt-3 min-h-16 relative rounded-full px-3 md:mx-6 md:px-5 items-center justify-between flex-shrink-0 z-20 border border-white/15 backdrop-blur-2xl transition-colors`}>
      <button
        type="button"
        onClick={onOpenLanding ?? onOpenToday}
        data-gsap-brand
        className="flex items-center gap-2 rounded-full border border-white/15 bg-white/5 py-1.5 pl-1.5 pr-3 shadow-lg backdrop-blur-xl transition-all duration-300 hover:scale-[1.03] hover:bg-white/10 active:scale-[0.98] cursor-pointer"
        title="SonFlash Home"
      >
        <div className="flex size-8 items-center justify-center overflow-hidden rounded-full border border-white/20 bg-white/10 shadow-inner">
          <img src="/brand/sonflash-logo-192.png?v=3e7aaa58" alt="" className="size-8 object-cover" aria-hidden="true" />
        </div>
        <span className="hidden text-xl font-black tracking-[-0.04em] text-white drop-shadow-sm sm:inline pr-1">
          Son<span className="text-cyan-300">Flash</span>
        </span>
      </button>

      <div className="liquid-glass hidden lg:flex items-center gap-1.5 rounded-full px-2 py-1.5 border border-white/15 bg-black/20 backdrop-blur-2xl">
        {onOpenLanding && (
          <button
            type="button"
            onClick={onOpenLanding}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition-all duration-300 flex items-center gap-1.5 cursor-pointer ${
              viewMode === 'landing'
                ? 'bg-cyan-400 text-[#071014] font-extrabold shadow-md shadow-cyan-500/25 scale-[1.02]'
                : 'text-white/80 hover:text-white hover:bg-white/10'
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
          className={`rounded-full px-4 py-2 text-sm font-semibold transition-all duration-300 flex items-center gap-1.5 cursor-pointer ${
            viewMode === 'today'
              ? 'bg-cyan-400 text-[#071014] font-extrabold shadow-md shadow-cyan-500/25 scale-[1.02]'
              : 'text-white/80 hover:text-white hover:bg-white/10'
          }`}
          aria-current={viewMode === 'today' ? 'page' : undefined}
        >
          <Flame size={14} aria-hidden="true" />
          <span>Today</span>
        </button>
        <button
          type="button"
          onClick={onOpenCatalog}
          className={`rounded-full px-4 py-2 text-sm font-semibold transition-all duration-300 flex items-center gap-1.5 cursor-pointer ${
            viewMode === 'catalog'
              ? 'bg-cyan-400 text-[#071014] font-extrabold shadow-md shadow-cyan-500/25 scale-[1.02]'
              : 'text-white/80 hover:text-white hover:bg-white/10'
          }`}
          aria-current={viewMode === 'catalog' ? 'page' : undefined}
        >
          <Map size={14} aria-hidden="true" />
          <span>Paths</span>
        </button>
        <button
          type="button"
          onClick={onOpenLibrary}
          className={`rounded-full px-4 py-2 text-sm font-semibold transition-all duration-300 flex items-center gap-1.5 cursor-pointer ${
            viewMode === 'library'
              ? 'bg-cyan-400 text-[#071014] font-extrabold shadow-md shadow-cyan-500/25 scale-[1.02]'
              : 'text-white/80 hover:text-white hover:bg-white/10'
          }`}
          aria-current={viewMode === 'library' ? 'page' : undefined}
        >
          <BookOpen size={14} aria-hidden="true" />
          <span>Vocabulary</span>
        </button>
        <button
          type="button"
          onClick={onOpenProgress}
          className={`rounded-full px-4 py-2 text-sm font-semibold transition-all duration-300 flex items-center gap-1.5 cursor-pointer ${
            viewMode === 'progress'
              ? 'bg-cyan-400 text-[#071014] font-extrabold shadow-md shadow-cyan-500/25 scale-[1.02]'
              : 'text-white/80 hover:text-white hover:bg-white/10'
          }`}
          aria-current={viewMode === 'progress' ? 'page' : undefined}
        >
          <BarChart3 size={14} className="stroke-2" aria-hidden="true" />
          <span>Progress</span>
        </button>
      </div>

      <div data-gsap-header-actions className="flex h-10 items-stretch gap-1.5 sm:gap-2.5">
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
                <span className="text-[11px] font-bold text-white truncate max-w-[90px]" title={syncIdentity.email || ''}>{syncIdentity.displayName || 'Cloud account'}</span>
              </div>
              {isDeviceSyncVisible && (
                <button type="button" onClick={onDeviceSync} disabled={isDeviceSyncing} className="hidden sm:flex min-h-9 items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-white/80 transition-all hover:bg-white/10 hover:text-white disabled:cursor-wait disabled:opacity-60" title="Copy cards to the shared library on this device">
                  {isDeviceSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <CloudUpload className="h-3.5 w-3.5" aria-hidden="true" />}
                  Shared library
                </button>
              )}
              <button type="button" onClick={onSignOut} className="flex items-center justify-center min-w-9 min-h-9 w-9 h-9 rounded-full border border-emerald-500/40 bg-emerald-500/15 text-emerald-300 hover:bg-rose-500/20 hover:text-rose-300 transition-all duration-300 hover:scale-105 cursor-pointer shadow-md overflow-hidden" title="Sign out of cloud sync" aria-label="Sign out of cloud sync">
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
              className="flex min-h-9 items-center gap-1.5 rounded-full bg-cyan-400 px-4 py-1.5 text-xs font-extrabold text-[#071014] shadow-md shadow-cyan-500/25 transition-all duration-300 hover:scale-[1.04] hover:bg-cyan-300 active:scale-[0.98] cursor-pointer disabled:opacity-60 disabled:cursor-wait"
              title="Sign in to sync devices"
            >
              {syncIdentity.isSigningIn ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <CloudUpload className="size-3.5" aria-hidden="true" />}
              <span>{syncIdentity.isSigningIn ? 'Connecting…' : <><span className="sm:hidden">Sync</span><span className="hidden sm:inline">Sign in &amp; sync</span></>}</span>
            </button>
          ) : (
            <div className="flex min-h-9 items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-bold text-white/70" title="Cloud sync is unavailable. Data is saved on this device only.">
              <CloudUpload className="w-3.5 h-3.5" aria-hidden="true" />
              <span>On device</span>
            </div>
          )}
        </div>

        <div className="flex h-9 shrink-0 items-center overflow-hidden rounded-full border border-white/15 bg-white/5 p-0.5 shadow-sm backdrop-blur-xl">
          <button type="button" onClick={toggleSound} className="flex size-8 shrink-0 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white" aria-label={soundActive ? 'Mute sound effects' : 'Enable sound effects'} title={soundActive ? 'Mute sound effects' : 'Enable sound effects'}>
            {soundActive ? <Volume2 size={15} aria-hidden="true" /> : <VolumeX size={15} aria-hidden="true" className="text-slate-400" />}
          </button>
          <div className="h-3.5 w-px bg-white/15 mx-0.5" />
          <button type="button" onClick={onToggleTheme} className="flex size-8 shrink-0 items-center justify-center rounded-full text-white/80 transition-colors hover:bg-white/10 hover:text-white" aria-label={isDarkMode ? 'Use light theme' : 'Use dark theme'} title={isDarkMode ? 'Use light theme' : 'Use dark theme'}>
            {isDarkMode ? <Sun size={15} aria-hidden="true" /> : <Moon size={15} aria-hidden="true" />}
          </button>
        </div>

        <div className="hidden h-9 items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 text-xs font-bold shadow-sm backdrop-blur-xl xl:flex">
          <div className="size-1.5 bg-cyan-400 rounded-full animate-pulse" aria-hidden="true" />
          <span className="text-[11px] font-black text-cyan-300 uppercase tracking-wider">{libraryCountLabel}</span>
        </div>
      </div>
    </nav>
  );
}
