import type { MouseEvent, Ref } from 'react';
import { BarChart3, BookOpen, CloudUpload, Download, House, Loader2, Map, Moon, Sun, Trash2 } from 'lucide-react';
import { isPracticeView, type ShellViewMode, type SyncIdentityViewModel } from './shellTypes';

export interface DesktopNavigationProps {
  navigationRef?: Ref<HTMLElement>;
  viewMode: ShellViewMode;
  syncIdentity: SyncIdentityViewModel;
  isDeviceSyncVisible: boolean;
  isDeviceSyncing: boolean;
  isDarkMode: boolean;
  canManageLibrary: boolean;
  isLibraryMutationPending: boolean;
  libraryCountLabel: string;
  onOpenToday: () => void;
  onOpenLibrary: () => void;
  onOpenCatalog: () => void;
  onOpenProgress: () => void;
  onDeviceSync: () => void | Promise<void>;
  onSignIn: () => void | Promise<void>;
  onSignOut: () => void | Promise<void>;
  onToggleTheme: () => void;
  onExportLibrary: () => void | Promise<void>;
  onClearLibrary: (event: MouseEvent<HTMLButtonElement>) => void;
}

export function DesktopNavigation({
  navigationRef,
  viewMode,
  syncIdentity,
  isDeviceSyncVisible,
  isDeviceSyncing,
  isDarkMode,
  canManageLibrary,
  isLibraryMutationPending,
  libraryCountLabel,
  onOpenToday,
  onOpenLibrary,
  onOpenCatalog,
  onOpenProgress,
  onDeviceSync,
  onSignIn,
  onSignOut,
  onToggleTheme,
  onExportLibrary,
  onClearLibrary,
}: DesktopNavigationProps) {
  return (
    <nav ref={navigationRef} aria-label="Primary" className={`${isPracticeView(viewMode) ? 'hidden' : 'flex'} app-navigation liquid-glass mx-3 mt-3 min-h-16 relative rounded-[22px] px-3 md:mx-6 md:px-5 items-center justify-between flex-shrink-0 z-20 transition-colors`}>
      <div data-gsap-brand className="flex items-center gap-2 rounded-2xl border border-white/10 bg-[#071014]/95 py-1.5 pl-1.5 pr-2.5 shadow-lg shadow-slate-950/15 backdrop-blur-xl sm:pr-3">
        <div className="flex size-9 items-center justify-center overflow-hidden rounded-xl border border-white/10 bg-white/[0.06] shadow-inner shadow-white/10">
          <img src="/favicon.svg" alt="" className="size-10 max-w-none object-contain" aria-hidden="true" />
        </div>
        <span className="hidden text-xl font-black tracking-[-0.04em] text-white drop-shadow-sm sm:inline">
          Son<span className="text-cyan-300">Flash</span>
        </span>
      </div>

      <div className="liquid-control hidden lg:flex items-center gap-1 rounded-2xl p-1">
        <button type="button" onClick={onOpenToday} className={`min-h-11 px-4 py-2 rounded-xl text-sm font-bold transition-colors cursor-pointer flex items-center gap-1.5 ${viewMode === 'today' ? 'bg-[var(--sf-brand)] text-[var(--sf-on-brand)] shadow-sm' : 'text-[var(--sf-text-muted)] hover:text-[var(--sf-text)] hover:bg-[var(--sf-surface-raised)]'}`} aria-current={viewMode === 'today' ? 'page' : undefined}>
          <House size={14} aria-hidden="true" />Today
        </button>
        <button type="button" onClick={onOpenCatalog} className={`min-h-11 px-4 py-2 rounded-xl text-sm font-bold transition-colors cursor-pointer flex items-center gap-1.5 ${viewMode === 'catalog' ? 'bg-[var(--sf-brand)] text-[var(--sf-on-brand)] shadow-sm' : 'text-[var(--sf-text-muted)] hover:text-[var(--sf-text)] hover:bg-[var(--sf-surface-raised)]'}`} aria-current={viewMode === 'catalog' ? 'page' : undefined}>
          <Map size={14} aria-hidden="true" />
          Paths
        </button>
        <button type="button" onClick={onOpenLibrary} className={`min-h-11 px-4 py-2 rounded-xl text-sm font-bold transition-colors cursor-pointer flex items-center gap-1.5 ${viewMode === 'library' ? 'bg-[var(--sf-brand)] text-[var(--sf-on-brand)] shadow-sm' : 'text-[var(--sf-text-muted)] hover:text-[var(--sf-text)] hover:bg-[var(--sf-surface-raised)]'}`} aria-current={viewMode === 'library' ? 'page' : undefined}>
          <BookOpen size={14} aria-hidden="true" />Vocabulary
        </button>
        <button type="button" onClick={onOpenProgress} className={`min-h-11 px-4 py-2 rounded-xl text-sm font-bold transition-colors cursor-pointer flex items-center gap-1.5 ${viewMode === 'progress' ? 'bg-[var(--sf-brand)] text-[var(--sf-on-brand)] shadow-sm' : 'text-[var(--sf-text-muted)] hover:text-[var(--sf-text)] hover:bg-[var(--sf-surface-raised)]'}`} aria-current={viewMode === 'progress' ? 'page' : undefined}>
          <BarChart3 size={14} className="stroke-2" aria-hidden="true" />
          Progress
        </button>
      </div>

      <div data-gsap-header-actions className="flex h-11 items-stretch gap-1.5 sm:gap-3">
        <div className="relative">
          {syncIdentity.status === 'loading' ? (
            <Loader2 className="animate-spin text-slate-400" size={16} aria-label="Loading cloud sync" />
          ) : syncIdentity.status === 'authenticated' ? (
            <div className="flex items-center gap-2">
              <div className="hidden sm:flex flex-col items-end text-right">
                <span className="text-[11px] font-black text-emerald-700 dark:text-emerald-300 uppercase tracking-wider leading-none">Synced</span>
                <span className="text-[11px] font-bold text-[var(--sf-text)] truncate max-w-[90px]" title={syncIdentity.email || ''}>{syncIdentity.displayName || 'Synced'}</span>
              </div>
              {isDeviceSyncVisible && (
                <button type="button" onClick={onDeviceSync} disabled={isDeviceSyncing} className="hidden sm:flex min-h-11 items-center gap-1.5 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-3 py-2 text-[10px] font-black uppercase tracking-wider text-[var(--sf-text-muted)] transition-colors hover:border-[var(--sf-brand)] hover:text-cyan-700 disabled:cursor-wait disabled:opacity-60 dark:hover:text-cyan-300" title="Copy cards to the shared library on this device">
                  {isDeviceSyncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <CloudUpload className="h-3.5 w-3.5" aria-hidden="true" />}
                  Shared library
                </button>
              )}
              <button type="button" onClick={onSignOut} className="flex items-center justify-center min-w-11 min-h-11 w-11 h-11 rounded-full border border-emerald-500/30 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-600 transition-all cursor-pointer shadow-sm overflow-hidden" title="Sign out of cloud sync" aria-label="Sign out of cloud sync">
                {syncIdentity.photoUrl ? (
                  <img src={syncIdentity.photoUrl} alt="Avatar" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                ) : (
                  <span className="font-extrabold text-xs uppercase">{syncIdentity.email?.charAt(0) || 'U'}</span>
                )}
              </button>
            </div>
          ) : syncIdentity.isConfigured ? (
            <button type="button" onClick={onSignIn} disabled={syncIdentity.isSigningIn} className="min-h-11 flex items-center gap-1.5 px-2.5 sm:px-3 py-2 bg-[var(--sf-brand)] hover:bg-[var(--sf-brand-hover)] text-[var(--sf-on-brand)] hover:text-white rounded-xl text-xs font-extrabold transition-colors shadow-sm cursor-pointer disabled:opacity-60 disabled:cursor-wait active:scale-[0.98]" title="Sign in to sync devices">
              {syncIdentity.isSigningIn ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <CloudUpload className="w-3.5 h-3.5" aria-hidden="true" />}
              <span>{syncIdentity.isSigningIn ? 'Connecting…' : <><span className="sm:hidden">Sync</span><span className="hidden sm:inline">Sign in &amp; sync</span></>}</span>
            </button>
          ) : (
            <div className="min-h-11 flex items-center gap-1.5 px-3 py-2 bg-[var(--sf-surface-raised)] border border-[var(--sf-border)] text-[var(--sf-text-muted)] rounded-xl text-[11px] font-bold" title="Cloud sync is unavailable. Data is saved on this device only.">
              <CloudUpload className="w-3.5 h-3.5" aria-hidden="true" />
              <span>On device</span>
            </div>
          )}
        </div>

        <div className="flex h-11 shrink-0 items-center overflow-hidden rounded-[14px] border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] shadow-sm">
          <button type="button" onClick={onToggleTheme} className="flex size-11 shrink-0 items-center justify-center text-[var(--sf-text-muted)] transition-colors hover:bg-[var(--sf-surface)] hover:text-[var(--sf-brand-text)]" aria-label={isDarkMode ? 'Use light theme' : 'Use dark theme'}>
            {isDarkMode ? <Sun size={18} aria-hidden="true" /> : <Moon size={18} aria-hidden="true" />}
          </button>
          {canManageLibrary && (
            <>
              <button type="button" onClick={onExportLibrary} className="hidden size-11 shrink-0 items-center justify-center border-l border-[var(--sf-border)] text-[var(--sf-text-muted)] transition-colors hover:bg-[var(--sf-surface)] hover:text-emerald-700 xl:flex dark:hover:text-emerald-300" title="Export library to Excel" aria-label="Export library to Excel">
                <Download size={16} aria-hidden="true" />
              </button>
              <button type="button" onClick={onClearLibrary} disabled={isLibraryMutationPending} className="hidden size-11 shrink-0 items-center justify-center border-l border-[var(--sf-border)] text-[var(--sf-text-muted)] transition-colors hover:bg-[var(--sf-surface)] hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50 xl:flex dark:hover:text-rose-300" title="Clear the entire library" aria-label="Clear the entire library">
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </>
          )}
        </div>

        <div className="hidden h-11 items-center gap-1.5 rounded-[14px] border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-3 xl:flex">
          <div className="size-1.5 bg-[var(--sf-brand)] rounded-full" aria-hidden="true" />
          <span className="text-[11px] font-black text-cyan-700 dark:text-cyan-300 uppercase tracking-wider">{libraryCountLabel}</span>
        </div>
      </div>
    </nav>
  );
}
