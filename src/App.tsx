import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { AppFeedback } from './components/shell/AppFeedback';
import { AppFooter } from './components/shell/AppFooter';
import { DesktopNavigation } from './components/shell/DesktopNavigation';
import { FloatingMobileNav } from './components/shell/FloatingMobileNav';
import { UndoToast } from './components/ui/UndoToast';
import { LEARNING_WORKSPACE_ID, SkipToContentLink } from './components/shell/SkipToContentLink';
import { useAppNavigation } from './features/navigation/useAppNavigation';
import { useOverlayState } from './features/overlays/useOverlayState';
import { appDependencies } from './app/appDependencies';
import { AppDeferredLibraryView, AppDeferredPracticeView, preloadPracticeView } from './app/AppDeferredViews';
import { AppViewStage } from './app/AppViewStage';
import { useAppLibraryRuntime } from './app/useAppLibraryRuntime';
import { useAppLearningCoordination } from './app/useAppLearningCoordination';
import { AppShellMotion } from './components/motion/AppShellMotion';
import { useBrowserExtensionImport } from './features/browserExtension/useBrowserExtensionImport';

const LandingPage = lazy(() => import('./features/landing/LandingPage'));
const AppOverlays = lazy(() => import('./components/AppOverlays').then(module => ({ default: module.AppOverlays })));

export default function App() {
  const [error, setError] = useState<string | null>(null);
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
    practiceOpenerRef,
    statsOpenerRef,
    clearOpenerRef,
    rememberOpener,
    openPractice,
    openClearConfirm: openClearOverlay,
    undoToast,
    setUndoToast,
  } = useOverlayState();
  const appShellRef = useRef<HTMLDivElement | null>(null);
  const navigationRef = useRef<HTMLElement | null>(null);
  const viewStageRef = useRef<HTMLDivElement | null>(null);
  const {
    viewMode,
    setViewMode,
    viewHeading,
    viewHeadingRef,
    viewFocusIntent,
    isDarkMode,
    toggleTheme,
  } = useAppNavigation({ practiceOpenerRef });
  const library = useAppLibraryRuntime({
    viewMode,
    isStatsOpen,
    reportError: setError,
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
    customDecks,
    intakeSharing,
    isLibraryBusy,
    canClearLibrary,
  } = learning.model;
  const practiceActions = learning.actions.practice;
  const intakeActions = learning.actions.intakeSharing;
  const identity = librarySession.identity;
  useBrowserExtensionImport({
    ownerId: user?.uid ?? null,
    identityLoading: identity.status === 'loading',
    isBusy: isLibraryBusy,
    changeDraft: intakeActions.changeDraft,
    generate: intakeActions.generate,
    openLibrary: () => setViewMode('library'),
    notify: message => setNotice(message),
    reportError: message => setError(message),
  });
  const openClearConfirm = (focusReturnTarget: HTMLButtonElement) =>
    openClearOverlay(focusReturnTarget, canClearLibrary);
  const handleSignIn = async () => { await library.actions.signIn(); };
  const handleSignOut = async () => { await library.actions.signOut(); };

  useEffect(() => {
    if (viewMode === 'today') preloadPracticeView();
  }, [viewMode]);

  if (viewMode === 'landing') {
    return (
      <Suspense fallback={<div className="h-screen w-full bg-[#071014] flex items-center justify-center text-cyan-400 font-bold">Loading SonFlash…</div>}>
        <LandingPage
          onEnterApp={() => setViewMode('today')}
          onOpenLibrary={() => setViewMode('library')}
          onOpenCatalog={() => setViewMode('catalog')}
          onOpenProgress={() => setViewMode('progress')}
          onSignIn={handleSignIn}
          user={user}
        />
      </Suspense>
    );
  }

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
        onSignIn={handleSignIn}
        onSignOut={handleSignOut}
        onToggleTheme={toggleTheme}
        onExportLibrary={library.actions.exportLibrary}
        onClearLibrary={openClearConfirm}
      />

      <AppFeedback
        authError={user ? null : identity.error}
        error={error}
        notice={notice}
        syncStatus={shellSyncStatus}
        onDismissAuthError={library.actions.clearAuthError}
        onDismissError={() => setError(null)}
        onDismissNotice={() => setNotice(null)}
        onRetrySync={library.actions.retrySync}
      />
      <main
        id={LEARNING_WORKSPACE_ID}
        tabIndex={-1}
        aria-label="Learning workspace"
        className="flex-1 relative w-full overflow-y-auto z-10 scrollbar-thin"
      >
        <div className="relative w-full max-w-[1560px] mx-auto p-4 sm:px-6 sm:py-6 lg:px-8 pb-24 lg:pb-8">
          {viewMode !== 'catalog' && viewMode !== 'today' && viewMode !== 'progress' && (
            <h1 ref={viewHeadingRef} tabIndex={-1} className="sr-only">{viewHeading}</h1>
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
              practiceContent={<AppDeferredPracticeView session={practiceSession} actions={practiceActions} customDecks={customDecks} />}
            />
          </div>
        </div>
      </main>

      <AppFooter
        viewMode={viewMode}
        libraryCountLabel={libraryScreen.navigation.libraryCountLabel}
        syncStatus={shellSyncStatus}
      />


      {(hasMountedOverlays || intakeSharing.share.isShareDialogOpen || Boolean(intakeSharing.share.activeShareId)) && (
        <Suspense fallback={<span className="sr-only" role="status">Opening dialog</span>}>
          <AppOverlays
            shareDialogOpen={intakeSharing.share.isShareDialogOpen}
            shareLink={intakeSharing.share.shareLink}
            shareWarning={intakeSharing.share.shareWarning}
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
            practiceOpenerRef={practiceOpenerRef}
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
