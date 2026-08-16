import { useCallback, useMemo, useRef, type RefObject } from 'react';
import { cardWordKey } from '../lib/cardIdentity';
import { getReducedMotionScrollBehavior } from '../lib/motion';
import type { CardData } from '../types/card';
import { useIntakeSharingSession } from '../features/intake/useIntakeSharingSession';
import { ENGLISH_TO_VIETNAMESE_PROFILE } from '../features/language/languageProfile';
import { useCustomDeckWorkspace } from '../features/library/useCustomDeckWorkspace';
import { useLibraryScreenContract } from '../features/library/useLibraryScreenContract';
import { canStartLibraryClear } from '../features/library/libraryMutationRecovery';
import { existingCardRevealState } from '../features/library/libraryPresentation';
import {
  cloudFacetsCacheKey,
  cloudPageCacheKey,
  cloudStatsCacheKey,
  isCloudBackoffActive,
  removeLocalValue,
} from '../features/library/libraryStorage';
import { useLearningWorkspace, type LearningWorkspaceActions } from '../features/learning/useLearningWorkspace';
import type { AppViewMode } from '../features/navigation/useAppNavigation';
import { usePracticeWorkspace } from '../features/practice/usePracticeWorkspace';
import { appDependencies } from './appDependencies';
import { useAppCardMediaCoordination } from './useAppCardMediaCoordination';
import { EMPTY_CLOUD_STATS, type AppLibraryRuntime } from './useAppLibraryRuntime';

interface UseAppLearningCoordinationOptions {
  library: AppLibraryRuntime;
  viewMode: AppViewMode;
  setViewMode(view: AppViewMode): void;
  setPracticeMenuOpen(open: boolean): void;
  setClearConfirm(open: boolean): void;
  rememberOpener(openerRef: RefObject<HTMLElement | null>): void;
  shareOpenerRef: RefObject<HTMLElement | null>;
  reportError(message: string | null): void;
  notify(message: string | null): void;
}

export function useAppLearningCoordination({
  library,
  viewMode,
  setViewMode,
  setPracticeMenuOpen,
  setClearConfirm,
  rememberOpener,
  shareOpenerRef,
  reportError,
  notify,
}: UseAppLearningCoordinationOptions) {
  const { model, actions, ports } = library;
  const { cards, cardsOwnerKey, user, cloudStats, knownLibraryTotal, libraryEpochState, ownerLibrary,
    librarySession, externalLibraryBusy, cardsPerPage, catalog } = model;
  const catalogActions = actions.catalog;
  const activeOwnerKey = user?.uid ?? null;
  const ownerScopedCards = useMemo(
    () => cardsOwnerKey === activeOwnerKey ? cards : [],
    [activeOwnerKey, cards, cardsOwnerKey],
  );
  const ownerScopedKnownTotal = cardsOwnerKey === activeOwnerKey ? knownLibraryTotal : 0;
  const ownerScopedCloudStats = cardsOwnerKey === activeOwnerKey ? cloudStats : EMPTY_CLOUD_STATS;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const learningActionsRef = useRef<LearningWorkspaceActions | null>(null);
  const practiceLearning = useMemo(() => ({
    reviewCard: (...args: Parameters<LearningWorkspaceActions['reviewCard']>) =>
      learningActionsRef.current?.reviewCard(...args) ?? Promise.resolve(),
    toggleBookmark: (...args: Parameters<LearningWorkspaceActions['toggleBookmark']>) =>
      learningActionsRef.current?.toggleBookmark(...args),
    assignDeck: (...args: Parameters<LearningWorkspaceActions['assignDeck']>) =>
      learningActionsRef.current?.assignDeck(...args),
    updateCard: (cardId: string, fields: Partial<CardData>) =>
      learningActionsRef.current?.updateCard(cardId, fields),
  }), []);
  const practiceWorkspace = usePracticeWorkspace({
    mode: viewMode === 'study' || viewMode === 'quiz' || viewMode === 'spelling' || viewMode === 'story'
      ? viewMode
      : 'library',
    openView: nextView => setViewMode(nextView),
    onSessionStarted: () => setPracticeMenuOpen(false),
    ownerId: user?.uid ?? null,
    cloudBackoffActive: Boolean(user && isCloudBackoffActive(user.uid)),
    cards: ownerScopedCards,
    cardsOwnerId: cardsOwnerKey,
    poolSource: appDependencies.practice.pool,
    gamificationStore: appDependencies.practice.gamification,
    learning: practiceLearning,
    languageProfile: ENGLISH_TO_VIETNAMESE_PROFILE,
    reportError,
  });
  const practiceSnapshotRef = practiceWorkspace.snapshotRef;
  ports.practicePublicationRef.current = practiceSnapshotRef.current;
  const { streak, xp, xpHistory, level, addXp } = practiceWorkspace.model.gamification;
  const {
    mediaHydration,
    updateCard: handleUpdateCard,
    imageUnavailable: handleImageUnavailable,
    publishCardPatch,
  } = useAppCardMediaCoordination({
    ownerKey: activeOwnerKey,
    cardsOwnerKey,
    cards: ownerScopedCards,
    cardsPerPage,
    viewMode,
    libraryPorts: ports,
    learningActionsRef,
    practiceSnapshotRef,
    reportError,
  });
  const learningCommands = useLearningWorkspace({
    owner: {
      id: activeOwnerKey,
      verifiedEpoch: user && libraryEpochState?.userId === user.uid ? libraryEpochState.value : null,
    },
    library: {
      knownTotal: ownerScopedKnownTotal,
      findCard: cardId => cardsOwnerKey === ports.activeOwnerIdRef.current
        ? ports.cardsRef.current.find(card => card.id === cardId)
        : undefined,
      isPatchCurrent: (cardId, expectedLifecycle) => !expectedLifecycle
        || mediaHydration.actions.isLifecycleCurrent(cardId, expectedLifecycle),
      publication: {
        patch: publishCardPatch,
        remove: cardId => {
          mediaHydration.actions.invalidateCard(cardId);
          ports.setCards(current => current.filter(card => card.id !== cardId));
        },
        clear: () => {
          ports.browser.actions.bumpHydrationSession();
          ports.cardsRef.current.forEach(card => mediaHydration.actions.invalidateCard(card.id));
          ports.setCards([]);
          ports.session.actions.owner.discardCards();
        },
      },
    },
    practice: {
      findCard: cardId => practiceSnapshotRef.current.findCard(cardId),
      publication: {
        patch: (cardId, fields) => practiceSnapshotRef.current.updateCard(cardId, fields),
        remove: cardId => practiceSnapshotRef.current.removeCard(cardId),
        clear: () => practiceSnapshotRef.current.clear(),
      },
    },
    ports: {
      patchDeviceCards: ports.session.ports.cards.patch,
      removeDeviceCard: ports.session.ports.cards.remove,
      flushDeviceCards: async logicalOperationId => {
        const report = await ports.session.ports.cloud.flush();
        return report.settlements.find(settlement =>
          settlement.ownerUserId === user?.uid
          && settlement.logicalOperationId === logicalOperationId,
        )?.outcome ?? 'deferred';
      },
      acknowledgeDevicePending: ports.session.ports.cards.acknowledge,
      acceptVerifiedEpoch: ports.session.actions.identity.acceptVerifiedOwnerEpoch,
      mutateCloudStats: ports.setCloudStats,
      resetCloudState: ports.sessionPorts.resetCloudState,
      resetCloudPage: () => catalogActions.goToPage(1),
      refreshCloud: ports.sessionPorts.refreshCloud,
      cloudAvailabilityChanged: ports.sessionPorts.markCloudUnavailable,
      mutationPendingChanged: ports.setLibraryMutationPending,
      reportError,
      addXp,
    },
  }, appDependencies.sessions.learningWorkspace).actions;
  learningActionsRef.current = learningCommands;
  const deckWorkspace = useCustomDeckWorkspace({
    identityReady: librarySession.identity.status !== 'loading',
    owner: {
      id: user?.uid ?? null,
      remoteAvailable: Boolean(appDependencies.configuration.cloudAvailable && user),
    },
    remoteDecks: user && ownerLibrary.ownerId === user.uid ? ownerLibrary.decks : null,
    cards: ownerScopedCards,
    activeDeck: catalog.deck,
    knownLibraryTotal: ownerScopedKnownTotal,
    mutations: appDependencies.adapters.ownerDecks,
    ports: {
      assignCard: learningCommands.assignDeck,
      patchDeviceCards: ports.session.ports.cards.patch,
      acknowledgeDevicePending: ports.session.ports.cards.acknowledge,
      publishCards: (cardIds, fields) => ports.setCards(previous => previous.map(card =>
        cardIds.has(card.id) ? { ...card, ...fields } : card)),
      publishPractice: (cardIds, fields) => practiceSnapshotRef.current.updateCards(cardIds, fields),
      chooseAllDecks: () => catalogActions.chooseDeck('All'),
      recoverCloud: (ownerId, message) => {
        removeLocalValue(cloudPageCacheKey(ownerId));
        removeLocalValue(cloudStatsCacheKey(ownerId));
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
  const resetSpreadsheetSource = useCallback(() => {
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);
  const sharingDependencies = useMemo(
    () => appDependencies.intake.forOwner(user?.uid ?? null),
    [user?.uid],
  );
  const intakeSharing = useIntakeSharingSession({
    ownerKey: user?.uid ?? null,
    intake: {
      ownerId: user?.uid ?? null,
      libraryEpoch: user && libraryEpochState?.userId === user.uid ? libraryEpochState.value : null,
      knownLibraryTotal: ownerScopedKnownTotal,
      cloudStats: ownerScopedCloudStats,
      cardsPerPage,
      getCards: () => cardsOwnerKey === ports.activeOwnerIdRef.current ? ports.cardsRef.current : [],
      publishCards: ports.setCards,
      upsertDeviceCards: ports.session.ports.cards.upsert,
      connectPendingCreateSettlement: ports.sessionPorts.connectPendingCreateSettlement,
      patchCard: handleUpdateCard,
      hydrateExisting: card => {
        void mediaHydration.actions.hydrateCard(card, { force: true, allowInactive: true }).catch(() => {
          reportError('The card image could not be saved. Please try again later.');
        });
      },
      rememberPromoted: card => ports.recentlyPromotedCardsRef.current.set(cardWordKey(card), card),
      resetCatalog: () => catalogActions.replaceQuery(existingCardRevealState()),
      resetCloudPage: () => {
        catalogActions.goToPage(1);
        ports.refreshCloud();
      },
      updateCloudStats: ports.setCloudStats,
      updateCloudTotal: ports.setCloudTotal,
      updateCategoryFacets: ports.updateCategoryFacets,
      setCloudUnavailable: ports.setCloudReadUnavailable,
      notify,
      focusLibrary: ports.browser.actions.requestLibraryFocus,
      addXp,
    },
    sharing: sharingDependencies,
    language: ENGLISH_TO_VIETNAMESE_PROFILE,
    resetSpreadsheetSource,
    feedback: { reportError, notify },
    externalBusy: externalLibraryBusy,
  }, appDependencies.sessions.intakeSharing);
  const isLibraryBusy = intakeSharing.model.isBusy;
  const shareCategory = async (category: string) => {
    rememberOpener(shareOpenerRef);
    return intakeSharing.actions.shareCategory(category);
  };
  const deleteCard = useCallback(async (id: string) => {
    try {
      await learningCommands.deleteCard(id);
    } catch (cause) {
      reportError(cause instanceof Error ? cause.message : 'The card could not be deleted. Please try again.');
    }
  }, [learningCommands, reportError]);
  const libraryScreen = useLibraryScreenContract({
    workspace: {
      catalog: { model: catalog, actions: catalogActions },
      session: {
        model: librarySession,
        actions: {
          ...ports.session.actions,
          owner: { migrateLegacy: actions.migrateLegacyCards, discardCards: ports.session.actions.owner.discardCards },
        },
      },
      intake: { model: intakeSharing.model, actions: { ...intakeSharing.actions, shareCategory } },
      learning: { actions: { ...learningCommands, deleteCard } },
    },
    library: {
      cards: ownerScopedCards,
      knownTotal: ownerScopedKnownTotal,
      usesCloudPagination: appDependencies.configuration.cloudAvailable,
      customDecks: deckWorkspace.model.decks,
      pageSize: cardsPerPage,
    },
    gamification: { streak, level, xp, xpHistory },
    ui: {
      isLibraryBusy,
      newDeckInput: deckWorkspace.model.newDeckInput,
      libraryHeadingRef: ports.browser.refs.libraryHeading,
      fileInputRef,
    },
    commands: {
      startStudy: practiceWorkspace.actions.startStudy,
      imageUnavailable: handleImageUnavailable,
      openCardCreator: () => {
        const scrollBehavior = getReducedMotionScrollBehavior();
        document.getElementById('library-tools')?.scrollIntoView({ behavior: scrollBehavior, block: 'start' });
        window.setTimeout(() => document.getElementById('new-word')?.focus(), scrollBehavior === 'auto' ? 0 : 350);
      },
      changeNewDeckInput: deckWorkspace.actions.changeNewDeckInput,
      createCustomDeck: deckWorkspace.actions.createDeck,
      deleteCustomDeck: deckWorkspace.actions.deleteDeck,
    },
  });
  const clearAll = async () => {
    if (!canStartLibraryClear(isLibraryBusy)) {
      reportError('Wait for the current card generation or import to finish before clearing the library.');
      return;
    }
    setClearConfirm(false);
    try {
      await learningCommands.clearLibrary();
    } catch (cause) {
      reportError(cause instanceof Error ? cause.message : 'The library could not be cleared. Please try again.');
    }
  };
  return {
    model: {
      libraryScreen,
      practiceSession: practiceWorkspace.model.session,
      customDecks: deckWorkspace.model.decks,
      intakeSharing: intakeSharing.model,
      isLibraryBusy,
      canClearLibrary: canStartLibraryClear(isLibraryBusy),
    },
    actions: {
      practice: practiceWorkspace.actions,
      imageUnavailable: handleImageUnavailable,
      intakeSharing: intakeSharing.actions,
      loadPracticePool: practiceWorkspace.ports.loadPracticePool,
      reviewCard: practiceLearning.reviewCard,
      clearAll,
    },
  };
}
