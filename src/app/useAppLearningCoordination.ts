import { useCallback, useMemo, useRef, type RefObject } from 'react';
import { buildVocabularyImageQuery, fetchImageUrl, isSupportedImageUrl } from '../lib/images';
import { getReducedMotionScrollBehavior } from '../lib/motion';
import { cardWordKey } from '../lib/cardIdentity';
import { retainCardsForSession } from '../lib/sessionCards';
import type { CardData } from '../types/card';
import { useIntakeSharingSession } from '../features/intake/useIntakeSharingSession';
import { ENGLISH_TO_VIETNAMESE_PROFILE } from '../features/language/languageProfile';
import { useCardMediaHydration } from '../features/library/useCardMediaHydration';
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
  writeLocalCardCache,
} from '../features/library/libraryStorage';
import { useLearningWorkspace, type LearningWorkspaceActions } from '../features/learning/useLearningWorkspace';
import type { AppViewMode } from '../features/navigation/useAppNavigation';
import { usePracticeWorkspace } from '../features/practice/usePracticeWorkspace';
import { appDependencies } from './appDependencies';
import type { AppLibraryRuntime } from './useAppLibraryRuntime';

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
  const { cards, user, cloudStats, knownLibraryTotal, libraryEpochState, ownerLibrary,
    librarySession, externalLibraryBusy, cardsPerPage, catalog } = model;
  const catalogActions = actions.catalog;
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
    cards,
    poolSource: appDependencies.practice.pool,
    gamificationStore: appDependencies.practice.gamification,
    learning: practiceLearning,
    languageProfile: ENGLISH_TO_VIETNAMESE_PROFILE,
    reportError,
  });
  const practiceSnapshotRef = practiceWorkspace.snapshotRef;
  ports.practicePublicationRef.current = practiceSnapshotRef.current;
  const { streak, xp, xpHistory, level, addXp } = practiceWorkspace.model.gamification;
  const mediaHydration = useCardMediaHydration({
    ownerKey: user?.uid ?? null,
    cards,
    enabled: viewMode === 'library',
    port: {
      hasMedia: card => isSupportedImageUrl(card.imageUrl),
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
          if (!isSupportedImageUrl(imageUrl)) return null;
          const imageSearchQuery = card.imageSearchQuery?.trim() || buildVocabularyImageQuery(context);
          return { imageUrl, ...(imageSearchQuery ? { imageSearchQuery } : {}) };
        } catch (cause) {
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
        patch: (cardId, fields) => ports.setCards(current => {
          const updated = current.map(card => card.id === cardId ? { ...card, ...fields } : card);
          writeLocalCardCache(
            retainCardsForSession(updated, Boolean(user), cardsPerPage),
            user?.uid ?? null,
          );
          return updated;
        }),
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
      acknowledgeDevicePending: ports.session.ports.cards.acknowledge,
      acceptVerifiedEpoch: ports.session.actions.identity.acceptVerifiedOwnerEpoch,
      mutateCloudStats: ports.setCloudStats,
      publishCategoryFacets: ports.updateCategoryFacets,
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
    cards,
    activeDeck: catalog.deck,
    knownLibraryTotal,
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
  const handleUpdateCard = useCallback(async (
    cardId: string,
    updatedFields: Partial<CardData>,
    explicitSource?: CardData,
    expectedLifecycle?: string,
  ) => {
    await learningCommands.updateCard(cardId, updatedFields, {
      source: explicitSource,
      expectedLifecycle,
    });
  }, [learningCommands]);
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
      knownLibraryTotal,
      cloudStats,
      cardsPerPage,
      getCards: () => ports.cardsRef.current,
      publishCards: ports.setCards,
      upsertDeviceCards: ports.session.ports.cards.upsert,
      acknowledgeDevicePending: ports.session.ports.cards.acknowledge,
      patchCard: handleUpdateCard,
      hydrateExisting: card => void mediaHydration.actions.hydrateCard(card, { force: true, allowInactive: true }),
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
      cards,
      knownTotal: knownLibraryTotal,
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
      intakeSharing: intakeSharing.actions,
      loadPracticePool: practiceWorkspace.ports.loadPracticePool,
      reviewCard: practiceLearning.reviewCard,
      clearAll,
    },
  };
}
