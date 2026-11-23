import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { lazy, Suspense, useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode, type RefObject } from 'react';
import { i18n } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react';
import {
  AlertTriangle,
  ArrowRight,
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
  Trash2,
  X,
} from 'lucide-react';
import type { CardData } from '../../types/card';
import { courseWordCopy } from './courseLanguageCopy';
import { ENGLISH_TO_VIETNAMESE_PROFILE, type LanguageProfile } from '../language/languageProfile';
import { PART_OF_SPEECH_OPTIONS } from '../../lib/cardQuery';
import { formatNumber } from '../../lib/format';
import './library-dialog-overlays.css';
import { createImeSubmitGuard } from '../../lib/imeSubmitGuard';
import { getActiveUiLocale, loadCatalog } from '../../i18n/loadCatalog';
import { ALL_PRACTICE_DECK_SCOPE, type PracticeDeckScope } from '../../lib/practiceScope';
import type { CardGenerationOptions } from '../intake/cardIntakeController';
import type {
  SpreadsheetImportProgress,
  SpreadsheetImportResult,
} from '../importExport/spreadsheetImportService';
import {
  SpreadsheetImportDialog,
  downloadSpreadsheetImportErrorReport,
} from '../importExport/SpreadsheetImportDialog';
import { dateLabelToQueryDate, displayCardDate } from './libraryPresentation';
import {
  CUSTOM_DECK_RESERVED_NAME_ERROR,
  isReservedCustomDeckName,
  normalizeCustomDeckName,
} from './customDecks';
import type { AiGenerationAccess } from './aiGenerationAccess';
import { AiDialogueModal } from './AiDialogueModal';
import { DeckCreationDialog, type LibraryDialogPhase } from './LibraryDialogOverlays';
import { customDeckCoverKey, deckMonogram, defaultCoverPreset, normalizeCoverPreset, type CoverPreset } from './customDecks';
import { WordExtractorModal } from './WordExtractorModal';
import { createExtractedWordsCsv } from './extractedWordsImport';
const PlanUsageMeter = lazy(() => Promise.all([
  import('../plan/PlanUsageMeter'), loadCatalog(getActiveUiLocale(), 'billing'),
]).then(([module]) => ({ default: module.PlanUsageMeter })));

export { createExtractedWordsCsv } from './extractedWordsImport';

interface LibraryToolsProps {
  fileInputRef: RefObject<HTMLInputElement | null>;
  onImport: (event: ChangeEvent<HTMLInputElement>) => void;
  importFile: (file: File) => void;
  onGenerate: (event: FormEvent, options?: CardGenerationOptions) => Promise<void>;
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
  customDeckCoverPresets?: Record<string, CoverPreset>;
  newDeckInput: string;
  setNewDeckInput: (value: string) => void;
  createCustomDeck: (name: string, preset?: CoverPreset) => Promise<void>;
  activeCustomDeck: PracticeDeckScope;
  setActiveCustomDeck: (value: PracticeDeckScope) => void;
  cards: CardData[];
  deleteCustomDeck: (name: string) => Promise<void>;
  cloudFacetsComplete: boolean;
  sortedCategories: string[];
  categoryCounts: Record<string, number>;
  activeCategory: string;
  setActiveCategory: (value: string) => void;
  languageProfile?: LanguageProfile;
  ownerId?: string | null;
}

const partOfSpeechMessages = {
  noun: msg({ id: 'library.part-of-speech.noun', message: 'Noun' }),
  verb: msg({ id: 'library.part-of-speech.verb', message: 'Verb' }),
  adjective: msg({ id: 'library.part-of-speech.adjective', message: 'Adjective' }),
  adverb: msg({ id: 'library.part-of-speech.adverb', message: 'Adverb' }),
  pronoun: msg({ id: 'library.part-of-speech.pronoun', message: 'Pronoun' }),
  preposition: msg({ id: 'library.part-of-speech.preposition', message: 'Preposition' }),
  conjunction: msg({ id: 'library.part-of-speech.conjunction', message: 'Conjunction' }),
  determiner: msg({ id: 'library.part-of-speech.determiner', message: 'Determiner' }),
  interjection: msg({ id: 'library.part-of-speech.interjection', message: 'Interjection' }),
  'phrasal verb': msg({ id: 'library.part-of-speech.phrasal-verb', message: 'Phrasal verb' }),
  'auxiliary verb': msg({ id: 'library.part-of-speech.auxiliary-verb', message: 'Auxiliary verb' }),
  'modal verb': msg({ id: 'library.part-of-speech.modal-verb', message: 'Modal verb' }),
  article: msg({ id: 'library.part-of-speech.article', message: 'Article' }),
  numeral: msg({ id: 'library.part-of-speech.numeral', message: 'Numeral' }),
  idiom: msg({ id: 'library.part-of-speech.idiom', message: 'Idiom' }),
  phrase: msg({ id: 'library.part-of-speech.phrase', message: 'Phrase' }),
} satisfies Record<(typeof PART_OF_SPEECH_OPTIONS)[number]['value'], ReturnType<typeof msg>>;

const assistantButtonClass = 'flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-control)] px-3 py-2 text-xs font-bold text-[var(--sf-text)] transition-colors hover:border-[var(--sf-brand)] hover:bg-[var(--sf-surface-raised)] hover:text-[var(--sf-brand-text)] cursor-pointer';
const filterLabelClass = 'mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--sf-text-muted)]';
const filterSelectClass = 'min-h-11 w-full rounded-lg border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-2.5 text-xs font-semibold text-[var(--sf-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)] focus:border-[var(--sf-brand)]';

type DeckDeletionOwnerId = string | null | undefined;
type DeckDeletionIntent = { name: string; ownerId: DeckDeletionOwnerId };

export function getDeckCreationValidationError(input: string): string | null {
  return isReservedCustomDeckName(normalizeCustomDeckName(input))
    ? CUSTOM_DECK_RESERVED_NAME_ERROR
    : null;
}

export function getGenerationDeckSelection(activeCustomDeck: PracticeDeckScope, customDecks: readonly string[]): string {
  if (activeCustomDeck.kind !== 'deck') return '';
  return customDecks.includes(activeCustomDeck.name) ? activeCustomDeck.name : '';
}

export function SpreadsheetImportStatus({
  progress,
  result,
}: {
  progress: SpreadsheetImportProgress | null;
  result: SpreadsheetImportResult | null;
}) {
  if (progress) {
    return (
      <div role="status" aria-live="polite" className="mt-3 rounded-xl border border-[color-mix(in_srgb,var(--sf-brand)_40%,var(--sf-border))] bg-[color-mix(in_srgb,var(--sf-brand)_9%,transparent)] px-3 py-2 text-xs font-semibold text-[var(--sf-text)] [html[data-theme-family=crystal]_&]:crystal-chamfer-sm">
        <span className="block font-bold"><Trans {...msg({ context: 'library.import.progress', message: 'Importing {current, number} of {total, number}' })} values={{ current: progress.current, total: progress.total }} /></span>
        <span className="mt-0.5 block truncate text-[11px] text-[var(--sf-text-muted)]"><Trans {...msg({ context: 'library.import.current-word', message: 'Current word: {word}' })} values={{ word: progress.word }} /></span>
        <progress className="mt-2 h-1.5 w-full overflow-hidden rounded-full accent-[var(--sf-brand)]" value={progress.current} max={progress.total}>
          {progress.current} / {progress.total}
        </progress>
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
      className={`mt-3 rounded-xl border px-3 py-2 text-xs font-semibold text-[var(--sf-text)] [html[data-theme-family=crystal]_&]:crystal-chamfer-sm ${
        isWarning
          ? 'border-[color-mix(in_srgb,var(--sf-reward)_45%,var(--sf-border))] bg-[color-mix(in_srgb,var(--sf-reward)_10%,transparent)]'
          : 'border-[color-mix(in_srgb,var(--sf-success)_45%,var(--sf-border))] bg-[color-mix(in_srgb,var(--sf-success)_10%,transparent)]'
      }`}
    >
      <span className="block font-bold">{result.status === 'completed' ? <Trans {...msg({ context: 'library.import.complete', message: 'Import complete' })} /> : result.status === 'partial' ? <Trans {...msg({ context: 'library.import.partial', message: 'Import partly complete' })} /> : <Trans {...msg({ context: 'library.import.failed', message: 'Import failed' })} />}</span>
      <span className="mt-1 block text-[11px] leading-relaxed">
        <Trans {...msg({ context: 'library.import.summary', message: '{created, plural, one {# created} other {# created}} · {reused, plural, one {# already present} other {# already present}} · {failed, plural, one {# failed} other {# failed}} · {skipped, plural, one {# skipped} other {# skipped}}' })} values={{ created: summary.created, reused: summary.reused, failed: summary.failed, skipped: summary.skipped }} />
      </span>
      <span className="mt-1 block text-[11px] leading-relaxed text-[var(--sf-text-muted)]">
        {result.status === 'completed' ? (
          <Trans {...msg({ context: 'library.import.completed-guidance', message: 'Your new and existing cards are ready in the library.' })} />
        ) : result.status === 'partial' ? (
          <Trans {...msg({ id: 'library.import.partial-guidance', message: 'Retry the failed or skipped words later.' })} />
        ) : result.reason === 'size' ? (
          <Trans {...msg({ context: 'library.import.failure-size', message: 'Choose a smaller spreadsheet, then try again.' })} />
        ) : result.reason === 'read' ? (
          <Trans {...msg({ context: 'library.import.failure-read', message: 'Check that the spreadsheet can be opened, then try again.' })} />
        ) : result.reason === 'parse' ? (
          <Trans {...msg({ context: 'library.import.failure-parse', message: 'Check the spreadsheet columns and format, then try again.' })} />
        ) : result.reason === 'empty' ? (
          <Trans {...msg({ context: 'library.import.failure-empty', message: 'Add at least one word to the spreadsheet, then try again.' })} />
        ) : result.reason === 'items' && result.generationLimited ? (
          <Trans {...msg({ context: 'library.import.failure-limited', message: 'Your AI card allowance does not cover more generated cards right now.' })} />
        ) : result.reason === 'items' ? (
          <Trans {...msg({ context: 'library.import.failure-items', message: 'Check your sign-in and connection, then try again.' })} />
        ) : (
          <Trans {...msg({ context: 'library.import.failure-save', message: 'Check your connection, then try again.' })} />
        )}
      </span>
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
  intent: DeckDeletionIntent,
  currentOwnerId: DeckDeletionOwnerId,
  deleteDeck: (name: string) => Promise<void>,
  closeDialog: () => void,
) {
  if (intent.ownerId !== currentOwnerId) return false;
  await deleteDeck(intent.name);
  closeDialog();
  return true;
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
          aria-label={i18n._(msg({ id: "library-tools.new-deck-name", message: "New deck name" }))}
          value={value}
          onChange={event => onChange(event.target.value)}
          placeholder={i18n._(msg({ id: "library-tools.ielts-travel", message: "IELTS, Travel…" }))}
          disabled={isCreating}
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-3 py-2 text-sm font-semibold text-[var(--sf-text)] placeholder:text-[var(--sf-text-muted)] focus:border-[var(--sf-brand)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)] disabled:cursor-wait disabled:opacity-70"
        />
        <button
          type="submit"
          disabled={isCreating || !value.trim()}
          className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-[var(--sf-brand)] px-3 text-xs font-bold text-[var(--sf-on-brand)] transition-colors hover:bg-[var(--sf-brand-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          aria-label={isCreating ? i18n._(msg({ id: 'library.deck.creating-aria', message: 'Creating deck' })) : i18n._(msg({ context: 'library.deck.creation-submit', message: 'Create deck' }))}
        >
          {isCreating ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Plus size={15} aria-hidden="true" />}
          <span>{isCreating ? i18n._(msg({ context: 'library.deck.creating', message: 'Creating…' })) : i18n._(msg({ id: 'library.deck.create-short', message: 'Create' }))}</span>
        </button>
      </form>
      {error ? <p role="alert" className="mt-2 text-xs font-semibold leading-relaxed text-[var(--sf-danger)]">{error}</p> : null}
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

/**
 * The deck's exact size for the delete confirmation, or `undefined` when it is not known: a signed-in
 * learner's `cards` is one cloud page, so counting it would understate the cards that move to Unassigned.
 */
export function countDeckCardsForDeletion(
  cards: readonly Pick<CardData, 'customDeck'>[],
  deckName: string,
  authenticated: boolean,
): number | undefined {
  return authenticated ? undefined : cards.filter(card => card.customDeck === deckName).length;
}

export function DeckDeletionDialogContent({
  deckName,
  assignedCardCount,
  unassignedCardCount,
  onConfirm,
  restoreFocusRef,
  isDeleting = false,
  error = false,
}: {
  deckName: string;
  assignedCardCount?: number;
  /** Cards already unassigned; omitted when the local list is not the full library. */
  unassignedCardCount?: number;
  onConfirm: () => void;
  restoreFocusRef?: RefObject<HTMLButtonElement | null>;
  isDeleting?: boolean;
  error?: boolean;
}) {
  return (
    <>
      <AlertDialog.Overlay className="library-dialog-overlay library-dialog-overlay--danger" />
      <AlertDialog.Content
        className="library-dialog-frame library-dialog-frame--deck-delete"
        onCloseAutoFocus={event => restoreDeckDeletionFocus(event, restoreFocusRef)}
        onEscapeKeyDown={event => {
          if (isDeleting) event.preventDefault();
        }}
      >
        <header className="library-dialog-header">
          <div className="library-dialog-heading-with-icon">
            <span className="library-dialog-danger-icon" aria-hidden="true"><Trash2 size={20} /></span>
            <div>
              <p className="library-dialog-kicker"><Trans {...msg({ context: 'library.deck.delete-kicker', message: 'Delete deck' })} /></p>
              <AlertDialog.Title className="library-dialog-title"><Trans {...msg({ context: 'library.deck.delete-dialog-title', message: 'Delete “{deckName}”?' })} values={{ deckName }} /></AlertDialog.Title>
            </div>
          </div>
          <AlertDialog.Cancel
            className="library-dialog-icon-button"
            aria-label={i18n._(msg({ id: 'library.close', message: 'Close' }))}
            disabled={isDeleting}
          >
            <X size={17} aria-hidden="true" />
          </AlertDialog.Cancel>
        </header>

        <div className="library-dialog-body">
          <AlertDialog.Description className="library-dialog-description library-dialog-description--body">
            {assignedCardCount === undefined ? (
              <Trans
                {...msg({ context: 'library.deck.delete-effect-uncounted', message: 'The deck goes away, but its cards stay in your library and move to <0>Unassigned</0>. Nothing you have learned is lost.' })}
                components={{ 0: <strong /> }}
              />
            ) : <Trans
              {...msg({ context: 'library.deck.delete-effect', message: '{count, plural, one {The deck goes away, but its <0>#</0> card stays in your library and moves to <1>Unassigned</1>. Nothing you have learned is lost.} other {The deck goes away, but its <0>#</0> cards stay in your library and move to <1>Unassigned</1>. Nothing you have learned is lost.}}' })}
              values={{ count: assignedCardCount }}
              components={{ 0: <code />, 1: <strong /> }}
            />}
          </AlertDialog.Description>
          <div className="library-deck-transfer">
            <div>
              <span>{deckName}</span>
              {assignedCardCount !== undefined && <strong><s>{formatNumber(assignedCardCount)}</s></strong>}
              <small><Trans {...msg({ context: 'library.deck.removed-caption', message: 'deck removed' })} /></small>
            </div>
            <ArrowRight size={16} aria-hidden="true" />
            <div>
              <span><Trans {...msg({ context: 'library.deck.unassigned', message: 'Unassigned' })} /></span>
              {assignedCardCount === undefined ? (
                <small><Trans {...msg({ context: 'library.deck.unassigned-incoming-uncounted', message: 'its cards move here' })} /></small>
              ) : typeof unassignedCardCount === 'number' ? (
                <>
                  <strong>{formatNumber(unassignedCardCount + assignedCardCount)}</strong>
                  <small><Trans {...msg({ context: 'library.deck.unassigned-sum', message: '{current} + {moved, plural, one {# card} other {# cards}}' })} values={{ current: formatNumber(unassignedCardCount), moved: assignedCardCount }} /></small>
                </>
              ) : (
                <>
                  <strong>+{formatNumber(assignedCardCount)}</strong>
                  <small><Trans {...msg({ context: 'library.deck.unassigned-incoming', message: '{count, plural, one {card moves here} other {cards move here}}' })} values={{ count: assignedCardCount }} /></small>
                </>
              )}
            </div>
          </div>
          <p className="library-dialog-footnote"><Trans {...msg({ context: 'library.deck.progress-kept', message: 'Review schedules and mastery are kept for every card.' })} /></p>
          {error ? <p role="alert" className="library-dialog-error"><AlertTriangle size={15} aria-hidden="true" /><Trans {...msg({ id: 'library.deck.delete-error', message: 'Could not finish deleting this deck. Refreshing the latest cloud state; try again.' })} /></p> : null}
        </div>

        <footer className="library-dialog-footer">
          <AlertDialog.Cancel disabled={isDeleting} className="library-dialog-button library-dialog-button--secondary"><Trans {...msg({ context: 'library.deck.keep', message: 'Keep deck' })} /></AlertDialog.Cancel>
          <AlertDialog.Action
            disabled={isDeleting}
            aria-busy={isDeleting}
            onClick={event => {
              event.preventDefault();
              if (!isDeleting) onConfirm();
            }}
            className="library-dialog-button library-dialog-button--danger"
          >
            {isDeleting ? <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
            {isDeleting ? <Trans {...msg({ context: 'library.deck.deleting', message: 'Deleting…' })} /> : error ? <Trans {...msg({ context: 'library.deck.delete-again', message: 'Try deleting again' })} /> : <Trans {...msg({ context: 'library.deck.delete', message: 'Delete deck' })} />}
          </AlertDialog.Action>
        </footer>
      </AlertDialog.Content>
    </>
  );
}

export function DeckDeletionDialog({
  deckName,
  assignedCardCount,
  unassignedCardCount,
  open,
  onOpenChange,
  onConfirm,
  restoreFocusRef,
  isDeleting,
  error,
}: {
  deckName: string;
  /** Omitted when the deck's exact size is not loaded, so the dialog states no number. */
  assignedCardCount?: number;
  unassignedCardCount?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  restoreFocusRef?: RefObject<HTMLButtonElement | null>;
  isDeleting: boolean;
  error: boolean;
}) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <DeckDeletionDialogContent
          deckName={deckName}
          assignedCardCount={assignedCardCount}
          unassignedCardCount={unassignedCardCount}
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
  customDeckCoverPresets = {},
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
  languageProfile = ENGLISH_TO_VIETNAMESE_PROFILE,
  ownerId,
}: LibraryToolsProps) {
  const { i18n: catalog } = useLingui();
  const wordCopy = courseWordCopy(catalog, languageProfile);
  const authenticated = isAuthenticated ?? Boolean(user);
  const ownerIdRef = useRef<DeckDeletionOwnerId>(ownerId);
  ownerIdRef.current = ownerId;
  const [deckPendingDeletion, setDeckPendingDeletion] = useState<DeckDeletionIntent | null>(null);
  const [isCreatingDeck, setIsCreatingDeck] = useState(false);
  const [deckCreationError, setDeckCreationError] = useState(false);
  const [deckCreationPhase, setDeckCreationPhase] = useState<LibraryDialogPhase>('idle');
  const [deckCoverPreset, setDeckCoverPreset] = useState<CoverPreset>(defaultCoverPreset);
  const [isDeletingDeck, setIsDeletingDeck] = useState(false);
  const [deckDeletionError, setDeckDeletionError] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(
    activePartOfSpeech !== 'All' || activeDifficulty !== 'All' || activeDate !== 'All',
  );
  const [showDeckCreator, setShowDeckCreator] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const [showDialogueModal, setShowDialogueModal] = useState(false);
  const [showExtractorModal, setShowExtractorModal] = useState(false);
  const imeSubmitGuard = useRef(createImeSubmitGuard()).current;
  const pointerSubmit = useRef(false);

  const deckDeletionRestoreRef = useRef<HTMLButtonElement | null>(null);
  const deckCreatorRestoreRef = useRef<HTMLButtonElement | null>(null);
  const importRestoreRef = useRef<HTMLButtonElement | null>(null);
  const extractorRestoreRef = useRef<HTMLButtonElement | null>(null);
  const [generationDeck, setGenerationDeck] = useState(() => getGenerationDeckSelection(activeCustomDeck, customDecks));

  const currentPendingDeletion = deckPendingDeletion?.ownerId === ownerIdRef.current ? deckPendingDeletion : null;
  const pendingDeckCardCount = currentPendingDeletion
    ? countDeckCardsForDeletion(cards, currentPendingDeletion.name, authenticated)
    : undefined;
  const canSubmitWord = Boolean(wordInput.trim()) && !isLoading;

  const handleImportChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImportFileName(file.name);
    setImportDialogOpen(true);
    onImport(event);
  };

  const handleImportFile = (file: File) => {
    setImportFileName(file.name);
    setImportDialogOpen(true);
    importFile(file);
  };

  const handleCreateDeck = async () => {
    if (!newDeckInput.trim() || isCreatingDeck) return;
    const validationError = getDeckCreationValidationError(newDeckInput);
    if (validationError) {
      setDeckCreationError(true);
      return;
    }
    setIsCreatingDeck(true);
    setDeckCreationError(false);
    setDeckCreationPhase('working');
    try {
      await createDeckThenClearInput(
        newDeckInput.trim(),
        name => createCustomDeck(name, deckCoverPreset),
        () => {
          setNewDeckInput('');
        },
      );
      setDeckCreationPhase('success');
    } catch {
      setDeckCreationError(true);
      setDeckCreationPhase('failure');
    } finally {
      setIsCreatingDeck(false);
    }
  };

  const handleDeleteDeck = async () => {
    const pendingDeletion = deckPendingDeletion;
    if (!pendingDeletion || isDeletingDeck) return;
    if (pendingDeletion.ownerId !== ownerIdRef.current) {
      setDeckPendingDeletion(null);
      setDeckDeletionError(false);
      return;
    }
    setIsDeletingDeck(true);
    setDeckDeletionError(false);
    try {
      await deleteDeckThenCloseDialog(
        pendingDeletion,
        ownerIdRef.current,
        deleteCustomDeck,
        () => setDeckPendingDeletion(current => (
          current?.name === pendingDeletion.name && current.ownerId === pendingDeletion.ownerId ? null : current
        )),
      );
    } catch {
      if (pendingDeletion.ownerId === ownerIdRef.current) setDeckDeletionError(true);
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

  useEffect(() => {
    if (isImporting) setImportDialogOpen(true);
  }, [isImporting]);

  useEffect(() => {
    setGenerationDeck(getGenerationDeckSelection(activeCustomDeck, customDecks));
  }, [activeCustomDeck, customDecks]);

  useEffect(() => {
    setDeckPendingDeletion(current => current?.ownerId === ownerIdRef.current ? current : null);
    setDeckDeletionError(false);
  }, [ownerId]);

  const validGenerationDeck = customDecks.includes(generationDeck) ? generationDeck : '';

  const clearAllFilters = () => {
    setSearchQuery('');
    setShowStarredOnly(false);
    setActivePartOfSpeech('All');
    setActiveDifficulty('All');
    setActiveDate('All');
    setActiveCategory('All');
    setActiveCustomDeck(ALL_PRACTICE_DECK_SCOPE);
  };

  const hasAnyFilterActive =
    searchQuery.trim() !== '' ||
    showStarredOnly ||
    activePartOfSpeech !== 'All' ||
    activeDifficulty !== 'All' ||
    activeDate !== 'All' ||
    activeCategory !== 'All' ||
    activeCustomDeck.kind !== 'all';
  const generationHelp = generationAccess.available
    ? null
    : catalog._(msg({ id: 'library.create.sign-in-help', message: 'Sign in to generate smart cards.' }));

  return (
    <aside id="library-tools" className="flex scroll-mt-4 flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
      {/* 1. Smart AI Card Creation Bar */}
      <section data-library-tool="create" data-tool-priority="primary" className="premium-surface rounded-[24px] p-5 sm:p-6" aria-labelledby="create-card-heading">
        <div className="mb-3.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-xl bg-[var(--sf-brand)] text-[var(--sf-on-brand)] shadow-sm">
              <Sparkles size={16} aria-hidden="true" />
            </span>
            <div>
              <h2 id="create-card-heading" className="text-base font-black tracking-tight text-[var(--sf-text)]">
                <Trans {...msg({ context: 'library.create.title', message: 'Create a card' })} />
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            ref={importRestoreRef}
            disabled={isLoading}
            data-tool-priority="secondary"
            className="flex min-h-12 min-w-12 items-center justify-center rounded-xl border border-transparent bg-transparent text-[var(--sf-text-muted)] transition-colors hover:border-[var(--sf-border)] hover:bg-[var(--sf-surface-raised)] hover:text-[var(--sf-brand-text)] disabled:opacity-50"
            title={isImporting ? i18n._(msg({ id: 'library.import.in-progress', message: 'Import in progress' })) : i18n._(msg({ id: 'library.import.action', message: 'Import cards from Excel or CSV' }))}
            aria-label={isImporting ? i18n._(msg({ id: 'library.import.in-progress', message: 'Import in progress' })) : i18n._(msg({ id: 'library.import.action', message: 'Import cards from Excel or CSV' }))}
          >
            {isImporting ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <FileUp size={16} aria-hidden="true" />}
            <input
              type="file"
              name="card-import"
              aria-label={i18n._(msg({ id: 'library.import.choose-file', message: 'Choose an Excel or CSV file' }))}
              ref={fileInputRef}
              onChange={handleImportChange}
              disabled={isLoading}
              className="hidden"
              accept=".xlsx, .csv"
            />
          </button>
        </div>

        {!importDialogOpen ? <SpreadsheetImportStatus progress={importProgress} result={importResult} /> : null}

        <form
          onSubmit={event => {
            const submittedByPointer = pointerSubmit.current;
            pointerSubmit.current = false;
            if (imeSubmitGuard.shouldBlockSubmit(event.nativeEvent as SubmitEvent & { isComposing?: boolean; keyCode?: number }, submittedByPointer)) {
              event.preventDefault();
              return;
            }
            void onGenerate(event, validGenerationDeck ? { requestedDeck: validGenerationDeck, requestedDeckAvailable: deck => customDecks.includes(deck) } : undefined);
          }}
          className="mt-3 space-y-3"
        >
          {authenticated && <Suspense fallback={null}><PlanUsageMeter /></Suspense>}
          <div>
            <label htmlFor="new-word" className="sr-only">{wordCopy.wordLabel}</label>
            <div className="relative">
              <input
                id="new-word"
                type="text"
                value={wordInput}
                onChange={event => setWordInput(event.target.value)}
                onCompositionStart={imeSubmitGuard.onCompositionStart}
                onCompositionEnd={imeSubmitGuard.onCompositionEnd}
                onKeyDown={event => { if (imeSubmitGuard.shouldBlockKeyDown(event.nativeEvent)) event.preventDefault(); }}
                lang={wordCopy.lang}
                inputMode="text"
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder={wordCopy.wordPlaceholder}
                disabled={isLoading}
                className={`min-h-11 w-full rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-3.5 py-2.5 text-sm font-semibold text-[var(--sf-text)] placeholder:text-[var(--sf-text-muted)] focus:border-[var(--sf-brand)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)] disabled:cursor-wait ${
                  isLoading ? 'border-[var(--sf-brand)]' : ''
                }`}
              />
            </div>
            {isGenerating && (
              <div
                role="status"
                aria-live="polite"
                className="mt-2 flex items-center justify-between px-1 text-[10px] font-black uppercase tracking-wider text-[var(--sf-brand-text)]"
              >
                <span><Trans {...msg({ context: 'library.create.analysing', message: 'AI is analysing' })} /></span>
                <span><Trans {...msg({ context: 'library.create.building', message: 'Building your card' })} /></span>
              </div>
            )}
          </div>

          <div>
            <label htmlFor="new-card-deck" className="mb-1.5 block text-xs font-bold text-[var(--sf-text-muted)]"><Trans {...msg({ context: 'library-tools.deck-space', message: 'Deck space' })} /></label>
            <select
              id="new-card-deck"
              value={validGenerationDeck}
              onChange={event => setGenerationDeck(event.target.value)}
              disabled={isLoading}
              className="min-h-11 w-full rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-3 text-sm font-semibold text-[var(--sf-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)] focus:border-[var(--sf-brand)] disabled:cursor-wait disabled:opacity-70"
            >
              <option value=""><Trans {...msg({ context: 'library-tools.unassigned', message: 'Unassigned' })} /></option>
              {customDecks.map(deck => <option key={deck} value={deck}>{deck}</option>)}
            </select>
          </div>

          <button
            type="submit"
            onPointerDown={() => { pointerSubmit.current = true; setTimeout(() => { pointerSubmit.current = false; }, 0); }}
            data-color-role="primary"
            disabled={!canSubmitWord}
            aria-describedby="smart-card-generation-help"
              className="shimmer-sweep brand-action flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-[var(--sf-brand)] py-3 text-xs font-black uppercase tracking-wider text-[var(--sf-on-brand)] shadow-md shadow-[0_10px_24px_-14px_var(--sf-brand)] transition-[background-color,box-shadow,transform] duration-300 hover:scale-[1.02] hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100 cursor-pointer"
          >
            {isLoading ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            <span>
              {isGenerating
                ? i18n._(msg({ id: 'library.create.creating', message: 'Creating card…' }))
                : isImporting
                  ? i18n._(msg({ id: 'library.create.importing', message: 'Import in progress…' }))
                  : isLoading
                    ? i18n._(msg({ id: 'library.create.busy', message: 'Library busy…' }))
                    : generationAccess.available
                      ? i18n._(msg({ id: 'library.create.generate', message: 'Generate smart card' }))
                      : i18n._(msg({ id: 'library.create.check-library', message: 'Check library' }))}
            </span>
          </button>
          {/* Quick AI Assistants (Dialogue & Extractor) */}
          <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[var(--sf-border)]/60">
            <button
              type="button"
              data-color-role="secondary"
              onClick={() => setShowDialogueModal(true)}
              className={assistantButtonClass}
            >
              <MessageSquare size={14} className="text-[var(--sf-brand-text)]" aria-hidden="true" />
              <span><Trans {...msg({ context: 'library.tools.dialogue', message: 'AI Dialogue' })} /></span>
            </button>
            <button
              type="button"
              data-color-role="secondary"
              onClick={() => setShowExtractorModal(true)}
              ref={extractorRestoreRef}
              className={assistantButtonClass}
            >
              <ScanText size={14} className="text-[var(--sf-brand-text)]" aria-hidden="true" />
              <span><Trans {...msg({ context: 'library.tools.scan', message: 'Scan Text' })} /></span>
            </button>
          </div>

          <p id="smart-card-generation-help" className="text-center text-[10px] font-medium leading-relaxed text-[var(--sf-text-muted)]">
            {generationAccess.available
              ? <Trans {...msg({ context: 'library.create.help', message: 'Definitions, phonetic audio, usage examples, and smart visuals auto-generated.' })} />
              : generationHelp}
          </p>
        </form>

        <AiDialogueModal
          cards={cards}
          open={showDialogueModal}
          onOpenChange={setShowDialogueModal}
          ownerId={ownerId}
        />

        <WordExtractorModal
          key={`extractor-${ownerId ?? 'anonymous'}`}
          open={showExtractorModal}
          ownerId={ownerId}
          onOpenChange={setShowExtractorModal}
          cards={cards}
          restoreFocusRef={extractorRestoreRef}
          decks={customDecks}
          onImportItems={(items, { deck }) => {
            if (items.length > 0) {
              const csvContent = createExtractedWordsCsv(items, languageProfile, { deck });
              const file = new File([csvContent], 'extracted_words.csv', { type: 'text/csv' });
              handleImportFile(file);
            }
          }}
          languageProfile={languageProfile}
        />
      </section>

      {/* 2. Modern Library Filter Hub */}
      {libraryCount > 0 && (
        <section data-library-tool="deck-spaces" data-tool-priority="primary" className="rounded-[20px] border border-[var(--sf-border)] bg-[var(--sf-surface)] p-4 sm:p-5" aria-labelledby="library-deck-spaces-heading">
          {/* Header & Reset */}
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Filter size={16} className="text-[var(--sf-brand-text)]" />
              <h2 id="library-filters-heading" className="text-base font-black text-[var(--sf-text)]">
                <Trans {...msg({ context: 'library.filters.title', message: 'Filters' })} />
              </h2>
            </div>
            {hasAnyFilterActive && (
              <button
                type="button"
                onClick={clearAllFilters}
                className="flex min-h-11 items-center gap-1 text-[11px] font-bold text-[var(--sf-brand-text)] hover:underline"
              >
                <RotateCcw size={12} />
                <span><Trans {...msg({ context: 'library.filters.reset', message: 'Reset all' })} /></span>
              </button>
            )}
          </div>

          <div data-library-tool="filters" data-tool-priority="secondary" className="space-y-4">
            {/* Search Input */}
            <div className="relative hidden lg:block">
              <label htmlFor="library-search" className="sr-only">
                {wordCopy.searchLabel}
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
                placeholder={wordCopy.searchPlaceholder}
                className="min-h-11 w-full rounded-xl border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] py-2 pl-9 pr-8 text-xs font-semibold text-[var(--sf-text)] placeholder:text-[var(--sf-text-muted)] focus:border-[var(--sf-brand)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)]"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute inset-y-0 right-0 flex min-w-11 items-center justify-center text-[var(--sf-text-muted)] hover:text-[var(--sf-text)]"
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
                className={`flex min-h-11 items-center justify-center gap-2 rounded-full border px-3 text-xs font-bold transition-colors duration-200 cursor-pointer ${
                  showStarredOnly
                    ? 'border-[color-mix(in_srgb,var(--sf-reward)_70%,transparent)] bg-[color-mix(in_srgb,var(--sf-reward)_15%,transparent)] text-[var(--sf-reward)] shadow-xs'
                    : 'border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-text-muted)] hover:border-[color-mix(in_srgb,var(--sf-reward)_40%,transparent)] hover:text-[var(--sf-reward)]'
                }`}
                role="switch"
                aria-checked={showStarredOnly}
                aria-label={i18n._(msg({ id: 'library.filters.starred-label', message: 'Show starred cards only' }))}
              >
                <Star size={13} className={showStarredOnly ? 'fill-[var(--sf-reward)] text-[var(--sf-reward)]' : ''} />
                <span><Trans {...msg({ context: 'library.filters.starred', message: 'Starred' })} /></span>
              </button>

              <button
                type="button"
                onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                className={`flex min-h-11 items-center justify-center gap-1.5 rounded-full border px-3 text-xs font-bold transition-colors duration-200 cursor-pointer ${
                  activeAdvancedFilterCount > 0 || showAdvancedFilters
                    ? 'border-[color-mix(in_srgb,var(--sf-brand)_60%,transparent)] bg-[color-mix(in_srgb,var(--sf-brand)_15%,transparent)] text-[var(--sf-brand-text)] shadow-xs'
                    : 'border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-text-muted)] hover:border-[color-mix(in_srgb,var(--sf-brand)_40%,transparent)] hover:text-[var(--sf-brand-text)]'
                }`}
                aria-expanded={showAdvancedFilters}
              >
                <SlidersHorizontal size={13} />
                <span><Trans {...msg({ context: 'library.filters.more', message: 'More' })} /></span>
                {activeAdvancedFilterCount > 0 && (
                  <span className="flex size-4 items-center justify-center rounded-full bg-[var(--sf-brand)] text-[9px] font-black text-[var(--sf-on-brand)]">
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
                  <label className={filterLabelClass}>
                    <Tags size={12} />
                    <span><Trans {...msg({ context: 'library.filters.part-of-speech', message: 'Part of speech' })} /></span>
                  </label>
                  <select
                    aria-label={i18n._(msg({ id: 'library.filters.part-of-speech-label', message: 'Filter by part of speech' }))}
                    value={activePartOfSpeech}
                    onChange={event => setActivePartOfSpeech(event.target.value)}
                    className={filterSelectClass}
                  >
                    <option value="All">{i18n._(msg({ id: 'library.filters.all-word-types', message: 'All word types' }))}</option>
                    {PART_OF_SPEECH_OPTIONS.map(option => (
                      <option key={option.value} value={option.value}>
                        {catalog._(partOfSpeechMessages[option.value])}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Memory status */}
                <div>
                  <label className={filterLabelClass}>
                    <Award size={12} />
                    <span><Trans {...msg({ context: 'library.filters.memory-status', message: 'Memory status' })} /></span>
                  </label>
                  <select
                    aria-label={i18n._(msg({ id: 'library.filters.memory-status-label', message: 'Filter by memory status' }))}
                    value={activeDifficulty}
                    onChange={event => setActiveDifficulty(event.target.value)}
                    className={filterSelectClass}
                  >
                    <option value="All">{i18n._(msg({ id: 'library.filters.all-statuses', message: 'All statuses' }))}</option>
                    <option value="due">{i18n._(msg({ id: 'library.filters.due', message: 'Due for review' }))}</option>
                    <option value="easy">{i18n._(msg({ id: 'library.filters.mastered', message: 'Mastered' }))}</option>
                    <option value="learning">{i18n._(msg({ id: 'library.filters.learning-all', message: 'Learning and needs practice' }))}</option>
                    <option value="good">{i18n._(msg({ id: 'library.filters.learning', message: 'Learning' }))}</option>
                    <option value="hard">{i18n._(msg({ id: 'library.filters.needs-practice', message: 'Needs practice' }))}</option>
                    <option value="unrated">{i18n._(msg({ id: 'library.filters.not-reviewed', message: 'Not reviewed' }))}</option>
                  </select>
                </div>

                {/* Date created */}
                <div>
                  <label className={filterLabelClass}>
                    <Calendar size={12} />
                    <span><Trans {...msg({ context: 'library.filters.date-created', message: 'Date created' })} /></span>
                  </label>
                  {authenticated ? (
                    <div className="flex gap-1.5">
                      <input
                        type="date"
                        aria-label={i18n._(msg({ id: 'library.filters.cloud-date-label', message: 'Filter cloud cards by date created' }))}
                        value={activeDate === 'All' ? '' : dateLabelToQueryDate(activeDate) || ''}
                        onChange={event => setActiveDate(event.target.value || 'All')}
                        className="min-h-11 min-w-0 flex-1 rounded-lg border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] px-2.5 text-xs font-semibold text-[var(--sf-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sf-brand)] focus:border-[var(--sf-brand)]"
                      />
                      <button
                        type="button"
                        onClick={() => setActiveDate('All')}
                        disabled={activeDate === 'All'}
                        className="flex size-11 items-center justify-center rounded-lg border border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-text)] disabled:opacity-40"
                        aria-label={i18n._(msg({ id: 'library.filters.clear-date', message: 'Clear date filter' }))}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <select
                      aria-label={i18n._(msg({ id: 'library.filters.date-label', message: 'Filter cards by date created' }))}
                      value={activeDate}
                      onChange={event => setActiveDate(event.target.value)}
                      className={filterSelectClass}
                    >
                      {availableDates.map(date => (
                        <option key={date} value={date}>
                          {displayCardDate(date, catalog.locale)}
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
                  <span><Trans {...msg({ context: 'library.decks.title', message: 'Decks ({count, number})' })} values={{ count: customDecks.length }} /></span>
                </h3>
                <button
                  type="button"
                  ref={deckCreatorRestoreRef}
                  onClick={() => {
                    setDeckCreationError(false);
                    setDeckCreationPhase('idle');
                    setShowDeckCreator(!showDeckCreator);
                  }}
                  className="flex min-h-11 items-center gap-1 text-[11px] font-bold text-[var(--sf-brand-text)] hover:underline"
                >
                  <Plus size={13} />
                  <span>{showDeckCreator ? <Trans {...msg({ context: 'library.deck.cancel', message: 'Cancel' })} /> : <Trans {...msg({ context: 'library.deck.new', message: 'New deck' })} />}</span>
                </button>
              </div>

              <div className="flex max-h-[140px] flex-wrap gap-1.5 overflow-y-auto pr-1 scrollbar-none">
                <DeckButton active={activeCustomDeck.kind === 'all'} onClick={() => setActiveCustomDeck(ALL_PRACTICE_DECK_SCOPE)} icon={<Layers3 size={13} />} label={i18n._(msg({ id: 'library.decks.all', message: 'All decks' }))} buttonRef={deckDeletionRestoreRef} />
                <DeckButton
                  active={activeCustomDeck.kind === 'unassigned'}
                  onClick={() => setActiveCustomDeck({ kind: 'unassigned' })}
                  icon={<Folder size={13} />}
                  label={i18n._(msg({ id: 'library.decks.unassigned', message: 'Unassigned' }))}
                  count={
                    !authenticated || activeCustomDeck.kind === 'unassigned'
                      ? `${formatNumber(cards.filter(card => !card.customDeck).length)}${authenticated ? '+' : ''}`
                      : undefined
                  }
                />
                {customDecks.map(deck => (
                  <div
                    key={deck}
                    className={`flex min-h-11 items-center rounded-xl border pl-2.5 pr-1 text-xs font-bold transition-colors ${
                      activeCustomDeck.kind === 'deck' && activeCustomDeck.name === deck
                        ? 'border-[var(--sf-brand)] bg-[var(--sf-brand)] text-[var(--sf-on-brand)] shadow-xs'
                        : 'border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-text-muted)] hover:text-[var(--sf-text)]'
                    }`}
                  >
                    <button
                      type="button"
                      aria-pressed={activeCustomDeck.kind === 'deck' && activeCustomDeck.name === deck}
                      onClick={() => setActiveCustomDeck({ kind: 'deck', name: deck })}
                      className="flex min-h-11 min-w-11 items-center gap-1.5 py-1"
                    >
                      <span className={`grid size-5 place-items-center rounded-md text-[10px] text-[var(--ld-cover-ink,var(--sf-on-brand))] library-deck-cover--${normalizeCoverPreset(customDeckCoverPresets[customDeckCoverKey(deck)])}`} aria-hidden="true">{deckMonogram(deck)}</span>
                      <span className="max-w-28 truncate">{deck}</span>
                      {(!authenticated || (activeCustomDeck.kind === 'deck' && activeCustomDeck.name === deck)) && (
                        <span className="text-[10px] opacity-70">
                          {formatNumber(cards.filter(card => card.customDeck === deck).length)}
                          {authenticated ? '+' : ''}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDeckDeletionError(false);
                        setDeckPendingDeletion({ name: deck, ownerId: ownerIdRef.current });
                      }}
                      className="ml-1 flex size-11 items-center justify-center rounded-md text-inherit opacity-60 hover:bg-[var(--sf-danger)] hover:text-[var(--sf-on-brand)] hover:opacity-100"
                      title={i18n._(msg({ id: 'library.deck.delete-this', message: 'Delete this deck' }))}
                      aria-label={i18n._(msg({ id: 'library.deck.delete-action', message: 'Delete {deck} deck' }).id, { deck })}
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
                  <span><Trans {...msg({ context: 'library.categories.title', message: 'Categories' })} /></span>
              </h3>
              <div className="flex max-h-[160px] flex-wrap gap-1.5 overflow-y-auto pr-1 scrollbar-none">
                {sortedCategories.map(category => (
                  <button
                    key={category}
                    type="button"
                    aria-pressed={activeCategory === category}
                    onClick={() => setActiveCategory(category)}
                    className={`flex min-h-11 min-w-11 items-center gap-1.5 rounded-xl border px-2.5 py-1 text-xs font-bold transition-colors ${
                      activeCategory === category
                        ? 'border-[var(--sf-brand)] bg-[var(--sf-brand)] text-[var(--sf-on-brand)] shadow-xs'
                        : 'border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-text-muted)] hover:border-[color-mix(in_srgb,var(--sf-brand)_40%,transparent)] hover:text-[var(--sf-text)]'
                    }`}
                  >
                    <span>{category === 'All' ? <Trans {...msg({ id: 'library.categories.all', message: 'All' })} /> : category}</span>
                    <span className="text-[10px] opacity-70">
                      {authenticated && category !== 'All' && !cloudFacetsComplete
                        ? `${formatNumber(categoryCounts[category] || 0)}+`
                        : formatNumber(categoryCounts[category] || 0)}
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
        deckName={currentPendingDeletion?.name ?? ''}
        assignedCardCount={pendingDeckCardCount}
        unassignedCardCount={authenticated ? undefined : cards.filter(card => !card.customDeck).length}
        open={currentPendingDeletion !== null}
        onOpenChange={open => {
          if (!open && !isDeletingDeck) {
            setDeckPendingDeletion(null);
            setDeckDeletionError(false);
          }
        }}
        onConfirm={() => {
          void handleDeleteDeck();
        }}
        restoreFocusRef={deckDeletionRestoreRef}
        isDeleting={isDeletingDeck}
        error={deckDeletionError}
      />

      <DeckCreationDialog
        open={showDeckCreator}
        onOpenChange={open => {
          if (!open && !isCreatingDeck) {
            setShowDeckCreator(false);
            setDeckCreationError(false);
            setDeckCreationPhase('idle');
          }
        }}
        value={newDeckInput}
        onChange={value => {
          setDeckCreationError(false);
          setDeckCreationPhase('idle');
          setNewDeckInput(value);
        }}
        onSubmit={() => { void handleCreateDeck(); }}
        preset={deckCoverPreset}
        onPresetChange={setDeckCoverPreset}
        status={deckCreationPhase}
        errorMessage={deckCreationError ? i18n._(msg({ id: 'library.deck.create-error', message: 'Could not create this deck. Check your connection and try again.' })) : null}
        restoreFocusRef={deckCreatorRestoreRef}
      />

      <SpreadsheetImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        fileName={importFileName}
        isImporting={isImporting}
        progress={importProgress}
        result={importResult}
        onDownloadErrorReport={importResult ? () => { void downloadSpreadsheetImportErrorReport(importFileName, importResult); } : undefined}
        restoreFocusRef={importRestoreRef}
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
      className={`flex min-h-11 min-w-11 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors duration-200 cursor-pointer ${
        active
          ? 'border-[var(--sf-brand)] bg-[var(--sf-brand)] text-[var(--sf-on-brand)] font-extrabold shadow-sm scale-[1.02]'
          : 'border-[var(--sf-border)] bg-[var(--sf-surface-raised)] text-[var(--sf-text-muted)] hover:border-[color-mix(in_srgb,var(--sf-brand)_50%,transparent)] hover:text-[var(--sf-text)]'
      }`}
    >
      {icon}
      <span>{label}</span>
      {count && <span className={`text-[10px] ${active ? 'text-[#071014]/80' : 'opacity-70'}`}>{count}</span>}
    </button>
  );
}
