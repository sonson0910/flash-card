import { msg } from '@lingui/core/macro';
import type { I18n } from '@lingui/core';
import type { Dispatch, SetStateAction } from 'react';
import type { CourseNativeLanguage, CourseTargetLanguage } from '../features/courses/courseModel';
import { getLibraryCardTier } from '../features/library/libraryViewModel';
import type { AnimeRevealEventKind, AnimeRevealSourcePayload } from '../features/rewards/AnimeReveal';
import type { SharedDeckIncomingPreview } from '../features/sharing/sharedDeckSessionController';
import type { LearningCeremony } from './useAppLearningCoordination';
import type { useAppLearningCoordination } from './useAppLearningCoordination';
import type { useAppLibraryRuntime } from './useAppLibraryRuntime';

export interface QueuedCeremony {
  readonly ownerId: string;
  readonly operationId: string;
  readonly event: AnimeRevealEventKind;
  readonly payload: AnimeRevealSourcePayload;
  readonly focusReturnTarget: HTMLElement | null;
}

export interface CeremonyQueueState {
  readonly keys: ReadonlySet<string>;
  readonly queue: readonly QueuedCeremony[];
}

export const createCeremonyQueueState = (): CeremonyQueueState => ({ keys: new Set(), queue: [] });

export const queueCeremonies = (
  current: CeremonyQueueState,
  ceremonies: readonly QueuedCeremony[],
): CeremonyQueueState => {
  const keys = new Set(current.keys);
  const queued = ceremonies.filter(ceremony => {
    const key = `${ceremony.ownerId}:${ceremony.operationId}:${ceremony.event}`;
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  });
  return queued.length ? { keys, queue: [...current.queue, ...queued] } : current;
};

export const dismissQueuedCeremony = (current: CeremonyQueueState): {
  readonly state: CeremonyQueueState;
  readonly focusReturnTarget: HTMLElement | null;
} => {
  const [active, ...remaining] = current.queue;
  return {
    state: { ...current, queue: remaining },
    focusReturnTarget: active && remaining.length === 0 ? active.focusReturnTarget : null,
  };
};

export const orderCeremonyEvents = (events: readonly AnimeRevealEventKind[]): readonly AnimeRevealEventKind[] =>
  (['tierup', 'streak', 'levelup'] as const).filter(event => events.includes(event));

export const streakCeremonyRewardLabels = (translate: I18n['_']): readonly string[] => [
  translate(msg({ id: 'rewards.reveal.streak.badge', message: 'Web Wanderer' })),
];

export const ceremonyPayload = (
  ceremony: LearningCeremony,
  event: AnimeRevealEventKind,
  translate: I18n['_'],
): AnimeRevealSourcePayload => {
  if (event === 'tierup') {
    return {
      headword: ceremony.card?.word,
      translation: ceremony.card?.translation,
      imageUrl: ceremony.card?.imageUrl ?? undefined,
      previousValue: ceremony.card ? getLibraryCardTier(ceremony.card) : undefined,
      currentValue: 'mastered',
    };
  }
  if (event === 'streak') return {
    currentValue: ceremony.gamification ? String(ceremony.gamification.streak) : undefined,
    rewardLabels: streakCeremonyRewardLabels(translate),
  };
  return {
    previousValue: ceremony.gamification?.level === 13 ? '12' : undefined,
    currentValue: ceremony.gamification ? String(ceremony.gamification.level) : undefined,
    rewardLabels: [
      translate(msg({ id: 'rewards.reveal.level.frame', message: 'Crimson Wing frame' })),
      translate(msg({ id: 'rewards.reveal.level.title', message: 'Word Collector title' })),
      translate(msg({ id: 'rewards.reveal.level.hint', message: 'Hint tokens · limit 3' })),
    ],
  };
};

export const queueLearningCeremonies = (
  ceremony: LearningCeremony,
  focusReturnTarget: HTMLElement | null,
  translate: I18n['_'],
): readonly QueuedCeremony[] => orderCeremonyEvents(ceremony.events).map(event => ({
  ownerId: ceremony.ownerId,
  operationId: ceremony.operationId,
  event,
  payload: ceremonyPayload(ceremony, event, translate),
  focusReturnTarget,
}));

export const equipCeremonyFrame = async (
  equipFrame: (frameId: string) => Promise<void>,
  dismissCeremony: () => void,
): Promise<void> => {
  await equipFrame('crimson-wing');
  dismissCeremony();
};

export function libraryInsightsPhase({
  ownerMatches,
  isLoading,
  statsTargetMatches,
  error,
}: {
  ownerMatches: boolean;
  isLoading: boolean;
  statsTargetMatches: boolean;
  error: string | null;
}): 'loading' | 'ready' | 'failure' {
  if (!ownerMatches || isLoading) return 'loading';
  if (error) return 'failure';
  return statsTargetMatches ? 'ready' : 'loading';
}

export function statsRefreshForTarget<T extends { targetLanguage: string }>(request: T | null, targetLanguage: string): T | null {
  return request?.targetLanguage === targetLanguage ? request : null;
}

export function latestStatsRefresh<T extends { requestId: number }>(first: T | null, second: T | null): T | null {
  if (!first) return second;
  if (!second) return first;
  return first.requestId > second.requestId ? first : second;
}

export const extensionCapturePreview = (
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

export type StudyShortcut = 'reveal' | 'next' | 'previous' | 'again' | 'hard' | 'good' | 'easy' | 'bookmark';

export const studyShortcut = (event: {
  readonly key: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}): StudyShortcut | null => {
  if (event.ctrlKey || event.metaKey || event.shiftKey) return null;
  if (event.altKey) {
    if (event.key.toLocaleLowerCase() === 's') return 'bookmark';
    return (['again', 'hard', 'good', 'easy'] as const)[Number(event.key) - 1] ?? null;
  }
  if (event.key === ' ' || event.key === 'Space' || event.key === 'Spacebar' || event.key === 'Enter') return 'reveal';
  if (event.key === 'ArrowRight') return 'next';
  return event.key === 'ArrowLeft' ? 'previous' : null;
};

export const shouldShowViewHeading = (viewMode: string): boolean =>
  !['catalog', 'today', 'progress', 'settings'].includes(viewMode);

export const desktopNavigationActions = <T>(setViewMode: (view: T) => void) => ({
  onOpenLanding: () => setViewMode('landing' as T),
  onOpenToday: () => setViewMode('today' as T),
  onOpenLibrary: () => setViewMode('library' as T),
  onOpenCatalog: () => setViewMode('catalog' as T),
  onOpenProgress: () => setViewMode('progress' as T),
  onOpenSettings: () => setViewMode('settings' as T),
});

export const viewStageNavigationActions = <T>(setViewMode: (view: T) => void) => ({
  openVocabulary: () => setViewMode('library' as T),
  openPaths: () => setViewMode('catalog' as T),
});

export const practiceOverlayActions = <T extends {
  startQuiz: unknown;
  startSpelling: unknown;
  startLanguageDrill: unknown;
  startMatch: unknown;
  startShadowing: unknown;
  generateStory: unknown;
}>(actions: T): Pick<T, 'startQuiz' | 'startSpelling' | 'startLanguageDrill' | 'startMatch' | 'startShadowing' | 'generateStory'> => ({
  startQuiz: actions.startQuiz,
  startSpelling: actions.startSpelling,
  startLanguageDrill: actions.startLanguageDrill,
  startMatch: actions.startMatch,
  startShadowing: actions.startShadowing,
  generateStory: actions.generateStory,
}) as Pick<T, 'startQuiz' | 'startSpelling' | 'startLanguageDrill' | 'startMatch' | 'startShadowing' | 'generateStory'>;

export const syncIdentityForShell = <T extends {
  status: string;
  isSigningIn: boolean;
}, U extends {
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
}>(identity: T, user: U | null, isConfigured: boolean) => identity.status === 'loading'
  ? { status: 'loading' as const }
  : user
    ? {
        status: 'authenticated' as const,
        displayName: user.displayName,
        email: user.email,
        photoUrl: user.photoURL,
      }
    : {
        status: 'signed-out' as const,
        isConfigured,
        isSigningIn: identity.isSigningIn,
      };

export const weeklyRecapRequestSettled = <T extends {
  ownerId: string;
  requestId: number;
}>(request: T | null, cloud: {
  ownerId: string | null;
  error: string | null;
  statsTargetLanguage?: string | null;
  statsSettledRequestId?: number | null;
  stats: unknown;
  isStatsLoading: boolean;
}, targetLanguage: string, cloudStats: unknown): boolean => Boolean(
  request
  && cloud.ownerId === request.ownerId
  && (cloud.error || cloud.statsTargetLanguage === targetLanguage)
  && cloud.statsSettledRequestId === request.requestId
  && cloudStats === cloud.stats
  && !cloud.isStatsLoading,
);

type LearningRuntime = ReturnType<typeof useAppLearningCoordination>;
type LibraryRuntime = ReturnType<typeof useAppLibraryRuntime>;

export const viewStageLearningProps = (
  library: LibraryRuntime,
  learning: LearningRuntime,
  notify: Dispatch<SetStateAction<string | null>>,
) => ({
  loadPracticePool: learning.actions.loadPracticePool,
  reviewCard: learning.actions.reviewCard,
  catalogCards: library.model.cards,
  adoptCatalogCards: learning.actions.intakeSharing.adoptCards,
  notifyCatalog: notify,
  continueReview: learning.actions.practice.startStudy,
  continueCatalogUnit: learning.actions.continueCatalogUnit,
  onVerifiedPracticeOutcome: learning.actions.acceptPracticeOutcome,
});

export const overlayLearningProps = (learning: LearningRuntime) => ({
  ...practiceOverlayActions(learning.actions.practice),
  practiceCards: learning.model.libraryScreen.model.grid.filteredCards,
  visibleLibraryCount: learning.model.libraryScreen.navigation.practiceLibraryCount,
  clearAll: learning.actions.clearAll,
  clearStatus: learning.model.clearStatus,
  clearError: learning.model.clearError,
  resetClearFeedback: learning.actions.resetClearFeedback,
  isLoading: learning.model.isLibraryBusy,
});

export const overlayShareProps = (learning: LearningRuntime) => {
  const { share } = learning.model.intakeSharing;
  const actions = learning.actions.intakeSharing;
  return {
    shareLink: share.shareLink,
    shareWarning: share.shareWarning,
    shareExpiresAt: share.expiresAt,
    shareError: share.error,
    outgoingSharePreview: share.outgoingPreview,
    incomingSharePreview: share.incomingPreview,
    dismissShareDialog: actions.dismissShareLink,
    showShareDialog: actions.showShareDialog,
    cancelSharedDeck: actions.cancelShared,
    isSharing: share.isLoading,
  };
};

export const viewStageStatsProps = <T, S, U extends {
  stats: S;
  statsTargetLanguage?: string | null;
  isStatsLoading: boolean;
  error: string | null;
}, V extends { streak: number }>(stats: T, cloud: U, overview: V) => ({
  stats,
  cloudStats: cloud.stats,
  cloudStatsTargetLanguage: cloud.statsTargetLanguage,
  streak: overview.streak,
  isStatsLoading: cloud.isStatsLoading,
  statsError: cloud.error,
});

export const desktopCourseProps = <T extends {
  streak: number;
  level: number;
  xp: number;
}, U, V>(
  ready: boolean,
  libraryCountLabel: string,
  overview: T,
  evidencedStreak: number,
  equippedFrameId: U,
  ownedTitleIds: V,
) => ({
  libraryCountLabel,
  streak: ready ? evidencedStreak : 0,
  level: ready ? overview.level : 1,
  xp: ready ? overview.xp : 0,
  equippedFrameId: ready ? equippedFrameId : null,
  ownedTitleIds: ready ? ownedTitleIds : [],
});

export const overlayUiProps = <A, B, C, D, E, F>(
  isPracticeMenuOpen: boolean,
  setIsPracticeMenuOpen: A,
  isStatsOpen: boolean,
  setIsStatsOpen: B,
  statsData: C,
  insightsPhase: D,
  insightsError: string | null,
  onRetryInsights: E,
  isDarkMode: boolean,
  showClearConfirm: boolean,
  setShowClearConfirm: F,
) => ({
  isPracticeMenuOpen,
  setIsPracticeMenuOpen,
  isStatsOpen,
  setIsStatsOpen,
  statsData,
  insightsPhase,
  insightsError,
  onRetryInsights,
  isDarkMode,
  showClearConfirm,
  setShowClearConfirm,
});
