import { lazy, Suspense, type ReactNode, type RefObject } from 'react';
import type { CardData, ReviewRatingValue } from '../types/card';
import type { LibraryStatsViewModel } from '../features/library/libraryViewModel';
import type { AppViewMode } from '../features/navigation/useAppNavigation';
import { createDailyLearningLocation, readDailyLearningUrlState, type DailyLessonMode } from '../features/dailyLearning/dailyLearningUrl';
import type { IntakeSharingSessionActions } from '../features/intake/useIntakeSharingSession';

const CatalogWorkspace = lazy(() => import('../features/catalogWorkspace/CatalogWorkspace'));
const DailyLearningWorkspace = lazy(() => import('../features/dailyLearning/DailyLearningWorkspace'));
const ProgressWorkspace = lazy(() => import('../features/dailyLearning/ProgressWorkspace'));

interface AppViewStageProps {
  readonly viewMode: AppViewMode;
  readonly ownerId: string | null;
  readonly isOffline: boolean;
  readonly isDarkMode: boolean;
  readonly headingRef: RefObject<HTMLHeadingElement | null>;
  readonly stats: LibraryStatsViewModel;
  readonly isStatsLoading: boolean;
  readonly statsError: string | null;
  readonly loadPracticePool: (maximum?: number, includeFuture?: boolean) => Promise<CardData[]>;
  readonly reviewCard: (cardId: string, rating: ReviewRatingValue, operationId?: string, source?: CardData) => Promise<void>;
  readonly catalogCards: readonly CardData[];
  readonly adoptCatalogCards: IntakeSharingSessionActions['adoptCards'];
  readonly notifyCatalog: (message: string) => void;
  readonly openVocabulary: () => void;
  readonly openPaths: () => void;
  readonly continueReview: () => void | Promise<void>;
  readonly openMorePractice: (opener: HTMLButtonElement) => void;
  readonly libraryContent: ReactNode;
  readonly practiceContent: ReactNode;
}

const fallback = (message: string) => <div role="status" className="rounded-[26px] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-8 text-center">{message}</div>;

export function AppViewStage({
  viewMode, ownerId, isOffline, isDarkMode, headingRef, stats, isStatsLoading, statsError, loadPracticePool, reviewCard,
  catalogCards, adoptCatalogCards, notifyCatalog,
  openVocabulary, openPaths, continueReview, openMorePractice, libraryContent, practiceContent,
}: AppViewStageProps) {
  if (viewMode === 'catalog') return <Suspense fallback={fallback('Preparing learning paths…')}><CatalogWorkspace ownerId={ownerId} headingRef={headingRef} cards={catalogCards} adoptCards={adoptCatalogCards} notify={notifyCatalog} libraryStats={stats} openVocabulary={openVocabulary} continueReview={continueReview} /></Suspense>;
  if (viewMode === 'today') {
    const route = readDailyLearningUrlState(window.location.href);
    const openLesson = (lesson: DailyLessonMode | null) => {
      const location = createDailyLearningLocation(window.location.href, { view: 'today', lesson });
      if (lesson) window.history.pushState({}, '', location);
      else window.history.replaceState({}, '', location);
    };
    return <Suspense fallback={fallback('Preparing today’s learning plan…')}><DailyLearningWorkspace
      ownerId={ownerId} isOffline={isOffline} headingRef={headingRef} initialLesson={route.lesson}
      loadPracticePool={loadPracticePool} reviewCard={(cardId, rating, operationId, source) => reviewCard(cardId, rating, operationId, source)}
      openLesson={openLesson} openVocabulary={openVocabulary} openPaths={openPaths} continueReview={continueReview} openMorePractice={openMorePractice}
    /></Suspense>;
  }
  if (viewMode === 'progress') return <Suspense fallback={fallback('Preparing learning progress…')}><ProgressWorkspace darkMode={isDarkMode} isOffline={isOffline} headingRef={headingRef} stats={stats} isStatsLoading={isStatsLoading} statsError={statsError} /></Suspense>;
  if (viewMode === 'library') return libraryContent;
  return practiceContent;
}
