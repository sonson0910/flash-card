import type { Ref, ReactNode } from 'react';
import { Trans, useLingui } from '@lingui/react';
import { msg } from '@lingui/core/macro';
import { useTheme } from '../../features/theme/ThemeProvider';
import { isPracticeView, shellNavigationView, type ShellViewMode, type SyncIdentityViewModel } from './shellTypes';
import type { SettingsSectionId } from '../../features/settings/settings-sections';
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
  equippedFrameId?: string | null;
  ownedTitleIds?: readonly string[];
  onOpenLanding?: () => void;
  onOpenToday: () => void;
  onOpenLibrary: () => void;
  onOpenCatalog: () => void;
  onOpenProgress: () => void;
  /** Starts today's study for the active course from the courses surface; its start button shows only when given. */
  onStudyActiveCourse?: () => void;
  /** Opens the courses page from the course switcher's "Manage courses". */
  onOpenCourses?: () => void;
  /** Opens settings on a section; the theme, language and account menus link to their own section. */
  onOpenSettings?: (section: SettingsSectionId) => void;
  onSignIn: () => void | Promise<void>;
  onSignOut: () => void | Promise<void>;
  onRetrySync?: () => void | Promise<void>;
  onExportLibrary?: () => void | Promise<void>;
  onClearLibrary?: (focusReturnTarget: HTMLButtonElement) => void;
  onOpenInsights?: (focusReturnTarget: HTMLButtonElement) => void;
}

type NavigationItem = { view: ShellViewMode; classic: ReactNode; crystal: ReactNode; action: () => void };

/** The boards' faceted five-point star: each arm is a lit and a shaded facet meeting at the centre. */
function CrystalStar() {
  return <svg viewBox="0 0 100 100" width="36" height="36" aria-hidden="true" className="claude-brand-star"><path className="claude-brand-star-face" d="M50 52 38.2 35.7 50 4ZM50 52 61.8 35.7 95.7 37.2ZM50 52 69.2 58.2 78.2 90.8ZM50 52 50 72.2 21.8 90.8ZM50 52 30.8 58.2 4.3 37.2Z" /><path className="claude-brand-star-shade" d="M50 52 50 4 61.8 35.7ZM50 52 95.7 37.2 69.2 58.2ZM50 52 78.2 90.8 50 72.2ZM50 52 21.8 90.8 30.8 58.2ZM50 52 4.3 37.2 38.2 35.7Z" /></svg>;
}

/** The boards' streak flame, filled with the chip's warm colour. */
function StreakFlame() {
  return <svg className="claude-streak-flame" viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d="M12 2c1 3.5-1.5 5.5-1.5 8.2 0 1.4 1 2.5 2.3 2.5 1.5 0 2.4-1.2 2.2-3 2.3 1.7 3.5 4.3 3.5 6.8C18.5 20 15.6 22 12 22s-6.5-2.3-6.5-5.9c0-4.7 4.3-7 6.5-14.1z" /></svg>;
}

export function DesktopNavigation({ navigationRef, viewMode, syncIdentity, syncStatus, isExporting, isLibraryMutationPending, isRetryingSync, canSyncNow, sessionLost, libraryCountLabel, streak, level, xp, equippedFrameId, ownedTitleIds, onOpenLanding, onOpenToday, onOpenLibrary, onOpenCatalog, onOpenProgress, onStudyActiveCourse, onOpenCourses, onOpenSettings, onSignIn, onSignOut, onRetrySync, onExportLibrary, onClearLibrary, onOpenInsights }: DesktopNavigationProps) {
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
    { view: 'today', classic: <Trans {...msg({ id: 'shell.nav.today', message: 'Today' })} />, crystal: <Trans {...msg({ id: 'shell.nav.today', message: 'Today' })} />, action: onOpenToday },
    { view: 'catalog', classic: <Trans {...msg({ id: 'shell.nav.paths', message: 'Paths' })} />, crystal: <Trans {...msg({ id: 'shell.nav.paths', message: 'Paths' })} />, action: onOpenCatalog },
    { view: 'library', classic: <Trans {...msg({ id: 'shell.nav.vocabulary', message: 'Vocabulary' })} />, crystal: <Trans {...msg({ context: 'shell.nav.collection', message: 'Collection' })} />, action: onOpenLibrary },
    { view: 'progress', classic: <Trans {...msg({ id: 'shell.nav.progress', message: 'Progress' })} />, crystal: <Trans {...msg({ id: 'shell.nav.progress', message: 'Progress' })} />, action: onOpenProgress },
  ];
  const activeView = shellNavigationView(viewMode);
  const openAppearanceSettings = onOpenSettings ? () => onOpenSettings('appearance') : undefined;
  const openLanguageSettings = onOpenSettings ? () => onOpenSettings('language') : undefined;
  const hasStreak = typeof streak === 'number' && Number.isFinite(streak) && streak >= 0;
  const hasLevel = typeof level === 'number' && Number.isFinite(level) && level >= 1;
  const hasXp = typeof xp === 'number' && Number.isFinite(xp) && xp >= 0;
  const levelStartXp = hasLevel ? 100 * (level - 1) ** 2 : 0;
  const nextLevelXp = hasLevel ? 100 * level ** 2 : 0;
  const levelProgress = hasLevel && hasXp ? Math.max(0, Math.min(100, ((xp - levelStartXp) / (nextLevelXp - levelStartXp)) * 100)) : 0;

  return <header data-mobile-course={syncIdentity.status === 'authenticated' ? 'true' : undefined} className={`claude-topbar relative z-30 shrink-0 ${isPracticeView(viewMode) ? 'hidden' : ''}`}>
    <nav ref={navigationRef} aria-label={_(msg({ id: 'shell.navigation.primary', message: 'Primary navigation' }))} data-shell-layer="primary" className="app-navigation claude-topbar-nav flex h-full items-center">
    <div className="claude-topbar-inner mx-auto flex w-full max-w-[1440px] items-center">
      <button type="button" onClick={onOpenLanding ?? onOpenToday} data-gsap-brand aria-label="SonFlash" className="claude-brand shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2">
        <span className="claude-brand-classic" aria-hidden="true"><Trans {...msg({ context: 'shell.brand.mark', message: 'S' })} /></span><CrystalStar />
        <span className="claude-brand-name"><span>{family === 'crystal' ? 'SON' : 'Son'}</span><em>{family === 'crystal' ? 'FLASH' : 'Flash'}</em></span>
      </button>
      <CourseSwitcherSlot signedIn={syncIdentity.status === 'authenticated'} onOpenLanguageSettings={openLanguageSettings} onStudyActiveCourse={onStudyActiveCourse} onOpenCourses={onOpenCourses} />
      <div className="claude-nav-items hidden min-w-0 items-center lg:flex">{navigation.map(item => <button key={item.view} type="button" onClick={item.action} data-shell-active={activeView === item.view ? 'true' : undefined} aria-current={activeView === item.view ? 'page' : undefined} className={`claude-nav-item${family === 'classic' ? ' sf-ease' : ''}`}><span>{family === 'crystal' ? item.crystal : item.classic}</span></button>)}</div>
      <div data-gsap-header-actions className="claude-shell-actions ml-auto flex items-center">
        <ThemeMenu onOpenSettings={openAppearanceSettings} />
        {hasStreak && <span className="claude-streak" aria-label={_(msg({ id: 'shell.streak', message: '{count} day streak' }).id, { count: streak })}><StreakFlame />{streak}</span>}
        {hasLevel && <span className="claude-level" aria-label={hasXp ? _(msg({ id: 'shell.level', message: 'Level {level}, {xp} XP' }).id, { level, xp }) : _(msg({ id: 'shell.level.short', message: 'Lv {level}' }).id, { level })}>{family === 'crystal'
          ? <Trans {...msg({ id: 'shell.level.short', message: 'Lv {level}' })} values={{ level }} />
          // Classic chips set the "Lv" prefix apart from the number, as on the board.
          : <Trans {...msg({ id: 'shell.level.chip', message: '<0>Lv</0> {level}' })} values={{ level }} components={{ 0: <span className="claude-level-label" /> }} />}{hasXp && <span className="claude-level-track" aria-hidden="true"><span style={{ width: `${levelProgress}%` }} /></span>}</span>}
        <LanguageMenu onOpenSettings={openLanguageSettings} />
        <LibraryManagementMenu
          preferences={<>
            <ThemeMenu onOpenSettings={openAppearanceSettings} />
            <LanguageMenu onOpenSettings={openLanguageSettings} />
          </>}
          equippedFrameId={equippedFrameId}
          ownedTitleIds={ownedTitleIds}
          isExporting={isExporting}
          isLibraryMutationPending={isLibraryMutationPending}
          onOpenSettings={openAppearanceSettings}
          onExportLibrary={onExportLibrary}
          onClearLibrary={onClearLibrary}
          onOpenInsights={onOpenInsights}
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
