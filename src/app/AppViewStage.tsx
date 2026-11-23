import { msg } from '@lingui/core/macro';
import { lazy, Suspense, type ReactNode, type RefObject } from 'react';
import type { Firestore } from 'firebase/firestore';
import type { CardData, ReviewRatingValue } from '../types/card';
import type { LibraryStatsViewModel } from '../features/library/libraryViewModel';
import type { CloudLibraryStats } from '../features/librarySession/cloudLibraryPageController';
import type { LanguageProfile } from '../features/language/languageProfile';
import type { AppViewMode, WebWordsReturnView } from '../features/navigation/useAppNavigation';
import type { SettingsSectionId } from '../features/settings/settings-sections';
import type { FilePort } from '../features/files/filePort';
import type { FileCardPhotos } from '../features/files/fileCardPhotos';
import type { FileCourseOption } from '../features/files/FilesWorkspace';
import { AchievementsLearnerProvider, type AchievementsLearnerLevel } from '../components/stats/AchievementsMatrixLearner';
import { createDailyLearningLocation, readDailyLearningUrlState, type DailyLessonMode } from '../features/dailyLearning/dailyLearningUrl';
import type { IntakeSharingSessionActions } from '../features/intake/useIntakeSharingSession';
import type { PracticeGamificationOutcome } from '../features/practice/practiceSessionService';
import { getActiveUiLocale, loadCatalog } from '../i18n/loadCatalog';
import { Trans } from '@lingui/react';
import { WorkspaceLoadingPanel } from '../components/WorkspaceLoadingPanel';
import type { DailyLearningWorkspaceProps } from '../features/dailyLearning/DailyLearningWorkspace';
import type { TodayLearnerFacts } from '../features/dailyLearning/dailyLearningPresentation';
import { TEXT_CONVERSATION_LIMITS } from '../features/conversation/textConversationModel';
import type { LearningStateOutcome } from '../features/learning/learningStateController';

export type ListenPracticeHandoff = NonNullable<DailyLearningWorkspaceProps['onPracticePhrase']> extends (
  handoff: infer Handoff,
) => void ? Handoff : never;
export type ListenPracticeScope = {
  readonly ownerId: string | null;
  readonly clipId: string | null;
  readonly generation: number;
};

export const capListenPracticeCards = (cards: readonly CardData[]): readonly CardData[] => (
  cards.slice(0, TEXT_CONVERSATION_LIMITS.maximumCards)
);

export const listenPracticeUnavailableMessage = (
  ownerId: string | null,
  isOffline: boolean,
): string | null => !ownerId
  ? 'Sign in to practise this phrase.'
  : isOffline ? 'Reconnect to practise this phrase.' : null;

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
const WebWordsPage = lazy(() => Promise.all([
  import('../features/webWords/WebWordsPage'), loadCatalog(getActiveUiLocale(), 'today'),
  // Its day labels come from the library presentation helpers.
  loadCatalog(getActiveUiLocale(), 'library'),
]).then(([module]) => ({ default: module.WebWordsPage })));
const FilesWorkspace = lazy(() => Promise.all([
  import('../features/files/FilesWorkspace'), loadCatalog(getActiveUiLocale(), 'files'),
]).then(([module]) => ({ default: module.FilesWorkspace })));
const CoursesPage = lazy(() => Promise.all([
  import('../features/courses/CoursesPage'), loadCatalog(getActiveUiLocale(), 'shell'),
]).then(([module]) => ({ default: module.CoursesPage })));

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
  /** Signed-in learner facts for the Today header. */
  readonly learner?: TodayLearnerFacts;
  /** The verified level and XP the achievements ring shows; absent until the course scope is ready. */
  readonly learnerLevel?: AchievementsLearnerLevel;
  readonly loadPracticePool: (maximum?: number, includeFuture?: boolean) => Promise<CardData[]>;
  readonly reviewCard: (cardId: string, rating: ReviewRatingValue, operationId?: string, source?: CardData) => Promise<LearningStateOutcome>;
  readonly catalogCards: readonly CardData[];
  readonly adoptCatalogCards: IntakeSharingSessionActions['adoptCards'];
  readonly notifyCatalog: (message: string) => void;
  readonly openVocabulary: () => void;
  /** Opens Vocabulary on the mastered tier, from the Progress "All N" link. */
  readonly openMasteredVocabulary?: () => void;
  readonly openPaths: () => void;
  readonly continueReview: () => void | Promise<void>;
  readonly continueCatalogUnit: (cards: readonly CardData[], isCurrent: () => boolean) => Promise<'started' | 'stale' | 'partial' | 'unavailable'>;
  readonly openMorePractice: (opener: HTMLButtonElement) => void;
  readonly openWeeklyRecap: () => void;
  readonly onVerifiedPracticeOutcome: (outcome: PracticeGamificationOutcome, operationId: string, ownerId: string) => void;
  readonly weeklyRecapRequestOwnerId: string | null;
  readonly weeklyRecapRequestSettled: boolean;
  readonly onWeeklyRecapRequestConsumed: () => void;
  readonly onPracticePhrase?: (handoff: ListenPracticeHandoff) => void;
  readonly onListenScopeChange?: (scope: ListenPracticeScope) => void;
  /** The settings section in the URL; menu clicks push a new section so back and forward walk through them. */
  readonly settingsSection: SettingsSectionId;
  readonly openSettings: (section: SettingsSectionId) => void;
  /** Where the web words back link leads, and the navigation that takes it there. */
  readonly webWordsReturnView: WebWordsReturnView;
  readonly returnFromWebWords: () => void;
  /** The signed-in learner's file service, stable per owner; null while signed out or without Firebase. */
  readonly filePort: FilePort | null;
  /** Courses a stored file can be attached to, and the one new uploads go to first. */
  readonly fileCourses: readonly FileCourseOption[];
  /** The loaded cards that show a stored photo, for the delete confirmation in My files. */
  readonly fileCardPhotos: FileCardPhotos | undefined;
  readonly activeCourseId: string | null;
  readonly openFiles: () => void;
  /** Opens Today, where the courses page's start button leads. */
  readonly openToday: () => void;
  /** The course whose goals the courses page shows, from the URL. */
  readonly goalsCourseId: string | null;
  /** Opens the courses page on one course's goals or, for `null`, its course list; `inPlace` keeps the same history entry. */
  readonly openCourseGoals: (courseId: string | null, inPlace?: boolean) => void;
  readonly libraryContent: ReactNode;
  readonly practiceContent: ReactNode;
}

const fallback = (message: ReactNode) => <WorkspaceLoadingPanel>{message}</WorkspaceLoadingPanel>;

export function AppViewStage({
  viewMode, ownerId, database, verifiedLibraryEpoch, languageProfile, isOffline, isDarkMode, headingRef, focusIntent, stats, cloudStats, cloudStatsTargetLanguage, streak, isStatsLoading, statsError, rewardTimeZone, learner, learnerLevel, loadPracticePool, reviewCard,
  catalogCards, adoptCatalogCards, notifyCatalog,
  openVocabulary, openMasteredVocabulary, openPaths, continueReview, continueCatalogUnit, openMorePractice, openWeeklyRecap, onVerifiedPracticeOutcome, weeklyRecapRequestOwnerId, weeklyRecapRequestSettled, onWeeklyRecapRequestConsumed, onPracticePhrase, onListenScopeChange, settingsSection, openSettings, webWordsReturnView, returnFromWebWords, filePort, fileCourses, fileCardPhotos, activeCourseId, openFiles, openToday, goalsCourseId, openCourseGoals, libraryContent, practiceContent,
}: AppViewStageProps) {
  if (viewMode === 'catalog') return <Suspense fallback={fallback(<Trans {...msg({ context: 'shell.loading.paths', message: 'Preparing learning paths…' })} />)}><div className="async-content-enter" data-async-content="catalog"><CatalogWorkspace ownerId={ownerId} targetLanguage={languageProfile.source.code} database={database} verifiedLibraryEpoch={verifiedLibraryEpoch} headingRef={headingRef} focusIntent={focusIntent} cards={catalogCards} adoptCards={adoptCatalogCards} notify={notifyCatalog} libraryStats={stats} cloudStats={cloudStats} cloudStatsTargetLanguage={cloudStatsTargetLanguage} openVocabulary={openVocabulary} continueReview={continueReview} continueCatalogUnit={continueCatalogUnit} /></div></Suspense>;
  if (viewMode === 'today') {
    const route = readDailyLearningUrlState(window.location.href);
    const openLesson = (lesson: DailyLessonMode | null) => {
      const location = createDailyLearningLocation(window.location.href, { view: 'today', lesson });
      if (lesson) window.history.pushState({}, '', location);
      else window.history.replaceState({}, '', location);
    };
    return <Suspense fallback={fallback(<Trans {...msg({ context: 'shell.loading.today', message: 'Preparing today’s learning plan…' })} />)}><div className="async-content-enter" data-async-content="today"><DailyLearningWorkspace
      ownerId={ownerId} database={database} verifiedLibraryEpoch={verifiedLibraryEpoch} languageProfile={languageProfile} isOffline={isOffline} headingRef={headingRef} focusIntent={focusIntent} initialLesson={route.lesson} streak={streak} studyXpHistory={stats.xpChartData} rewardTimeZone={rewardTimeZone} {...(learner ? { learner } : {})}
      loadPracticePool={loadPracticePool} reviewCard={(cardId, rating, operationId, source) => reviewCard(cardId, rating, operationId, source)}
      openLesson={openLesson} openVocabulary={openVocabulary} openPaths={openPaths} openCourseGoals={openCourseGoals} continueReview={continueReview} openMorePractice={openMorePractice} openWeeklyRecap={openWeeklyRecap} onVerifiedPracticeOutcome={onVerifiedPracticeOutcome}
      adoptCatalogCards={adoptCatalogCards} onPracticePhrase={onPracticePhrase} onListenScopeChange={onListenScopeChange}
    /></div></Suspense>;
  }
  if (viewMode === 'progress') return <Suspense fallback={fallback(<Trans {...msg({ context: 'shell.loading.progress', message: 'Preparing learning progress…' })} />)}><div className="async-content-enter" data-async-content="progress"><AchievementsLearnerProvider learner={learnerLevel ?? null}><ProgressWorkspace key={ownerId ?? 'signed-out'} ownerId={ownerId} targetLanguage={languageProfile.source.code} darkMode={isDarkMode} isOffline={isOffline} headingRef={headingRef} focusIntent={focusIntent} stats={stats} isStatsLoading={isStatsLoading} statsError={statsError} continueReview={continueReview} openVocabulary={openVocabulary} openMasteredVocabulary={openMasteredVocabulary} weeklyRecapRequestOwnerId={weeklyRecapRequestOwnerId} weeklyRecapRequestSettled={weeklyRecapRequestSettled} onWeeklyRecapRequestConsumed={onWeeklyRecapRequestConsumed} /></AchievementsLearnerProvider></div></Suspense>;
  if (viewMode === 'settings') return <Suspense fallback={fallback(<Trans {...msg({ context: 'shell.loading.settings', message: 'Preparing appearance settings…' })} />)}><div className="async-content-enter" data-async-content="settings"><SettingsScreen headingRef={headingRef} focusIntent={focusIntent} section={settingsSection} onSelectSection={openSettings} filePort={filePort} onOpenFiles={openFiles} /></div></Suspense>;
  if (viewMode === 'web-words') return <Suspense fallback={fallback(<Trans {...msg({ context: 'shell.loading.web-words', message: 'Preparing your web words…' })} />)}><div className="async-content-enter" data-async-content="web-words"><WebWordsPage ownerId={ownerId} targetLanguage={languageProfile.source.code} translationLanguage={languageProfile.target.code} returnView={webWordsReturnView} onClose={returnFromWebWords} headingRef={headingRef} focusIntent={focusIntent} /></div></Suspense>;
  if (viewMode === 'files') return filePort && <Suspense fallback={fallback(<Trans {...msg({ context: 'shell.loading.files', message: 'Preparing your files…' })} />)}><div className="async-content-enter" data-async-content="files"><FilesWorkspace key={ownerId ?? 'signed-out'} port={filePort} courses={fileCourses} defaultCourseId={activeCourseId} cardPhotos={fileCardPhotos} headingRef={headingRef} focusIntent={focusIntent} /></div></Suspense>;
  if (viewMode === 'courses') return ownerId && <Suspense fallback={fallback(<Trans {...msg({ context: 'course.loading', message: 'Preparing your courses…' })} />)}><div className="async-content-enter" data-async-content="courses"><CoursesPage key={ownerId} onStudy={openToday} goalsCourseId={goalsCourseId} onGoalsCourseChange={courseId => openCourseGoals(courseId, true)} headingRef={headingRef} focusIntent={focusIntent} /></div></Suspense>;
  if (viewMode === 'library') return libraryContent;
  return practiceContent;
}
