import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import type { ReviewRating } from '../lib/reviewScheduler';
import { playFlipSound, playRewardSound } from '../lib/interactionSounds';
import type { useAppNavigation } from '../features/navigation/useAppNavigation';
import { AppFeedback } from '../components/shell/AppFeedback';
import { AppFooter } from '../components/shell/AppFooter';
import { DesktopNavigation } from '../components/shell/DesktopNavigation';
import { FloatingMobileNav } from '../components/shell/FloatingMobileNav';
import { UndoToast, type UndoToastItem } from '../components/ui/UndoToast';
import { LEARNING_WORKSPACE_ID, SkipToContentLink } from '../components/shell/SkipToContentLink';
import { useOverlayState } from '../features/overlays/useOverlayState';
import { appDependencies } from './appDependencies';
import { AppDeferredCreateCardDialog, AppDeferredLibraryView, AppDeferredPracticeView } from './AppDeferredViews';
import { AppViewStage } from './AppViewStage';
import { useAppLibraryRuntime } from './useAppLibraryRuntime';
import { useAppLearningCoordination } from './useAppLearningCoordination';
import { consumeLandingSignInRequest } from './landingSignInRequest';
import { AppShellMotion } from '../components/motion/AppShellMotion';
import { useBrowserExtensionImport } from '../features/browserExtension/useBrowserExtensionImport';
import { useExtensionDueCountBridge } from '../features/extensionBridge/useExtensionDueCountBridge';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { APP_VIEW_HEADINGS } from '../features/navigation/app-view-headings';
import { evidencedStudyStreak } from '../features/dailyLearning/dailyLearningPresentation';
import { CourseProvider, useCourseSession, type CourseGateValue } from '../features/courses/CourseGate';
import { activeCourseNativeLanguage, activeCourseTargetLanguage, languageProfileForCourse } from '../features/courses/courseLanguageProfile';
import type { CourseNativeLanguage, CourseTargetLanguage } from '../features/courses/courseModel';
import { createSharedDeckCoursePort, resolveShareCourseAction } from '../features/sharing/shareCourseMatching';
import type { SharedDeckIncomingPreview } from '../features/sharing/sharedDeckSessionController';
import { OnboardingGate } from '../features/onboarding/OnboardingGate';
import '../styles/shell.css';

const AppOverlays = lazy(() => import('../components/AppOverlays').then(module => ({ default: module.AppOverlays })));
const WebWordsRouteHost = lazy(() => import('../features/webWords/WebWordsRouteHost').then(module => ({ default: module.WebWordsRouteHost })));

/**
 * Surfaces the live `useCourseSession()` value up to AppRuntime as plain
 * data. It has to be a real descendant of `CourseProvider` to see its value;
 * AppRuntime's own hooks (useAppLibraryRuntime, useAppLearningCoordination)
 * run in AppRuntime's own function body, above where CourseProvider mounts,
 * so they cannot call useCourseSession() themselves and instead consume this
 * bridge's reported snapshot as a plain parameter.
 */
function CourseSessionBridge({ onSnapshot }: { readonly onSnapshot: (value: CourseGateValue) => void }) {
  const courseSession = useCourseSession();
  useEffect(() => {
    onSnapshot(courseSession);
  }, [courseSession, onSnapshot]);
  return null;
}

// A capture carries the target language the extension had synced from the
// active course when it was saved ('en' for older extensions). Reusing
// `resolveShareCourseAction` against that pair detects a course switch made
// between capture and import.
const extensionCapturePreview = (
  targetLanguage: CourseTargetLanguage,
  translationLanguage: CourseNativeLanguage,
): SharedDeckIncomingPreview => ({
  shareId: '',
  category: '',
  cardCount: 0,
  sampleWords: [],
  languagePairs: [{ targetLanguage, translationLanguage }],
  createdAt: null,
  expiresAt: null,
  containsAiGeneratedCards: false,
});

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
  const [isRetryingSync, setIsRetryingSync] = useState(false);
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
  const preSignInLocationRef = useRef<string | null>(null);
  // null until CourseSessionBridge reports the live CourseProvider value;
  // languageProfileForCourse(null) already matches the no-active-course
  // default, so the very first render before that report lands is correct.
  const [courseSession, setCourseSession] = useState<CourseGateValue | null>(null);
  const handleCourseSessionSnapshot = useCallback((value: CourseGateValue) => {
    setCourseSession(value);
  }, []);
  const languageProfile = languageProfileForCourse(courseSession?.model.activeCourse ?? null);
  const coursePort = useMemo(
    () => courseSession ? createSharedDeckCoursePort(courseSession) : null,
    [courseSession],
  );
  // Gate for the extension's silent (one-click, no-review) capture path
  // only: manual captures already open the library view, where the real
  // course switcher is visible before the user generates anything, so no
  // extra gate is needed there. Cancelling here leaves nothing generated.
  const ensureExtensionCaptureCourse = useCallback(async (targetLanguage: CourseTargetLanguage): Promise<'proceed' | 'cancel'> => {
    if (!courseSession || !coursePort) return 'proceed';
    const preview = extensionCapturePreview(targetLanguage, activeCourseNativeLanguage(courseSession.model.activeCourse));
    const decision = resolveShareCourseAction(preview, courseSession.model.profile);
    if (!decision || decision.action === 'none') return 'proceed';
    const confirmed = globalThis.confirm?.(_(msg({
      id: 'extension.import.course-mismatch-confirm',
      message: "This word was saved for a different language than your active course. Switch to (or create) the matching course to save it?",
    }))) ?? true;
    if (!confirmed) return 'cancel';
    await coursePort.ensureCourseForIncomingShare(preview);
    return 'proceed';
  }, [courseSession, coursePort, _]);
  const library = useAppLibraryRuntime({
    viewMode,
    isStatsOpen,
    targetLanguage: languageProfile.source.code,
    reportError: setError,
    clearError,
    notify: setNotice,
  });
  const undoOwnerRef = useRef<string | null | undefined>(undefined);
  const currentOwnerId = library.model.user?.uid ?? null;
  const currentOwnerRef = useRef(currentOwnerId);
  currentOwnerRef.current = currentOwnerId;
  const offerUndo = useCallback((ownerId: string | null, toast: UndoToastItem | null) => {
    if (ownerId !== currentOwnerRef.current) return;
    undoOwnerRef.current = toast ? ownerId : undefined;
    setUndoToast(toast);
  }, [setUndoToast]);
  useEffect(() => {
    if (undoOwnerRef.current !== currentOwnerId) {
      undoOwnerRef.current = undefined;
      setUndoToast(null);
    }
  }, [currentOwnerId, setUndoToast]);
  const learning = useAppLearningCoordination({
    library,
    viewMode,
    languageProfile,
    coursePort,
    setViewMode,
    setPracticeMenuOpen: setIsPracticeMenuOpen,
    setClearConfirm: setShowClearConfirm,
    rememberOpener,
    shareOpenerRef,
    reportError: setError,
    notify: setNotice,
    offerUndo,
  });
  const {
    cards,
    user,
    librarySession,
    shellSyncStatus,
    isBrowserOnline,
    isExporting,
    cloudStats,
    knownLibraryTotal,
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
    if (practiceSession.mode !== 'study' || practiceSession.study.isPaused || event.defaultPrevented || event.nativeEvent.isComposing) return;
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
  const libraryReady = Boolean(
    user
    && librarySession.owner.ownerId === user.uid
    && librarySession.owner.status === 'ready'
  );
  useBrowserExtensionImport({
    ownerId: user?.uid ?? null,
    identityLoading: identity.status === 'loading',
    customDecks,
    libraryReady,
    isBusy: isLibraryBusy,
    changeDraft: intakeActions.changeDraft,
    generate: intakeActions.generate,
    openLibrary: () => setViewMode('library'),
    notify: message => setNotice(message),
    reportError: message => setError(message),
    ensureCaptureCourse: ensureExtensionCaptureCourse,
    courseNativeLanguage: courseSession?.model.activeCourse ? activeCourseNativeLanguage(courseSession.model.activeCourse) : null,
    courseTargetLanguage: courseSession?.model.activeCourse ? activeCourseTargetLanguage(courseSession.model.activeCourse) : null,
  });
  useExtensionDueCountBridge({ ownerId: user?.uid ?? null, ready: libraryReady, dueCount: cloudStats.due });
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
  useEffect(() => {
    // The workspace only renders for an authenticated owner. Once identity
    // resolves to signed-out, bounce back to the landing page and its
    // sign-in, but remember the pre-bounce location so a deep link (or an
    // extension import intent tied to that URL) survives the round trip.
    if (identity.status === 'loading' || user || viewMode === 'landing') return;
    preSignInLocationRef.current = window.location.href;
    setViewMode('landing');
  }, [identity.status, setViewMode, user, viewMode]);
  useEffect(() => {
    if (!user || !preSignInLocationRef.current) return;
    // Restore the captured URL verbatim, then let every URL-driven listener
    // (view mode, lesson, catalog, web words) re-read it through popstate.
    // setViewMode would normalize the URL and drop deep-link params.
    window.history.pushState(window.history.state, '', preSignInLocationRef.current);
    preSignInLocationRef.current = null;
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, [user]);
  const openClearConfirm = (focusReturnTarget: HTMLButtonElement) =>
    openClearOverlay(focusReturnTarget, canClearLibrary);
  const handleSignIn = async () => { await library.actions.signIn(); };
  const handleSignOut = async () => { await library.actions.signOut(); };
  const handleRetrySync = async () => {
    if (isRetryingSync) return;
    setIsRetryingSync(true);
    setError(current => current === librarySession.cloud.error ? null : current);
    try {
      await library.actions.retrySync();
    } catch {
      setError(_(msg({ id: 'shell.sync.retry-failed', message: 'Sync could not finish. Your changes remain on this device. Try again.' })));
    } finally {
      setIsRetryingSync(false);
    }
  };

  if (!visible) return null;
  if (identity.status !== 'loading' && !user && viewMode !== 'landing') return null;

  return (
    <CourseProvider ownerId={user?.uid ?? null}>
    <CourseSessionBridge onSnapshot={handleCourseSessionSnapshot} />
    <div ref={appShellRef} data-view={viewMode} className={`app-canvas claude-app-shell min-h-dvh h-dvh text-[var(--sf-text)] font-sans flex flex-col overflow-hidden transition-colors relative ${isDarkMode ? 'dark' : ''}`}>
      <SkipToContentLink />
      <OnboardingGate ownerId={user?.uid ?? null} suppress={viewMode === 'landing' || shellSyncStatus.isCheckingCloud} hasCards={knownLibraryTotal > 0} />

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
        streak={evidencedStudyStreak(libraryScreen.model.overview.streak, libraryScreen.overlays.stats.xpChartData)}
        level={libraryScreen.model.overview.level}
        xp={libraryScreen.model.overview.xp}
        onOpenLanding={() => setViewMode('landing')}
        onOpenToday={() => setViewMode('today')}
        onOpenLibrary={() => setViewMode('library')}
        onOpenCatalog={() => setViewMode('catalog')}
        onOpenProgress={() => setViewMode('progress')}
        onOpenSettings={() => setViewMode('settings')}
        onSignIn={handleSignIn}
        onSignOut={handleSignOut}
        onRetrySync={handleRetrySync}
        isRetryingSync={isRetryingSync}
        sessionLost={Boolean(identity.authenticationRecovery)}
        canSyncNow={identity.status === 'authenticated' && !identity.authenticationRecovery && isBrowserOnline && Boolean(user)}
        onExportLibrary={library.actions.exportLibrary}
        onClearLibrary={openClearConfirm}
      />

      <AppFeedback
        authError={user && !identity.authenticationRecovery ? null : identity.error}
        sessionLost={identity.authenticationRecovery === 'session-lost'}
        isRetryingAuth={identity.isSigningIn}
        onRetryAuth={handleSignIn}
        error={isShareModalOpen && error === intakeSharing.share.error ? null : error}
        notice={notice}
        syncStatus={shellSyncStatus}
        onDismissAuthError={library.actions.clearAuthError}
        onDismissError={() => setError(null)}
        onDismissNotice={() => setNotice(null)}
        onRetrySync={handleRetrySync}
      >
        {undoToast && undoOwnerRef.current === currentOwnerId && !identity.authenticationRecovery ? (
          <UndoToast stacked toast={undoToast} onDismiss={() => setUndoToast(null)} />
        ) : null}
      </AppFeedback>
      <main
        id={LEARNING_WORKSPACE_ID}
        tabIndex={0}
        aria-label={_(msg({ id: 'shell.learning-workspace', message: 'Learning workspace' }))}
        className="claude-workspace flex-1 relative w-full overflow-y-auto z-10 scrollbar-thin focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
      >
        <div onKeyDown={handlePracticeStageKeyDown} className="claude-workspace-inner relative w-full max-w-[1440px] mx-auto px-5 pt-5 pb-28 sm:px-8 lg:px-11 lg:pt-3 lg:pb-8">
          {viewMode !== 'catalog' && viewMode !== 'today' && viewMode !== 'progress' && viewMode !== 'settings' && (
            <h1 ref={viewHeadingRef} tabIndex={-1} className="sr-only">{_(APP_VIEW_HEADINGS[viewMode])}</h1>
          )}
          <div ref={viewStageRef} data-app-view-stage className="min-h-full">
            <AppViewStage
              viewMode={viewMode}
              ownerId={user?.uid ?? null}
              languageProfile={languageProfile}
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

      <AppDeferredCreateCardDialog
        model={intakeSharing.cardCreator}
        actions={intakeActions.cardCreator}
        deckOptions={customDecks}
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

      {user && viewMode !== 'landing' && (
        <Suspense fallback={null}>
          <WebWordsRouteHost />
        </Suspense>
      )}

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
    </CourseProvider>
  );
}
