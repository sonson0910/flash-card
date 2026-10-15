import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type KeyboardEvent as ReactKeyboardEvent, type RefObject, type SetStateAction } from 'react';
import { playFlipSound, playRewardSound } from '../lib/interactionSounds';
import type { useAppNavigation } from '../features/navigation/useAppNavigation';
import { AppFeedback } from '../components/shell/AppFeedback';
import { AppFooter } from '../components/shell/AppFooter';
import { DesktopNavigation } from '../components/shell/DesktopNavigation';
import { FloatingMobileNav } from '../components/shell/FloatingMobileNav';
import { UndoToast, type UndoToastItem } from '../components/ui/UndoToast';
import { LEARNING_WORKSPACE_ID, SkipToContentLink } from '../components/shell/SkipToContentLink';
import { scheduleNoticeDismissal, useOverlayState } from '../features/overlays/useOverlayState';
import { appDependencies } from './appDependencies';
import { db, isFirebaseConfigured } from '../lib/firebase';
import { AppDeferredCreateCardDialog, AppDeferredLibraryView, AppDeferredPracticeView } from './AppDeferredViews';
import { AppViewStage } from './AppViewStage';
import { WorkspaceLoadingPanel } from '../components/WorkspaceLoadingPanel';
import { useAppLibraryRuntime } from './useAppLibraryRuntime';
import { useAppLearningCoordination } from './useAppLearningCoordination';
import { consumeLandingSignInRequest } from './landingSignInRequest';
import { accountDeletionNoticePath, withoutAccountDeletionNotices } from '../features/account/account-deletion-notice';
import { AppShellMotion } from '../components/motion/AppShellMotion';
import { useBrowserExtensionImport } from '../features/browserExtension/useBrowserExtensionImport';
import { useExtensionDueCountBridge } from '../features/extensionBridge/useExtensionDueCountBridge';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import { APP_VIEW_HEADINGS } from '../features/navigation/app-view-headings';
import { evidencedStudyStreak } from '../features/dailyLearning/dailyLearningPresentation';
import { CourseProvider, readyCourseSessionForOwner, useCourseSession, type CourseGateValue } from '../features/courses/CourseGate';
import { activeCourseNativeLanguage, activeCourseTargetLanguage, languageProfileForCourse } from '../features/courses/courseLanguageProfile';
import type { CourseTargetLanguage } from '../features/courses/courseModel';
import { createSharedDeckCoursePort, resolveShareCourseAction } from '../features/sharing/shareCourseMatching';
import { OnboardingGate } from '../features/onboarding/OnboardingGate';
import { useOnboardingLibraryState } from '../features/onboarding/useOnboardingLibraryState';
import { getActiveUiLocale, loadCatalog } from '../i18n/loadCatalog';
import type { LearningCeremony } from './useAppLearningCoordination';
import {
  createCeremonyQueueState,
  desktopCourseProps,
  desktopNavigationActions,
  dismissQueuedCeremony,
  equipCeremonyFrame,
  extensionCapturePreview,
  latestStatsRefresh,
  libraryInsightsPhase,
  overlayLearningProps,
  overlayShareProps,
  overlayUiProps,
  queueCeremonies,
  queueLearningCeremonies,
  shouldShowViewHeading,
  statsRefreshForTarget,
  studyShortcut,
  syncIdentityForShell,
  type CeremonyQueueState,
  viewStageLearningProps,
  viewStageNavigationActions,
  viewStageStatsProps,
  weeklyRecapRequestSettled,
} from './app-runtime-shared';
export {
  createCeremonyQueueState,
  dismissQueuedCeremony,
  equipCeremonyFrame,
  latestStatsRefresh,
  libraryInsightsPhase,
  orderCeremonyEvents,
  queueCeremonies,
  statsRefreshForTarget,
  streakCeremonyRewardLabels,
  type CeremonyQueueState,
  type QueuedCeremony,
} from './app-runtime-shared';
import '../styles/shell.css';

const AppOverlays = lazy(() => import('../components/AppOverlays').then(module => ({ default: module.AppOverlays })));
const WebWordsRouteHost = lazy(() => import('../features/webWords/WebWordsRouteHost').then(module => ({ default: module.WebWordsRouteHost })));
const AnimeReveal = lazy(() => Promise.all([
  import('../features/rewards/AnimeReveal'), loadCatalog(getActiveUiLocale(), 'rewards'),
]).then(([module]) => ({ default: module.AnimeReveal })));
const dialogFallback = <span className="sr-only" role="status"><Trans id="shell.opening-dialog" message="Opening dialog" /></span>;

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

export function useOwnerScopedMessage(
  ownerId: string | null,
  activeOwnerRef: RefObject<string | null>,
  storedMessage: string | null,
  setStoredMessage: Dispatch<SetStateAction<string | null>>,
): readonly [string | null, Dispatch<SetStateAction<string | null>>] {
  const [publishedGeneration, setPublishedGeneration] = useState<number | null>(null);
  const scopeRef = useRef({ ownerId, generation: 0, published: false });
  if (scopeRef.current.ownerId !== ownerId) {
    scopeRef.current = { ownerId, generation: scopeRef.current.generation + 1, published: false };
  }
  const generation = scopeRef.current.generation;
  const message = publishedGeneration === generation ? storedMessage : null;
  const setMessage = useCallback<Dispatch<SetStateAction<string | null>>>(value => {
    if (activeOwnerRef.current !== ownerId || scopeRef.current.generation !== generation) return;
    const sameOwner = scopeRef.current.published;
    scopeRef.current.published = true;
    setStoredMessage(previous => typeof value === 'function' ? value(sameOwner ? previous : null) : value);
    setPublishedGeneration(generation);
  }, [activeOwnerRef, generation, ownerId, setStoredMessage]);
  return [message, setMessage];
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
  const identitySession = appDependencies.sessions.libraryHooks.useIdentitySession();
  const identityOwnerId = identitySession.owner?.id ?? null;
  const identityOwnerRef = useRef(identityOwnerId);
  identityOwnerRef.current = identityOwnerId;
  const [storedError, setStoredError] = useState<string | null>(null);
  const [error, setError] = useOwnerScopedMessage(identityOwnerId, identityOwnerRef, storedError, setStoredError);
  const [isRetryingSync, setIsRetryingSync] = useState(false);
  const clearError = useCallback((message: string) => {
    setError(current => current === message ? null : current);
  }, [setError]);
  const {
    notice: storedNotice,
    setNotice: setStoredNotice,
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
    openStats,
    openClearConfirm: openClearOverlay,
    undoToast,
    setUndoToast,
  } = useOverlayState({ ownerId: identityOwnerId, practiceOpenerRef, autoDismissNotice: false });
  const [notice, setNotice] = useOwnerScopedMessage(identityOwnerId, identityOwnerRef, storedNotice, setStoredNotice);
  useEffect(() => scheduleNoticeDismissal(notice, () => setNotice(null)), [notice, setNotice]);
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
  const preSignInLocationRef = useRef<{ href: string; ownerId: string | null } | null>(null);
  const lastAuthenticatedOwnerIdRef = useRef(identityOwnerId);
  useLayoutEffect(() => {
    const previousOwnerId = lastAuthenticatedOwnerIdRef.current;
    if (identityOwnerId) {
      lastAuthenticatedOwnerIdRef.current = identityOwnerId;
      if (previousOwnerId && previousOwnerId !== identityOwnerId) {
        preSignInLocationRef.current = null;
        window.history.replaceState(window.history.state, '', accountDeletionNoticePath(window.location.href));
        return;
      }
      const returnLocation = preSignInLocationRef.current;
      if (!returnLocation) return;
      preSignInLocationRef.current = null;
      if (returnLocation.ownerId && returnLocation.ownerId !== identityOwnerId) return;
      // Replay only this owner's saved location after the signed-out bounce.
      window.history.pushState(window.history.state, '', returnLocation.href);
      window.dispatchEvent(new PopStateEvent('popstate'));
      return;
    }
    if (identitySession.status === 'loading') return;
    if (viewMode === 'landing') {
      lastAuthenticatedOwnerIdRef.current = null;
      return;
    }
    preSignInLocationRef.current = { href: withoutAccountDeletionNotices(window.location.href), ownerId: previousOwnerId };
    lastAuthenticatedOwnerIdRef.current = null;
    if (previousOwnerId) window.history.replaceState(window.history.state, '', accountDeletionNoticePath(window.location.href));
    setViewMode('landing');
  }, [identityOwnerId, identitySession.status, setViewMode, viewMode]);
  // null until CourseSessionBridge reports the live CourseProvider value;
  // languageProfileForCourse(null) already matches the no-active-course
  // default, so the very first render before that report lands is correct.
  const [courseSession, setCourseSession] = useState<CourseGateValue | null>(null);
  const currentCourseSession = readyCourseSessionForOwner(courseSession, identityOwnerId);
  const courseScopeReady = identitySession.status === 'anonymous' || !!(identityOwnerId && currentCourseSession);
  const activeCourse = currentCourseSession?.model.activeCourse ?? null;
  const languageProfile = languageProfileForCourse(activeCourse);
  const targetLanguage = languageProfile.source.code;
  const coursePort = useMemo(
    () => currentCourseSession ? createSharedDeckCoursePort(currentCourseSession) : null,
    [currentCourseSession],
  );
  // Gate for the extension's silent (one-click, no-review) capture path
  // only: manual captures already open the library view, where the real
  // course switcher is visible before the user generates anything, so no
  // extra gate is needed there. Cancelling here leaves nothing generated.
  const ensureExtensionCaptureCourse = useCallback(async (targetLanguage: CourseTargetLanguage): Promise<'proceed' | 'cancel'> => {
    if (!identityOwnerId || !currentCourseSession || !coursePort) return 'cancel';
    const preview = extensionCapturePreview(targetLanguage, activeCourseNativeLanguage(currentCourseSession.model.activeCourse));
    const decision = resolveShareCourseAction(preview, currentCourseSession.model.profile);
    if (!decision || decision.action === 'none') return 'proceed';
    const confirmed = globalThis.confirm?.(_(msg({
      id: 'extension.import.course-mismatch-confirm',
      message: "This word was saved for a different language than your active course. Switch to (or create) the matching course to save it?",
    }))) ?? true;
    if (!confirmed) return 'cancel';
    await coursePort.ensureCourseForIncomingShare(preview);
    return identityOwnerRef.current === identityOwnerId ? 'proceed' : 'cancel';
  }, [identityOwnerId, currentCourseSession, coursePort, _]);
  const [weeklyRecapRequest, setWeeklyRecapRequest] = useState<{ ownerId: string; requestId: number; targetLanguage: string } | null>(null);
  const [insightsRefreshRequest, setInsightsRefreshRequest] = useState<{ ownerId: string; requestId: number; targetLanguage: string } | null>(null);
  const nextStatsRefreshRequestId = useRef(0);
  const activeWeeklyRecapRequest = statsRefreshForTarget(weeklyRecapRequest, targetLanguage);
  const activeInsightsRefreshRequest = statsRefreshForTarget(insightsRefreshRequest, targetLanguage);
  const statsRefreshRequest = latestStatsRefresh(activeInsightsRefreshRequest, activeWeeklyRecapRequest);
  const library = useAppLibraryRuntime({
    identity: identitySession,
    courseScopeReady,
    viewMode,
    isStatsOpen,
    statsRefreshRequest,
    targetLanguage,
    reportError: setError,
    clearError,
    notify: setNotice,
  });
  const undoOwnerRef = useRef<string | null | undefined>(undefined);
  const currentOwnerId = library.model.user?.uid ?? null;
  const openWeeklyRecap = useCallback(() => {
    if (!currentOwnerId) return;
    setWeeklyRecapRequest({ ownerId: currentOwnerId, requestId: ++nextStatsRefreshRequestId.current, targetLanguage });
    setViewMode('progress');
  }, [currentOwnerId, targetLanguage, setViewMode]);
  const retryInsights = useCallback(() => {
    if (!currentOwnerId) return;
    setInsightsRefreshRequest({ ownerId: currentOwnerId, requestId: ++nextStatsRefreshRequestId.current, targetLanguage });
  }, [currentOwnerId, targetLanguage]);
  useEffect(() => {
    setWeeklyRecapRequest(request => request && (request.ownerId !== currentOwnerId || request.targetLanguage !== targetLanguage) ? null : request);
    setInsightsRefreshRequest(request => request && (request.ownerId !== currentOwnerId || request.targetLanguage !== targetLanguage) ? null : request);
  }, [currentOwnerId, targetLanguage]);
  const currentOwnerRef = useRef(currentOwnerId);
  currentOwnerRef.current = currentOwnerId;
  const [ceremonyState, setCeremonyState] = useState<CeremonyQueueState>(createCeremonyQueueState);
  const enqueueCeremony = useCallback((ceremony: LearningCeremony) => {
    if (ceremony.ownerId !== currentOwnerRef.current) return;
    const focusReturnTarget = globalThis.document?.activeElement instanceof HTMLElement
      ? globalThis.document.activeElement
      : null;
    const queued = queueLearningCeremonies(ceremony, focusReturnTarget, _);
    if (queued.length) setCeremonyState(current => queueCeremonies(current, queued));
  }, [_]);
  const dismissCeremony = useCallback(() => {
    setCeremonyState(current => {
      const dismissal = dismissQueuedCeremony(current);
      if (current.queue.length === 1) {
        globalThis.requestAnimationFrame?.(() => {
          const recapButton = globalThis.document?.querySelector<HTMLButtonElement>('[data-session-recap] button');
          if (recapButton?.isConnected) recapButton.focus();
          else if (dismissal.focusReturnTarget?.isConnected) dismissal.focusReturnTarget.focus();
        });
      }
      return dismissal.state;
    });
  }, []);
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
  useEffect(() => {
    setCeremonyState(createCeremonyQueueState());
  }, [currentOwnerId]);
  const learning = useAppLearningCoordination({
    library,
    courseScopeReady,
    viewMode,
    languageProfile,
    coursePort,
    setViewMode,
    setPracticeMenuOpen: setIsPracticeMenuOpen,
    rememberOpener,
    shareOpenerRef,
    reportError: setError,
    notify: setNotice,
    offerUndo,
    onCeremony: enqueueCeremony,
  });
  const {
    user,
    libraryEpochState,
    librarySession,
    shellSyncStatus,
    isBrowserOnline,
    isExporting,
    cloudStats,
  } = library.model;
  const libraryActions = library.actions;
  const { cloud, identity, owner: libraryOwner } = librarySession;
  useEffect(() => {
    if (cloud.ownerId !== currentOwnerId || cloud.statsSettledRequestId == null) return;
    const settledRequestId = cloud.statsSettledRequestId;
    setInsightsRefreshRequest(request => request?.ownerId === currentOwnerId && request.targetLanguage === targetLanguage && request.requestId <= settledRequestId ? null : request);
    setWeeklyRecapRequest(request => request?.ownerId === currentOwnerId && request.targetLanguage === targetLanguage && request.requestId < settledRequestId ? null : request);
  }, [cloud.ownerId, cloud.statsSettledRequestId, currentOwnerId, targetLanguage]);
  const onboardingLibrary = useOnboardingLibraryState({
    ownerId: currentOwnerId,
    cloud,
    needsOnboarding: currentCourseSession?.model.source === 'absent',
    canClassify: courseScopeReady && visible && viewMode !== 'landing' && !shellSyncStatus.isCheckingCloud,
  });
  const {
    libraryScreen,
    practiceSession,
    customDecks,
    intakeSharing,
    isLibraryBusy,
    canClearLibrary,
    equipFrame,
    equippedFrameId,
    ownedTitleIds,
  } = learning.model;
  const { intakeSharing: intakeActions, practice: practiceActions, deleteCard } = learning.actions;
  const { share } = intakeSharing;
  const isShareModalOpen = share.isShareDialogOpen || share.isLoading;
  const handlePracticeStageKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (practiceSession.mode !== 'study' || practiceSession.study.isPaused || event.defaultPrevented || event.nativeEvent.isComposing) return;
    const target = event.target as { closest?: (selectors: string) => Element | null } | null;
    if (target?.closest?.('button, a, input, select, textarea, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [data-radix-popper-content-wrapper]')) return;
    const study = practiceSession.study;
    const shortcut = studyShortcut(event);
    if (shortcut === 'reveal') {
      event.preventDefault();
      playFlipSound();
      practiceActions.reveal();
    } else if (shortcut === 'next') {
      event.preventDefault();
      practiceActions.setStudyIndex(Math.min(study.cards.length - 1, study.index + 1));
    } else if (shortcut === 'previous') {
      event.preventDefault();
      practiceActions.setStudyIndex(Math.max(0, study.index - 1));
    } else if (shortcut && shortcut !== 'bookmark') {
      event.preventDefault();
      void practiceActions.submitStudyRating(shortcut);
    } else if (shortcut === 'bookmark') {
      const card = study.cards[study.index];
      if (!card) return;
      event.preventDefault();
      if (!card.bookmarked) playRewardSound();
      void practiceSession.learning.toggleBookmark(card.id);
    }
  }, [practiceActions, practiceSession]);
  const libraryReady = !!(
    courseScopeReady
    && user
    && libraryOwner.ownerId === user.uid
    && libraryOwner.status === 'ready'
  );
  useBrowserExtensionImport({
    ownerId: currentOwnerId,
    identityLoading: identity.status === 'loading',
    customDecks,
    libraryReady,
    isBusy: isLibraryBusy,
    changeDraft: intakeActions.changeDraft,
    generate: intakeActions.generate,
    openLibrary: () => setViewMode('library'),
    notify: setNotice,
    reportError: setError,
    ensureCaptureCourse: ensureExtensionCaptureCourse,
    courseNativeLanguage: activeCourse ? activeCourseNativeLanguage(activeCourse) : null,
    courseTargetLanguage: activeCourse ? activeCourseTargetLanguage(activeCourse) : null,
  });
  useExtensionDueCountBridge({ ownerId: currentOwnerId, ready: libraryReady, dueCount: cloudStats.due });
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
      libraryActions.signIn,
    );
  }, [libraryActions.signIn, onSignInRequestHandled, signInRequest]);
  const openClearConfirm = (focusReturnTarget: HTMLButtonElement) =>
    openClearOverlay(focusReturnTarget, canClearLibrary);
  const handleSignIn = async () => { await libraryActions.signIn(); };
  const handleSignOut = async () => { await libraryActions.signOut(); };
  const handleRetrySync = async () => {
    if (isRetryingSync) return;
    setIsRetryingSync(true);
    setError(current => current === cloud.error ? null : current);
    try {
      await libraryActions.retrySync();
    } catch {
      setError(_(msg({ id: 'shell.sync.retry-failed', message: 'Sync could not finish. Your changes remain on this device. Try again.' })));
    } finally {
      setIsRetryingSync(false);
    }
  };

  if (!visible) return null;
  if (identity.status !== 'loading' && !user && viewMode !== 'landing') return null;
  const shellViewMode = viewMode === 'language-drill' ? 'spelling' : viewMode;
  const activeCeremony = ceremonyState.queue[0];
  const stats = libraryScreen.overlays.stats;
  const insightsPhase = currentOwnerId ? libraryInsightsPhase({
    ownerMatches: cloud.ownerId === currentOwnerId,
    isLoading: cloud.isStatsLoading,
    statsTargetMatches: cloud.statsTargetLanguage === targetLanguage,
    error: cloud.error,
  }) : 'ready';
  const overview = libraryScreen.model.overview;
  const libraryNavigation = libraryScreen.navigation;
  const libraryCountLabel = courseScopeReady ? libraryNavigation.libraryCountLabel : '';

  return (
    <CourseProvider ownerId={currentOwnerId}>
    <CourseSessionBridge onSnapshot={setCourseSession} />
    <div ref={appShellRef} data-view={viewMode} className={`app-canvas claude-app-shell min-h-dvh h-dvh text-[var(--sf-text)] font-sans flex flex-col overflow-hidden transition-colors relative ${isDarkMode ? 'dark' : ''}`}>
      <SkipToContentLink />
      <OnboardingGate ownerId={currentOwnerId} suppress={!courseScopeReady || viewMode === 'landing' || shellSyncStatus.isCheckingCloud}
        {...onboardingLibrary} />

      <DesktopNavigation
        {...desktopNavigationActions(setViewMode)}
        {...desktopCourseProps(
          courseScopeReady,
          libraryCountLabel,
          overview,
          evidencedStudyStreak(overview.streak, stats.xpChartData, undefined, stats.rewardTimeZone),
          equippedFrameId,
          ownedTitleIds,
        )}
        navigationRef={navigationRef}
        viewMode={shellViewMode}
        syncIdentity={syncIdentityForShell(identity, user, appDependencies.configuration.cloudConfigured)}
        syncStatus={shellSyncStatus}
        isDarkMode={isDarkMode}
        isExporting={isExporting}
        isLibraryMutationPending={isLibraryBusy}
        onSignIn={handleSignIn}
        onSignOut={handleSignOut}
        onRetrySync={handleRetrySync}
        isRetryingSync={isRetryingSync}
        sessionLost={!!identity.authenticationRecovery}
        canSyncNow={identity.status === 'authenticated' && !identity.authenticationRecovery && isBrowserOnline && !!user}
        onExportLibrary={courseScopeReady ? libraryActions.exportLibrary : undefined}
        onClearLibrary={courseScopeReady ? openClearConfirm : undefined}
        onOpenInsights={courseScopeReady ? openStats : undefined}
      />

      <AppFeedback
        authError={user && !identity.authenticationRecovery ? null : identity.error}
        sessionLost={identity.authenticationRecovery === 'session-lost'}
        isRetryingAuth={identity.isSigningIn}
        onRetryAuth={handleSignIn}
        error={isShareModalOpen && error === share.error ? null : error}
        notice={notice}
        syncStatus={shellSyncStatus}
        onDismissAuthError={libraryActions.clearAuthError}
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
          {shouldShowViewHeading(viewMode) && (
            <h1 ref={viewHeadingRef} tabIndex={-1} className="sr-only">{_(APP_VIEW_HEADINGS[viewMode])}</h1>
          )}
          <div ref={viewStageRef} data-app-view-stage className="min-h-full">
            {!courseScopeReady && user ? (courseSession?.model.ownerId === user.uid && courseSession.model.status === 'error'
              ? <div role="alert" className="rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface)] p-6 text-[var(--sf-text)]">
                  <p><Trans id="course.error.read" message="Courses could not be loaded." /></p>
                  <button type="button" onClick={() => void courseSession.actions.retry()} className="liquid-control mt-3 min-h-11 rounded-xl border border-[var(--sf-border)] px-4 font-bold"><Trans id="course.action.retry" message="Retry" /></button>
                </div>
              : <WorkspaceLoadingPanel><Trans id="course.loading" message="Preparing your courses…" /></WorkspaceLoadingPanel>) : <AppViewStage
              {...viewStageNavigationActions(setViewMode)}
              {...viewStageLearningProps(library, learning, setNotice)}
              {...viewStageStatsProps(stats, cloud, overview)}
              rewardTimeZone={stats.rewardTimeZone}
              viewMode={viewMode}
              ownerId={currentOwnerId}
              database={isFirebaseConfigured ? db : null}
              verifiedLibraryEpoch={user && libraryEpochState?.userId === user.uid ? libraryEpochState.value : null}
              languageProfile={languageProfile}
              isOffline={!isBrowserOnline}
              isDarkMode={isDarkMode}
              headingRef={viewHeadingRef}
              focusIntent={viewFocusIntent}
              openMorePractice={openPractice}
              openWeeklyRecap={openWeeklyRecap}
              weeklyRecapRequestOwnerId={activeWeeklyRecapRequest?.ownerId ?? null}
              weeklyRecapRequestSettled={weeklyRecapRequestSettled(activeWeeklyRecapRequest, cloud, targetLanguage, cloudStats)}
              onWeeklyRecapRequestConsumed={() => setWeeklyRecapRequest(null)}
              libraryContent={<AppDeferredLibraryView model={libraryScreen.model} actions={libraryScreen.actions} />}
              practiceContent={<AppDeferredPracticeView session={practiceSession} actions={practiceActions} customDecks={customDecks} openWeeklyRecap={openWeeklyRecap} onDeleteCard={deleteCard} />}
            />}
          </div>
        </div>
      </main>

      <AppFooter
        viewMode={shellViewMode}
        libraryCountLabel={libraryCountLabel}
        syncStatus={shellSyncStatus}
      />

      {courseScopeReady && <AppDeferredCreateCardDialog
        model={intakeSharing.cardCreator}
        actions={intakeActions.cardCreator}
        deckOptions={customDecks}
      />}

      {activeCeremony?.ownerId === currentOwnerId && (
        <Suspense fallback={dialogFallback}>
          <AnimeReveal
            open
            event={activeCeremony.event}
            payload={activeCeremony.payload}
            onContinue={dismissCeremony}
            onLater={dismissCeremony}
            onEquip={() => equipCeremonyFrame(equipFrame, dismissCeremony)}
          />
        </Suspense>
      )}

      {courseScopeReady && (hasMountedOverlays || isShareModalOpen || !!share.activeShareId) && (
        <Suspense fallback={dialogFallback}>
          <AppOverlays
            {...overlayLearningProps(learning)}
            {...overlayShareProps(learning)}
            {...overlayUiProps(
              isPracticeMenuOpen,
              setIsPracticeMenuOpen,
              isStatsOpen,
              setIsStatsOpen,
              stats,
              insightsPhase,
              cloud.error,
              retryInsights,
              isDarkMode,
              showClearConfirm,
              setShowClearConfirm,
            )}
            shareDialogOpen={isShareModalOpen}
            onDismissShareError={() => {
              intakeActions.clearShareError();
              setError(current => current === share.error ? null : current);
            }}
            acceptSharedDeck={async () => { await intakeActions.acceptShared(); }}
            canRevokeShare={!!share.activeShareId}
            revokeShare={async () => { await intakeActions.revokeShare(); }}
            shareOpenerRef={shareOpenerRef}
            practiceOpenerRef={overlayPracticeOpenerRef}
            statsOpenerRef={statsOpenerRef}
            clearOpenerRef={clearOpenerRef}
            onExportLibrary={libraryActions.exportLibrary}
            onOpenProgress={() => setViewMode('progress')}
          />
        </Suspense>
      )}

      {courseScopeReady && user && viewMode !== 'landing' && (
        <Suspense fallback={null}>
          <WebWordsRouteHost ownerId={user.uid} targetLanguage={targetLanguage} translationLanguage={languageProfile.target.code} />
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
