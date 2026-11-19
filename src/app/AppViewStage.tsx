import { msg } from '@lingui/core/macro';
import { lazy, Suspense, type ReactNode, type RefObject } from 'react';
import type { Firestore } from 'firebase/firestore';
import type { CardData, ReviewRatingValue } from '../types/card';
import type { LibraryStatsViewModel } from '../features/library/libraryViewModel';
import type { CloudLibraryStats } from '../features/librarySession/cloudLibraryPageController';
import type { LanguageProfile } from '../features/language/languageProfile';
import type { AppViewMode, WebWordsReturnView } from '../features/navigation/useAppNavigation';
import type { SettingsSectionId } from '../features/settings/settings-sections';
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
]).then(([module]) => ({ default: module.WebWordsPage })));

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
  readonly onPracticePhrase?: (handoff: ListenPracticeHandoff) => void;
  readonly onListenScopeChange?: (scope: ListenPracticeScope) => void;
  /** The settings section in the URL; menu clicks push a new section so back and forward walk through them. */
  readonly settingsSection: SettingsSectionId;
  readonly openSettings: (section: SettingsSectionId) => void;
  /** Where the web words back link leads, and the navigation that takes it there. */
  readonly webWordsReturnView: WebWordsReturnView;
  readonly returnFromWebWords: () => void;
  readonly libraryContent: ReactNode;
  readonly practiceContent: ReactNode;
}

const fallback = (message: ReactNode) => <WorkspaceLoadingPanel>{message}</WorkspaceLoadingPanel>;

export function AppViewStage({
  viewMode, ownerId, database, verifiedLibraryEpoch, languageProfile, isOffline, isDarkMode, headingRef, focusIntent, stats, cloudStats, cloudStatsTargetLanguage, streak, isStatsLoading, statsError, rewardTimeZone, learner, loadPracticePool, reviewCard,
  catalogCards, adoptCatalogCards, notifyCatalog,
  openVocabulary, openPaths, continueReview, continueCatalogUnit, openMorePractice, openWeeklyRecap, onVerifiedPracticeOutcome, weeklyRecapRequestOwnerId, weeklyRecapRequestSettled, onWeeklyRecapRequestConsumed, onPracticePhrase, onListenScopeChange, settingsSection, openSettings, webWordsReturnView, returnFromWebWords, libraryContent, practiceContent,
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
      ownerId={ownerId} languageProfile={languageProfile} isOffline={isOffline} headingRef={headingRef} focusIntent={focusIntent} initialLesson={route.lesson} streak={streak} studyXpHistory={stats.xpChartData} rewardTimeZone={rewardTimeZone} {...(learner ? { learner } : {})}
      loadPracticePool={loadPracticePool} reviewCard={(cardId, rating, operationId, source) => reviewCard(cardId, rating, operationId, source)}
      openLesson={openLesson} openVocabulary={openVocabulary} openPaths={openPaths} continueReview={continueReview} openMorePractice={openMorePractice} openWeeklyRecap={openWeeklyRecap} onVerifiedPracticeOutcome={onVerifiedPracticeOutcome}
      adoptCatalogCards={adoptCatalogCards} onPracticePhrase={onPracticePhrase} onListenScopeChange={onListenScopeChange}
    /></div></Suspense>;
  }
  if (viewMode === 'progress') return <Suspense fallback={fallback(<Trans {...msg({ context: 'shell.loading.progress', message: 'Preparing learning progress…' })} />)}><div className="async-content-enter" data-async-content="progress"><ProgressWorkspace key={ownerId ?? 'signed-out'} ownerId={ownerId} targetLanguage={languageProfile.source.code} darkMode={isDarkMode} isOffline={isOffline} headingRef={headingRef} focusIntent={focusIntent} stats={stats} isStatsLoading={isStatsLoading} statsError={statsError} continueReview={continueReview} openVocabulary={openVocabulary} weeklyRecapRequestOwnerId={weeklyRecapRequestOwnerId} weeklyRecapRequestSettled={weeklyRecapRequestSettled} onWeeklyRecapRequestConsumed={onWeeklyRecapRequestConsumed} /></div></Suspense>;
  if (viewMode === 'settings') return <Suspense fallback={fallback(<Trans {...msg({ context: 'shell.loading.settings', message: 'Preparing appearance settings…' })} />)}><div className="async-content-enter" data-async-content="settings"><SettingsScreen headingRef={headingRef} focusIntent={focusIntent} section={settingsSection} onSelectSection={openSettings} /></div></Suspense>;
  if (viewMode === 'web-words') return <Suspense fallback={fallback(<Trans {...msg({ context: 'shell.loading.web-words', message: 'Preparing your web words…' })} />)}><div className="async-content-enter" data-async-content="web-words"><WebWordsPage ownerId={ownerId} targetLanguage={languageProfile.source.code} translationLanguage={languageProfile.target.code} returnView={webWordsReturnView} onClose={returnFromWebWords} headingRef={headingRef} focusIntent={focusIntent} /></div></Suspense>;
  if (viewMode === 'library') return libraryContent;
  return practiceContent;
}
