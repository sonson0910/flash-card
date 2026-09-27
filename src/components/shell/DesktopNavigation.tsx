import type { Ref, ReactNode } from 'react';
import { Flame } from 'lucide-react';
import { Trans, useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { useTheme } from '../../features/theme/ThemeProvider';
import { isPracticeView, type ShellViewMode, type SyncIdentityViewModel } from './shellTypes';
import { getShellSyncStatus, type ShellSyncStatusInput } from './shellSyncStatus';
import { LibraryManagementMenu } from './LibraryManagementMenu';
import { LanguageMenu } from './LanguageMenu';
import { ThemeMenu } from './ThemeMenu';
import { localizeShellSyncStatus } from './localized-sync-status';
import { CourseSwitcherSlot } from './CourseSwitcherSlot';

export interface DesktopNavigationProps {
  navigationRef?: Ref<HTMLElement>;
  viewMode: ShellViewMode;
  syncIdentity: SyncIdentityViewModel;
  syncStatus: ShellSyncStatusInput;
  isDarkMode: boolean;
  isExporting?: boolean;
  isLibraryMutationPending?: boolean;
  isRetryingSync?: boolean;
  canSyncNow?: boolean;
  sessionLost?: boolean;
  libraryCountLabel: string;
  streak?: number;
  level?: number;
  xp?: number;
  onOpenLanding?: () => void;
  onOpenToday: () => void;
  onOpenLibrary: () => void;
  onOpenCatalog: () => void;
  onOpenProgress: () => void;
  onOpenSettings?: () => void;
  onSignIn: () => void | Promise<void>;
  onSignOut: () => void | Promise<void>;
  onRetrySync?: () => void | Promise<void>;
  onExportLibrary?: () => void | Promise<void>;
  onClearLibrary?: (focusReturnTarget: HTMLButtonElement) => void;
}

type NavigationItem = { view: ShellViewMode; classic: ReactNode; crystal: ReactNode; action: () => void };

function CrystalStar() {
  return <svg viewBox="0 0 100 100" width="36" height="36" aria-hidden="true" className="claude-brand-star"><path d="M50 4 62 36 96 37 69 59 78 91 50 72 22 91 31 59 4 37 38 36Z" fill="#ff5470" /><path d="M50 4 62 36 96 37 69 59 78 91 50 72Z" fill="#7a0820" /></svg>;
}

export function DesktopNavigation({ navigationRef, viewMode, syncIdentity, syncStatus, isExporting, isLibraryMutationPending, isRetryingSync, canSyncNow, sessionLost, libraryCountLabel, streak, level, xp, onOpenLanding, onOpenToday, onOpenLibrary, onOpenCatalog, onOpenProgress, onOpenSettings, onSignIn, onSignOut, onRetrySync, onExportLibrary, onClearLibrary }: DesktopNavigationProps) {
  const { _ } = useLingui();
  const { family } = useTheme();
  const status = localizeShellSyncStatus(getShellSyncStatus(syncStatus), _);
  const statusAnnouncement = sessionLost
    ? _(msg({ id: 'shell.feedback.session-ended', message: 'Session ended' }))
    : syncIdentity.status === 'loading'
      ? _(msg({ id: 'shell.sync.checking', message: 'Checking cloud…' }))
      : syncIdentity.status === 'signed-out'
        ? syncIdentity.isSigningIn
          ? _(msg({ id: 'shell.feedback.connecting', message: 'Connecting…' }))
          : _(msg({ id: 'shell.sync.device', message: 'On this device' }))
        : status.headerLabel;
  const navigation: NavigationItem[] = [
    { view: 'today', classic: <Trans id="shell.nav.today" message="Today" />, crystal: <Trans id="shell.nav.today" message="Today" />, action: onOpenToday },
    { view: 'catalog', classic: <Trans id="shell.nav.paths" message="Paths" />, crystal: <Trans id="shell.nav.paths" message="Paths" />, action: onOpenCatalog },
    { view: 'library', classic: <Trans id="shell.nav.vocabulary" message="Vocabulary" />, crystal: <Trans id="shell.nav.collection" message="Collection" />, action: onOpenLibrary },
    { view: 'progress', classic: <Trans id="shell.nav.progress" message="Progress" />, crystal: <Trans id="shell.nav.progress" message="Progress" />, action: onOpenProgress },
  ];
  const hasStreak = typeof streak === 'number' && Number.isFinite(streak) && streak >= 0;
  const hasLevel = typeof level === 'number' && Number.isFinite(level) && level >= 1;
  const hasXp = typeof xp === 'number' && Number.isFinite(xp) && xp >= 0;
  const levelStartXp = hasLevel ? 100 * (level - 1) ** 2 : 0;
  const nextLevelXp = hasLevel ? 100 * level ** 2 : 0;
  const levelProgress = hasLevel && hasXp ? Math.max(0, Math.min(100, ((xp - levelStartXp) / (nextLevelXp - levelStartXp)) * 100)) : 0;

  return <header className={`claude-topbar relative z-30 shrink-0 ${isPracticeView(viewMode) ? 'hidden' : ''}`}>
    <nav ref={navigationRef} aria-label={_(msg({ id: 'shell.navigation.primary', message: 'Primary navigation' }))} data-shell-layer="primary" className="app-navigation claude-topbar-nav flex h-full items-center">
    <div className="claude-topbar-inner mx-auto flex w-full max-w-[1440px] items-center">
      <button type="button" onClick={onOpenLanding ?? onOpenToday} data-gsap-brand aria-label="SonFlash" className="claude-brand shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2">
        <span className="claude-brand-classic" aria-hidden="true"><Trans id="shell.brand.mark" message="S" /></span><CrystalStar />
        <span className="claude-brand-name"><span>{family === 'crystal' ? 'SON' : 'Son'}</span><em>{family === 'crystal' ? 'FLASH' : 'Flash'}</em></span>
      </button>
      <div className="claude-nav-items hidden min-w-0 items-center lg:flex">{navigation.map(item => <button key={item.view} type="button" onClick={item.action} data-shell-active={viewMode === item.view ? 'true' : undefined} aria-current={viewMode === item.view ? 'page' : undefined} className="claude-nav-item"><span>{family === 'crystal' ? item.crystal : item.classic}</span></button>)}</div>
      <CourseSwitcherSlot signedIn={syncIdentity.status === 'authenticated'} />
      <div data-gsap-header-actions className="claude-shell-actions ml-auto flex items-center">
        <ThemeMenu onOpenSettings={onOpenSettings} />
        {hasStreak && <span className="claude-streak" aria-label={_(msg({ id: 'shell.streak', message: '{count} day streak' }).id, { count: streak })}><Flame size={15} fill="currentColor" aria-hidden="true" />{streak}</span>}
        {hasLevel && <span className="claude-level" aria-label={hasXp ? _(msg({ id: 'shell.level', message: 'Level {level}, {xp} XP' }).id, { level, xp }) : _(msg({ id: 'shell.level.short', message: 'Lv {level}' }).id, { level })}><Trans id="shell.level.short" message="Lv {level}" values={{ level }} />{hasXp && <span className="claude-level-track" aria-hidden="true"><span style={{ width: `${levelProgress}%` }} /></span>}</span>}
        <LanguageMenu />
        <LibraryManagementMenu
          isExporting={isExporting}
          isLibraryMutationPending={isLibraryMutationPending}
          onOpenSettings={onOpenSettings}
          onExportLibrary={onExportLibrary}
          onClearLibrary={onClearLibrary}
          onSignIn={sessionLost || (syncIdentity.status === 'signed-out' && syncIdentity.isConfigured) ? onSignIn : undefined}
          onSignOut={syncIdentity.status === 'authenticated' && !sessionLost ? onSignOut : undefined}
          onRetrySync={onRetrySync}
          isRetryingSync={isRetryingSync}
          canSyncNow={canSyncNow}
          sessionLost={sessionLost}
          syncIdentity={syncIdentity}
          syncStatus={status}
          libraryCountLabel={libraryCountLabel}
        />
        <span className="sr-only" role="status" aria-live="polite" aria-busy={status.busy}>{statusAnnouncement}</span>
        <span className="sr-only">{libraryCountLabel}</span>
      </div>
    </div>
    </nav>
  </header>;
}
