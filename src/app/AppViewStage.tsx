import { lazy, Suspense, type ReactNode, type RefObject } from 'react';
import type { Firestore } from 'firebase/firestore';
import type { CardData, ReviewRatingValue } from '../types/card';
import type { LibraryStatsViewModel } from '../features/library/libraryViewModel';
import type { CloudLibraryStats } from '../features/librarySession/cloudLibraryPageController';
import type { LanguageProfile } from '../features/language/languageProfile';
import type { AppViewMode } from '../features/navigation/useAppNavigation';
import { createDailyLearningLocation, readDailyLearningUrlState, type DailyLessonMode } from '../features/dailyLearning/dailyLearningUrl';
import type { IntakeSharingSessionActions } from '../features/intake/useIntakeSharingSession';
import type { LearningStateOutcome } from '../features/learning/learningStateController';
import type { PracticeGamificationOutcome } from '../features/practice/practiceSessionService';
import { getActiveUiLocale, loadCatalog } from '../i18n/loadCatalog';
import { Trans } from '@lingui/react';
import { WorkspaceLoadingPanel } from '../components/WorkspaceLoadingPanel';

const CatalogWorkspace = lazy(() => Promise.all([
  import('../features/catalogWorkspace/CatalogWorkspace'), loadCatalog(getActiveUiLocale(), 'catalog'),
]).then(([component]) => component));
const DailyLearningWorkspace = lazy(() => Promise.all([
  import('../features/dailyLearning/DailyLearningWorkspace'), loadCatalog(getActiveUiLocale(), 'today'),
]).then(([component]) => component));
const ProgressWorkspace = lazy(() => Promise.all([
  import('../features/dailyLearning/ProgressWorkspace'),
  loadCatalog(getActiveUiLocale(), 'progress'),
  loadCatalog(getActiveUiLocale(), 'today'),
]).then(([component]) => component));
const SettingsScreen = lazy(() => Promise.all([
  import('../features/settings/settings-screen'), loadCatalog(getActiveUiLocale(), 'settings'),
]).then(([component]) => component));

interface AppViewStageProps {
  readonly viewMode: AppViewMode;
  readonly ownerId: string | null;
  readonly database: Firestore | null;
  readonly verifiedLibraryEpoch: number | null;
  /** Active course's language pair; defaults to English-Vietnamese for legacy users with no active course. */
  readonly languageProfile: LanguageProfile;
  readonly isOffline: boolean;
  readonly isDarkMode: boolean;
  readonly headingRef: RefObject<HTMLHeadingElement | null>;
  readonly focusIntent: number;
  readonly stats: LibraryStatsViewModel;
  readonly cloudStats: CloudLibraryStats;
  readonly cloudStatsTargetLanguage?: string | null;
  readonly streak: number;
  readonly isStatsLoading: boolean;
  readonly statsError: string | null;
  readonly rewardTimeZone?: string;
  readonly loadPracticePool: (maximum?: number, includeFuture?: boolean) => Promise<CardData[]>;
  readonly reviewCard: (cardId: string, rating: ReviewRatingValue, operationId?: string, source?: CardData) => Promise<LearningStateOutcome>;
  readonly catalogCards: readonly CardData[];
  readonly adoptCatalogCards: IntakeSharingSessionActions['adoptCards'];
  readonly notifyCatalog: (message: string) => void;
  readonly openVocabulary: () => void;
  readonly openPaths: () => void;
  readonly continueReview: () => void | Promise<void>;
  readonly continueCatalogUnit: (cards: readonly CardData[], isCurrent: () => boolean) => Promise<'started' | 'stale' | 'partial' | 'unavailable'>;
  readonly openMorePractice: (opener: HTMLButtonElement) => void;
  readonly openWeeklyRecap: () => void;
  readonly onVerifiedPracticeOutcome: (outcome: PracticeGamificationOutcome, operationId: string, ownerId: string) => void;
  readonly weeklyRecapRequestOwnerId: string | null;
  readonly weeklyRecapRequestSettled: boolean;
  readonly onWeeklyRecapRequestConsumed: () => void;
  readonly libraryContent: ReactNode;
  readonly practiceContent: ReactNode;
}

const fallback = (message: ReactNode) => <WorkspaceLoadingPanel>{message}</WorkspaceLoadingPanel>;

export function AppViewStage({
  viewMode, ownerId, database, verifiedLibraryEpoch, languageProfile, isOffline, isDarkMode, headingRef, focusIntent, stats, cloudStats, cloudStatsTargetLanguage, streak, isStatsLoading, statsError, rewardTimeZone, loadPracticePool, reviewCard,
  catalogCards, adoptCatalogCards, notifyCatalog,
  openVocabulary, openPaths, continueReview, continueCatalogUnit, openMorePractice, openWeeklyRecap, onVerifiedPracticeOutcome, weeklyRecapRequestOwnerId, weeklyRecapRequestSettled, onWeeklyRecapRequestConsumed, libraryContent, practiceContent,
}: AppViewStageProps) {
  if (viewMode === 'catalog') return <Suspense fallback={fallback(<Trans id="shell.loading.paths" message="Preparing learning paths…" />)}><div className="async-content-enter" data-async-content="catalog"><CatalogWorkspace ownerId={ownerId} targetLanguage={languageProfile.source.code} database={database} verifiedLibraryEpoch={verifiedLibraryEpoch} headingRef={headingRef} focusIntent={focusIntent} cards={catalogCards} adoptCards={adoptCatalogCards} notify={notifyCatalog} libraryStats={stats} cloudStats={cloudStats} cloudStatsTargetLanguage={cloudStatsTargetLanguage} openVocabulary={openVocabulary} continueReview={continueReview} continueCatalogUnit={continueCatalogUnit} /></div></Suspense>;
  if (viewMode === 'today') {
    const route = readDailyLearningUrlState(window.location.href);
    const openLesson = (lesson: DailyLessonMode | null) => {
      const location = createDailyLearningLocation(window.location.href, { view: 'today', lesson });
      if (lesson) window.history.pushState({}, '', location);
      else window.history.replaceState({}, '', location);
    };
    return <Suspense fallback={fallback(<Trans id="shell.loading.today" message="Preparing today’s learning plan…" />)}><div className="async-content-enter" data-async-content="today"><DailyLearningWorkspace
      ownerId={ownerId} languageProfile={languageProfile} isOffline={isOffline} headingRef={headingRef} focusIntent={focusIntent} initialLesson={route.lesson} streak={streak} studyXpHistory={stats.xpChartData} rewardTimeZone={rewardTimeZone}
      loadPracticePool={loadPracticePool} reviewCard={(cardId, rating, operationId, source) => reviewCard(cardId, rating, operationId, source)}
      openLesson={openLesson} openVocabulary={openVocabulary} openPaths={openPaths} continueReview={continueReview} openMorePractice={openMorePractice} openWeeklyRecap={openWeeklyRecap} onVerifiedPracticeOutcome={onVerifiedPracticeOutcome}
    /></div></Suspense>;
  }
  if (viewMode === 'progress') return <Suspense fallback={fallback(<Trans id="shell.loading.progress" message="Preparing learning progress…" />)}><div className="async-content-enter" data-async-content="progress"><ProgressWorkspace key={ownerId ?? 'signed-out'} ownerId={ownerId} targetLanguage={languageProfile.source.code} darkMode={isDarkMode} isOffline={isOffline} headingRef={headingRef} focusIntent={focusIntent} stats={stats} isStatsLoading={isStatsLoading} statsError={statsError} continueReview={continueReview} openVocabulary={openVocabulary} weeklyRecapRequestOwnerId={weeklyRecapRequestOwnerId} weeklyRecapRequestSettled={weeklyRecapRequestSettled} onWeeklyRecapRequestConsumed={onWeeklyRecapRequestConsumed} /></div></Suspense>;
  if (viewMode === 'settings') return <Suspense fallback={fallback(<Trans id="shell.loading.settings" message="Preparing appearance settings…" />)}><div className="async-content-enter" data-async-content="settings"><SettingsScreen headingRef={headingRef} focusIntent={focusIntent} /></div></Suspense>;
  if (viewMode === 'library') return libraryContent;
  return practiceContent;
}
