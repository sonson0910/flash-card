import { useCallback, useMemo, useRef, type RefObject } from 'react';
import { buildVocabularyImageQuery, fetchImageUrl, isRetryableImageSearchError, isSupportedImageUrl } from '../lib/images';
import { cardWordKey } from '../lib/cardIdentity';
import { db } from '../lib/firebase';
import { retainCardsForSession } from '../lib/sessionCards';
import type { CardData } from '../types/card';
import type { UndoToastItem } from '../components/ui/UndoToast';
import { useIntakeSharingSession } from '../features/intake/useIntakeSharingSession';
import type { LanguageProfile } from '../features/language/languageProfile';
import type { SharedDeckCoursePort } from '../features/sharing/shareCourseMatching';
import { useCardMediaHydration } from '../features/library/useCardMediaHydration';
import { useCustomDeckWorkspace } from '../features/library/useCustomDeckWorkspace';
import { useLibraryScreenContract } from '../features/library/useLibraryScreenContract';
import { canStartLibraryClear } from '../features/library/libraryMutationRecovery';
import { existingCardRevealState } from '../features/library/libraryPresentation';
import {
  cloudFacetsCacheKey,
  cloudPageCacheKey,
  removeCloudStatsCaches,
  clearImageNegativeCache,
  hasImageNegativeCache,
  isCloudBackoffActive,
  markImageNegativeCache,
  removeLocalValue,
} from '../features/library/libraryStorage';
import { useLearningWorkspace, type LearningWorkspaceActions } from '../features/learning/useLearningWorkspace';
import type { AppViewMode } from '../features/navigation/useAppNavigation';
import { usePracticeWorkspace } from '../features/practice/usePracticeWorkspace';
import type { CeremonyEvent, VerifiedGamificationOutcome } from '../features/gamification/verifiedGamificationClient';
import { appDependencies } from './appDependencies';
import type { AppLibraryRuntime } from './useAppLibraryRuntime';
import { useLibraryMutationFeedback } from './use-library-mutation-feedback';
export interface LearningCeremony {
  ownerId: string; operationId: string; events: readonly CeremonyEvent[];
  card?: Pick<CardData, 'word' | 'translation' | 'imageUrl'>; gamification?: VerifiedGamificationOutcome;
}
interface UseAppLearningCoordinationOptions {
  library: AppLibraryRuntime;
  viewMode: AppViewMode;
  /** Active course's language pair; defaults to English-Vietnamese for legacy users with no active course. */
  languageProfile: LanguageProfile;
  /** Steers an incoming shared deck to the matching course before import; see CourseSessionBridge in AppRuntime.tsx. */
  coursePort: SharedDeckCoursePort | null;
  setViewMode(view: AppViewMode): void;
  setPracticeMenuOpen(open: boolean): void;
  setClearConfirm(open: boolean): void;
  rememberOpener(openerRef: RefObject<HTMLElement | null>): void;
  shareOpenerRef: RefObject<HTMLElement | null>;
  reportError(message: string | null): void;
  notify(message: string | null): void;
  offerUndo(ownerId: string | null, toast: UndoToastItem | null): void;
  onCeremony?(ceremony: LearningCeremony): void;
}
export function useAppLearningCoordination({
  library,
  viewMode,
  languageProfile,
  coursePort,
  setViewMode,
  setPracticeMenuOpen,
  setClearConfirm,
  rememberOpener,
  shareOpenerRef,
  reportError,
  notify,
  offerUndo,
  onCeremony,
}: UseAppLearningCoordinationOptions) {
  const { model, actions, ports } = library;
  const { cards, user, cloudStats, knownLibraryTotal, libraryEpochState, ownerLibrary, librarySession, externalLibraryBusy, cardsPerPage, catalog } = model;
  const offerCeremony = (operationId: string, events: readonly CeremonyEvent[] | undefined, card?: LearningCeremony['card'], gamification?: VerifiedGamificationOutcome) => {
    if (user?.uid && events?.length) onCeremony?.({ ownerId: user.uid, operationId, events, card, gamification });
  };
  const catalogActions = actions.catalog;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const learningActionsRef = useRef<LearningWorkspaceActions | null>(null);
  const practiceLearning = useMemo(() => ({
    reviewCard: (...args: Parameters<LearningWorkspaceActions['reviewCard']>) => learningActionsRef.current?.reviewCard(...args) ?? Promise.resolve({ status: 'no-active-owner' as const }),
    toggleBookmark: (...args: Parameters<LearningWorkspaceActions['toggleBookmark']>) => learningActionsRef.current?.toggleBookmark(...args),
    assignDeck: (...args: Parameters<LearningWorkspaceActions['assignDeck']>) => learningActionsRef.current?.assignDeck(...args),
    updateCard: (cardId: string, fields: Partial<CardData>) => learningActionsRef.current?.updateCard(cardId, fields) ?? Promise.resolve({ status: 'no-active-owner' as const }),
  }), []);
  const practiceWorkspace = usePracticeWorkspace({
    mode: viewMode === 'study' || viewMode === 'quiz' || viewMode === 'spelling' || viewMode === 'language-drill' || viewMode === 'story' || viewMode === 'match' || viewMode === 'shadowing'
      ? viewMode
      : 'library',
    openView: nextView => setViewMode(nextView),
    onSessionStarted: () => setPracticeMenuOpen(false),
    ownerId: user?.uid ?? null,
    cloudBackoffActive: Boolean(user && isCloudBackoffActive(user.uid)),
    cards,
    poolSource: appDependencies.practice.pool,
    gamificationDatabase: db,
    onCeremony: (outcome, operationId) => offerCeremony(operationId, outcome.events, undefined, outcome),
    learning: practiceLearning,
    languageProfile,
    reportError,
  });
  ports.practicePublicationRef.current = practiceWorkspace.snapshotRef.current;
  const { streak, xp, xpHistory, level, rewards, reviewActivityByLanguage, rewardTimeZone, acceptAuthoritativeOutcome, equipFrame } = practiceWorkspace.model.gamification;
  const mediaHydration = useCardMediaHydration({
    ownerKey: user?.uid ?? null,
    cards,
    enabled: viewMode === 'library',
    port: {
      hasMedia: card => isSupportedImageUrl(card.imageUrl) || (
        hasImageNegativeCache(user?.uid ?? null, card.id)
      ),
      fetchMedia: async card => {
        try {
          const context = {
            word: (card.normalizedWord || card.word).trim(),
            searchQuery: card.imageSearchQuery,
            category: card.category,
            partOfSpeech: card.partOfSpeech,
            explanation: card.explanation,
          };
          if (!context.word) return null;
          const imageUrl = await fetchImageUrl(context);
          if (!isSupportedImageUrl(imageUrl)) {
            markImageNegativeCache(user?.uid ?? null, card.id);
            return null;
          }
          const imageSearchQuery = card.imageSearchQuery?.trim() || buildVocabularyImageQuery(context);
          return { imageUrl, ...(imageSearchQuery ? { imageSearchQuery } : {}) };
        } catch (cause) {
          if (isRetryableImageSearchError(cause)) throw cause;
          console.warn('The missing card image could not be loaded yet.', cause);
          return null;
        }
      },
      previewCard: (cardId, fields) => ports.setCards(current =>
        current.map(card => card.id === cardId ? { ...card, ...fields } : card)),
      updateCard: async (cardId, fields, options) => {
        const promoted = ports.recentlyPromotedCardsRef.current.get(cardWordKey(options.source));
        if (promoted) {
          ports.recentlyPromotedCardsRef.current.set(cardWordKey(options.source), { ...promoted, ...fields });
        }
        await learningActionsRef.current?.updateCard(cardId, fields, options);
      },
    },
  });
  const learningCommands = useLearningWorkspace({
    owner: {
      id: user?.uid ?? null,
      verifiedEpoch: user && libraryEpochState?.userId === user.uid ? libraryEpochState.value : null,
    },
    library: {
      knownTotal: knownLibraryTotal,
      findCard: cardId => ports.cardsRef.current.find(card => card.id === cardId),
      isPatchCurrent: (cardId, expectedLifecycle) => !expectedLifecycle
        || mediaHydration.actions.isLifecycleCurrent(cardId, expectedLifecycle),
      publication: {
        restore: card => {
          ports.recentlyPromotedCardsRef.current.set(cardWordKey(card), card);
          ports.setCards(current =>
            retainCardsForSession([card, ...current.filter(candidate => candidate.id !== card.id)], cardsPerPage));
        },
        patch: (cardId, fields) => ports.setCards(current =>
          current.map(card => card.id === cardId ? { ...card, ...fields } : card)),
        remove: cardId => {
          mediaHydration.actions.invalidateCard(cardId);
          ports.setCards(current => current.filter(card => card.id !== cardId));
        },
        clear: () => {
          ports.browser.actions.bumpHydrationSession();
          ports.cardsRef.current.forEach(card => mediaHydration.actions.invalidateCard(card.id));
          ports.setCards([]);
          offerUndo(user?.uid ?? null, null);
        },
      },
    },
    practice: {
      findCard: cardId => practiceWorkspace.snapshotRef.current.findCard(cardId),
      publication: {
        restore: card => practiceWorkspace.snapshotRef.current.restoreCard(card),
        patch: (cardId, fields) => practiceWorkspace.snapshotRef.current.updateCard(cardId, fields),
        remove: cardId => practiceWorkspace.snapshotRef.current.removeCard(cardId),
        clear: () => practiceWorkspace.snapshotRef.current.clear(),
      },
    },
    ports: {
      acceptVerifiedEpoch: ports.session.actions.identity.acceptVerifiedOwnerEpoch,
      mutateCloudStats: ports.setCloudStats,
      publishCategoryFacets: ports.updateCategoryFacets,
      resetCloudState: ports.sessionPorts.resetCloudState,
      resetCloudPage: () => catalogActions.goToPage(1),
      refreshCloud: ports.sessionPorts.refreshCloud,
      cloudAvailabilityChanged: ports.sessionPorts.markCloudUnavailable,
      mutationPendingChanged: ports.setLibraryMutationPending,
      reportError,
      onReviewOutcome: (outcome, operationId, card) => {
        if (outcome.gamification) acceptAuthoritativeOutcome(outcome.gamification);
        offerCeremony(operationId, outcome.ceremonyEvents, card, outcome.gamification);
      },
    },
  }, appDependencies.sessions.learningWorkspace).actions;
  learningActionsRef.current = learningCommands;
  const deckWorkspace = useCustomDeckWorkspace({
    identityReady: librarySession.identity.status !== 'loading',
    owner: {
      id: user?.uid ?? null,
      remoteAvailable: Boolean(appDependencies.configuration.cloudAvailable && user && librarySession.identity.canPublishMutations),
    },
    remoteDecks: user && ownerLibrary.ownerId === user.uid ? ownerLibrary.decks : null,
    remoteCoverPresets: user && ownerLibrary.ownerId === user.uid ? ownerLibrary.coverPresets : null,
    cards,
    activeDeck: catalog.deck,
    knownLibraryTotal,
    mutations: appDependencies.adapters.ownerDecks,
    ports: {
      assignCard: learningCommands.assignDeck,
      publishCards: (cardIds, fields) => ports.setCards(previous => previous.map(card =>
        cardIds.has(card.id) ? { ...card, ...fields } : card)),
      publishPractice: (cardIds, fields) => practiceWorkspace.snapshotRef.current.updateCards(cardIds, fields),
      chooseAllDecks: () => catalogActions.chooseDeck('All'),
      recoverCloud: (ownerId, message) => {
        removeLocalValue(cloudPageCacheKey(ownerId));
        removeCloudStatsCaches(ownerId);
        removeLocalValue(cloudFacetsCacheKey(ownerId));
        if (ports.activeOwnerIdRef.current !== ownerId) return;
        ports.setCloudReadUnavailable(true);
        catalogActions.goToPage(1);
        ports.refreshCloud();
        reportError(message);
      },
      reportError,
      warn: (message, cause) => console.warn(message, cause),
    },
  });
  const handleUpdateCard = useCallback(async (
    cardId: string,
    updatedFields: Partial<CardData>,
    explicitSource?: CardData,
    expectedLifecycle?: string,
  ) => {
    await learningCommands.updateCard(cardId, updatedFields, { source: explicitSource, expectedLifecycle });
  }, [learningCommands]);
  const resetSpreadsheetSource = useCallback(() => { if (fileInputRef.current) fileInputRef.current.value = ''; }, []);
  const sharingDependencies = useMemo(
    () => appDependencies.intake.forOwner(user?.uid ?? null, languageProfile.source.code),
    [user?.uid, languageProfile],
  );
  const intakeSharing = useIntakeSharingSession({
    ownerKey: user?.uid ?? null,
    intake: {
      ownerId: user?.uid ?? null,
      libraryEpoch: user && libraryEpochState?.userId === user.uid ? libraryEpochState.value : null,
      knownLibraryTotal,
      cloudStats,
      cardsPerPage,
      languageProfile,
      getCards: () => ports.cardsRef.current,
      publishCards: ports.setCards,
      patchCard: handleUpdateCard,
      hydrateExisting: card => {
        clearImageNegativeCache(user?.uid ?? null, card.id);
        void mediaHydration.actions.hydrateCard(card, { force: true, allowInactive: true });
      },
      rememberPromoted: card => ports.recentlyPromotedCardsRef.current.set(cardWordKey(card), card),
      resetCatalog: () => catalogActions.replaceQuery(existingCardRevealState()),
      resetCloudPage: () => { catalogActions.goToPage(1); ports.refreshCloud(); },
      updateCloudStats: ports.setCloudStats,
      updateCloudTotal: ports.setCloudTotal,
      updateCategoryFacets: ports.updateCategoryFacets,
      setCloudUnavailable: ports.setCloudReadUnavailable,
      notify,
      focusLibrary: ports.browser.actions.requestLibraryFocus,
      acceptGamificationOutcome: (outcome, operationId) => {
        acceptAuthoritativeOutcome(outcome);
        offerCeremony(operationId, outcome.events, undefined, outcome);
      },
    },
    sharing: sharingDependencies,
    coursePort,
    language: languageProfile,
    resetSpreadsheetSource,
    feedback: { reportError, notify },
    externalBusy: externalLibraryBusy,
  }, appDependencies.sessions.intakeSharing);
  const isLibraryBusy = intakeSharing.model.isBusy;
  const shareCategory = async (category: string) => {
    rememberOpener(shareOpenerRef);
    return intakeSharing.actions.shareCategory(category);
  };
  const { deleteCard, clearAll } = useLibraryMutationFeedback({
    ownerId: user?.uid ?? null, activeOwnerIdRef: ports.activeOwnerIdRef,
    commands: learningCommands, isLibraryBusy, setClearConfirm, reportError, offerUndo,
  });
  const libraryScreen = useLibraryScreenContract({
    workspace: {
      catalog: { model: catalog, actions: catalogActions },
      session: {
        model: librarySession,
        actions: {
          ...ports.session.actions,
          owner: { migrateLegacy: actions.migrateLegacyCards },
        },
      },
      intake: { model: intakeSharing.model, actions: { ...intakeSharing.actions, shareCategory } },
      learning: { actions: { ...learningCommands, deleteCard } },
    },
    library: {
      cards,
      knownTotal: knownLibraryTotal,
      usesCloudPagination: appDependencies.configuration.cloudAvailable,
      customDecks: deckWorkspace.model.decks,
      customDeckCoverPresets: deckWorkspace.model.coverPresets,
      pageSize: cardsPerPage,
    },
    gamification: { streak, level, xp, xpHistory, reviewActivityByLanguage, targetLanguage: languageProfile.source.code, rewardTimeZone },
    ui: {
      isLibraryBusy,
      newDeckInput: deckWorkspace.model.newDeckInput,
      libraryHeadingRef: ports.browser.refs.libraryHeading,
      fileInputRef,
    },
    commands: {
      startStudy: practiceWorkspace.actions.startStudy,
      openPaths: () => setViewMode('catalog'),
      openCardCreator: () => {
        const opener = document.activeElement;
        intakeSharing.actions.cardCreator.open(opener instanceof HTMLElement ? opener : undefined);
      },
      changeNewDeckInput: deckWorkspace.actions.changeNewDeckInput,
      createCustomDeck: deckWorkspace.actions.createDeck,
      deleteCustomDeck: deckWorkspace.actions.deleteDeck,
    },
  });
  return {
    model: {
      libraryScreen,
      practiceSession: practiceWorkspace.model.session,
      equipFrame, equippedFrameId: rewards.equippedFrameId, ownedTitleIds: rewards.ownedTitleIds,
      customDecks: deckWorkspace.model.decks,
      intakeSharing: intakeSharing.model,
      isLibraryBusy,
      canClearLibrary: canStartLibraryClear(isLibraryBusy),
    },
    actions: {
      practice: practiceWorkspace.actions,
      intakeSharing: intakeSharing.actions,
      loadPracticePool: practiceWorkspace.ports.loadPracticePool,
      reviewCard: practiceLearning.reviewCard,
      clearAll,
    },
  };
}
