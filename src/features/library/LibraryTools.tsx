import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode, type RefObject } from 'react';
import {
  Award,
  BookOpen,
  Calendar,
  ChevronDown,
  FileUp,
  Filter,
  Folder,
  Layers3,
  Loader2,
  MessageSquare,
  Plus,
  RotateCcw,
  ScanText,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  Tags,
  X,
} from 'lucide-react';
import type { CardData } from '../../types/card';
import { PART_OF_SPEECH_OPTIONS } from '../../lib/cardQuery';
import type {
  SpreadsheetImportProgress,
  SpreadsheetImportResult,
} from '../importExport/spreadsheetImportService';
import { dateLabelToQueryDate } from './libraryPresentation';
import type { AiGenerationAccess } from './aiGenerationAccess';
import { AiDialogueModal } from './AiDialogueModal';
import { WordExtractorModal } from './WordExtractorModal';

interface LibraryToolsProps {
  fileInputRef: RefObject<HTMLInputElement | null>;
  onImport: (event: ChangeEvent<HTMLInputElement>) => void;
  importFile: (file: File) => void;
  onGenerate: (event: FormEvent) => Promise<void>;
  wordInput: string;
  setWordInput: (value: string) => void;
  isLoading: boolean;
  isGenerating?: boolean;
  isImporting?: boolean;
  generationAccess: AiGenerationAccess;
  importProgress: SpreadsheetImportProgress | null;
  importResult?: SpreadsheetImportResult | null;
  libraryCount: number;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  showStarredOnly: boolean;
  setShowStarredOnly: (value: boolean) => void;
  activeDifficulty: string;
  setActiveDifficulty: (value: string) => void;
  activePartOfSpeech: string;
  setActivePartOfSpeech: (value: string) => void;
  /** Transitional compatibility for the current composition root. */
  user?: unknown;
  isAuthenticated?: boolean;
  activeDate: string;
  setActiveDate: (value: string) => void;
  availableDates: string[];
  customDecks: string[];
  newDeckInput: string;
  setNewDeckInput: (value: string) => void;
  createCustomDeck: (name: string) => Promise<void>;
  activeCustomDeck: string;
  setActiveCustomDeck: (value: string) => void;
  cards: CardData[];
  deleteCustomDeck: (name: string) => Promise<void>;
  cloudFacetsComplete: boolean;
  sortedCategories: string[];
  categoryCounts: Record<string, number>;
  activeCategory: string;
  setActiveCategory: (value: string) => void;
}

const deckCreationErrorMessage = 'Could not create this deck. Check your connection and try again.';
const deckDeletionErrorMessage = 'Could not finish deleting this deck. Refreshing the latest cloud state; try again.';

export function SpreadsheetImportStatus({
  progress,
  result,
}: {
  progress: SpreadsheetImportProgress | null;
  result: SpreadsheetImportResult | null;
}) {
  if (progress) {
    return (
      <div role="status" aria-live="polite" className="mt-3 rounded-xl border border-cyan-300/50 bg-cyan-50/80 px-3 py-2 text-xs font-semibold text-cyan-900 dark:border-cyan-300/20 dark:bg-cyan-300/10 dark:text-cyan-100">
        <span className="block font-black">Importing {progress.current} of {progress.total}</span>
        <span className="mt-0.5 block truncate text-[11px] opacity-80">Current word: {progress.word}</span>
      </div>
    );
  }
  if (!result) return null;

  const { summary } = result;
  const isWarning = result.status !== 'completed';
  return (
    <div
      role={isWarning ? 'alert' : 'status'}
      aria-live={isWarning ? 'assertive' : 'polite'}
      className={`mt-3 rounded-xl border px-3 py-2 text-xs font-semibold ${
        isWarning
          ? 'border-amber-300/60 bg-amber-50/85 text-amber-950 dark:border-amber-300/20 dark:bg-amber-300/10 dark:text-amber-100'
          : 'border-emerald-300/60 bg-emerald-50/85 text-emerald-950 dark:border-emerald-300/20 dark:bg-emerald-300/10 dark:text-emerald-100'
      }`}
    >
      <span className="block font-black">{result.status === 'completed' ? 'Import complete' : result.status === 'partial' ? 'Import partly complete' : 'Import failed'}</span>
      <span className="mt-1 block text-[11px] leading-relaxed">
        {summary.created} created · {summary.reused} already present · {summary.failed} failed · {summary.skipped} skipped
      </span>
      <span className="mt-1 block text-[11px] leading-relaxed opacity-85">{result.message}</span>
    </div>
  );
}

export async function createDeckThenClearInput(
  name: string,
  createDeck: (name: string) => Promise<void>,
  clearInput: () => void,
) {
  await createDeck(name);
  clearInput();
}

export async function deleteDeckThenCloseDialog(
  name: string,
  deleteDeck: (name: string) => Promise<void>,
  closeDialog: () => void,
) {
  await deleteDeck(name);
  closeDialog();
}

export function DeckCreationForm({
  value,
  onChange,
  onSubmit,
  isCreating,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isCreating: boolean;
  error: string | null;
}) {
  return (
    <div className="mb-3">
      <form
        onSubmit={event => {
          event.preventDefault();
          onSubmit();
        }}
        className="flex gap-2"
      >
        <input
          type="text"
          aria-label="New deck name"
          value={value}
          onChange={event => onChange(event.target.value)}
          placeholder="IELTS, Travel…"
          disabled={isCreating}
          className="min-w-0 flex-1 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-3 py-2 text-sm font-semibold text-[var(--sf-text)] placeholder:text-[var(--sf-text-muted)] focus:border-[var(--sf-brand)] focus:outline-none disabled:cursor-wait disabled:opacity-70"
        />
        <button
          type="submit"
          disabled={isCreating || !value.trim()}
          className="flex min-h-10 items-center justify-center gap-1.5 rounded-xl bg-[var(--sf-brand)] px-3 text-xs font-bold text-[var(--sf-on-brand)] transition-colors hover:bg-[var(--sf-brand-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={isCreating ? 'Creating deck' : 'Create deck'}
        >
          {isCreating ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}
          <span>{isCreating ? 'Creating…' : 'Create'}</span>
        </button>
      </form>
      {error ? <p role="alert" className="mt-2 text-xs font-semibold leading-relaxed text-rose-700 dark:text-rose-300">{error}</p> : null}
    </div>
  );
}

export function restoreDeckDeletionFocus(
  event: { preventDefault: () => void },
  restoreFocusRef?: RefObject<HTMLButtonElement | null>,
) {
  event.preventDefault();
  restoreFocusRef?.current?.focus();
}

export function DeckDeletionDialogContent({
  deckName,
  assignedCardCount,
  onConfirm,
  restoreFocusRef,
  isDeleting = false,
  error = null,
}: {
  deckName: string;
  assignedCardCount: number;
  onConfirm: () => void;
  restoreFocusRef?: RefObject<HTMLButtonElement | null>;
  isDeleting?: boolean;
  error?: string | null;
}) {
  const assignmentMessage = assignedCardCount === 1
    ? '1 card will become unassigned.'
    : `${assignedCardCount} cards will become unassigned.`;
  return (
    <>
      <AlertDialog.Overlay className="fixed inset-0 z-50 bg-slate-950/72 backdrop-blur-xs" />
      <AlertDialog.Content
        className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-[28px] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-6 text-[var(--sf-text)] shadow-2xl outline-none"
        onCloseAutoFocus={event => restoreDeckDeletionFocus(event, restoreFocusRef)}
      >
        <AlertDialog.Title className="text-balance text-lg font-black">Delete “{deckName}” deck?</AlertDialog.Title>
        <AlertDialog.Description className="mt-2 text-pretty text-sm leading-relaxed text-[var(--sf-text-muted)]">
          {assignmentMessage} The cards stay in your library, but the deck itself will be permanently removed.
        </AlertDialog.Description>
        {error ? <p role="alert" className="mt-4 rounded-xl border border-rose-300/70 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800 dark:border-rose-300/25 dark:bg-rose-300/10 dark:text-rose-200">{error}</p> : null}
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <AlertDialog.Cancel disabled={isDeleting} className="min-h-11 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-4 py-2 text-sm font-semibold text-[var(--sf-text)] transition-colors hover:border-[var(--sf-brand)] disabled:cursor-wait disabled:opacity-50">Keep deck</AlertDialog.Cancel>
          <AlertDialog.Action
            disabled={isDeleting}
            onClick={event => {
              event.preventDefault();
              if (!isDeleting) onConfirm();
            }}
            className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-rose-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-rose-800 disabled:cursor-wait disabled:opacity-70"
          >
            {isDeleting ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : null}
            {isDeleting ? 'Deleting…' : error ? 'Try deleting again' : 'Delete deck'}
          </AlertDialog.Action>
        </div>
      </AlertDialog.Content>
    </>
  );
}

export function DeckDeletionDialog({
  deckName,
  assignedCardCount,
  open,
  onOpenChange,
  onConfirm,
  restoreFocusRef,
  isDeleting,
  error,
}: {
  deckName: string;
  assignedCardCount: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  restoreFocusRef?: RefObject<HTMLButtonElement | null>;
  isDeleting: boolean;
  error: string | null;
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <DeckDeletionDialogContent
          deckName={deckName}
          assignedCardCount={assignedCardCount}
          onConfirm={onConfirm}
          restoreFocusRef={restoreFocusRef}
          isDeleting={isDeleting}
          error={error}
        />
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

export function LibraryTools({
  fileInputRef,
  onImport,
  importFile,
  onGenerate,
  wordInput,
  setWordInput,
  isLoading,
  isGenerating = false,
  isImporting = false,
  generationAccess,
  importProgress,
  importResult = null,
  libraryCount,
  searchQuery,
  setSearchQuery,
  showStarredOnly,
  setShowStarredOnly,
  activeDifficulty,
  setActiveDifficulty,
  activePartOfSpeech,
  setActivePartOfSpeech,
  user,
  isAuthenticated,
  activeDate,
  setActiveDate,
  availableDates,
  customDecks,
  newDeckInput,
  setNewDeckInput,
  createCustomDeck,
  activeCustomDeck,
  setActiveCustomDeck,
  cards,
  deleteCustomDeck,
  cloudFacetsComplete,
  sortedCategories,
  categoryCounts,
  activeCategory,
  setActiveCategory,
}: LibraryToolsProps) {
  const authenticated = isAuthenticated ?? Boolean(user);
  const [deckPendingDeletion, setDeckPendingDeletion] = useState<string | null>(null);
  const [isCreatingDeck, setIsCreatingDeck] = useState(false);
  const [deckCreationError, setDeckCreationError] = useState<string | null>(null);
  const [isDeletingDeck, setIsDeletingDeck] = useState(false);
  const [deckDeletionError, setDeckDeletionError] = useState<string | null>(null);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(
    activePartOfSpeech !== 'All' || activeDifficulty !== 'All' || activeDate !== 'All',
  );
  const [showDeckCreator, setShowDeckCreator] = useState(false);
  const [showDialogueModal, setShowDialogueModal] = useState(false);
  const [showExtractorModal, setShowExtractorModal] = useState(false);

  const deckDeletionRestoreRef = useRef<HTMLButtonElement | null>(null);
  const pendingDeckCardCount = deckPendingDeletion
    ? cards.filter(card => card.customDeck === deckPendingDeletion).length
    : 0;
  const canSubmitWord = Boolean(wordInput.trim()) && !isLoading;

  const handleCreateDeck = async () => {
    if (!newDeckInput.trim() || isCreatingDeck) return;
    setIsCreatingDeck(true);
    setDeckCreationError(null);
    try {
      await createDeckThenClearInput(
        newDeckInput,
        createCustomDeck,
        () => {
          setNewDeckInput('');
          setShowDeckCreator(false);
        },
      );
    } catch {
      setDeckCreationError(deckCreationErrorMessage);
    } finally {
      setIsCreatingDeck(false);
    }
  };

  const handleDeleteDeck = async () => {
    if (!deckPendingDeletion || isDeletingDeck) return;
    setIsDeletingDeck(true);
    setDeckDeletionError(null);
    try {
      await deleteDeckThenCloseDialog(
        deckPendingDeletion,
        deleteCustomDeck,
        () => setDeckPendingDeletion(null),
      );
    } catch {
      setDeckDeletionError(deckDeletionErrorMessage);
    } finally {
      setIsDeletingDeck(false);
    }
  };

  const activeAdvancedFilterCount =
    (activePartOfSpeech !== 'All' ? 1 : 0) +
    (activeDifficulty !== 'All' ? 1 : 0) +
    (activeDate !== 'All' ? 1 : 0);

  useEffect(() => {
    if (activeAdvancedFilterCount > 0) setShowAdvancedFilters(true);
  }, [activeAdvancedFilterCount]);

  const clearAllFilters = () => {
    setSearchQuery('');
    setShowStarredOnly(false);
    setActivePartOfSpeech('All');
    setActiveDifficulty('All');
    setActiveDate('All');
    setActiveCategory('All');
    setActiveCustomDeck('All');
  };

  const hasAnyFilterActive =
    searchQuery.trim() !== '' ||
    showStarredOnly ||
    activePartOfSpeech !== 'All' ||
    activeDifficulty !== 'All' ||
    activeDate !== 'All' ||
    activeCategory !== 'All' ||
    activeCustomDeck !== 'All';

  return (
    <aside id="library-tools" className="flex scroll-mt-4 flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
      {/* 1. Smart AI Card Creation Bar */}
      <section data-library-tool="create" data-tool-priority="primary" className="rounded-[24px] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-5 shadow-[0_28px_70px_-52px_var(--sf-shadow)] sm:p-6" aria-labelledby="create-card-heading">
        <div className="mb-3.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-xl bg-[var(--sf-brand)] text-[var(--sf-on-brand)] shadow-sm">
              <Sparkles size={16} aria-hidden="true" />
            </span>
            <div>
              <h2 id="create-card-heading" className="text-base font-black tracking-tight text-[var(--sf-text)]">
                Create a card
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
            data-tool-priority="secondary"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-transparent bg-transparent text-[var(--sf-text-muted)] transition-colors hover:border-[var(--sf-border)] hover:bg-[var(--sf-surface-raised)] hover:text-[var(--sf-brand-text)] disabled:opacity-50"
            title={isImporting ? 'Import in progress' : 'Import cards from Excel or CSV'}
            aria-label={isImporting ? 'Import in progress' : 'Import cards from Excel or CSV'}
          >
            {isImporting ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <FileUp size={16} aria-hidden="true" />}
            <input
              type="file"
              name="card-import"
              aria-label="Choose an Excel or CSV file"
              ref={fileInputRef}
              onChange={onImport}
              disabled={isLoading}
              className="hidden"
              accept=".xlsx, .xls, .csv"
            />
          </button>
        </div>

        <SpreadsheetImportStatus progress={importProgress} result={importResult} />

        <form onSubmit={onGenerate} className="mt-3 space-y-3">
          <div>
            <label htmlFor="new-word" className="sr-only">
              English word
            </label>
            <div className="relative">
              <input
                id="new-word"
                type="text"
                value={wordInput}
                onChange={event => setWordInput(event.target.value)}
                placeholder="Type an English word (e.g. serendipity)…"
                disabled={isLoading}
                className={`w-full rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-3.5 py-2.5 text-sm font-semibold text-[var(--sf-text)] placeholder:text-[var(--sf-text-muted)] focus:border-[var(--sf-brand)] focus:outline-none disabled:cursor-wait ${
                  isLoading ? 'border-[var(--sf-brand)]' : ''
                }`}
              />
            </div>
            {isGenerating && (
              <div
                role="status"
                aria-live="polite"
                className="mt-2 flex items-center justify-between px-1 text-[10px] font-black uppercase tracking-wider text-cyan-700 dark:text-cyan-300"
              >
                <span>AI is analysing</span>
                <span>Building your card</span>
              </div>
            )}
          </div>

          <button
            type="submit"
            data-color-role="primary"
            disabled={!canSubmitWord}
            aria-describedby="smart-card-generation-help"
            title={generationAccess.available ? undefined : generationAccess.message}
            className="brand-action flex w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-[var(--sf-brand)] py-3 text-xs font-black uppercase tracking-wider text-[var(--sf-on-brand)] shadow-md shadow-sky-600/20 transition-[transform,filter,opacity] duration-300 hover:scale-[1.02] hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
          >
            {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            <span>
              {isGenerating
                ? 'Creating card…'
                : isImporting
                  ? 'Import in progress…'
                  : isLoading
                    ? 'Library busy…'
                    : generationAccess.available
                      ? 'Generate smart card'
                      : 'Check library'}
            </span>
          </button>
          {/* Quick AI Assistants (Dialogue & Extractor) */}
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[var(--sf-border)]/60">
            <button
              type="button"
              data-color-role="secondary"
              onClick={() => setShowDialogueModal(true)}
              className="flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200/90 bg-slate-100/90 dark:border-white/10 dark:bg-white/5 px-3 py-2 text-xs font-bold text-[var(--sf-text)] transition-all hover:border-[var(--sf-brand)] hover:bg-slate-200 dark:hover:bg-white/10 hover:text-[var(--sf-brand-text)] hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
            >
              <MessageSquare size={14} className="text-[var(--sf-brand-text)]" aria-hidden="true" />
              <span>AI Dialogue</span>
            </button>
            <button
              type="button"
              data-color-role="secondary"
              onClick={() => setShowExtractorModal(true)}
              className="flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200/90 bg-slate-100/90 dark:border-white/10 dark:bg-white/5 px-3 py-2 text-xs font-bold text-[var(--sf-text)] transition-all hover:border-[var(--sf-brand)] hover:bg-slate-200 dark:hover:bg-white/10 hover:text-[var(--sf-brand-text)] hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
            >
              <ScanText size={14} className="text-[var(--sf-brand-text)]" aria-hidden="true" />
              <span>Scan Text</span>
            </button>
          </div>

          <p id="smart-card-generation-help" className="text-center text-[10px] font-medium leading-relaxed text-[var(--sf-text-muted)]">
            {generationAccess.available
              ? 'Definitions, phonetic audio, usage examples, and smart visuals auto-generated.'
              : generationAccess.message}
          </p>
        </form>

        <AiDialogueModal
          cards={cards}
          open={showDialogueModal}
          onOpenChange={setShowDialogueModal}
        />

        <WordExtractorModal
          open={showExtractorModal}
          onOpenChange={setShowExtractorModal}
          onImportWords={words => {
            if (words.length > 0) {
              const csvContent = 'word\n' + words.map(w => `"${w.replace(/"/g, '""')}"`).join('\n');
              const file = new File([csvContent], 'extracted_words.csv', { type: 'text/csv' });
              importFile(file);
            }
          }}
        />
      </section>

      {/* 2. Modern Library Filter Hub */}
      {libraryCount > 0 && (
        <section data-library-tool="filters" data-tool-priority="secondary" className="rounded-[20px] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-4 sm:p-5" aria-labelledby="library-filters-heading">
          {/* Header & Reset */}
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Filter size={16} className="text-[var(--sf-brand-text)]" />
              <h2 id="library-filters-heading" className="text-base font-black text-[var(--sf-text)]">
                Filters
              </h2>
            </div>
            {hasAnyFilterActive && (
              <button
                type="button"
                onClick={clearAllFilters}
                className="flex items-center gap-1 text-[11px] font-bold text-[var(--sf-brand-text)] hover:underline"
              >
                <RotateCcw size={12} />
                <span>Reset all</span>
              </button>
            )}
          </div>

          <div className="space-y-4">
            {/* Search Input */}
            <div className="relative hidden lg:block">
              <label htmlFor="library-search" className="sr-only">
                Search English words
              </label>
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-[var(--sf-text-muted)]">
                <Search size={15} />
              </div>
              <input
                id="library-search"
                name="library-search"
                type="search"
                autoComplete="off"
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
                placeholder="Search English words…"
                className="w-full rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] py-2 pl-9 pr-8 text-xs font-semibold text-[var(--sf-text)] placeholder:text-[var(--sf-text-muted)] focus:border-[var(--sf-brand)] focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute inset-y-0 right-0 flex items-center pr-2.5 text-[var(--sf-text-muted)] hover:text-[var(--sf-text)]"
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Quick Starred Toggle & More Filters Pill */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                data-color-role="reward"
                onClick={() => setShowStarredOnly(!showStarredOnly)}
                className={`flex min-h-9 items-center justify-center gap-2 rounded-full border px-3 text-xs font-bold transition-all duration-200 cursor-pointer ${
                  showStarredOnly
                    ? 'border-amber-400/80 bg-amber-500/15 text-amber-500 dark:text-amber-300 shadow-xs'
                    : 'border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-text-muted)] hover:border-amber-400/40 hover:text-amber-400'
                }`}
                role="switch"
                aria-checked={showStarredOnly}
                aria-label="Show starred cards only"
              >
                <Star size={13} className={showStarredOnly ? 'fill-amber-400 text-amber-400' : ''} />
                <span>Starred</span>
              </button>

              <button
                type="button"
                onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                className={`flex min-h-9 items-center justify-center gap-1.5 rounded-full border px-3 text-xs font-bold transition-all duration-200 cursor-pointer ${
                  activeAdvancedFilterCount > 0 || showAdvancedFilters
                    ? 'border-cyan-400/60 bg-cyan-500/15 text-cyan-500 dark:text-cyan-300 shadow-xs'
                    : 'border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-text-muted)] hover:border-cyan-400/40 hover:text-cyan-400'
                }`}
                aria-expanded={showAdvancedFilters}
              >
                <SlidersHorizontal size={13} />
                <span>More</span>
                {activeAdvancedFilterCount > 0 && (
                  <span className="flex size-4 items-center justify-center rounded-full bg-cyan-400 text-[9px] font-black text-[#071014]">
                    {activeAdvancedFilterCount}
                  </span>
                )}
                <ChevronDown size={13} className={`transition-transform duration-200 ${showAdvancedFilters ? 'rotate-180' : ''}`} />
              </button>
            </div>

            {/* Collapsible Advanced Filters Panel */}
            {showAdvancedFilters && (
              <div className="space-y-3.5 rounded-2xl border border-[var(--sf-border)] bg-[var(--sf-surface)] p-3 text-xs">
                {/* Part of Speech */}
                <div>
                  <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--sf-text-muted)]">
                    <Tags size={12} />
                    <span>Part of speech</span>
                  </label>
                  <select
                    aria-label="Filter by part of speech"
                    value={activePartOfSpeech}
                    onChange={event => setActivePartOfSpeech(event.target.value)}
                    className="min-h-9 w-full rounded-lg border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-2.5 text-xs font-semibold text-[var(--sf-text)] outline-none focus:border-[var(--sf-brand)]"
                  >
                    <option value="All">All word types</option>
                    {PART_OF_SPEECH_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Memory status */}
                <div>
                  <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--sf-text-muted)]">
                    <Award size={12} />
                    <span>Memory status</span>
                  </label>
                  <select
                    aria-label="Filter by memory status"
                    value={activeDifficulty}
                    onChange={event => setActiveDifficulty(event.target.value)}
                    className="min-h-9 w-full rounded-lg border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-2.5 text-xs font-semibold text-[var(--sf-text)] outline-none focus:border-[var(--sf-brand)]"
                  >
                    <option value="All">All statuses</option>
                    <option value="due">Due for review</option>
                    <option value="easy">Mastered</option>
                    <option value="good">Learning</option>
                    <option value="hard">Needs practice</option>
                    <option value="unrated">Not reviewed</option>
                  </select>
                </div>

                {/* Date created */}
                <div>
                  <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--sf-text-muted)]">
                    <Calendar size={12} />
                    <span>Date created</span>
                  </label>
                  {authenticated ? (
                    <div className="flex gap-1.5">
                      <input
                        type="date"
                        aria-label="Filter cloud cards by date created"
                        value={activeDate === 'All' ? '' : dateLabelToQueryDate(activeDate) || ''}
                        onChange={event => setActiveDate(event.target.value || 'All')}
                        className="min-h-9 min-w-0 flex-1 rounded-lg border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-2.5 text-xs font-semibold text-[var(--sf-text)] outline-none focus:border-[var(--sf-brand)]"
                      />
                      <button
                        type="button"
                        onClick={() => setActiveDate('All')}
                        disabled={activeDate === 'All'}
                        className="flex size-9 items-center justify-center rounded-lg border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-text)] disabled:opacity-40"
                        aria-label="Clear date filter"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <select
                      aria-label="Filter cards by date created"
                      value={activeDate}
                      onChange={event => setActiveDate(event.target.value)}
                      className="min-h-9 w-full rounded-lg border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-2.5 text-xs font-semibold text-[var(--sf-text)] outline-none focus:border-[var(--sf-brand)]"
                    >
                      {availableDates.map(date => (
                        <option key={date} value={date}>
                          {date}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            )}

            {/* Custom Decks Bar */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-[var(--sf-text-muted)]">
                  <BookOpen size={13} />
                  <span>Decks ({customDecks.length})</span>
                </h3>
                <button
                  type="button"
                  onClick={() => setShowDeckCreator(!showDeckCreator)}
                  className="flex items-center gap-1 text-[11px] font-bold text-[var(--sf-brand-text)] hover:underline"
                >
                  <Plus size={13} />
                  <span>{showDeckCreator ? 'Cancel' : 'New deck'}</span>
                </button>
              </div>

              {showDeckCreator && (
                <DeckCreationForm
                  value={newDeckInput}
                  onChange={value => {
                    setDeckCreationError(null);
                    setNewDeckInput(value);
                  }}
                  onSubmit={() => {
                    void handleCreateDeck();
                  }}
                  isCreating={isCreatingDeck}
                  error={deckCreationError}
                />
              )}

              <div className="flex max-h-[140px] flex-wrap gap-1.5 overflow-y-auto pr-1 scrollbar-none">
                <DeckButton active={activeCustomDeck === 'All'} onClick={() => setActiveCustomDeck('All')} icon={<Layers3 size={13} />} label="All decks" buttonRef={deckDeletionRestoreRef} />
                <DeckButton
                  active={activeCustomDeck === 'Unassigned'}
                  onClick={() => setActiveCustomDeck('Unassigned')}
                  icon={<Folder size={13} />}
                  label="Unassigned"
                  count={
                    !authenticated || activeCustomDeck === 'Unassigned'
                      ? `${cards.filter(card => !card.customDeck).length}${authenticated ? '+' : ''}`
                      : undefined
                  }
                />
                {customDecks.map(deck => (
                  <div
                    key={deck}
                    className={`flex min-h-8 items-center rounded-xl border pl-2.5 pr-1 text-xs font-bold transition-all ${
                      activeCustomDeck === deck
                        ? 'border-[var(--sf-brand)] bg-[var(--sf-brand)] text-[var(--sf-on-brand)] shadow-xs'
                        : 'border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-text-muted)] hover:text-[var(--sf-text)]'
                    }`}
                  >
                    <button
                      type="button"
                      aria-pressed={activeCustomDeck === deck}
                      onClick={() => setActiveCustomDeck(deck)}
                      className="flex items-center gap-1.5 py-1"
                    >
                      <Folder size={12} />
                      <span className="max-w-28 truncate">{deck}</span>
                      {(!authenticated || activeCustomDeck === deck) && (
                        <span className="text-[10px] opacity-70">
                          {cards.filter(card => card.customDeck === deck).length}
                          {authenticated ? '+' : ''}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDeckDeletionError(null);
                        setDeckPendingDeletion(deck);
                      }}
                      className="ml-1 flex size-6 items-center justify-center rounded-md text-inherit opacity-60 hover:bg-rose-600 hover:text-white hover:opacity-100"
                      title="Delete this deck"
                      aria-label={`Delete ${deck} deck`}
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {/* Categories Carousel */}
            <div>
              <h3 className="mb-2 flex items-center gap-1.5 text-xs font-black uppercase tracking-wider text-[var(--sf-text-muted)]">
                <Tags size={13} />
                <span>Categories</span>
              </h3>
              <div className="flex max-h-[160px] flex-wrap gap-1.5 overflow-y-auto pr-1 scrollbar-none">
                {sortedCategories.map(category => (
                  <button
                    key={category}
                    type="button"
                    aria-pressed={activeCategory === category}
                    onClick={() => setActiveCategory(category)}
                    className={`flex min-h-8 items-center gap-1.5 rounded-xl border px-2.5 py-1 text-xs font-bold transition-all ${
                      activeCategory === category
                        ? 'border-[var(--sf-brand)] bg-[var(--sf-brand)] text-[var(--sf-on-brand)] shadow-xs'
                        : 'border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-text-muted)] hover:border-cyan-400/40 hover:text-[var(--sf-text)]'
                    }`}
                  >
                    <span>{category}</span>
                    <span className="text-[10px] opacity-70">
                      {authenticated && category !== 'All' && !cloudFacetsComplete
                        ? `${categoryCounts[category] || 0}+`
                        : categoryCounts[category] || 0}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Deletion confirmation dialog */}
      <DeckDeletionDialog
        deckName={deckPendingDeletion ?? ''}
        assignedCardCount={pendingDeckCardCount}
        open={deckPendingDeletion !== null}
        onOpenChange={open => {
          if (!open && !isDeletingDeck) {
            setDeckPendingDeletion(null);
            setDeckDeletionError(null);
          }
        }}
        onConfirm={() => {
          void handleDeleteDeck();
        }}
        restoreFocusRef={deckDeletionRestoreRef}
        isDeleting={isDeletingDeck}
        error={deckDeletionError}
      />
    </aside>
  );
}

function DeckButton({
  active,
  onClick,
  icon,
  label,
  count,
  buttonRef,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  count?: string;
  buttonRef?: RefObject<HTMLButtonElement | null>;
}) {
  return (
    <button
      ref={buttonRef}
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex min-h-8 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-all duration-200 cursor-pointer ${
        active
          ? 'border-cyan-400/80 bg-cyan-400 text-[#071014] font-extrabold shadow-sm shadow-cyan-500/20 scale-[1.02]'
          : 'border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-text-muted)] hover:border-cyan-400/50 hover:text-[var(--sf-text)]'
      }`}
    >
      {icon}
      <span>{label}</span>
      {count && <span className={`text-[10px] ${active ? 'text-[#071014]/80' : 'opacity-70'}`}>{count}</span>}
    </button>
  );
}
