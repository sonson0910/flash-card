import { useRef, type RefObject } from 'react';
import { useLingui } from '@lingui/react';
import type { CardData } from '../../types/card';
import { ENGLISH_TO_VIETNAMESE_PROFILE, type LanguageProfile } from '../language/languageProfile';
import type {
  LibraryCatalogActions,
  LibraryCatalogModel,
} from '../catalog/useLibraryCatalogQuery';
import type {
  IntakeSharingSessionActions,
  IntakeSharingSessionModel,
} from '../intake/useIntakeSharingSession';
import type { CardGenerationOptions } from '../intake/cardIntakeController';
import type { LearningWorkspaceActions } from '../learning/useLearningWorkspace';
import type {
  LibrarySessionActions,
  LibrarySessionModel,
} from '../librarySession/useLibrarySession';
import type { PracticeStudyStartOptions } from '../practice/usePracticeSession';
import { existingCardRevealState } from './libraryPresentation';
import type { CoverPreset } from './customDecks';
import {
  buildLibraryViewModel,
  type LibraryStatsViewModel,
} from './libraryViewModel';
import type { ReviewActivity } from '../gamification/verifiedGamificationClient';
import type { LibraryScreenActions, LibraryScreenModel } from './LibraryScreen';
import {
  resolveAiGenerationAccess,
  type AiGenerationRuntime,
} from './aiGenerationAccess';

export interface LibraryScreenWorkspaceInput {
  catalog: { model: LibraryCatalogModel; actions: LibraryCatalogActions };
  session: { model: LibrarySessionModel; actions: LibrarySessionActions };
  intake: { model: IntakeSharingSessionModel; actions: IntakeSharingSessionActions };
  learning: {
    actions: Pick<LearningWorkspaceActions, 'toggleBookmark' | 'assignDeck' | 'updateCard' | 'bulkPatchCards'> & {
      deleteCard(cardId: string): Promise<boolean | void>;
    };
  };
}

export interface LibraryScreenLibraryInput {
  cards: CardData[];
  knownTotal: number;
  usesCloudPagination: boolean;
  customDecks: string[];
  customDeckCoverPresets?: Record<string, CoverPreset>;
  pageSize: number;
}

export interface LibraryScreenGamificationInput {
  streak: number;
  level: number;
  xp: number;
  xpHistory: Record<string, number>;
  reviewActivityByLanguage?: Readonly<Record<string, ReviewActivity>>;
  targetLanguage?: string;
  rewardTimeZone?: string;
}

export interface LibraryScreenUiInput {
  isLibraryBusy: boolean;
  newDeckInput: string;
  aiGenerationRuntime?: AiGenerationRuntime;
  libraryHeadingRef?: RefObject<HTMLHeadingElement | null>;
  fileInputRef?: RefObject<HTMLInputElement | null>;
  languageProfile?: LanguageProfile;
}

export interface LibraryScreenCommandInput {
  startStudy(request?: PracticeStudyStartOptions): Promise<void>;
  openCardCreator(): void;
  openPaths(): void;
  changeNewDeckInput(value: string): void;
  createCustomDeck(name: string, preset?: CoverPreset): Promise<void>;
  deleteCustomDeck(name: string): Promise<void>;
}

export interface LibraryScreenContractInput {
  workspace: LibraryScreenWorkspaceInput;
  library: LibraryScreenLibraryInput;
  gamification: LibraryScreenGamificationInput;
  ui: LibraryScreenUiInput;
  commands: LibraryScreenCommandInput;
}

export interface LibraryScreenNavigationContract {
  canUseVisibleLibrary: boolean;
  practiceLibraryCount: number;
  libraryCountLabel: string;
}

export interface LibraryScreenOverlayContract {
  visibleLibraryCount: number;
  stats: LibraryStatsViewModel;
}

export interface LibraryScreenContract {
  model: LibraryScreenModel;
  actions: LibraryScreenActions;
  navigation: LibraryScreenNavigationContract;
  overlays: LibraryScreenOverlayContract;
}

export function buildLibraryScreenContract({
  workspace,
  library,
  gamification,
  ui,
  commands,
}: LibraryScreenContractInput): LibraryScreenContract {
  const { catalog, session, intake, learning } = workspace;
  const identity = session.model.identity;
  const ownerId = identity.owner?.id ?? null;
  const isAuthenticated = ownerId !== null;
  const cloud = session.model.cloud;
  const owner = session.model.owner;
  const query = catalog.model;
  const view = buildLibraryViewModel({
    cards: library.cards,
    isAuthenticated,
    usesCloudPagination: library.usesCloudPagination,
    cloudTotal: cloud.total,
    cloudStats: cloud.stats,
    cloudCategoryCounts: cloud.facets,
    cloudFacetsComplete: cloud.facetsComplete,
    cloudReadUnavailable: cloud.cloudUnavailable,
    query: {
      category: query.category,
      customDeck: query.deck,
      date: query.date,
      difficulty: query.difficulty,
      partOfSpeech: query.partOfSpeech,
      starredOnly: query.starred,
      search: query.search,
    },
    currentPage: query.page,
    pageSize: library.pageSize,
    hasNextCloudPage: cloud.hasNext,
    knownLibraryTotal: library.knownTotal,
    xpHistory: gamification.xpHistory,
    reviewActivity: gamification.targetLanguage ? gamification.reviewActivityByLanguage?.[gamification.targetLanguage] : undefined,
    rewardTimeZone: gamification.rewardTimeZone,
  });
  const libraryCount = view.counts.total;
  const visibleLibraryCount = view.counts.visible;
  const activeOwnerModel = isAuthenticated && owner.ownerId === ownerId;
  const practiceDeck: PracticeStudyStartOptions['customDeck'] = query.deck;

  const model: LibraryScreenModel = {
    isAuthenticated,
    ownerId,
    overview: {
      total: libraryCount,
      due: view.difficultySummary.due,
      mastered: view.difficultySummary.easy,
      streak: gamification.streak,
      level: gamification.level,
      xp: gamification.xp,
      canStudy: visibleLibraryCount > 0,
    },
    grid: {
      searchQuery: query.search,
      legacyCardsPending: activeOwnerModel ? owner.legacyPending : 0,
      legacyIssue: activeOwnerModel ? owner.legacyIssue : null,
      isMigratingLegacy: Boolean(activeOwnerModel && owner.isMigratingLegacy),
      libraryHeadingRef: ui.libraryHeadingRef,
      activeCategory: query.category,
      activeCustomDeck: query.deck,
      filteredCards: view.filteredCards,
      isSharing: intake.model.share.isLoading,
      currentPage: query.page,
      paginatedCards: view.paginatedCards,
      isPageLoading: Boolean(isAuthenticated && cloud.isLoading),
      cloudReadUnavailable: cloud.cloudUnavailable,
      importProgress: intake.model.importProgress,
      groupedCards: view.groupedCards,
      customDecks: library.customDecks,
      customDeckCoverPresets: library.customDeckCoverPresets,
      totalPages: view.counts.totalPages,
      hasNextCloudPage: cloud.hasNext,
      libraryCount,
    },
    tools: {
      fileInputRef: ui.fileInputRef,
      wordInput: intake.model.draft,
      isLoading: ui.isLibraryBusy,
      isGenerating: intake.model.isSubmitting,
      isImporting: intake.model.isImporting,
      generationAccess: resolveAiGenerationAccess({
        runtime: ui.aiGenerationRuntime
          ?? (import.meta.env.DEV ? 'direct-development' : 'protected-production'),
        isAuthenticated,
      }),
      importProgress: intake.model.importProgress,
      importResult: intake.model.importResult,
      libraryCount,
      searchQuery: query.search,
      showStarredOnly: query.starred,
      activeDifficulty: query.difficulty,
      activePartOfSpeech: query.partOfSpeech,
      activeDate: query.date,
      availableDates: view.availableDates,
      customDecks: library.customDecks,
      customDeckCoverPresets: library.customDeckCoverPresets,
      newDeckInput: ui.newDeckInput,
      activeCustomDeck: query.deck,
      cards: library.cards,
      cloudFacetsComplete: cloud.facetsComplete,
      sortedCategories: view.sortedCategories,
      categoryCounts: view.categoryCounts,
      activeCategory: query.category,
      languageProfile: ui.languageProfile ?? ENGLISH_TO_VIETNAMESE_PROFILE,
      ownerId,
    },
  };

  const actions: LibraryScreenActions = {
    startStudy: () => commands.startStudy({ customDeck: practiceDeck }),
    openCardCreator: commands.openCardCreator,
    grid: {
      changeSearch: catalog.actions.changeSearch,
      migrateLegacyCards: async () => { await session.actions.owner.migrateLegacy(); },
      shareCategory: async () => {
        await intake.actions.shareCategory({ category: query.category, customDeck: query.deck });
      },
      deleteCard: learning.actions.deleteCard,
      toggleBookmark: learning.actions.toggleBookmark,
      assignDeck: learning.actions.assignDeck,
      bulkPatchCards: learning.actions.bulkPatchCards,
      updateCard: learning.actions.updateCard,
      changePage: catalog.actions.goToPage,
      clearFilters: () => catalog.actions.replaceQuery(existingCardRevealState()),
    },
    tools: {
      openPaths: commands.openPaths,
      importCards: event => { void intake.actions.importFile(event.target.files?.[0] ?? null); },
      importFile: file => { void intake.actions.importFile(file); },
      generateCard: async (event, options?: CardGenerationOptions) => {
        event.preventDefault();
        commands.openCardCreator();
        const requestedDeck = options?.requestedDeck
          ?? (query.deck.kind === 'deck' ? query.deck.name : undefined);
        if (requestedDeck) intake.actions.cardCreator.updateDraft({ deck: requestedDeck });
        await intake.actions.cardCreator.generatePreview();
      },
      changeWordInput: intake.actions.changeDraft,
      changeSearch: catalog.actions.changeSearch,
      changeStarredOnly: value => catalog.actions.toggleStarred(value),
      changeDifficulty: value => catalog.actions.chooseDifficulty(
        value as LibraryCatalogModel['difficulty'],
      ),
      changePartOfSpeech: catalog.actions.choosePartOfSpeech,
      changeDate: catalog.actions.chooseDate,
      changeNewDeckInput: commands.changeNewDeckInput,
      createCustomDeck: commands.createCustomDeck,
      changeCustomDeck: value => {
        catalog.actions.replaceQuery({
          search: '',
          category: 'All',
          deck: value,
          difficulty: 'All',
          partOfSpeech: 'All',
          starred: false,
          date: 'All',
          page: 1,
        });
      },
      deleteCustomDeck: commands.deleteCustomDeck,
      changeCategory: catalog.actions.chooseCategory,
    },
  };

  return {
    model,
    actions,
    navigation: {
      canUseVisibleLibrary: visibleLibraryCount > 0,
      practiceLibraryCount: view.counts.practice,
      libraryCountLabel: view.countLabel,
    },
    overlays: {
      visibleLibraryCount,
      stats: view.stats,
    },
  };
}

export function createLibraryScreenContractBuilder() {
  let previousInput: LibraryScreenContractInput | null = null;
  let previousLocale: string | null = null;
  let previousContract: LibraryScreenContract | null = null;
  return {
    build(input: LibraryScreenContractInput, locale = 'en'): LibraryScreenContract {
      if (
        previousInput
        && previousContract
        && previousLocale === locale
        && previousInput.workspace === input.workspace
        && previousInput.library === input.library
        && previousInput.gamification === input.gamification
        && previousInput.ui === input.ui
        && previousInput.commands === input.commands
      ) {
        return previousContract;
      }
      previousInput = input;
      previousLocale = locale;
      previousContract = buildLibraryScreenContract(input);
      return previousContract;
    },
  };
}

export function useLibraryScreenContract(
  input: LibraryScreenContractInput,
): LibraryScreenContract {
  const { i18n } = useLingui();
  const builderRef = useRef<ReturnType<typeof createLibraryScreenContractBuilder> | null>(null);
  if (builderRef.current === null) builderRef.current = createLibraryScreenContractBuilder();
  return builderRef.current.build(input, i18n.locale);
}
