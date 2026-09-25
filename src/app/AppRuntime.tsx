import { lazy, Suspense, useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import type { ReviewRating } from '../lib/reviewScheduler';
import { playFlipSound, playRewardSound } from '../lib/interactionSounds';
import type { useAppNavigation } from '../features/navigation/useAppNavigation';
import { AppFeedback } from '../components/shell/AppFeedback';
import { AppFooter } from '../components/shell/AppFooter';
import { DesktopNavigation } from '../components/shell/DesktopNavigation';
import { FloatingMobileNav } from '../components/shell/FloatingMobileNav';
import { UndoToast } from '../components/ui/UndoToast';
import { LEARNING_WORKSPACE_ID, SkipToContentLink } from '../components/shell/SkipToContentLink';
import { useOverlayState } from '../features/overlays/useOverlayState';
import { appDependencies } from './appDependencies';
import { AppDeferredLibraryView, AppDeferredPracticeView } from './AppDeferredViews';
import { AppViewStage } from './AppViewStage';
import { useAppLibraryRuntime } from './useAppLibraryRuntime';
import { useAppLearningCoordination } from './useAppLearningCoordination';
import { consumeLandingSignInRequest } from './landingSignInRequest';
import { AppShellMotion } from '../components/motion/AppShellMotion';
import { useBrowserExtensionImport } from '../features/browserExtension/useBrowserExtensionImport';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { APP_VIEW_HEADINGS } from '../features/navigation/app-view-headings';

const AppOverlays = lazy(() => import('../components/AppOverlays').then(module => ({ default: module.AppOverlays })));

export interface LandingUser {
  readonly displayName?: string | null;
  readonly email?: string | null;
  readonly photoURL?: string | null;
}

export interface AppRuntimeProps {
  readonly navigation: ReturnType<typeof useAppNavigation>;
  readonly practiceOpenerRef: RefObject<HTMLElement | null>;
  readonly visible: boolean;
  readonly signInRequest: number | null;
  readonly onSignInRequestHandled: (request: number) => void;
  readonly onLandingUserChange: (user: LandingUser | null) => void;
}

export default function AppRuntime({
  navigation,
  practiceOpenerRef,
  visible,
  signInRequest,
  onSignInRequestHandled,
  onLandingUserChange,
}: AppRuntimeProps) {
  const { _ } = useLingui();
  const [error, setError] = useState<string | null>(null);
  const clearError = useCallback((message: string) => {
    setError(current => current === message ? null : current);
  }, []);
  const {
    notice,
    setNotice,
    isPracticeMenuOpen,
    setIsPracticeMenuOpen,
    isStatsOpen,
    setIsStatsOpen,
    showClearConfirm,
    setShowClearConfirm,
    hasMountedOverlays,
    shareOpenerRef,
    practiceOpenerRef: overlayPracticeOpenerRef,
    statsOpenerRef,
    clearOpenerRef,
    rememberOpener,
    openPractice,
    openClearConfirm: openClearOverlay,
    undoToast,
    setUndoToast,
  } = useOverlayState({ practiceOpenerRef });
  const appShellRef = useRef<HTMLDivElement | null>(null);
  const navigationRef = useRef<HTMLElement | null>(null);
  const viewStageRef = useRef<HTMLDivElement | null>(null);
  const {
    viewMode,
    setViewMode,
    viewHeadingRef,
    viewFocusIntent,
    isDarkMode,
  } = navigation;
  const library = useAppLibraryRuntime({
    viewMode,
    isStatsOpen,
    reportError: setError,
    clearError,
    notify: setNotice,
  });
  const learning = useAppLearningCoordination({
    library,
    viewMode,
    setViewMode,
    setPracticeMenuOpen: setIsPracticeMenuOpen,
    setClearConfirm: setShowClearConfirm,
    rememberOpener,
    shareOpenerRef,
    reportError: setError,
    notify: setNotice,
  });
  const {
    cards,
    user,
    librarySession,
    shellSyncStatus,
    isBrowserOnline,
    isExporting,
  } = library.model;
  const {
    libraryScreen,
    practiceSession,
    practiceAddXp,
    customDecks,
    intakeSharing,
    isLibraryBusy,
    canClearLibrary,
  } = learning.model;
  const practiceActions = learning.actions.practice;
  const intakeActions = learning.actions.intakeSharing;
  const identity = librarySession.identity;
  const isShareModalOpen = intakeSharing.share.isShareDialogOpen || intakeSharing.share.isLoading;
  const handlePracticeStageKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (practiceSession.mode !== 'study' || event.defaultPrevented || event.nativeEvent.isComposing) return;
    const target = event.target as { closest?: (selectors: string) => Element | null } | null;
    if (target?.closest?.('button, a, input, select, textarea, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [data-radix-popper-content-wrapper]')) return;
    const noModifiers = !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    const altShortcut = event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    if (noModifiers && (event.key === ' ' || event.key === 'Space' || event.key === 'Spacebar' || event.key === 'Enter')) {
      event.preventDefault();
      playFlipSound();
      practiceActions.reveal();
    } else if (noModifiers && event.key === 'ArrowRight') {
      event.preventDefault();
      practiceActions.setStudyIndex(Math.min(practiceSession.study.cards.length - 1, practiceSession.study.index + 1));
    } else if (noModifiers && event.key === 'ArrowLeft') {
      event.preventDefault();
      practiceActions.setStudyIndex(Math.max(0, practiceSession.study.index - 1));
    } else if (altShortcut && ['1', '2', '3', '4'].includes(event.key)) {
      event.preventDefault();
      const ratings: Record<string, ReviewRating> = { '1': 'again', '2': 'hard', '3': 'good', '4': 'easy' };
      void practiceActions.submitStudyRating(ratings[event.key]);
    } else if (altShortcut && event.key.toLocaleLowerCase() === 's') {
      const card = practiceSession.study.cards[practiceSession.study.index];
      if (!card) return;
      event.preventDefault();
      if (!card.bookmarked) playRewardSound();
      void practiceSession.learning.toggleBookmark(card.id);
    }
  }, [practiceActions, practiceSession]);
  useBrowserExtensionImport({
    ownerId: user?.uid ?? null,
    identityLoading: identity.status === 'loading',
    customDecks,
    libraryReady: Boolean(
      user
      && librarySession.owner.ownerId === user.uid
      && librarySession.owner.status === 'ready'
    ),
    isBusy: isLibraryBusy,
    changeDraft: intakeActions.changeDraft,
    generate: intakeActions.generate,
    openLibrary: () => setViewMode('library'),
    notify: message => setNotice(message),
    reportError: message => setError(message),
  });
  const handledSignInRequestRef = useRef(0);
  useEffect(() => {
    onLandingUserChange(user ? {
      displayName: user.displayName,
      email: user.email,
      photoURL: user.photoURL,
    } : null);
  }, [onLandingUserChange, user?.displayName, user?.email, user?.photoURL]);
  useEffect(() => {
    void consumeLandingSignInRequest(
      signInRequest,
      handledSignInRequestRef,
      onSignInRequestHandled,
      library.actions.signIn,
    );
  }, [library.actions.signIn, onSignInRequestHandled, signInRequest]);
  const openClearConfirm = (focusReturnTarget: HTMLButtonElement) =>
    openClearOverlay(focusReturnTarget, canClearLibrary);
  const handleSignIn = async () => { await library.actions.signIn(); };
  const handleSignOut = async () => { await library.actions.signOut(); };

  if (!visible) return null;

  return (
    <div ref={appShellRef} className={`app-canvas min-h-dvh h-dvh text-[var(--sf-text)] font-sans flex flex-col overflow-hidden selection:bg-cyan-500/20 transition-colors relative ${isDarkMode ? 'dark' : ''}`}>
      <div className="ambient-orb ambient-orb-a" aria-hidden="true" />
      <div className="ambient-orb ambient-orb-b" aria-hidden="true" />
      <div className="ambient-orb ambient-orb-c" aria-hidden="true" />
      <SkipToContentLink />

      <DesktopNavigation
        navigationRef={navigationRef}
        viewMode={viewMode}
        syncIdentity={identity.status === 'loading'
          ? { status: 'loading' }
          : user
            ? {
                status: 'authenticated',
                displayName: user.displayName,
                email: user.email,
                photoUrl: user.photoURL,
              }
            : {
                status: 'signed-out',
                isConfigured: appDependencies.configuration.cloudConfigured,
                isSigningIn: identity.isSigningIn,
              }}
        syncStatus={shellSyncStatus}
        isDarkMode={isDarkMode}
        isExporting={isExporting}
        isLibraryMutationPending={isLibraryBusy}
        libraryCountLabel={libraryScreen.navigation.libraryCountLabel}
        onOpenLanding={() => setViewMode('landing')}
        onOpenToday={() => setViewMode('today')}
        onOpenLibrary={() => setViewMode('library')}
        onOpenCatalog={() => setViewMode('catalog')}
        onOpenProgress={() => setViewMode('progress')}
        onOpenSettings={() => setViewMode('settings')}
        onSignIn={handleSignIn}
        onSignOut={handleSignOut}
        onExportLibrary={library.actions.exportLibrary}
        onClearLibrary={openClearConfirm}
      />

      <AppFeedback
        authError={user ? null : identity.error}
        error={isShareModalOpen && error === intakeSharing.share.error ? null : error}
        notice={notice}
        syncStatus={shellSyncStatus}
        onDismissAuthError={library.actions.clearAuthError}
        onDismissError={() => setError(null)}
        onDismissNotice={() => setNotice(null)}
        onRetrySync={() => {
          setError(current => current === librarySession.cloud.error ? null : current);
          return library.actions.retrySync();
        }}
      />
      <main
        id={LEARNING_WORKSPACE_ID}
        tabIndex={0}
        aria-label={_(msg({ id: 'shell.learning-workspace', message: 'Learning workspace' }))}
        className="flex-1 relative w-full overflow-y-auto z-10 scrollbar-thin focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
      >
        <div onKeyDown={handlePracticeStageKeyDown} className="relative w-full max-w-[1560px] mx-auto p-4 sm:px-6 sm:py-6 lg:px-8 pb-24 lg:pb-8">
          {viewMode !== 'catalog' && viewMode !== 'today' && viewMode !== 'progress' && viewMode !== 'settings' && (
            <h1 ref={viewHeadingRef} tabIndex={-1} className="sr-only">{_(APP_VIEW_HEADINGS[viewMode])}</h1>
          )}
          <div ref={viewStageRef} data-app-view-stage className="min-h-full">
            <AppViewStage
              viewMode={viewMode}
              ownerId={user?.uid ?? null}
              isOffline={!isBrowserOnline}
              isDarkMode={isDarkMode}
              headingRef={viewHeadingRef}
              focusIntent={viewFocusIntent}
              stats={libraryScreen.overlays.stats}
              streak={libraryScreen.model.overview.streak}
              isStatsLoading={librarySession.cloud.isStatsLoading}
              statsError={librarySession.cloud.error}
              loadPracticePool={learning.actions.loadPracticePool}
              reviewCard={learning.actions.reviewCard}
              catalogCards={cards}
              adoptCatalogCards={intakeActions.adoptCards}
              notifyCatalog={setNotice}
              openVocabulary={() => setViewMode('library')}
              openPaths={() => setViewMode('catalog')}
              continueReview={practiceActions.startStudy}
              openMorePractice={openPractice}
              libraryContent={<AppDeferredLibraryView model={libraryScreen.model} actions={libraryScreen.actions} />}
              practiceContent={<AppDeferredPracticeView session={practiceSession} actions={practiceActions} customDecks={customDecks} addXp={practiceAddXp} />}
            />
          </div>
        </div>
      </main>

      <AppFooter
        viewMode={viewMode}
        libraryCountLabel={libraryScreen.navigation.libraryCountLabel}
        syncStatus={shellSyncStatus}
      />

      {(hasMountedOverlays || isShareModalOpen || Boolean(intakeSharing.share.activeShareId)) && (
        <Suspense fallback={<span className="sr-only" role="status"><Trans id="shell.opening-dialog" message="Opening dialog" /></span>}>
          <AppOverlays
            shareDialogOpen={isShareModalOpen}
            shareLink={intakeSharing.share.shareLink}
            shareWarning={intakeSharing.share.shareWarning}
            shareExpiresAt={intakeSharing.share.expiresAt}
            shareError={intakeSharing.share.error}
            onDismissShareError={() => {
              intakeActions.clearShareError();
              setError(current => current === intakeSharing.share.error ? null : current);
            }}
            outgoingSharePreview={intakeSharing.share.outgoingPreview}
            incomingSharePreview={intakeSharing.share.incomingPreview}
            dismissShareDialog={intakeActions.dismissShareLink}
            showShareDialog={intakeActions.showShareDialog}
            acceptSharedDeck={async () => { await intakeActions.acceptShared(); }}
            cancelSharedDeck={intakeActions.cancelShared}
            canRevokeShare={Boolean(intakeSharing.share.activeShareId)}
            revokeShare={async () => { await intakeActions.revokeShare(); }}
            isSharing={intakeSharing.share.isLoading}
            isPracticeMenuOpen={isPracticeMenuOpen}
            setIsPracticeMenuOpen={setIsPracticeMenuOpen}
            startQuiz={practiceActions.startQuiz}
            startSpelling={practiceActions.startSpelling}
            startMatch={practiceActions.startMatch}
            startShadowing={practiceActions.startShadowing}
            practiceCards={libraryScreen.model.grid.filteredCards}
            visibleLibraryCount={libraryScreen.navigation.practiceLibraryCount}
            generateStory={practiceActions.generateStory}
            isStatsOpen={isStatsOpen}
            setIsStatsOpen={setIsStatsOpen}
            statsData={libraryScreen.overlays.stats}
            isDarkMode={isDarkMode}
            showClearConfirm={showClearConfirm}
            setShowClearConfirm={setShowClearConfirm}
            clearAll={learning.actions.clearAll}
            isLoading={isLibraryBusy}
            shareOpenerRef={shareOpenerRef}
            practiceOpenerRef={overlayPracticeOpenerRef}
            statsOpenerRef={statsOpenerRef}
            clearOpenerRef={clearOpenerRef}
          />
        </Suspense>
      )}

      <UndoToast toast={undoToast} onDismiss={() => setUndoToast(null)} />

      {/* Floating Mobile Bottom Navigation */}
      <FloatingMobileNav
        activeView={viewMode}
        onSelectView={setViewMode}
      />

      <AppShellMotion
        appShellRef={appShellRef}
        navigationRef={navigationRef}
        viewMode={viewMode}
        viewStageRef={viewStageRef}
      />
    </div>
  );
}
