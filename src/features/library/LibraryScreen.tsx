import { lazy, Suspense, useRef, type ChangeEvent, type FormEvent, type RefObject } from 'react';
import type { CardData } from '../../types/card';
import type {
  SpreadsheetImportProgress,
  SpreadsheetImportResult,
} from '../importExport/spreadsheetImportService';
import type { LegacyMigrationIssue } from '../librarySession/ownerLibrarySessionController';
import { LibraryOverview } from './LibraryOverview';
import type { AiGenerationAccess } from './aiGenerationAccess';

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
    totalPages: number;
    hasNextCloudPage: boolean;
    libraryCount: number;
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
    updateCard: (cardId: string, fields: Partial<CardData>) => Promise<void>;
    changePage: (page: number) => void;
    clearFilters: () => void;
  };
  tools: {
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
    createCustomDeck: (name: string) => Promise<void>;
    changeCustomDeck: (value: string) => void;
    deleteCustomDeck: (name: string) => Promise<void>;
    changeCategory: (value: string) => void;
  };
}

export interface LibraryScreenProps {
  model: LibraryScreenModel;
  actions: LibraryScreenActions;
}

function DeferredLibraryFallback({ label }: { label: string }) {
  return (
    <div className="skeleton-sheen min-h-40 rounded-[26px] border border-[var(--sf-border)]" role="status">
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function LibraryScreen({ model, actions }: LibraryScreenProps) {
  const internalHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const internalFileInputRef = useRef<HTMLInputElement | null>(null);
  const headingRef = model.grid.libraryHeadingRef ?? internalHeadingRef;
  const fileInputRef = model.tools.fileInputRef ?? internalFileInputRef;
  const isEmptyLibrary = model.grid.libraryCount === 0;

  return (
    <div className="space-y-6 sm:space-y-8">
      <LibraryOverview
        {...model.overview}
        onStartStudy={actions.startStudy}
        onCreateCard={actions.openCardCreator}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 xl:gap-8">
        <div data-library-region="collection" className={`${isEmptyLibrary ? 'order-2 ' : ''}lg:order-1 lg:col-span-9`}>
          <Suspense fallback={<DeferredLibraryFallback label="Loading library cards" />}>
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
              filteredCards={model.grid.filteredCards}
              shareCategory={actions.grid.shareCategory}
              isSharing={model.grid.isSharing}
              startStudy={actions.startStudy}
              currentPage={model.grid.currentPage}
              paginatedCards={model.grid.paginatedCards}
              isPageLoading={model.grid.isPageLoading}
              cloudReadUnavailable={model.grid.cloudReadUnavailable}
              importProgress={model.grid.importProgress}
              groupedCards={model.grid.groupedCards}
              deleteCard={actions.grid.deleteCard}
              toggleBookmark={actions.grid.toggleBookmark}
              customDecks={model.grid.customDecks}
              assignDeck={actions.grid.assignDeck}
              updateCard={actions.grid.updateCard}
              totalPages={model.grid.totalPages}
              onPageChange={actions.grid.changePage}
              hasNextCloudPage={model.grid.hasNextCloudPage}
              libraryCount={model.grid.libraryCount}
              onClearFilters={actions.grid.clearFilters}
              isGenerating={model.tools.isGenerating || model.tools.isLoading}
            />
          </Suspense>
        </div>
        <div data-library-region="tools" className={`${isEmptyLibrary ? 'order-1 ' : ''}lg:order-2 lg:col-span-3 lg:self-start`}>
          <Suspense fallback={<DeferredLibraryFallback label="Loading library tools" />}>
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
      </div>
    </div>
  );
}
