import { lazy, Suspense, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode, type RefObject } from 'react';
import { Bookmark, LayoutGrid, List } from 'lucide-react';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import type { CardData } from '../../types/card';
import type { CoverPreset } from './customDecks';
import type {
  SpreadsheetImportProgress,
  SpreadsheetImportResult,
} from '../importExport/spreadsheetImportService';
import type { LearningStateOutcome } from '../learning/learningStateController';
import type { BulkCardFieldPatchRequest } from '../learning/learningPersistencePort';
import type { LegacyMigrationIssue } from '../librarySession/ownerLibrarySessionController';
import { LibraryOverview } from './LibraryOverview';
import { EmptyLibraryPanel } from './EmptyLibraryPanel';
import type { AiGenerationAccess } from './aiGenerationAccess';
import { getLibraryCardTier, isLibraryCardDue } from './libraryViewModel';
import './library-canvas.css';

const LibraryCardGrid = lazy(() => import('./LibraryCardGrid').then(module => ({ default: module.LibraryCardGrid })));
const LibraryTools = lazy(() => import('./LibraryTools').then(module => ({ default: module.LibraryTools })));

export interface LibraryScreenModel {
  isAuthenticated: boolean;
  overview: {
    total: number;
    due: number;
    mastered: number;
    streak: number;
    level: number;
    xp: number;
    canStudy: boolean;
  };
  grid: {
    searchQuery: string;
    legacyCardsPending: number;
    legacyIssue: LegacyMigrationIssue | null;
    isMigratingLegacy: boolean;
    libraryHeadingRef?: RefObject<HTMLHeadingElement | null>;
    activeCategory: string;
    filteredCards: CardData[];
    isSharing: boolean;
    currentPage: number;
    paginatedCards: CardData[];
    isPageLoading: boolean;
    cloudReadUnavailable: boolean;
    importProgress: SpreadsheetImportProgress | null;
    groupedCards: Record<string, CardData[]>;
    customDecks: string[];
    customDeckCoverPresets?: Record<string, CoverPreset>;
    totalPages: number;
    hasNextCloudPage: boolean;
    libraryCount: number;
    /** Optional controller-backed status for the Canvas rail. */
    activeLearningFilter?: LibraryFilter;
  };
  tools: {
    fileInputRef?: RefObject<HTMLInputElement | null>;
    wordInput: string;
    isLoading: boolean;
    isGenerating: boolean;
    isImporting: boolean;
    generationAccess: AiGenerationAccess;
    importProgress: SpreadsheetImportProgress | null;
    importResult: SpreadsheetImportResult | null;
    libraryCount: number;
    searchQuery: string;
    showStarredOnly: boolean;
    activeDifficulty: string;
    activePartOfSpeech: string;
    activeDate: string;
    availableDates: string[];
    customDecks: string[];
    customDeckCoverPresets?: Record<string, CoverPreset>;
    newDeckInput: string;
    activeCustomDeck: string;
    cards: CardData[];
    cloudFacetsComplete: boolean;
    sortedCategories: string[];
    categoryCounts: Record<string, number>;
    activeCategory: string;
  };
}

export interface LibraryScreenActions {
  startStudy: () => Promise<void>;
  openCardCreator: () => void;
  grid: {
    changeSearch: (value: string) => void;
    migrateLegacyCards: () => Promise<void>;
    shareCategory: () => Promise<void>;
    deleteCard: (cardId: string) => Promise<void>;
    toggleBookmark: (cardId: string) => Promise<void>;
    assignDeck: (cardId: string, deckName: string | null) => Promise<void>;
    bulkPatchCards: (patches: readonly BulkCardFieldPatchRequest[]) => Promise<void>;
    updateCard: (cardId: string, fields: Partial<CardData>) => Promise<LearningStateOutcome>;
    changePage: (page: number) => void;
    clearFilters: () => void;
    /** Optional union filter bridge for cloud-backed Learning cards. */
    changeLearningFilter?: (value: LibraryFilter) => void;
  };
  tools: {
    openPaths: () => void;
    importCards: (event: ChangeEvent<HTMLInputElement>) => void;
    importFile: (file: File) => void;
    generateCard: (event: FormEvent) => Promise<void>;
    changeWordInput: (value: string) => void;
    changeSearch: (value: string) => void;
    changeStarredOnly: (value: boolean) => void;
    changeDifficulty: (value: string) => void;
    changePartOfSpeech: (value: string) => void;
    changeDate: (value: string) => void;
    changeNewDeckInput: (value: string) => void;
    createCustomDeck: (name: string, preset?: import('./customDecks').CoverPreset) => Promise<void>;
    changeCustomDeck: (value: string) => void;
    deleteCustomDeck: (name: string) => Promise<void>;
    changeCategory: (value: string) => void;
  };
}

export interface LibraryScreenProps {
  model: LibraryScreenModel;
  actions: LibraryScreenActions;
}

export type LibraryFilter = 'all' | 'due' | 'new' | 'learning' | 'mastered';
export type LibraryViewMode = 'grid' | 'list';

export const cardIsDue = isLibraryCardDue;

export function shouldShowFirstUseLibraryPanel(model: LibraryScreenModel): boolean {
  return model.grid.libraryCount === 0
    && model.grid.searchQuery.trim() === ''
    && !model.grid.isPageLoading
    && !model.grid.cloudReadUnavailable
    && model.grid.legacyCardsPending === 0
    && model.grid.legacyIssue === null
    && !model.grid.isMigratingLegacy;
}

export function deriveActiveLearningFilter(
  model: LibraryScreenModel,
  localFilter: LibraryFilter | null,
): LibraryFilter {
  return model.grid.activeLearningFilter ?? localFilter ?? (
    model.tools.activeDifficulty === 'due'
      ? 'due'
      : model.tools.activeDifficulty === 'unrated'
        ? 'new'
        : model.tools.activeDifficulty === 'easy'
          ? 'mastered'
          : model.tools.activeDifficulty === 'good' || model.tools.activeDifficulty === 'hard'
            ? 'learning'
            : 'all'
  );
}

/**
 * The "Learning" quick tab spans two difficulty values (good + hard) and also
 * requires review history, which Firestore can't express as a single
 * equality filter — so `changeFilter` resets the server-side difficulty
 * filter to 'All' and this tier check narrows the full result set
 * client-side instead. `deriveActiveLearningFilter` also derives 'learning'
 * when an explicit "hard"/"good" memory-status filter is selected directly
 * (e.g. via a deep-linked URL), purely to highlight the matching tab; in that
 * case the server query is already exact, so re-applying the tier heuristic
 * would incorrectly drop matching cards that have no review history yet.
 * Only apply the local filter when the difficulty query is unfiltered, i.e.
 * when 'learning' actually came from the tab itself.
 */
export function shouldApplyLocalLearningFilter(
  model: LibraryScreenModel,
  activeFilter: LibraryFilter,
  hasLearningFilterBridge: boolean,
): boolean {
  return activeFilter === 'learning'
    && !hasLearningFilterBridge
    && model.tools.activeDifficulty === 'All';
}

function DeferredLibraryFallback({ label }: { label: ReactNode }) {
  return (
    <div className="skeleton-sheen min-h-40 rounded-[26px] border border-[var(--sf-border)]" role="status">
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function LibraryScreen({ model, actions }: LibraryScreenProps) {
  const internalHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const internalFileInputRef = useRef<HTMLInputElement | null>(null);
  const [localFilter, setLocalFilter] = useState<LibraryFilter | null>(null);
  const [viewMode, setViewMode] = useState<LibraryViewMode>('grid');
  const headingRef = model.grid.libraryHeadingRef ?? internalHeadingRef;
  const fileInputRef = model.tools.fileInputRef ?? internalFileInputRef;
  const activeFilter = deriveActiveLearningFilter(model, localFilter);
  const hasLearningFilterBridge = Boolean(actions.grid.changeLearningFilter);
  const appliesLocalLearningFilter = shouldApplyLocalLearningFilter(model, activeFilter, hasLearningFilterBridge);
  const visibleCards = appliesLocalLearningFilter
    ? model.grid.filteredCards.filter(card => getLibraryCardTier(card) === 'learning')
    : model.grid.filteredCards;
  const visiblePageCards = appliesLocalLearningFilter
    ? model.grid.paginatedCards.filter(card => getLibraryCardTier(card) === 'learning')
    : model.grid.paginatedCards;
  const showFirstUsePanel = shouldShowFirstUseLibraryPanel(model);

  const changeFilter = (filter: LibraryFilter) => {
    setLocalFilter(filter);
    if (actions.grid.changeLearningFilter) {
      actions.grid.changeLearningFilter(filter);
      return;
    }
    actions.tools.changeStarredOnly(false);
    if (filter === 'all' || filter === 'learning') actions.tools.changeDifficulty('All');
    if (filter === 'due') actions.tools.changeDifficulty('due');
    if (filter === 'new') actions.tools.changeDifficulty('unrated');
    if (filter === 'mastered') actions.tools.changeDifficulty('easy');
  };

  return (
    <div className="library-canvas space-y-5 sm:space-y-6">
      <LibraryOverview
        {...model.overview}
        onStartStudy={actions.startStudy}
        onCreateCard={actions.openCardCreator}
        searchQuery={model.grid.searchQuery}
        onSearchChange={actions.grid.changeSearch}
        deckCount={model.tools.customDecks.length + 1}
      />
      {showFirstUsePanel ? (
        <EmptyLibraryPanel
          fileInputRef={fileInputRef}
          wordInput={model.tools.wordInput}
          onWordInputChange={actions.tools.changeWordInput}
          onGenerate={actions.tools.generateCard}
          onImport={actions.tools.importCards}
          onOpenPaths={actions.tools.openPaths}
          isLoading={model.tools.isLoading}
          isGenerating={model.tools.isGenerating}
          isImporting={model.tools.isImporting}
          generationAccess={model.tools.generationAccess}
          importProgress={model.tools.importProgress}
          importResult={model.tools.importResult}
        />
      ) : (
        <LibraryCanvasRail
          model={model}
          actions={actions}
          activeFilter={activeFilter}
          onFilterChange={changeFilter}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
        />
      )}
      <div data-library-region="collection">
        {!showFirstUsePanel && (
          <Suspense fallback={<DeferredLibraryFallback label={<Trans id="library.loading.cards" message="Loading library cards" />} />}>
            <LibraryCardGrid
              isAuthenticated={model.isAuthenticated}
              searchQuery={model.grid.searchQuery}
              setSearchQuery={actions.grid.changeSearch}
              legacyCardsPending={model.grid.legacyCardsPending}
              legacyIssue={model.grid.legacyIssue}
              migrateLegacyCards={actions.grid.migrateLegacyCards}
              isMigratingLegacy={model.grid.isMigratingLegacy}
              libraryHeadingRef={headingRef}
              activeCategory={model.grid.activeCategory}
              filteredCards={visibleCards}
              shareCategory={actions.grid.shareCategory}
              isSharing={model.grid.isSharing}
              startStudy={actions.startStudy}
              currentPage={model.grid.currentPage}
              paginatedCards={visiblePageCards}
              isPageLoading={model.grid.isPageLoading}
              cloudReadUnavailable={model.grid.cloudReadUnavailable}
              importProgress={model.grid.importProgress}
              groupedCards={model.grid.groupedCards}
              deleteCard={actions.grid.deleteCard}
              toggleBookmark={actions.grid.toggleBookmark}
              customDecks={model.grid.customDecks}
              assignDeck={actions.grid.assignDeck}
              bulkPatchCards={actions.grid.bulkPatchCards}
              updateCard={actions.grid.updateCard}
              totalPages={model.grid.totalPages}
              onPageChange={actions.grid.changePage}
              hasNextCloudPage={model.grid.hasNextCloudPage}
              libraryCount={model.grid.libraryCount}
              onClearFilters={actions.grid.clearFilters}
              isGenerating={model.tools.isGenerating || model.tools.isLoading}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
            />
          </Suspense>
        )}
      </div>
      {!showFirstUsePanel && <details className="library-canvas-tools" data-library-region="tools">
        <summary><Trans id="library.tools.more" message="More library tools" /></summary>
        <div>
          <Suspense fallback={<DeferredLibraryFallback label={<Trans id="library.loading.tools" message="Loading library tools" />} />}>
            <LibraryTools
              fileInputRef={fileInputRef}
              onImport={actions.tools.importCards}
              importFile={actions.tools.importFile}
              onGenerate={actions.tools.generateCard}
              wordInput={model.tools.wordInput}
              setWordInput={actions.tools.changeWordInput}
              isLoading={model.tools.isLoading}
              isGenerating={model.tools.isGenerating}
              isImporting={model.tools.isImporting}
              generationAccess={model.tools.generationAccess}
              importProgress={model.tools.importProgress}
              importResult={model.tools.importResult}
              libraryCount={model.tools.libraryCount}
              searchQuery={model.tools.searchQuery}
              setSearchQuery={actions.tools.changeSearch}
              showStarredOnly={model.tools.showStarredOnly}
              setShowStarredOnly={actions.tools.changeStarredOnly}
              activeDifficulty={model.tools.activeDifficulty}
              setActiveDifficulty={actions.tools.changeDifficulty}
              activePartOfSpeech={model.tools.activePartOfSpeech}
              setActivePartOfSpeech={actions.tools.changePartOfSpeech}
              isAuthenticated={model.isAuthenticated}
              activeDate={model.tools.activeDate}
              setActiveDate={actions.tools.changeDate}
              availableDates={model.tools.availableDates}
              customDecks={model.tools.customDecks}
              customDeckCoverPresets={model.tools.customDeckCoverPresets}
              newDeckInput={model.tools.newDeckInput}
              setNewDeckInput={actions.tools.changeNewDeckInput}
              createCustomDeck={actions.tools.createCustomDeck}
              activeCustomDeck={model.tools.activeCustomDeck}
              setActiveCustomDeck={actions.tools.changeCustomDeck}
              cards={model.tools.cards}
              deleteCustomDeck={actions.tools.deleteCustomDeck}
              cloudFacetsComplete={model.tools.cloudFacetsComplete}
              sortedCategories={model.tools.sortedCategories}
              categoryCounts={model.tools.categoryCounts}
              activeCategory={model.tools.activeCategory}
              setActiveCategory={actions.tools.changeCategory}
            />
          </Suspense>
        </div>
      </details>}
    </div>
  );
}

function LibraryCanvasRail({
  model,
  actions,
  activeFilter,
  onFilterChange,
  viewMode,
  onViewModeChange,
}: {
  model: LibraryScreenModel;
  actions: LibraryScreenActions;
  activeFilter: LibraryFilter;
  onFilterChange: (value: LibraryFilter) => void;
  viewMode: LibraryViewMode;
  onViewModeChange: (value: LibraryViewMode) => void;
}) {
  const { tools } = model;
  const { i18n } = useLingui();
  const filter = (key: string, label: ReactNode, selected: boolean, onClick: () => void) => <button key={key} type="button" aria-pressed={selected} className={selected ? 'is-active' : ''} onClick={onClick}>{label}</button>;
  const deck = (key: string, name: ReactNode, selected: boolean, count: number, onClick: () => void) => <button key={key} type="button" role="tab" aria-selected={selected} className={selected ? 'is-active' : ''} onClick={onClick}><span>{name}</span><small>{count}</small></button>;
  const filterMark = (mark: ReactNode) => <span className="library-filter-mark" aria-hidden="true">{mark}</span>;
  return <div className="library-canvas-rail">
    <div className="library-canvas-decks" role="tablist" aria-label={i18n._(msg({ id: 'library.decks.nav-label', message: 'Decks' }))}>
      {deck('all-decks', <Trans id="library.decks.all" message="All decks" />, tools.activeCustomDeck === 'All', tools.libraryCount, () => actions.tools.changeCustomDeck('All'))}
      {tools.customDecks.map(deckName => deck(deckName, deckName, tools.activeCustomDeck === deckName, tools.cards.filter(card => card.customDeck === deckName).length, () => actions.tools.changeCustomDeck(deckName)))}
    </div>
    <div className="library-canvas-filters">
      {filter('all', <>{filterMark('∗')}<Trans id="library.filters.all" message="All" /></>, activeFilter === 'all', () => onFilterChange('all'))}
      {filter('due', <>{filterMark('!')}<Trans id="library.filters.due-short" message="Due" /></>, activeFilter === 'due', () => onFilterChange('due'))}
      {filter('new', <>{filterMark(<Trans id="library.card.grade.new" message="Bud" />)}<Trans id="library.card.tier.new" message="New" /></>, activeFilter === 'new', () => onFilterChange('new'))}
      {filter('learning', <>{filterMark(<Trans id="library.card.grade.learning" message="Bloom" />)}<Trans id="library.filters.learning" message="Learning" /></>, activeFilter === 'learning', () => onFilterChange('learning'))}
      {filter('mastered', <>{filterMark(<Trans id="library.card.grade.mastered" message="Star" />)}<Trans id="library.filters.mastered" message="Mastered" /></>, activeFilter === 'mastered', () => onFilterChange('mastered'))}
      {filter('starred', <><Bookmark size={13} fill="currentColor"/><Trans id="library.filters.starred" message="Starred" /></>, tools.showStarredOnly, () => actions.tools.changeStarredOnly(!tools.showStarredOnly))}
      <span aria-hidden="true" className="library-canvas-rail-divider" />
      <div className="library-canvas-view-toggle" role="group" aria-label={i18n._(msg({ id: 'library.view.label', message: 'View' }))}>
        <button type="button" aria-label={i18n._(msg({ id: 'library.view.grid', message: 'Grid view' }))} aria-pressed={viewMode === 'grid'} className={viewMode === 'grid' ? 'is-active' : ''} onClick={() => onViewModeChange('grid')}><LayoutGrid size={15} aria-hidden="true" /></button>
        <button type="button" aria-label={i18n._(msg({ id: 'library.view.list', message: 'List view' }))} aria-pressed={viewMode === 'list'} className={viewMode === 'list' ? 'is-active' : ''} onClick={() => onViewModeChange('list')}><List size={15} aria-hidden="true" /></button>
      </div>
    </div>
  </div>;
}
